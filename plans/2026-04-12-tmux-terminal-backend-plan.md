# Tmux Terminal Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `LocalPtyAdapter` with a tmux-based `TerminalBackend` so agent terminals survive Lucode restarts.

**Architecture:** A per-project dedicated `tmux` server (socket `lucode-{project_hash}`) hosts one tmux session per Lucode terminal ID. Each visible terminal has an outer PTY running `tmux attach -t <id>`; xterm.js reads the PTY byte stream as it does today. Lucode owns a versioned `tmux.conf` that disables UI, unbinds keys, and sets `remain-on-exit on`. The 512 KiB per-terminal ring buffer is deleted — `snapshot()` returns the empty tail and the next attach redraw streams through the broadcast channel like any other output. Idle detection, coalescing, visible screen, attention signals, and control-sequence sanitation are kept via the existing helper modules; only the PTY-I/O + process-supervision layer changes.

**Tech Stack:** Rust, Tauri, tokio, `portable-pty` (outer PTY for tmux client), system `tmux ≥ 3.6a` (not bundled), SHA-256 (`sha2`) for project hash, existing `IdleDetector`/`VisibleScreen`/`CoalescingState` modules.

**Key design constraints (locked by design doc):**
- tmux is the sole production backend; `LocalPtyAdapter` is removed.
- `TerminalBackend` trait surface is unchanged; `TmuxAdapter` becomes the single impl.
- macOS-only; fail fast if tmux is missing.
- Frontend contract unchanged (`broadcast::Sender<(String, u64)>`, `TerminalSnapshot { seq, start_seq, data }`).
- No timeouts/delays/polling/retries (per CLAUDE.md).
- Activity/idle refactor is **out of scope**.

---

## Phase 0 — Foundations

### Task 0.1: Expose a reusable project-hash helper

**Files:**
- Modify: `src-tauri/src/domains/projects/manager.rs`
- Test: `src-tauri/src/domains/projects/manager.rs` (inline `#[cfg(test)]`)

The function that derives the 16-char SHA-256 prefix used for the sessions DB path is private inside `get_project_db_path`. Extract it into a `pub fn project_hash16(project_path: &Path) -> Result<String, String>` used both by the DB path logic and the future tmux socket name.

**Step 1 (test first):** Add a unit test asserting that `project_hash16(Path::new("/fixed/abs/path"))` returns a 16-char lowercase-hex string equal to the first 16 chars of `sha256("/fixed/abs/path")` (when canonicalization is a no-op for an absolute existing path, or if canonicalization is unavailable we can assert length/format properties).

**Step 2:** Refactor `get_project_db_path` to call `project_hash16`, keeping the existing DB path output exactly stable (cover with an inline snapshot test).

**Step 3:** Commit with message: `refactor(projects): expose project_hash16 for reuse`.

### Task 0.2: App-support paths helper

**Files:**
- Create: `src-tauri/src/shared/app_paths.rs`
- Modify: `src-tauri/src/shared/mod.rs` (add `pub mod app_paths;`)

Create `app_support_dir() -> PathBuf` resolving to `~/Library/Application Support/com.lucacri.lucode` on macOS (using `dirs::data_dir()` + `APP_IDENTIFIER` from `src-tauri/src/permissions.rs`). Create `tmux_conf_path() -> PathBuf` = `app_support_dir().join("tmux").join("tmux.conf")`.

**Tests (inline):** Assert `app_support_dir()` ends with `"com.lucacri.lucode"` and `tmux_conf_path()` ends with `"tmux/tmux.conf"`. Do not actually create the directory in tests.

**Commit:** `feat(shared): add app_paths helper for tmux config`.

### Task 0.3: tmux session-name derivation

**Files:**
- Modify: `src-tauri/src/shared/terminal_id.rs`
- Test: same file, inline.

Add:

```rust
pub const TMUX_SESSION_NAME_PREFIX: &str = "lucode-";

/// Build the canonical tmux session prefix for a Lucode session id+name.
/// Returns `lucode-{sanitized_name}-{id8}` where id8 = first 8 hex chars of
/// `session_id` with dashes stripped, lowercased.
pub fn tmux_session_name_for_lucode_session(session_id: &str, session_name: &str) -> String { … }

/// Extract the id8 suffix from a tmux session name if it matches the
/// Lucode scheme; used by rename + GC.
pub fn id8_from_tmux_session_name(tmux_name: &str) -> Option<String> { … }
```

