# View Processes Window Design

## Context

Lucode owns one tmux server per project (`-L lucode-v2-<project_hash16>` — see `src-tauri/src/domains/terminal/manager.rs:20`). Those servers are configured with `destroy-unattached off`, `exit-empty off`, `exit-unattached off` (`tmux_conf.rs:90-93`) and therefore persist across app restarts, project closes, and empty-session states until something explicitly kills them.

Two problems follow from that:

1. When the bundled tmux.conf stamp changes (for example the `mouse-v1` addition in commit `75c300d2`), servers launched under the old stamp keep their old in-memory options. A user hitting a stale-config bug has no way to discover which servers are stale.
2. A user running many projects cannot audit Lucode's tmux footprint: which servers are alive, where, for how long, and how many resources they consume.

There is no user-visible inspector today; the only surfaces that read tmux state are internal (`list_sessions`, `session_has_live_pane`) and scoped to a single project's socket.

## Approaches Considered

### 1. Reuse an existing modal pattern (recommended)

Add a new menu entry `Window > View Processes…` that emits a `SchaltEvent`. A new overlay component mounted in `App.tsx` (same pattern as `SettingsModal` at `src/App.tsx:2354`) listens for the event and toggles open. The backend exposes one new Tauri command that enumerates Lucode-owned tmux sockets and returns a snapshot. A manual refresh button re-invokes the command.

This fits every Lucode convention: menu-item → SchaltEvent → overlay mounted by `App.tsx`, type-safe `TauriCommands` entry, no polling, no secondary native window. The existing `SelectAllRequested` flow already models the menu-to-event shape end-to-end.

### 2. Open a secondary native Tauri window

A separate `WebviewWindow` for the inspector. No code in the repo does this today (`grep WebviewWindowBuilder|WindowBuilder` → zero hits), so we would be inventing a new surface class. Adds window lifecycle handling, focus coordination, and menu scoping questions for a feature that does not need isolation from the main UI.

### 3. Inline inspector as a SettingsModal tab

Co-locate with the existing settings UI. It is reachable, but semantically wrong: this is an ephemeral diagnostic, not a preference. It also couples the inspector to the settings modal's state shape and tab navigation.

Approach 1 is recommended.

## Design

### Menu wiring (`src-tauri/src/main.rs`)

Add `Window > View Processes…` under the existing `window_menu` block (lines 1322-1330) with **no keyboard accelerator** — `Mod+Shift+P` stays bound to `CreatePullRequest` (`src/keyboardShortcuts/config.ts:126`). On click it emits a new `SchaltEvent::ViewProcessesRequested` event through the same `on_menu_event` handler that today handles `MACOS_SELECT_ALL_MENU_ID` (main.rs:1432-1440). Add a constant `MACOS_VIEW_PROCESSES_MENU_ID` next to the existing one.

### Event plumbing

- Rust: `SchaltEvent::ViewProcessesRequested` in `src-tauri/src/infrastructure/events/mod.rs`, string form `schaltwerk:view-processes-requested`. Update the round-trip test in that file.
- TS: mirror the variant in `src/common/events.ts` and add a `void` payload entry to `EventPayloadMap`.

### Backend enumeration

New module `src-tauri/src/domains/terminal/tmux_inspect.rs` with:

```rust
pub struct ServerInfo {
    pub socket_name: String,         // "lucode-v2-<hash>"
    pub project_hash: String,        // "<hash>"
    pub project_path: Option<String>,// resolved via ProjectHistory::get_recent_projects
    pub project_name: Option<String>,// file_name of the resolved path
    pub socket_path: String,         // absolute path to the socket file
    pub is_stale: bool,              // file present but list-sessions says "no server"
    pub sessions: Vec<SessionInfo>,
}

pub struct SessionInfo {
    pub name: String,
    pub created_unix: Option<i64>,
    pub last_activity_unix: Option<i64>,
    pub attached: bool,
    pub panes: Vec<PaneInfo>,
}

pub struct PaneInfo {
    pub pane_id: String,        // e.g. "%3"
    pub pid: i32,               // #{pane_pid}
    pub command: String,        // #{pane_current_command}
    pub rss_kb: Option<u64>,    // ps -o rss=  (pid only; v1 does not walk children)
    pub cpu_percent: Option<f32>,// ps -o %cpu=
}

pub async fn list_lucode_tmux_servers() -> Result<Vec<ServerInfo>, String>;
```

