# Error-Handling Audit — task-flow v2 (Tier 1.2)

Scope: `git diff main..pre-smoke-walk-4` (Phases 7+8). NEW or MODIFIED code
only. Doc-only — zero patches.

References: `feedback_stamp_after_side_effect.md` (stamp completion
timestamps AFTER the fallible side-effect), CLAUDE.md "Error Handling
(MANDATORY)" and dead-code policy.

---

## High

### H-1 — `confirm_stage` post-merge `?` propagation drops typed-sentinel context
**Classification:** `before-side-effect-stamp` (per `feedback_stamp_after_side_effect.md`).
**File:** `src-tauri/src/domains/tasks/orchestration.rs:480-491`
**Current behavior:**
```rust
// Merge succeeded above this point.
self.run_svc()
    .confirm_selection(run_id, Some(winning_session_id), None, selection_mode)?; // line 481

if let Some(next) = next_stage_after(task.stage)
    && let Err(e) = self.task_svc().advance_stage(&task.id, next)
{
    return Err(anyhow::Error::new(StageAdvanceAfterMergeFailed { ... })); // wrapped
}

self.task_svc().get_task(&task.id) // line 491 — raw `?`
```
The doc-comment at lines 408-415 explicitly promises: *"If `confirm_selection`
or the stage advance fail after the merge succeeded we surface a clearly-worded
error so the operator knows manual recovery is needed."* `advance_stage`
honors that. `confirm_selection?` (line 481) and the trailing `get_task?`
(line 491) do not — they propagate raw `anyhow::Error`, which the boundary
mapper (`map_confirm_stage_error`) cannot downcast to a typed sentinel and
collapses to `TaskFlowError::DatabaseError`. The merge already happened
(filesystem mutated, branch advanced), so a transient DB hiccup here leaves
the user looking at a generic "Database error" toast with no indication that
manual reconciliation is needed.

**Recommended fix:** Wrap both fallible post-merge calls in
`StageAdvanceAfterMergeFailed`:
```rust
self.run_svc()
    .confirm_selection(run_id, Some(winning_session_id), None, selection_mode)
    .map_err(|e| anyhow::Error::new(StageAdvanceAfterMergeFailed {
        message: format!("confirm_selection after merge: {e}"),
    }))?;
// ... existing advance_stage block ...
self.task_svc().get_task(&task.id).map_err(|e| anyhow::Error::new(
    StageAdvanceAfterMergeFailed { message: format!("get_task after merge: {e}") }
))
```
Pin with a regression test that arms `confirm_selection` to return `Err` after
a successful `FakeMerger` and asserts the orchestrator returns
`StageAdvanceAfterMergeFailed` (compile-time pin) — without it, a future edit
to add a third post-merge step will silently lose typed context the same way.

### H-2 — `useConfirmStage` Retry action calls `run()` without awaiting/catching
**Classification:** `silent-failure`
**File:** `src/components/sidebar/hooks/useConfirmStage.ts:88-93`
**Current behavior:**
```ts
action: {
  label: 'Retry merge',
  onClick: () => {
    void run()  // run() is async; if it rejects, the rejection is dropped silently
  },
},
```
`run` already swallows its own rejections internally and resolves to `null` on
error, so today this is technically safe — but the contract is not enforced
in the type system. If a future refactor of `run` lets a rejection escape (a
common change when adding a new error path before the existing try/catch),
the toast's Retry button would silently swallow it without any user feedback.
The pattern `void asyncFn()` masks future regressions.

**Recommended fix:** Make the retry signal observable:
```ts
onClick: () => {
  run().catch((err) => {
    logger.warn('[useConfirmStage] retry failed', err)
  })
}
```
This is belt-and-braces with the existing internal try/catch, but it pins the
"retries cannot crash silently" invariant at the call site so future agents
who edit `run` cannot regress it without the linter screaming.

