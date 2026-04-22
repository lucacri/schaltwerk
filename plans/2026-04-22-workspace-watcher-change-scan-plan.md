# Workspace Watcher Change-Scan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce redundant workspace watcher changed-file rescans and repeated identical file-change emissions for unchanged workspaces.

**Architecture:** Add a repo-state-keyed changed-files cache in the backend git diff pipeline, then let the workspace watcher suppress duplicate emissions using that same state identity. This keeps correctness driven by actual git state instead of adding a coarse timer.

**Tech Stack:** Rust, git2, Tauri backend watcher pipeline, existing workspace/git domain tests

---

### Task 1: Add changed-files cache coverage

**Files:**
- Modify: `src-tauri/src/domains/git/stats.rs`
- Test: `src-tauri/src/domains/git/stats.rs`

**Step 1: Write the failing tests**

- Add a test proving repeated `get_changed_files(...)` calls on an unchanged workspace hit a cache rather than rebuilding the diff result.
- Add a test proving the cache invalidates when tracked dirty file content changes.

**Step 2: Run test to verify it fails**

Run: `cargo test changed_files_cache --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: FAIL because the changed-files cache helpers and counters do not exist yet.

**Step 3: Write minimal implementation**

- Add a changed-files snapshot/state-key helper in `stats.rs`.
- Add a process-wide changed-files cache keyed by workspace/base branch.
- Keep `get_changed_files(...)` returning `Vec<ChangedFile>` for existing callers.

**Step 4: Run test to verify it passes**

Run: `cargo test changed_files_cache --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: PASS

### Task 2: Suppress duplicate watcher emissions

**Files:**
- Modify: `src-tauri/src/domains/workspace/watcher.rs`
- Test: `src-tauri/src/domains/workspace/watcher.rs`

**Step 1: Write the failing test**

- Add a watcher test proving the same workspace state is emitted once and suppressed on repeat until the state changes.

**Step 2: Run test to verify it fails**

Run: `cargo test duplicate_file_change_emission --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: FAIL because duplicate-emission state tracking does not exist yet.

**Step 3: Write minimal implementation**

- Store the last emitted changed-files state per workspace/base branch.
- Suppress identical info logs and `FileChanges` emissions when the state key repeats.

**Step 4: Run test to verify it passes**

Run: `cargo test duplicate_file_change_emission --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: PASS

### Task 3: Verify the integrated backend behavior

**Files:**
- Modify: `src-tauri/src/domains/git/stats.rs`
- Modify: `src-tauri/src/domains/workspace/watcher.rs`

**Step 1: Run focused backend tests**

Run: `cargo test watcher --manifest-path src-tauri/Cargo.toml -- --nocapture`
Expected: PASS

**Step 2: Run the full validation suite**

Run: `just test`
Expected: PASS

**Step 3: Commit**

Run:

```bash
git add plans/2026-04-22-workspace-watcher-change-scan-design.md \
  plans/2026-04-22-workspace-watcher-change-scan-plan.md \
  src-tauri/src/domains/git/stats.rs \
  src-tauri/src/domains/workspace/watcher.rs
git commit -m "fix: reduce duplicate workspace watcher rescans"
```
