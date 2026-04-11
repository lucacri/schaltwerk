# tmux Terminal Backend Analysis

**Date:** 2026-04-11
**Status:** Consolidated analysis
**Scope:** Evaluate replacing or restructuring the current `LocalPtyAdapter` terminal backend around tmux.

## Executive Summary

Using tmux as Lucode's terminal substrate is feasible, but it is not a drop-in swap for `LocalPtyAdapter`.

The strongest consolidated recommendation is:

1. Use a dedicated tmux server per Lucode project, never the user's default tmux socket.
2. Map one Lucode session to one tmux session.
3. Map each Lucode terminal (`top`, `bottom-0`, `bottom-1`, ...) to one tmux window with one pane.
4. Use a hybrid backend model:
   - tmux control mode for live output, lifecycle events, resize, and metadata
   - `capture-pane -p -e` for hydration and explicit resync
5. Keep tmux behind a feature flag and roll it out to top agent terminals first.

This recommendation is stronger than a pure control-mode bridge because the current Lucode frontend is still built around replayable byte streams and hydration snapshots, and tmux control mode alone does not give Lucode a fully rendered terminal surface. A pure `%output -> xterm.js` bridge is possible, but it is the highest-fidelity-risk path.

There is also a lower-risk fallback architecture worth preserving as a contingency: tmux owns the long-lived sessions, but Lucode attaches a normal tmux client through a thin PTY for the currently visible terminal. That keeps terminal fidelity closer to today's behavior while still getting persistence and faster reconnects.

## What The Current Code Actually Looks Like

The existing backend is more PTY-specific than the abstractions suggest:

- `TerminalBackend` is snapshot-oriented and assumes append-only byte replay (`src-tauri/src/domains/terminal/mod.rs`).
- `TerminalManager` is not backend-agnostic in practice. It is concrete-typed to `Arc<LocalPtyAdapter>` and calls local-only methods such as `configure_attention_profile`, `wait_for_output_change`, and `get_all_terminal_activity` (`src-tauri/src/domains/terminal/manager.rs`).
- `LocalPtyAdapter` keeps a 512 KiB buffer per terminal and caps hydration snapshots to that buffer (`src-tauri/src/domains/terminal/local.rs`).
- Idle detection is a 250 ms ticker that iterates terminals under a lock and hashes visible screen state (`src-tauri/src/domains/terminal/local.rs`, `src-tauri/src/domains/terminal/idle_detection.rs`).
- Frontend hydration is chunked twice: 64 KiB hydration payload chunks and 8 KiB xterm write chunks with `setTimeout(..., 0)` yielding in the replay path (`src/terminal/stream/terminalOutputManager.ts`, `src/terminal/registry/terminalRegistry.ts`).
- Session activity polling is still periodic, but it now groups sessions by repository and prefers libgit2-backed stats instead of shelling out to `git status` or `git diff` (`src-tauri/src/domains/sessions/activity.rs`, `src-tauri/src/domains/git/stats.rs`).

That means tmux can help materially, but Lucode still has to refactor its transport and manager boundaries before a tmux backend feels native.

## Empirical Notes

The source analyses agreed on a few facts, and the strongest branch grounded them in code and local tmux behavior:

- Local tmux version on the analyzed machine was `tmux 3.6a`.
- tmux control mode `%output` notifications contain raw escape-rich pane output.
- `%output` chunks can split escape sequences across notifications.
- `pause-after` produces `%extended-output` and `%pause`, so control-mode flow control is viable.
- Warm tmux CLI calls are in the low single-digit milliseconds on the analyzed machine:
  - `capture-pane`, `display-message`, `list-panes`: roughly 4-6 ms each
  - `send-keys`: roughly 4-5 ms
  - resize commands: roughly 4-5 ms

That makes occasional tmux commands acceptable, but it rules out naive high-frequency per-pane polling as the main transport for 20+ active terminals.

## Feasibility

### 1. Streaming tmux output to xterm.js

The candidate approaches break down like this:

| Approach | Best Use | Main Problem | Consolidated Verdict |
|---|---|---|---|
| Normal tmux client attached in a PTY | Lowest-risk rendering fidelity | Lucode still owns a visible PTY client | Strong fallback option |
| Control mode (`-C` / `-CC`) | Live output, events, lifecycle, resize | Raw pane bytes require parsing and resync strategy | Best tmux-native live transport |
| `capture-pane -p -e` | Hydration, resync, recovery | Polling and screen scraping are poor live transport | Keep for hydrate/resync only |
| `pipe-pane` | Experiments or logging | Output-only, one pipe per pane, weak lifecycle story | Not primary transport |
| Direct pane tty tapping | None | Not a supported tmux integration surface | Reject |

The best consolidated architecture is:

- control mode for real-time output and metadata
- `capture-pane` for initial hydrate and explicit resync
- optional normal tmux client fallback if xterm fidelity becomes the blocking issue

### 2. Resize handling

Resize is feasible and should not be a user-visible latency problem.

The right primitive depends on the mapping:

- one pane per one-pane window: prefer `resize-window` or `refresh-client -C`
- multiple panes in one layout: use `resize-pane`

The important point is not raw latency. The real risk is size arbitration when multiple tmux clients can attach to the same session. Any background or diagnostic clients need `ignore-size` semantics or equivalent handling so Lucode remains authoritative for the visible terminal dimensions.

### 3. Fidelity and the double-emulation problem

This is the main technical risk.

With control mode, Lucode is not receiving a post-rendered tmux surface. It is receiving the pane's raw output stream, escaped for the control protocol. That means:

- the program inside the pane thinks it is talking to tmux or screen, not directly to xterm.js
- unusual terminfo-driven sequences are more likely to misrender than with a standard PTY-backed tmux client
- Lucode still needs escape-sequence reassembly because `%output` boundaries do not preserve control-sequence boundaries

The strongest details to keep from the source branches are:

- set `default-terminal` to `tmux-256color`, not `screen-256color`, to minimize divergence
- validate OSC-dependent Lucode signals explicitly instead of assuming passthrough
- treat `%output -> xterm.js` as workable for shell-style agent output, but not as artifact-free without a dedicated validation pass against TUIs and prompt/OSC-heavy flows

This is exactly why the hybrid recommendation is stronger than the pure control-mode recommendation: Lucode needs a resync path even if live control-mode output is the steady-state transport.

## Recommended tmux Mapping

The best mapping across the three branches is:

- one dedicated tmux server per Lucode project
- one tmux session per Lucode session
- one tmux window per Lucode terminal
- one pane per window for the initial implementation

Why this wins:

- clean lifecycle alignment with Lucode sessions
- clean socket isolation from the user's own tmux usage
- simple terminal identity mapping
- room to expand bottom tabs without changing the top-level model
- terminal-level activity can map to tmux window activity if Lucode keeps one terminal per window

The weaker alternatives were:

- one global tmux server: poorer isolation, more naming and cleanup risk
- one project-wide tmux session for every Lucode session: worse session semantics and operational clarity
- one tmux session per terminal: viable for a quick MVP, but worse long-term ergonomics

## Output and Hydration Strategy

The reconciled output strategy is:

1. On attach, switch, or reconnect:
   - run `capture-pane -p -e` for the terminal's current state or history tail
   - hydrate xterm from that capture instead of replaying a large Lucode-owned buffer
2. During steady state:
   - keep a long-lived control-mode connection
   - route `%output` by pane or window identity
   - keep only a small Lucode-side transient delta ring for reconnect gaps
3. On detected drift or parser loss:
   - do a fresh `capture-pane` resync

This preserves the strongest insight from `v3`: tmux should own durable scrollback, while Lucode should own only enough transient state to keep the live stream stable.

It also preserves the strongest warning from `v2`: Lucode should not overfit to the current string-replay snapshot contract if it wants a clean tmux backend. The longer-term direction should look more like an authoritative event stream than replaying large strings back into xterm.

## Idle Detection And Activity

One proposal assumption did not survive comparison: `#{pane_last_activity}` is not available on the analyzed tmux installation.

The consolidated answer is:

- do not plan on `pane_last_activity`
- use Lucode-tracked last-seen `%output` timestamps for pane or window activity
- optionally use `window_activity` or `session_activity` as a coarse tmux-side signal
- keep the distinction clear: this is output/activity detection, not semantic "the agent is still thinking" detection

That still matters, because removing the current 250 ms global screen-hash loop is one of the clearest performance wins in the proposal. tmux gives Lucode a path to event-driven activity updates, but Lucode still has to decide how much of its current attention logic depends on screen hashing versus raw output timestamps.

## Agent Spawn And Input

The consolidated recommendation is not to build agent launch around `send-keys "claude ..." Enter`.

Use tmux lifecycle primitives for launch:

- `new-session -d -s <name> -c <cwd> ...`
- `new-window -c <cwd> ...`
- `respawn-pane -k -c <cwd> ...`

Use `send-keys` for subsequent interactive input only.

Important details worth keeping:

- when sending literal text, use `send-keys -l`
- control characters and non-text input need separate handling from plain text
- environment variables and cwd should be established at pane or window creation time, not reconstructed with ad hoc typing

This lines up better with Lucode's current guarantees around worktree path, agent process launch, and queued startup commands.

## Performance Expectations

### Switch Latency

The current slow path is dominated by Lucode-owned backlog replay:

- backend snapshots up to 512 KiB
- 64 KiB hydration chunks
- 8 KiB xterm write chunks
- yield-heavy replay on the frontend

The best expected tmux path is current-screen dominated, not backlog dominated:

- hydrate from `capture-pane`
- continue with live control-mode deltas
- avoid replaying giant detached buffers through the legacy hydration path

That should move switching from "depends on backlog size" to "depends mostly on current screen or requested history window", which is a substantial improvement under many active terminals.

### Memory

Today Lucode duplicates terminal history across backend buffers and frontend state.

With tmux:

- tmux owns durable history
- Lucode can shrink or remove the 512 KiB backend buffer model
- Lucode keeps only a small transient delta ring plus normal xterm state