### H-3 — `TaskRow.handleReopen` and Draft promote: error logged, no toast
**Classification:** `silent-failure` (UX surface)
**File:** `src/components/sidebar/TaskRow.tsx:434-436, 491-495`
**Current behavior:**
```ts
// Draft promote (line 434):
void actions.promoteToReady(task).catch((err) => {
  logger.warn('[TaskRow] promoteToReady failed', err)
})

// Reopen (line 491):
void actions.reopenTask(task, 'draft').catch((err) => {
  logger.warn('[TaskRow] reopenTask failed', err)
})
```
Both paths swallow the error to the logger only — no toast. Compare with the
sibling `performCancel` (line 448-489), which dispatches a structured error
toast on failure. Asymmetric: cancel surfaces failures, reopen and
promote-to-ready don't. The user clicks "Reopen", nothing visible happens,
and they don't know whether the click was registered or the backend rejected.
`promoteToReady` is the load-bearing path for Draft → Ready transitions;
silent failures here strand the user mid-workflow.

**Recommended fix:** Mirror the cancel toast shape — push an error toast on
failure with the message and (optionally) a Retry action. The
`useTaskRowActions` hook already rolls back optimistic state, so the toast
is the only missing affordance.

---

## Medium

### M-1 — `runs.rs::confirm_selection` writes three sequential rows without a transaction
**Classification:** `before-side-effect-stamp` (cousin pattern)
**File:** `src-tauri/src/domains/tasks/runs.rs:117-126`
**Current behavior:**
```rust
self.db.set_task_run_selection(run_id, ..., Some(selection_mode))?;
self.db.set_task_run_completed_at(run_id)?;
self.db.set_task_run_confirmed_at(run_id)?;
self.db.get_task_run(run_id)
```
Three separate UPDATEs without a wrapping transaction. If write 2 or 3 fails
(SQLite I/O hiccup, lock contention spike), the row sits in a hybrid state:
`selected_session_id` set, `completed_at` and/or `confirmed_at` NULL.
`compute_run_status` would then derive `Running` for a run that's actually
been "confirmed" from the user's perspective.

**Recommended fix:** Either (a) wrap the three writes in a rusqlite
transaction at the `confirm_selection` boundary, or (b) introduce a single
DB method `db.confirm_run_selection(run_id, selected_session_id, mode)` that
does all three updates inside one statement / transaction. The TODO at
orchestration.rs:417-420 already gestures at this work; tracking it here so
the audit trail captures the ordering risk.

### M-2 — `notify_task_mutation_with_db` emits payload after enrichment failure with `null` `derived_status`
**Classification:** `inappropriate-fallback`
**File:** `src-tauri/src/commands/tasks.rs:109-119`
**Current behavior:**
```rust
if let Err(err) = enrich_tasks_with_derived_run_statuses(&mut tasks, db) {
    log::warn!(
        "Failed to enrich tasks ... Emitting payload with status=null; \
         the next read will reconcile."
    );
}
let payload = TasksRefreshedPayload { ... };
emit_task_mutation_events(app, &payload);
```
The comment "the next read will reconcile" is misleading — this IS the
broadcast that drives the next read on the frontend. With `derived_status:
null`, every `TaskRunRow` falls into `UNKNOWN_VISUAL` and shows "Unknown".
There is no automatic re-fetch; the UI sits with "Unknown" badges until the
user manually triggers another mutation that succeeds at enrichment.

**Recommended fix:** Either (a) skip emitting on enrichment failure (same
pattern as the outer list_tasks failure), forcing the frontend to keep its
last-known state; or (b) emit a typed `TasksEnrichmentDegraded` event that
the frontend can react to (e.g., trigger a manual refetch on a debounced
schedule). Option (a) is cheaper and matches the existing list_tasks
fallback. The current behavior is the worst of both: a stale event with
half-populated data that LOOKS authoritative.