Sanitization rules match existing `sanitize_name()`: `[A-Za-z0-9_-]` preserved, everything else → `_`, empty → `"unknown"`. Lower-case only the id8 suffix.

**Tests:**
- `"A1B2C3D4-e5f6-7890-1234-56789abcdef0" + "Fix Login Bug"` → `"lucode-Fix_Login_Bug-a1b2c3d4"`.
- `"noise/chars"` name → safely sanitized.
- Round-trip `id8_from_tmux_session_name` against above output.
- Non-matching strings (e.g., `"other-session"`) return `None`.

**Commit:** `feat(terminal-id): derive canonical tmux session names`.

---

## Phase 1 — tmux.conf provisioning & preflight

### Task 1.1: Compiled-in tmux.conf constant

**Files:**
- Create: `src-tauri/src/domains/terminal/tmux_conf.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs` (`pub mod tmux_conf;`)

Export `pub const TMUX_CONF_BODY: &str = "…";` using the literal from the design doc, with `{app_version}` replaced by `env!("CARGO_PKG_VERSION")` at compile time via `concat!`. Expose `pub fn config_version_stamp() -> &'static str` returning just the first-line stamp so callers can hash/compare.

**Tests (inline):**
- `TMUX_CONF_BODY` contains each of the directives: `status off`, `unbind-key -a`, `history-limit 50000`, `window-size latest`, `aggressive-resize off`, `remain-on-exit on`, `destroy-unattached off`, `exit-empty off`.
- `config_version_stamp()` starts with `"# lucode-tmux-conf v"`.

**Commit:** `feat(terminal): compile-in lucode tmux.conf`.

### Task 1.2: Provision tmux.conf on disk

**Files:**
- Create: `src-tauri/src/domains/terminal/tmux_bootstrap.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs` (`pub mod tmux_bootstrap;`)

Function: `pub fn ensure_tmux_conf_on_disk() -> Result<PathBuf, String>`.

Behavior:
1. Compute path via `tmux_conf_path()`.
2. Create parent dir (`fs::create_dir_all`, permission errors → `Err`).
3. If file exists **and** its first line equals the current `config_version_stamp()`, return the path unchanged.
4. Otherwise, write `TMUX_CONF_BODY` atomically (write to `file.tmp` + rename) and return the path.

Return value is the canonical path the caller will pass via `tmux -f`.

**Tests (inline, using `tempfile::TempDir` to override app-support dir via a test helper in `app_paths.rs`):**
- First call creates the file.
- Second call with identical stamp is a no-op (same `mtime` or at least identical content).
- Changing the stamp (via a `#[cfg(test)]` override) triggers rewrite.

**Commit:** `feat(terminal): provision lucode tmux.conf on startup`.

### Task 1.3: tmux preflight check

**Files:**
- Create: `src-tauri/src/domains/terminal/tmux_preflight.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs`.

```rust
pub fn ensure_tmux_available() -> Result<TmuxVersion, String>;

pub struct TmuxVersion { pub major: u32, pub minor: u32, pub patch: String }
```

Implementation: `Command::new("tmux").arg("-V").output()`, parse the form `"tmux 3.6a"` (major.minor + optional letter suffix). Fail if (major, minor) < (3, 6). Letter suffix does **not** fail; we only require ≥ 3.6.

**Tests:** Parser tests over synthetic inputs `"tmux 3.6a\n"`, `"tmux 3.5\n"`, `"tmux 3.10\n"`, malformed `"foo\n"`. No subprocess in unit tests; integration test confirms happy path on the dev machine.

**Commit:** `feat(terminal): tmux version preflight`.

### Task 1.4: Kill stale project servers on config change

**Files:** `tmux_bootstrap.rs` additions.

Function: `pub fn kill_stale_servers_on_config_change(previous_stamp: Option<&str>, current_stamp: &str, known_project_hashes: &[String]) -> Result<(), String>`.

Runs `tmux -L lucode-{hash} kill-server` for each project hash when `previous_stamp != current_stamp`. Non-existent sockets are not an error (exit code 1 with "no server running" is expected and swallowed; other failures are logged and returned).

