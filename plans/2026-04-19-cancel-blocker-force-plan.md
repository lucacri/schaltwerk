# Cancel Blocker Force Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface typed session cancel blockers and provide an explicit force removal path that cleans worktree, git metadata, and the session DB row.

**Architecture:** Cancellation blocker classification lives in `src-tauri/src/domains/sessions/lifecycle/cancellation.rs`, with `SchaltError::CancelBlocked` as the Tauri serialization boundary. `schaltwerk_core_cancel_session` runs preflight synchronously before starting background cleanup, and `schaltwerk_core_force_cancel_session` performs force cleanup then emits normal removal refresh events. React renders typed blockers in `CancelConfirmation`.

**Tech Stack:** Rust/Tauri, git2 plus git CLI for force worktree removal, React, Vitest, Testing Library.

---

### Task 1: Add failing Rust blocker tests

**Files:**
- Modify: `src-tauri/src/domains/sessions/lifecycle/cancellation.rs`

**Steps:**
1. Add tests for dirty worktree, missing worktree path, locked worktree metadata, and invalid git worktree.
2. Run `cargo test --manifest-path src-tauri/Cargo.toml domains::sessions::lifecycle::cancellation -- --nocapture`.
3. Expected: fail because `CancelBlocker` and preflight APIs do not exist.

### Task 2: Implement blocker classification

**Files:**
- Modify: `src-tauri/src/domains/sessions/lifecycle/cancellation.rs`
- Modify: `src-tauri/src/domains/git/service.rs`
- Modify: `src-tauri/src/domains/git/worktrees.rs`
- Modify: `src-tauri/src/errors.rs`

**Steps:**
1. Add serializable `CancelBlocker`.
2. Add `detect_cancel_blocker` and call it from non-force cancellation paths.
3. Add `SchaltError::CancelBlocked`.
4. Add helper functions for lock detection, force worktree removal, and pruning.
5. Re-run the Rust cancellation tests.

### Task 3: Add failing force cleanup tests

**Files:**
- Modify: `src-tauri/src/domains/sessions/lifecycle/cancellation.rs`

**Steps:**
1. Add tests for force cancel with dirty files and missing worktree directories.
2. Assert the session row is deleted last from the DB manager.
3. Run the cancellation test module and observe failures.

### Task 4: Implement force cleanup

**Files:**
- Modify: `src-tauri/src/domains/sessions/lifecycle/cancellation.rs`
- Modify: `src-tauri/src/domains/sessions/service.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `src-tauri/src/main.rs`

**Steps:**
1. Add `force_cancel_session_async` to the cancellation coordinator and session manager.
2. Add `schaltwerk_core_force_cancel_session`.
3. Emit `SessionRemoved` and refresh events after force cleanup.
4. Register the command in `main.rs`.
5. Re-run the Rust cancellation tests.

### Task 5: Add failing frontend modal tests

**Files:**
- Modify: `src/components/modals/CancelConfirmation.test.tsx`

**Steps:**
1. Add tests for each blocker variant.
2. Assert the force button is visible and calls `onForceRemove`.
3. Run `bun run test -- CancelConfirmation.test.tsx`.
4. Expected: fail because the modal has no blocker contract.

### Task 6: Implement frontend blocker dialog and command wiring

**Files:**
- Modify: `src/components/modals/CancelConfirmation.tsx`
- Modify: `src/App.tsx`
- Modify: `src/common/events.ts`
- Modify: `src/common/tauriCommands.ts`
- Modify: `src/locales/en.json`

**Steps:**
1. Add shared TypeScript types for cancel blockers.
2. Add `SchaltEvent.SessionCancelBlocked` and `SchaltwerkCoreForceCancelSession`.
3. Teach `App.tsx` to map `SchaltError::CancelBlocked` and the event payload into modal state.
4. Add force remove handler that invokes the new command.
5. Update copy using localization keys and theme classes.
6. Re-run the frontend modal test.

### Task 7: Full verification and commit

**Files:**
- All modified files

**Steps:**
1. Run targeted Rust and frontend tests.
2. Run `just test`.
3. Request code review through the requested workflow.
4. Address any actionable review findings.
5. Create a single squashed commit with all changes.

