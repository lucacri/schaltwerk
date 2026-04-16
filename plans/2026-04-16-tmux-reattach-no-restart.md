# Tmux Reattach Without Restart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve surviving tmux-backed agent sessions on Lucode reopen, while surfacing a restart affordance when the persisted pane has already exited.

**Architecture:** Keep the public Tauri command surface unchanged. The backend start path decides between fresh spawn, force restart, live reattach, and dead-pane reattach; tmux provides pane liveness through `#{pane_dead}`. The frontend listens for the existing backend crash event and reuses the current stopped overlay, with restart routed through the existing force-restart command.

**Tech Stack:** Rust/Tauri backend, tmux CLI wrapper, React/Vitest frontend, existing typed event system.

---

### Task 1: Backend Start-Mode Contract

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`

**Step 1: Write failing tests**

Add unit tests for a pure start-mode decision helper:
- no existing tmux session -> `Fresh`
- existing live tmux session and no force -> `Reattach`
- existing dead tmux pane and no force -> `DeadPaneSurfaceRestart`
- explicit force restart -> `ForcedRestart`
- agent type override differing from recorded original -> `ForcedRestart`

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test commands::schaltwerk_core::agent_start_mode_tests --all-features`

Expected: FAIL because the helper and enum do not exist.

**Step 3: Implement minimal helper**

Add `AgentStartMode`, `StartModeInputs`, and `decide_agent_start_mode` near the agent start params.

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test commands::schaltwerk_core::agent_start_mode_tests --all-features`

Expected: PASS.

### Task 2: Tmux Pane Liveness

**Files:**
- Modify: `src-tauri/src/domains/terminal/tmux_cmd.rs`
- Modify: `src-tauri/src/domains/terminal/mod.rs`
- Modify: `src-tauri/src/domains/terminal/tmux.rs`
- Modify: `src-tauri/src/domains/terminal/manager.rs`

**Step 1: Write failing tests**

Add tmux CLI tests that:
- `list-panes -F #{pane_dead}` returning `0` reports live.
- returning `1` reports dead.
- mixed panes report live.

Add a `TmuxAdapter` test proving the adapter delegates pane liveness to the CLI.

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test domains::terminal::tmux_cmd::tests::session_has_live_pane domains::terminal::tmux::tests::agent_pane_alive_delegates --all-features`

Expected: FAIL because the methods do not exist.

**Step 3: Implement minimal liveness plumbing**

Add `TmuxCli::session_has_live_pane`, `TerminalBackend::agent_pane_alive` defaulting to `Ok(true)`, `TmuxAdapter` override, and `TerminalManager::agent_pane_alive`.

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test domains::terminal::tmux_cmd::tests::session_has_live_pane domains::terminal::tmux::tests::agent_pane_alive_delegates --all-features`

Expected: PASS.

### Task 3: Backend Start Path Branching

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`

**Step 1: Write failing/guard tests**

Use the Task 1 start-mode tests to pin the branch behavior, and add an event helper test if needed for the dead-pane payload shape.

**Step 2: Implement behavior**

In `schaltwerk_core_start_agent_in_terminal`:
- Compute `tmux_session_alive` through `terminal_exists`.
- Compute pane liveness only when a tmux session exists and the request is not an effective forced restart.
- Force restart when `force_restart` is true or a differing agent type override is supplied.
- `ForcedRestart`: close then continue fresh spawn.
- `Reattach`: skip close and skip initial-command queueing; call create so tmux attaches to the existing session; emit `TerminalAgentStarted`.
- `DeadPaneSurfaceRestart`: skip close and skip initial-command queueing; call create so tmux attaches; emit `AgentCrashed`; do not emit `TerminalAgentStarted`.
- `Fresh`: current spawn path.
- Log the branch and key booleans at info level.
- Warn when a prompt override was supplied but a reattach branch prevents prompt delivery.

**Step 3: Run focused Rust tests**

Run: `cd src-tauri && cargo test commands::schaltwerk_core::agent_start_mode_tests domains::terminal::tmux_cmd::tests::session_has_live_pane domains::terminal::tmux::tests::agent_pane_alive_delegates --all-features`

Expected: PASS.

### Task 4: Frontend Dead-Pane Overlay and Force Restart

**Files:**
- Modify: `src/common/events.ts`
- Modify: `src/components/terminal/Terminal.tsx`
- Modify: `src/components/terminal/Terminal.test.tsx`
- Modify: `src/common/agentSpawn.ts`
- Modify: `src/common/agentSpawn.test.ts`

**Step 1: Write failing tests**

Add tests that:
- `Terminal` shows the stopped overlay with terminated copy when `AgentCrashed` is received for its terminal after hydration.
- Clicking Restart from a session top terminal calls a force-restart helper/command instead of `startSessionTop`.
- The agent spawn helper sends `SchaltwerkCoreStartSessionAgentWithRestart` with `forceRestart: true`, terminal id, size, and agent type when requested.

**Step 2: Run test to verify it fails**

Run: `bun test src/components/terminal/Terminal.test.tsx src/common/agentSpawn.test.ts`

Expected: FAIL because the frontend does not consume `AgentCrashed` and restart still calls the non-force path.

**Step 3: Implement minimal frontend changes**

Add the typed `AgentCrashed` event, a `restartSessionTop` helper, a Terminal listener that sets stopped state and clears start tracking, and route session overlay restart through the force helper.

**Step 4: Run test to verify it passes**

Run: `bun test src/components/terminal/Terminal.test.tsx src/common/agentSpawn.test.ts`

Expected: PASS.

### Task 5: Full Verification and Commit

**Files:**
- All changed files.

**Step 1: Run targeted tests**

Run the focused Rust and frontend tests from Tasks 3 and 4.

**Step 2: Run full project validation**

Run: `just test`

Expected: PASS.

**Step 3: Review**

Use the requesting-code-review workflow, inspect diff and test evidence, and address findings.

**Step 4: Squashed commit**

Run: `git status --short`, stage the final files, and create a single commit with a concise message.