Same pattern in `notify_task_mutation` (commands/tasks.rs:122-152) — apply
the same fix.

### M-3 — `TaskRunSlots.confirmStage` errors are caught upstream but no toast on the slot row itself
**Classification:** `silent-failure` (UX surface)
**File:** `src/components/sidebar/TaskRunRow.tsx:170-172`
**Current behavior:**
```ts
onConfirmWinner={(sessionId) => {
  void confirmStage(run.id, sessionId)
}}
```
`useConfirmStage.confirmStage` returns `Promise<Task | null>` — `null` on
error, with the toast already handled inside the hook. The void-discard here
is correct (the hook owns the toast), but a future refactor that moves toast
handling out of the hook would silently lose error feedback. Pinning the
contract via a doc comment or a type-level `Promise<Task | null>` consumer
would prevent regression.

**Recommended fix:** Either add a doc comment at this call site referencing
where the error toast is dispatched (so the contract is greppable), or add a
shallow `.catch` that logs as a defense-in-depth pin. Low-priority cleanup;
the current behavior is correct.

### M-4 — `TaskArtifactEditor` save failure leaves stale `body` in local state
**Classification:** `silent-failure` (subtle UX drift)
**File:** `src/components/right-panel/TaskArtifactEditor.tsx:77-98`
**Current behavior:**
```ts
try {
  await updateTaskContent(task.id, kind, body, ...)
  const refreshed = await getTask(task.id, projectPath ?? null)
  onSaved?.(refreshed)
} catch (err) {
  // body stays as the user typed it
  setError(message)
}
```
On save failure, the inline error is shown but `body` is not reset. If the
user retries, the second save uses the same buffered text. That's correct
for a transient backend failure. But if `getTask` (the post-update refetch)
fails AFTER `updateTaskContent` succeeded, the user sees an error message
even though their save persisted — and the parent's `task` envelope is now
stale because `onSaved` was never called.

**Recommended fix:** Split the two awaits — if `updateTaskContent` succeeds
but `getTask` fails, dispatch a separate "save persisted but reload failed,
please refresh" message rather than a generic "save failed" error. Or trust
the `TasksRefreshed` broadcast (which fires after the backend's
`set_session_task_lineage` write) to reconcile the parent and skip the
explicit refetch. Per `feedback_stamp_after_side_effect.md`, the order is
correct (refetch AFTER save); the bug is that we don't distinguish between
the two failure modes.

### M-5 — `cancel_task_run_cascading` lossy failure aggregation
**Classification:** `missing-context`
**File:** `src-tauri/src/domains/tasks/service.rs:406-422`
**Current behavior:**
```rust
let mut failures = Vec::new();
while let Some(outcome) = join_set.join_next().await {
    match outcome {
        Ok(Ok(())) => {}
        Ok(Err(error)) => failures.push(error.to_string()),  // <- session id lost
        Err(error) => failures.push(format!("task run cancel worker join error: {error}")),
    }
}
```
Compare with `cancel_task_cascading` (line 244-258) which captures
`session.id` and `session.name` per failure. Here, the `Ok(Err(error))` branch
keeps only the error string — if four slot sessions fail to cancel, the user
sees "failed to cancel 4 session(s) for run X: err1; err2; err3; err4"
without any indication of which session ids were affected. Cleanup retries
have no actionable target.

**Recommended fix:** Hold the session reference in the join_set tuple (same
shape as `cancel_task_cascading`), and surface
`Vec<TaskSessionCancelFailure>` instead of `Vec<String>`. This requires a
matching `TaskFlowError::TaskRunCancelFailed { run_id, failures }` variant —
worth the symmetry with the task-cancel path.