This shifts some memory to tmux, but it still reduces Lucode's per-terminal memory footprint materially.

### CPU

The best CPU win is not from resize or command latency. It is from eliminating Lucode's current global idle loop:

- no 250 ms write-locking ticker across every terminal
- no repeated visible-screen hashing for inactive terminals
- event-driven last-output tracking instead of periodic whole-map scans

That is the strongest operational reason to pursue the design if the fidelity risks are managed.

## Migration Reality

tmux is not a clean `LocalPtyAdapter` swap today.

The codebase still needs a refactor before a tmux backend is comfortable:

1. `TerminalManager` needs to stop owning `Arc<LocalPtyAdapter>` directly.
2. The backend interface needs to cover the manager-only behaviors that are currently concrete-only.
3. Lucode needs a clearer contract for hydration:
   - append-only byte replay
   - or rendered/snapshotted state with a live delta channel
4. Input handling needs to distinguish plain text from control input more explicitly.

This is the strongest reason not to call the work a "backend swap". It is a transport and lifecycle redesign with a tmux-backed implementation path.

## Recommended MVP

The most defensible MVP is:

1. keep `LocalPtyAdapter`
2. add `TmuxAdapter`
3. hide tmux behind a feature flag
4. move top agent terminals to tmux first
5. keep bottom user shells on the existing PTY backend initially
6. use:
   - dedicated project socket
   - tmux session per Lucode session
   - tmux window per Lucode terminal
   - control mode for live transport
   - `capture-pane` for hydrate and resync

This preserves most of the value while containing the blast radius.

## Rollback

The rollback story should remain simple:

- runtime backend selection
- hard fallback to `LocalPtyAdapter` when tmux is missing or unsupported
- no session data migration

That means Lucode can test tmux without burning the existing backend bridge.

## Versioning And External Dependency

The three branches disagreed slightly on minimum tmux version, but they can be reconciled cleanly:

- `tmux >= 3.2a` is a reasonable floor for control mode and subscription-era functionality
- if Lucode depends on reliable OSC passthrough for existing attention or hyperlink flows, validate against `tmux >= 3.4` and be prepared to raise the floor
- do not assume macOS ships tmux
- detect tmux at runtime and surface a clear requirement or fallback

Bundling tmux is not the first move. Detect it, version-check it, and preserve the local PTY path.

## Security And Namespace Isolation

All three branches agreed on the most important operational rule: Lucode must not share the user's default tmux socket.

Use a Lucode-owned socket namespace per project, for example:

- `tmux -L lucode-<project-hash>`
- or `tmux -S <app-controlled-private-path>`

The key requirement is isolation, predictable cleanup, and zero collision with personal tmux usage.

## Lower-Risk Alternative Worth Preserving

One branch made a good strategic point that should remain visible in the final recommendation:

If a fully tmux-native backend proves too risky for fidelity in the first phase, Lucode can still get most of the persistence value by:

- letting tmux own the long-lived session
- attaching a normal tmux client in a thin PTY only for the currently visible terminal

That is not the clean final architecture, but it is the best contingency plan if `%output -> xterm.js` fidelity or input translation becomes the blocker.

## Recommended Next Step

The next implementation document should narrow the work into one concrete path:

1. preferred path:
   - hybrid tmux backend (`capture-pane` + control mode)
   - top terminals first
   - feature-flagged rollout
2. contingency path:
   - tmux-owned sessions plus thin PTY tmux client for the visible terminal

The implementation plan should explicitly cover:

- `TerminalManager` trait-object refactor
- control-mode parser and resync strategy
- hydration contract changes
- OSC and prompt validation matrix
- fallback behavior when tmux is missing or too old

## Direct Answers

1. Streaming tmux output to xterm.js is feasible, but control mode should be paired with `capture-pane` rather than treated as the only source of truth.
2. Resize is feasible and should not be a latency problem.
3. Fidelity is the main risk; `tmux-256color`, explicit validation, and a resync path are required.
4. Best mapping: dedicated tmux server per project, tmux session per Lucode session, tmux window per Lucode terminal.
5. Best live transport: control mode. Best hydrate and recovery transport: `capture-pane`.
6. `pane_last_activity` should not be part of the design; use last output timestamps plus tmux activity metadata where useful.
7. Launch agents with tmux session or window creation, not by typing full commands with `send-keys`.
8. Switching should improve materially if Lucode stops replaying large terminal backlogs through the old snapshot path.
9. Lucode memory should drop because tmux becomes the durable history owner.
10. Lucode CPU should drop because the global idle ticker and screen hashing can be retired.
11. This is not a drop-in replacement today because the manager and transport contracts are still PTY-shaped.
12. Top-terminals-first is the right MVP.
13. Feature-flagged rollback is straightforward and should remain available.
14. Treat tmux as an external dependency with runtime detection and version checks.
15. Control mode is stable enough to build on, but only with a deliberately narrow protocol surface.
16. Dedicated socket isolation is mandatory.
17. Personal tmux sessions are irrelevant if Lucode uses its own socket namespace.