**Tests:** Pure unit tests that gate behavior behind the `tmux_cmd` trait (introduced in Task 2.1) so we can assert calls without spawning subprocesses.

**Commit:** `feat(terminal): kill stale tmux servers on config upgrade`.

---

## Phase 2 — TmuxAdapter core

### Task 2.1: Tmux command abstraction

**Files:**
- Create: `src-tauri/src/domains/terminal/tmux_cmd.rs`

Introduce a small trait wrapping `std::process::Command` + `tokio::process::Command` used by TmuxAdapter:

```rust
#[async_trait::async_trait]
pub trait TmuxCli: Send + Sync {
    async fn run(&self, args: &[&str]) -> Result<TmuxCliOutput, String>;
}

pub struct TmuxCliOutput { pub status: i32, pub stdout: String, pub stderr: String }

pub struct SystemTmuxCli { pub socket: String, pub config_path: PathBuf }
```

`SystemTmuxCli::run(args)` always invokes `tmux -L {socket} -f {config_path} <args...>`. A `MockTmuxCli` lives in `#[cfg(test)]`, recording calls and returning scripted outputs.

**Tests:** MockTmuxCli round-trip + SystemTmuxCli builds the right argv (assert on `args` passed to `Command`).

**Commit:** `feat(terminal): introduce TmuxCli abstraction`.

### Task 2.2: TmuxAdapter skeleton

**Files:**
- Create: `src-tauri/src/domains/terminal/tmux.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs` — register module + `pub use tmux::TmuxAdapter;`.

Struct fields (mirror LocalPtyAdapter where meaningful):

```rust
pub struct TmuxAdapter {
    tmux: Arc<dyn TmuxCli>,
    project_hash: String,
    terminals: Arc<RwLock<HashMap<String, TerminalState>>>,
    creating: Arc<Mutex<HashSet<String>>>,
    pty_masters: Arc<Mutex<HashMap<String, Box<dyn MasterPty + Send>>>>,
    pty_writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
    pty_children: Arc<Mutex<HashMap<String, Box<dyn Child + Send>>>>,
    reader_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    coalescing_state: CoalescingState,
    pending_control_sequences: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    initial_commands: Arc<Mutex<HashMap<String, InitialCommandState>>>,
    last_resize: Arc<Mutex<HashMap<String, (u16, u16)>>>,
    output_event_sender: Arc<broadcast::Sender<(String, u64)>>,
}

impl TmuxAdapter {
    pub fn new(project_hash: String, conf_path: PathBuf) -> Self { … }
    pub fn new_with_cli(project_hash: String, tmux: Arc<dyn TmuxCli>) -> Self { … }
}
```

Only stubs; all `TerminalBackend` methods return `Err("unimplemented")` for now except `snapshot()` which returns `TerminalSnapshot { seq: state.seq, start_seq: state.seq, data: vec![] }` when the state exists.

**Tests:** `new()` constructs without error; `snapshot()` on unknown id returns `Err`.

**Commit:** `feat(terminal): TmuxAdapter skeleton`.

### Task 2.3: `create_with_size` → `tmux new-session -d`

Implement the session-creation arm (no attach yet):