### M-6 — `useTaskRefreshListener.attach` swallows attach failure, no retry
**Classification:** `silent-failure`
**File:** `src/hooks/useTaskRefreshListener.ts:165-183`
**Current behavior:**
```ts
const attach = async () => {
  try {
    const off = await listenEvent(SchaltEvent.TasksRefreshed, ...)
    ...
  } catch (err) {
    logger.warn('[useTaskRefreshListener] failed to attach listener', err)
  }
}
void attach()
```
If `listenEvent` rejects (e.g., the Tauri bridge isn't ready yet), the
listener is never attached and `tasksAtom` will never update from backend
broadcasts for the lifetime of the app. The user sees a frozen sidebar with
no indication that anything is wrong. Compare with how `Sidebar.tsx`
historically handles listener bootstrap with a finite retry or visible error
state.

**Recommended fix:** Either (a) re-throw the error so the React error
boundary surfaces it (preferable — mounting failure means the app is in a
fundamentally broken state), or (b) add a one-shot retry with a slight
backoff bounded by component lifecycle. Option (a) is simpler and follows
the "fix problems directly, no fallbacks" principle in CLAUDE.md.

---

## Low

### L-1 — `TaskRightPane` `getTask` failure shows error but no retry affordance
**Classification:** `missing-context` (UX)
**File:** `src/components/right-panel/TaskRightPane.tsx:236-243`
**Current behavior:** Renders an inline error banner with the error message
but no "Retry" button. The user must change selection and come back to
trigger a fresh fetch.

**Recommended fix:** Add a "Retry" button that re-runs the `getTask` call.
Cosmetic; the data fetches off `taskId` change, so re-selection works as a
workaround.

### L-2 — `parse_conflicting_paths` returns `Vec::new()` on missing marker without logging
**Classification:** `missing-context` (debug)
**File:** `src-tauri/src/domains/tasks/orchestration.rs:47-59`
**Current behavior:** If `MergeService` changes the error format and drops
the `"Conflicting paths:"` marker, this function silently returns an empty
list. The frontend will show "Merge conflict" with zero conflicting files,
which is useless.

**Recommended fix:** When a merge error contains the word "conflict" but
`parse_conflicting_paths` returns an empty list, log a `warn!` with the raw
message so a future format drift surfaces in logs without breaking the UI.
Strictly a maintenance hint; current code path won't fire unless
`MergeService` changes its error shape.

### L-3 — `TaskArtifactEditor` `useEffect` reset doesn't clear in-flight save
**Classification:** `silent-failure` (race)
**File:** `src/components/right-panel/TaskArtifactEditor.tsx:61-73`
**Current behavior:** Switching tasks during an in-flight save (rare but
possible) resets `body` to the new task's `initial`, but the in-flight
`handleSave` will still call `onSaved(refreshed)` with the OLD task's
refreshed envelope, which the parent will store as the current task — racing
with the new selection.

**Recommended fix:** Add a cancellation flag like `TaskRightPane` uses
(`let cancelled = false`); skip `onSaved` if the task changed mid-save. Edge
case; rare in practice.

---

## Acceptable patterns (do NOT "fix")

These look like smells but are intentional — flagged so future agents reading
this audit do not regress them.

### AP-1 — `useTaskRowActions` optimistic `cancelled_at` stamp
**File:** `src/components/sidebar/hooks/useTaskRowActions.ts:179-197, 199-224`
The optimistic flip stamps `cancelled_at = new Date().toISOString()` BEFORE
the side-effect — looks like a stamp-before-side-effect bug. It is not. The
header comment (lines 121-130) explicitly justifies: the value is speculative,
the real `cancelled_at` from the backend response replaces it on success, and
the stamp is rolled back on failure. The `findTask`/`replaceTask` rollback
flow makes this safe.

### AP-2 — `TaskArtifactEditor` `useEffect` `eslint-disable-next-line react-hooks/exhaustive-deps`
**File:** `src/components/right-panel/TaskArtifactEditor.tsx:61-73`
The effect deliberately omits `body` from the dep array. Comment at lines
65-72 justifies: a `TasksRefreshed` broadcast for the same task would
otherwise reset `body` on every keystroke that triggered a re-render,
clobbering user edits mid-typing. Intentional anti-clobber pattern.

### AP-3 — `useTaskRefreshListener.extractTasks` returns `[]` on malformed payload
**File:** `src/hooks/useTaskRefreshListener.ts:195-209`
Defensive narrowing pattern: if the backend ever broadcasts a malformed
payload, dropping the event with a warn is preferable to crashing the
listener. Mirrors the existing sessions listener.

### AP-4 — Test-side `.unwrap()` / `.expect()` under `#[cfg(test)]`
All `.unwrap()` calls flagged by grep in the diff (8000+ lines of new test
coverage in `runs.rs`, `service.rs`, `commands/tasks.rs`,
`auto_advance.rs`, `reconciler.rs`, migrations) are inside `#[cfg(test)]`
modules. Per CLAUDE.md, "Mutex::lock().unwrap() is widely accepted; flag
the ones that aren't" — none of the production-code unwraps in the
audited files violated this.

### AP-5 — `cancel_task_cascading` stamps `cancelled_at` AFTER host cancel succeeds
**File:** `src-tauri/src/domains/tasks/service.rs:262-288`
Correctly follows `feedback_stamp_after_side_effect.md`:
`set_task_cancelled_at` only fires inside the `if host_cancelled` block,
after the host session's `cancel_session_async` call returned `Ok`. If the
host failed, the task stays at its prior stage and the cascade error returns
without writing the timestamp. Sibling failures still produce a
`TaskCascadeCancelError` for the UI's retry-cleanup affordance.

### AP-6 — `auto_advance::on_pr_state_refreshed` writes stage + failure_flag without a transaction
**File:** `src-tauri/src/domains/tasks/auto_advance.rs:49-86`
Two sequential writes (`set_task_stage`, `set_task_failure_flag`) without a
transaction. Acceptable here because: (a) the writes are independent (no
ordering invariant), (b) compute_run_status doesn't read both, (c) the
`Decision` shape determines which write happens, so partial writes converge
to a coherent state on the next event. Different from `runs.rs::confirm_selection`
(M-1) where the three writes ARE coupled by `compute_run_status`'s read order.

### AP-7 — `notify_task_mutation_with_db` emits both `TasksRefreshed` and `SessionsRefreshed`
**File:** `src-tauri/src/commands/tasks.rs:78-92`
Both `emit_event` calls log on failure but don't propagate. Correct: emit
failures should not roll back the underlying mutation (which already
succeeded). A failed emit means the frontend will be stale until the next
mutation; the `log::warn!` is the operator-side signal.

---

## Summary

- **Critical:** 0
- **High:** 3 (H-1, H-2, H-3)
- **Medium:** 6 (M-1 through M-6)
- **Low:** 3 (L-1, L-2, L-3)
- **Acceptable patterns documented:** 7 (AP-1 through AP-7)

**Pre-merge gate (recommended):** H-1 should land before merge — the typed
sentinel was specifically added to communicate "merge succeeded but DB
follow-up failed; manual recovery required", and the current `?` propagation
silently strips that context for two of the three post-merge calls. The fix
is ~5 lines plus a regression test.

H-2 and H-3 can land post-merge but before public release; H-3 in particular
will cause user-visible "did my click work?" confusion on the reopen path.

M-2 deserves a follow-up wave — emitting half-populated `TasksRefreshed`
payloads makes UI bugs hard to diagnose. The "Unknown" badge is at least
loud (per the TaskRunRow comment); but the "next read will reconcile"
comment in commands/tasks.rs is misleading and should be revised regardless.

The acceptable-patterns block is deliberately verbose — most of these would
look like smells to a quick audit, and a future drive-by refactor "cleaning
up `cancelled_at` optimistic stamps" or "wrapping the auto_advance writes in
a transaction" would actively regress correctly-engineered code.
