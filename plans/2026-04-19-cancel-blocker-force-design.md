# Cancel Blocker Force Removal Design

## Context

Session cancellation currently starts through `schaltwerk_core_cancel_session`, emits `SessionCancelling`, and then performs filesystem cleanup in a background task. Failures from that task are flattened into `CancelError` with a string payload, so the frontend cannot distinguish dirty worktrees, missing worktree directories, locked worktrees, or git/path failures.

## Approaches

1. Keep string errors and parse them in React.
   This is fragile and would keep backend behavior ambiguous.

2. Add backend typed blocker detection, return it through `SchaltError`, and surface it with a dedicated dialog.
   This keeps the domain decision in Rust, gives the UI a stable contract, and matches the requested Tauri error shape.

3. Make all cancel calls forceful by default when cleanup fails.
   This removes user control and violates the explicit confirmation requirement.

Recommended approach: option 2.

## Design

Add a serializable `CancelBlocker` enum in the cancellation lifecycle module with `UncommittedChanges`, `OrphanedWorktree`, `WorktreeLocked`, and `GitError`. The normal cancel flow performs a deterministic preflight before emitting `SessionCancelling` or spawning background cleanup. If blocked, it logs the variant, emits `SessionCancelBlocked`, and returns `SchaltError::CancelBlocked`.

Add a force cancellation path used by a new Tauri command. It skips dirty checks, force removes the git worktree when possible, prunes stale git metadata when the directory is missing, best-effort deletes the branch, and deletes the session row last. Cleanup failures are logged and returned in the result only after the row is gone, so the UI cannot keep refreshing a ghost session.

The frontend keeps the existing cancel confirmation as the first step. If normal cancel returns or emits a typed blocker, the same modal switches to a blocked state showing a plain-language reason, affected files/path, a destructive `Force remove (discards work)` action, and `Keep session`.

Testing follows TDD:

- Rust tests assert each blocker variant from the preflight.
- Rust tests assert force cancel handles dirty and missing worktrees while removing the DB row.
- Frontend tests assert each blocker message renders and force invokes the force callback.

