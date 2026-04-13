# Tmux Terminal Backend — Design

## Problem

Lucode currently runs every terminal through `LocalPtyAdapter`, which owns the PTY directly. If Lucode crashes or is restarted, every agent process dies and terminal history is lost — there is no way to recover an in-flight Claude/Codex session.

The `TerminalBackend` trait was extracted in commit `dd035c8e`. `TerminalManager::new(Arc<dyn TerminalBackend>)` accepts any backend, so a second implementation is unblocked.

## Goal

Replace `LocalPtyAdapter` with a tmux-based `TerminalBackend` so that tmux owns long-lived agent sessions — they survive Lucode restarts and are reattached on next launch.

The adapter must behave identically from the frontend's point of view at the level of output events (`broadcast::Sender<(String, u64)>`), terminal IDs, and `TerminalSnapshot { seq, start_seq, data }` shape. `seq` remains a monotonic byte counter over the attached PTY's stream.

## Decisions

### Backend selection
- tmux is the only production backend; `LocalPtyAdapter` is removed once `TmuxAdapter` lands.
- If tmux is missing at startup, Lucode fails fast. Minimum tmux version: **3.6a**.
- `TerminalBackend` trait stays as a test-mocking seam; no user-facing toggle, no env var.

### Transport
- Thin PTY attaches a normal tmux client (`tmux attach`) per visible Lucode terminal; xterm.js sees the raw byte stream.
- Control mode (`-C`) is rejected — fidelity risks not worth the cost.
- Per-project dedicated tmux socket: `tmux -L lucode-{project_hash}` — never the user default.

### Snapshot / hydration (no ring buffer)
- The 512 KiB per-terminal ring buffer is deleted.
- `snapshot()` returns `TerminalSnapshot { seq: current, start_seq: current, data: [] }`. On mount, the frontend clears xterm.js and subscribes to output at `seq`; tmux's attach-time redraw streams through as live bytes with `seq` incrementing normally.
- Scrollback lives in tmux (`history-limit 50000`).

### Session / pane model
- One tmux session per Lucode terminal ID. Mapping is identity: Lucode terminal ID *is* the tmux session name.
- Create: `tmux -L … new-session -d -s {terminal_id} -x {cols} -y {rows} -c {cwd} -- {command}`.
- Close: `tmux -L … kill-session -t {terminal_id}`.
- Lookup: `tmux -L … has-session -t {terminal_id}`.

### Session naming
- Canonical session-bound tmux name: `lucode-{sanitized_name}-{id8}` where `id8` = first 8 hex chars of DB UUID (dashes stripped).
- Lucode terminal ID (wire ID, = tmux session name) appends `-top` / `-bottom` / `-bottom-{N}` per existing `terminal_id.rs` scheme.
- No new DB column — pure function of (session id, session name).
- Rename: detect old tmux session by `-{id8}` suffix, call `tmux rename-session`.
- GC on startup: `list-sessions` on project socket; kill any `lucode-*-{id8}` without a matching DB row.

### Resize
- `resize(id, cols, rows)` resizes only the outer PTY master; tmux follows via SIGWINCH.
- Deduplicate no-op resizes (macOS silently drops same-size `TIOCSWINSZ`).
- Required tmux config: `window-size latest`, `aggressive-resize off`, `default-size 80x24`.

### tmux.conf
- Lucode-owned, written to `~/Library/Application Support/com.lucacri.lucode/tmux/tmux.conf` from compiled-in constant on every app startup.
- Version-stamped; on mismatch, `kill-server` for stale project servers.
- Shared across all per-project servers via `tmux -f`. Never sources `~/.tmux.conf`.
- Contents (see spec § tmux.conf): UI suppressed, keys unbound, mouse off, `escape-time 0`, `history-limit 50000`, `default-terminal "tmux-256color"`, `set-clipboard on`, `allow-passthrough on`, `window-size latest`, `aggressive-resize off`, `remain-on-exit on`, `destroy-unattached off`, `exit-empty off`, `default-command ""`.

### Persistence
- Per-project tmux server is **not** killed on Lucode shutdown. Next launch reattaches existing sessions.
- Explicit "close project" / "delete session" tears down tmux sessions normally.
- Config-hash mismatch on upgrade triggers `kill-server`.

## Constraints

- Frontend contract unchanged: `broadcast::Sender<(String, u64)>`, `TerminalSnapshot { seq, start_seq, data }`, monotonic `seq`.
- tmux is a system dependency — not bundled.
- macOS only.

## Out of Scope

- Bundling tmux.
- Frontend rendering / hydration / coalescing changes.
- PTY fallback or user-facing toggle.
- Control-mode transport.
- Activity / idle-detection rework (separate PR). `TmuxAdapter` feeds the attached PTY byte stream into the same `IdleDetector` / `VisibleScreen`.

## Key Files (landed analysis)

- `src-tauri/src/domains/terminal/mod.rs` — `TerminalBackend` trait, `TerminalSnapshot`.
- `src-tauri/src/domains/terminal/local.rs` — `LocalPtyAdapter` (reference impl being replaced).
- `src-tauri/src/domains/terminal/manager.rs` — `TerminalManager::new(Arc<dyn TerminalBackend>)`, `new_local()` factory to rename/replace.
- `src-tauri/src/domains/terminal/idle_detection.rs` — `IdleDetector` (reused).
- `src-tauri/src/domains/terminal/visible.rs` — `VisibleScreen` (reused).
- `src-tauri/src/shared/terminal_id.rs` — wire-ID scheme (`session-{sanitized}~{fragment}-{top|bottom}`).
- `src-tauri/src/domains/projects/manager.rs` — 16-char SHA256 project hash (reuse for socket name).
- `src-tauri/src/permissions.rs` — `APP_IDENTIFIER = "com.lucacri.lucode"`.

## Project hash reuse

Project socket: `lucode-{hash16}` where `hash16` = first 16 hex chars of SHA256 of canonical project path. Same hash that `get_project_db_path` derives.
