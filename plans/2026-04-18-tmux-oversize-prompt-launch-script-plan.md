# Tmux Oversize Prompt Launch Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route agent launches with tmux-sized argv over 14 KiB through a temporary self-deleting shell script so large prompts no longer trip tmux IPC limits.

**Architecture:** Keep the existing direct and shell-chain launch behavior for normal prompts. For oversized launches, write a 0600 script that exports the same environment, captures any large argv entry through a quoted heredoc, removes itself, and execs the exact command shape that would otherwise have gone to tmux.

**Tech Stack:** Rust, Tauri terminal manager, tmux backend, POSIX shell script rendering, cargo tests.

---

### Task 1: Add tmux IPC threshold tests

**Files:**
- Modify: `src-tauri/src/domains/terminal/tmux_cmd.rs`

**Steps:**
1. Add tests for argv below and above the 14 KiB IPC threshold.
2. Run `cargo test --manifest-path src-tauri/Cargo.toml domains::terminal::tmux_cmd::tests::argv_exceeds_tmux_ipc --lib`.
3. Confirm the tests fail because the helper does not exist.
4. Add the constant and helper using the same byte accounting as `check_argv_size`.
5. Re-run the focused tests.

### Task 2: Add launch script renderer tests

**Files:**
- Create: `src-tauri/src/commands/schaltwerk_core/agent_launcher/launch_script.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core/agent_launcher.rs`

**Steps:**
1. Add tests for heredoc sentinel uniqueness, self-delete before exec, env exports before exec, shell metacharacter roundtrip, and writing 0600 script files.
2. Run `cargo test --manifest-path src-tauri/Cargo.toml commands::schaltwerk_core::agent_launcher::launch_script --bin lucode`.
3. Confirm the tests fail because the module is not implemented.
4. Implement script rendering and file writing with random 16-hex sentinels.
5. Re-run the focused tests.

### Task 3: Integrate launch script routing

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core/agent_launcher.rs`

**Steps:**
1. Add a helper that prepares the final terminal command, args, and env and switches to `sh <script>` when projected tmux argv exceeds 14 KiB.
2. Add a unit test for an oversized prompt producing `sh <path>` with a small tmux argv and a script present on disk.
3. Run the focused command module tests and confirm the new test fails before integration code.
4. Implement the routing just before terminal creation.
5. Re-run focused tests.

### Task 4: Add stale launch-script cleanup

**Files:**
- Modify: `src-tauri/src/schaltwerk_core/mod.rs`
- Modify: `src-tauri/src/main.rs`

**Steps:**
1. Add tests for removing only `lucode-launch-*.sh` files older than one hour.
2. Run the focused tests and confirm they fail.
3. Implement best-effort cleanup and call it at startup after logging initializes.
4. Re-run focused tests.

### Task 5: Document and verify

**Files:**
- Modify: `CHANGES.md`

**Steps:**
1. Add a concise upstream-change entry for oversized tmux launches.
2. Run `cargo test --manifest-path src-tauri/Cargo.toml launch_script tmux_cmd --lib --bin lucode`.
3. Run `just test`.
4. Request code review.
5. Create one squashed commit containing the implementation.