**Enumeration strategy:**
1. Resolve the tmux socket directory: `$TMUX_TMPDIR` if set, else `$TMPDIR`, else `/tmp`, suffixed with `/tmux-<uid>` (tmux's own convention). Read directory entries; keep names starting with `lucode-v2-`.
2. For each socket, run `tmux -L <name> list-sessions -F '<format>'`. If the invocation fails and `is_no_server_or_session` (`tmux_cmd.rs:64`) matches, flag `is_stale = true` and skip per-session work. Any other error aborts only that server's row (captured as `is_stale = true` with a best-effort message logged), not the whole listing.
3. For each live session, run `tmux -L <name> list-panes -t <session> -F '<format>'`. Format string packs `pane_id`, `pane_pid`, `pane_current_command`, `session_name`, `session_created`, `session_activity`, `session_attached` separated by a rare delimiter (`\t`) and parse line-by-line.
4. Collect all pane PIDs, then run a single `ps -o pid=,rss=,%cpu= -p <comma-list>` and join the results back. Missing PIDs (process exited between calls) leave `rss_kb` / `cpu_percent` as `None`.
5. Map socket hash → project: iterate `ProjectHistory::get_recent_projects()`, compute `project_hash16` (`src-tauri/src/shared/project_hash.rs:9`) for each, look up in a `HashMap<hash, RecentProject>`. Unknown hashes render as "Unknown project (\<hash\>)".

**Invoker:** reuse `SystemTmuxCli::new(socket, config_path)` per server — it already bakes in `-L <socket> -f <conf>` and the `is_no_server_or_session` classifier. The inspector does not mutate any server; it only reads.

### Tauri command

`list_lucode_tmux_servers` in the terminal domain command set, registered in `main.rs`'s `tauri::generate_handler!` list and exposed as `TauriCommands.ListLucodeTmuxServers` in `src/common/tauriCommands.ts`.

Return type serializes the `ServerInfo` tree above. Command body calls `tmux_inspect::list_lucode_tmux_servers().await`.

### Frontend overlay

New component `src/components/diagnostics/ViewProcessesModal.tsx` mounted once in `App.tsx` alongside `SettingsModal`. State lives locally:

```
open: boolean
loading: boolean
data: ServerInfo[] | null
error: string | null
```

- Toggle open by subscribing to `SchaltEvent.ViewProcessesRequested` via `listenEvent`.
- Escape key closes (match `SettingsModal` convention).
- On open and on manual refresh click, call `invoke(TauriCommands.ListLucodeTmuxServers)`; populate `data`.
- Layout: a scrollable list. Each server row shows project name + path (or "Unknown project (<hash>)"), socket name, stale badge if applicable, and an expandable section listing sessions → panes. Each pane row shows command, PID, RSS (MiB), %CPU, and — for sessions — created / last-activity timestamps as human-relative strings.
- All colors come from `src/common/theme.ts` / CSS variables (`--color-bg-elevated`, `--color-border-subtle`, `--color-text-primary`, etc.). Typography uses the helpers from `src/common/typography.ts` for any session-label-guarded area (`headingLarge`, `body`, `caption`).
- Empty state: "No Lucode tmux servers running."
- Error state: show `error` with a retry button.
- No auto-refresh. No kill buttons. No per-pane idle hints.

### Data flow summary

```
Menu click (macOS) ─► SchaltEvent::ViewProcessesRequested (backend emit)
                   └─► listenEvent in ViewProcessesModal ─► setOpen(true)
                       └─► invoke ListLucodeTmuxServers
                           └─► tmux_inspect::list_lucode_tmux_servers
                               ├─ scan socket dir for lucode-v2-*
                               ├─ per socket: SystemTmuxCli list-sessions / list-panes
                               ├─ ps -o pid=,rss=,%cpu= -p <pids>
                               └─ project hash lookup
                           └─► ServerInfo[] rendered
```

### Error handling

- Missing tmux binary: bubble the `failed to spawn tmux` error string up; modal shows error state.
- Socket dir missing: treat as empty list (not an error).
- Individual socket fails a non-"no server" way: record `is_stale = true` with log, continue with others.
- `ps` missing or returning garbage: leave metrics as `None`; do not fail the whole listing.
- All failures logged through the backend `log` crate (no `console.log`).

## Testing

### Rust unit tests (TDD)

- `tmux_inspect::tests::parses_list_sessions_output` — synthetic `#{session_name}\t#{session_created}\t…` lines produce expected `SessionInfo`.
- `tmux_inspect::tests::parses_list_panes_output` — similar for pane format.
- `tmux_inspect::tests::parses_ps_output_joins_metrics` — given a fake `ps` output string and a list of PIDs, returns the right `rss_kb` / `cpu_percent` per pane.
- `tmux_inspect::tests::stale_socket_is_flagged_not_failed` — `MockTmuxCli` (see `tmux_cmd.rs:295`) returns a "no server running" stderr; enumeration marks the server stale and does not error.
- `tmux_inspect::tests::unknown_hash_keeps_socket_name` — project history lookup miss returns `project_path = None`, leaves `socket_name` populated.
- `tmux_inspect::tests::socket_dir_resolution_prefers_tmpdir_env` — env-driven resolution with `serial_test` so tests don't race.

The socket-scanning path uses a small `trait SocketSource` so tests can feed a fixture directory; the production impl reads the real tmpdir.

### Rust events test

Extend the existing round-trip test in `infrastructure/events/mod.rs` to cover `SchaltEvent::ViewProcessesRequested` → `"schaltwerk:view-processes-requested"`.

### Frontend tests (Vitest)

- `ViewProcessesModal.test.tsx`:
  - renders empty state when command returns `[]`;
  - renders a server with one session + two panes using fixture data;
  - clicking refresh re-invokes `TauriCommands.ListLucodeTmuxServers`;
  - Escape closes the modal;
  - stale flag renders a visible badge using theme classes (assert class list, not hex).

Mock `invoke` via the project's existing Tauri mock setup (see sibling tests under `src/components/modals/`).

### Type / style guards

- `bun run lint` must pass (no Tailwind `text-*` size utilities in session-label-guarded files; use typography helpers).
- `bun run test` (full suite, includes knip, clippy, nextest) must be green before claiming done.

## Out of Scope (v1)

- Kill / signal actions.
- Showing the tmux.conf stamp that each server was booted with (tmux does not expose the `-f` path via `show-options`; would require out-of-band tracking).
- Auto-refresh / live streaming.
- Walking child processes under each pane PID to attribute resource usage beyond the shell.
- Reusing agent idle-detection atoms as per-pane hints.
- Windows / Linux menu wiring. The feature is macOS-only in v1 (see `memory/user_solo_macos.md`).

## Follow-ups (not in this PR)

- Add kill-server / kill-session actions once the read-only view has shipped and been used.
- Persist the config stamp each server was booted with so the inspector can flag "booted with old stamp" explicitly.
- Add a "Rebuild all stale servers" action once stamp tracking exists.

## CHANGES.md

On merge, add a `## View Processes Window` entry under the next release heading in `CHANGES.md`, per `memory/feedback_changes_md.md` — this is a user-visible Lucode feature that diverges from upstream Schaltwerk.
