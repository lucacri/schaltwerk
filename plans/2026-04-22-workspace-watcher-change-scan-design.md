# Workspace Watcher Change-Scan Efficiency Design

## Problem

`just dev` can drive the backend workspace watcher to rescan changed files for the same workspace every 500ms debounce window, even when the underlying git state has not changed. The concrete repro is repeated orchestrator log lines such as `Session orchestrator has 4 changed files detected`, which imply repeated `git::get_changed_files(...)` work and repeated identical `FileChanges` emissions.

## Goals

- Preserve correct file-change reporting for orchestrator and session workspaces.
- Reduce redundant changed-file recomputation when a workspace state is unchanged.
- Reduce repeated identical `FileChanges` emissions and identical info-level log lines for the same workspace.
- Keep the fix in the backend workspace watcher / file-change pipeline.

## Approaches

### 1. Watcher-only time throttle

Add another coarse timer around `handle_file_changes` and skip rescans for a short interval per workspace.

Pros:
- Small patch in one file.

Cons:
- Trades correctness latency for fewer scans.
- Still rescans unchanged state after each interval.
- Hides the repeated work instead of recognizing unchanged repo state.

### 2. Changed-files cache in git diff pipeline plus watcher dedupe

Add a repo-state-keyed cache for changed-file snapshots in `domains/git/stats.rs`, then let the watcher suppress identical `FileChanges` emissions when the cached state key matches the last emitted state for that workspace.

Pros:
- Keeps correctness tied to actual git state instead of wall-clock timing.
- Reuses the existing stats-signature pattern already present in the git stats pipeline.
- Reduces both expensive rescans and repeated identical event/log spam.

Cons:
- Slightly broader change because the git diff pipeline and watcher both need updates.

### 3. Diff-panel/UI-side suppression

Leave backend recomputation unchanged and only suppress duplicate UI reactions.

Pros:
- Minimal backend change.

Cons:
- Does not address the wasted backend work or the repeated watcher log spam.
- Misframes the bug as presentation-only.

## Recommendation

Use approach 2.

The backend already has a proven pattern for repo-state signatures and memoization in fast git stats. Extending that pattern to changed-file snapshots keeps the optimization deterministic and workspace-scoped. The watcher can then suppress unchanged emissions based on the same state key, which removes the repeated orchestrator info logs without weakening correctness.

## Design

### Git changed-files cache

- Introduce a changed-files cache in `src-tauri/src/domains/git/stats.rs`.
- Reuse the same repo-state inputs that indicate whether the diff result can change:
  - `HEAD` oid
  - baseline target oid
  - index signature
  - worktree status signature
  - dirty content signature
  - diff compare mode
- Return both the changed files and the computed state key from a new internal snapshot helper.
- Keep the public `get_changed_files(...)` API intact by having it delegate to the snapshot helper and return only the file list.

### Watcher emission dedupe

- Track the last emitted changed-files state per workspace/base-branch in `watcher.rs`.
- After collecting the snapshot, suppress the info log and `SchaltEvent::FileChanges` emission when the state key matches the last emitted value.
- Leave orchestrator watcher registration and session/orchestrator watcher dedupe unchanged.
- Continue to refresh orchestrator project files when commit signals change state.

### Verification

- Add red/green tests for changed-files caching in `stats.rs`.
- Add watcher-level tests for duplicate-emission suppression state tracking in `watcher.rs`.
- Run targeted Rust tests during TDD, then `just test` before the final commit.