1. Reject duplicate ids via `creating` + `terminals`.
2. Build argv: `["new-session", "-d", "-s", id, "-x", cols, "-y", rows, "-c", cwd]`.
3. If `CreateParams.app` is `Some(spec)`, append `"--", spec.command, spec.args…`; env vars become repeated `-e KEY=VAL`.
4. If `app` is `None`, pass no command (tmux spawns the server's `default-command`, which is empty → `$SHELL`).
5. On success, insert a fresh `TerminalState { seq: 0, start_seq: 0, buffer: Vec::new(), screen: VisibleScreen::new(cols, rows), idle_detector: IdleDetector::new(IDLE_THRESHOLD_MS), last_output: SystemTime::now(), … }`.
6. `create()` forwards to `create_with_size(params, 80, 24)` (matching `default-size`).

Failure handling: bubble tmux stderr into the returned `Err`. No retries.

**Tests (against `MockTmuxCli`):**
- Happy path asserts argv list verbatim.
- Duplicate id returns `Err`.
- ApplicationSpec translates env + command correctly.

**Commit:** `feat(terminal): tmux create_with_size via new-session`.

### Task 2.4: Outer PTY attach + reader pump

The big one. When `create_with_size()` succeeds, immediately open a `portable-pty` at size `(cols, rows)` and spawn `tmux -L {socket} -f {conf} attach-session -t {id}` inside it. Store master/writer/child, start a reader task that mirrors `handle_reader_data` from `local.rs`.

Factor the reader body out of `local.rs:641-867` into a new `reader_loop.rs` module so both adapters can call it. Specifically extract `handle_reader_data(id, data, &state, &coalescing_state, &pending_control_sequences, &output_event_sender, &initial_commands, &app_handle)` — keep it backend-agnostic. If extraction is costly, copy the body into `tmux.rs` for now and leave a TODO to DRY up once LocalPtyAdapter is deleted in Phase 4.

**Tests (integration — require real tmux, behind `#[cfg(test)] + #[ignore]`-gated feature, run in `just test`):**
- Create a terminal with `app` = `{ command: "printf", args: ["hello"] }`, subscribe to `output_event_sender`, assert a `(_, seq)` event fires with `seq >= 5`.
- `snapshot(id, None)` afterwards returns `seq >= 5`, `start_seq == seq`, `data == []`.

**Commit:** `feat(terminal): tmux reader pump + broadcast`.

### Task 2.5: `write` / `write_immediate`

Implementation: pull `Box<dyn Write>` out of `pty_writers`, call `write_all(data)` + `flush()`. Wrap in `spawn_blocking` to avoid blocking the runtime. `write_immediate` behaves identically for now (LocalPtyAdapter has parity here; differences only matter if coalescing tracks submissions — which lives in the writer helpers in `submission.rs` and is invoked by `TerminalManager`, not the backend).

**Tests:** Mock a writer in a stand-alone test by injecting a `Vec<u8>`-backed writer via a trait seam (new helper `insert_writer_for_test`), call `adapter.write(id, b"hi")`, assert buffer contents.

**Commit:** `feat(terminal): tmux write passes through to outer PTY`.

### Task 2.6: `resize`

Body:
1. Look up `last_resize`; if equal to new `(cols, rows)`, return `Ok(())`.
2. Else, `master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })` and update `last_resize`.

No direct `tmux resize-pane` call — tmux follows via SIGWINCH.

**Tests:** Unit test using a fake `MasterPty` that records resize calls; assert second identical resize is skipped.

**Commit:** `feat(terminal): dedup no-op resizes and skip tmux resize-pane`.

### Task 2.7: `close`

1. `tmux kill-session -t {id}` via `TmuxCli`.
2. Kill the outer PTY child (`child.kill().ok()`).
3. Abort reader handle.
4. Drop all per-terminal state.

Any individual failure is logged but does not block other cleanup steps.

**Tests:** Happy-path integration test creates then closes; asserts `exists(id) == Ok(false)` and reader handle is dropped.

**Commit:** `feat(terminal): close kills tmux session and outer PTY`.

### Task 2.8: `exists`

`exists(id)` calls `tmux has-session -t {id}`. Exit code 0 → `Ok(true)`, exit code 1 with stderr matching "can't find session" or "no server running" → `Ok(false)`, other non-zero → `Err(stderr)`.

**Tests (MockTmuxCli):** Cover all three branches explicitly.

**Commit:** `feat(terminal): tmux exists via has-session`.

### Task 2.9: Activity status + `get_all_terminal_activity`

Mirror LocalPtyAdapter (`local.rs:1500-1528` region): read `(seq, last_output, idle_detector.is_idle())` from `TerminalState`; compute elapsed seconds from `SystemTime::now().duration_since(last_output)`. Tests assert that a newly created terminal reports `elapsed == 0`.

**Commit:** `feat(terminal): tmux adapter activity tracking`.

### Task 2.10: `force_kill_all`

Iterate known terminals → `close(id)`. Then `tmux -L {socket} kill-server` as a belt-and-braces final step (errors swallowed).

**Tests:** MockTmuxCli integration asserts `kill-server` is the last call.

**Commit:** `feat(terminal): force_kill_all tears down the project server`.

---

## Phase 3 — Persistence: reattach & GC

### Task 3.1: `reattach_existing_on_startup`

**Files:** `tmux.rs` additions.

New method on `TmuxAdapter`:

```rust
pub async fn reattach_existing_on_startup(&self, known_terminal_ids: &[(String, u16, u16, String /* cwd */)]) -> Result<(), String>
```

For each `(id, cols, rows, cwd)` passed in from the caller (TerminalManager orchestrates this from the DB layer):
1. `tmux has-session -t {id}` — if false, skip.
2. Open a fresh outer PTY with the given size.
3. Spawn `tmux attach-session -t {id}` in it.
4. Register the state as if freshly created — seq starts at 0 again; xterm.js mount will get the attach redraw as live bytes, matching the design ("cold boot, hot reload, and post-restart reattach all go through the same code path").

**Tests (integration):** Start an adapter, create a session, drop & rebuild the adapter on the same socket, reattach, assert `exists(id)` and that a write still reaches the pane (verify by sending a shell command that echoes to a temp file and inspecting the file).

**Commit:** `feat(terminal): reattach existing tmux sessions on startup`.

### Task 3.2: GC of orphaned sessions

New method:

```rust
pub async fn gc_orphans(&self, known_id8s: &HashSet<String>) -> Result<Vec<String>, String>
```

`tmux list-sessions -F "#{session_name}"`, for each name starting with `TMUX_SESSION_NAME_PREFIX`: extract `id8` via `id8_from_tmux_session_name`. If absent from `known_id8s`, call `kill-session -t {name}` and append to the return vector. Errors are collected but do not halt iteration.

**Tests (MockTmuxCli):**
- Happy case: 3 lucode sessions, 1 orphaned → exactly one kill.
- Non-lucode sessions are ignored.
- Empty list returns `[]`.

**Commit:** `feat(terminal): gc orphaned lucode tmux sessions`.

### Task 3.3: Rename tmux session

New method:

```rust
pub async fn rename_session_for_id8(&self, id8: &str, new_terminal_id: &str) -> Result<(), String>
```

`list-sessions -F "#{session_name}"`, find the entry whose `id8` matches, call `tmux rename-session -t {old} {new}`. No-op + `Ok(())` if no match.

**Tests (MockTmuxCli):**
- Matches and renames.
- No match → Ok (with a log).
- Multiple matches → rename all (should be rare; one terminal = top + bottom(s) per session, all share id8 but different suffixes; match only the exact `-{id8}` suffix, not prefix).

**Commit:** `feat(terminal): rename lucode tmux sessions`.

---

## Phase 4 — Integration into TerminalManager / Project lifecycle

### Task 4.1: Swap `new_local()` for `new_tmux()`

**Files:**
- Modify: `src-tauri/src/domains/terminal/manager.rs`
- Modify: `src-tauri/src/project_manager.rs` (lines ~54, ~121)
- Modify: `src-tauri/src/shared/terminal_gateway.rs` (line ~21)

Replace `TerminalManager::new_local()` body:

```rust
pub fn new_for_project(project_path: &Path) -> Result<Self, String> {
    let hash = projects::project_hash16(project_path)?;
    let conf = tmux_bootstrap::ensure_tmux_conf_on_disk()?;
    let socket = format!("lucode-{hash}");
    let cli = Arc::new(SystemTmuxCli { socket, config_path: conf });
    Ok(Self::new(Arc::new(TmuxAdapter::new_with_cli(hash, cli))))
}
```

Update both callers to pass `&project_path`. If the caller doesn't already have a project path (the `terminal_gateway.rs` default `new_local` case is only used in tests — confirm this during execution and either remove the default constructor or keep it behind `#[cfg(test)]` with a hermetic `MockTmuxCli`).

**Commit:** `refactor(terminal): wire tmux backend into TerminalManager`.

### Task 4.2: App startup preflight

**Files:**
- Modify: `src-tauri/src/main.rs` (before `tauri::Builder::run`)
- Modify: `src-tauri/src/startup.rs` (wherever the pre-Tauri initialization lives)

Early in `main()`:
1. Call `tmux_preflight::ensure_tmux_available()?`. On failure, log + panic with a human-readable message ("tmux 3.6 or newer is required; install via `brew install tmux`").
2. Call `tmux_bootstrap::ensure_tmux_conf_on_disk()?`.

**Commit:** `feat(startup): preflight tmux + provision config`.

### Task 4.3: Reattach & GC on project open

**Files:**
- Modify: `src-tauri/src/project_manager.rs`

When `Project::new` finishes loading sessions from the DB:
1. Compute `known_id8s: HashSet<String>` from all live sessions.
2. Call `terminal_manager.backend_gc_orphans(&known_id8s)` (new pass-through method on `TerminalManager`).
3. For each (live session, terminal kind ∈ {top, bottom, bottom-N}), if `exists(id) == true`, call `reattach_existing_on_startup(...)` with persisted size (default `80x24` if unknown).

Add a test with a `MockTmuxCli` that simulates an existing session and asserts the adapter registers the reattach.

**Commit:** `feat(projects): reattach tmux sessions on project open`.

### Task 4.4: Session rename hook

**Files:** `src-tauri/src/domains/sessions/service.rs` — wherever `rename_session` lives.

After renaming in the DB, call `terminal_manager.backend_rename_id8(id8, new_terminal_ids)` for `-top`, `-bottom`, and each bottom-tab id. Failures are logged but do not block the DB rename.

**Commit:** `feat(sessions): propagate rename to tmux`.

---

## Phase 5 — Remove LocalPtyAdapter

### Task 5.1: Delete LocalPtyAdapter

**Files:**
- Delete: `src-tauri/src/domains/terminal/local.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs` — remove `pub mod local;` and `pub use local::LocalPtyAdapter;`.
- Delete any `LocalPtyAdapter`-specific tests.

If the reader-body extraction in Task 2.4 left a `reader_loop.rs`, keep it. Otherwise inline remains in `tmux.rs`.

**Commit:** `refactor(terminal): delete LocalPtyAdapter`.

### Task 5.2: Update `manager_test.rs`

Rewrite tests currently tied to `LocalPtyAdapter::new()` to use `TerminalManager::new_for_project_with_cli(MockTmuxCli)`. Drop tests listed as "LocalPtyAdapter-specific" in the research report (zombie prevention, signal handling for direct children, PTY write buffering); those behaviors now belong to tmux and are out of scope.

**Commit:** `test(terminal): adapt manager tests to tmux backend`.

---

## Phase 6 — Validation

### Task 6.1: `just test`

Run the full suite. Fix any TS/Rust/knip/shear/clippy/nextest issues. Do not mark the plan complete until all are green (per CLAUDE.md: "rerun the full validation suite and report 'tests green'").

### Task 6.2: Manual smoke

1. `bun run tauri:dev` → create a session → terminal spawns a shell.
2. Type `sleep 600 &` then close the Lucode window.
3. Relaunch Lucode → confirm the session's terminal reappears with the sleep still running (`pgrep -f 'sleep 600'` on host).
4. Rename the session, relaunch, confirm terminal still attaches (tmux session picked up by `id8`).
5. Delete the session → `tmux -L lucode-* list-sessions` shows the session gone.

### Task 6.3: `requesting-code-review`

Invoke `superpowers:requesting-code-review` to audit against the design doc and project conventions before the final squashed commit.

---

## Non-Goals (reminder)

- No changes to `IdleDetector` internals or activity domain.
- No frontend changes.
- No bundling of tmux.
- No control-mode (`-C`) transport.
- No env/user-facing toggle between backends.

## Risk log

- **Reader extraction churn (Task 2.4):** the `handle_reader_data` body in `local.rs` is ~230 lines and tightly couples to LocalPtyAdapter fields. If extraction proves hairy, duplicate-then-DRY in Task 5.1 is acceptable.
- **Attach race:** `new-session -d` returns before the pane's first draw. The attach PTY may see the pane empty until tmux paints. `refresh-client -S` is already fallback-ready per the design doc; wire it only if a blank-pane test fails.
- **Env leakage:** tmux server inherits env once at first launch. New env vars added after server start are not seen by later sessions unless `update-environment` applies. The tmux.conf includes the standard agent API keys; if a new variable is needed, it must be added to `update-environment` (and documented).
