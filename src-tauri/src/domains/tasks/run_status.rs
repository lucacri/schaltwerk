use crate::domains::tasks::entity::{TaskRun, TaskRunStatus};
use chrono::{DateTime, Utc};

/// The minimal session-row projection that [`compute_run_status`] reads.
///
/// Why a projection instead of the full `Session` type: the `tasks` domain cannot
/// import `domains::sessions` without violating `arch_domain_isolation`. So the
/// caller (typically the application layer assembling task-run views) is
/// responsible for mapping each `Session` to a `SessionFacts` and handing the
/// slice to the getter. Only three fields participate in the derivation:
///
/// - `task_run_id`: which run this session is bound to (if any).
/// - `exit_code`: PTY exit code, populated by `SessionFactsRecorder::record_exit`.
/// - `first_idle_at`: first-time-idle timestamp; write-once at the recorder layer.
///
/// `exited_at` is intentionally NOT part of this projection — the getter does not
/// gate on liveness directly; it gates on `exit_code` (failure path) and
/// `first_idle_at` (idle path), both of which are set by the recorder regardless of
/// whether the session is currently alive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFacts {
    pub task_run_id: Option<String>,
    pub exit_code: Option<i32>,
    pub first_idle_at: Option<DateTime<Utc>>,
}

/// Derive a [`TaskRunStatus`] from the raw facts that v2 actually persists.
///
/// This is the *only* producer of `TaskRunStatus` in v2. Callers always go through
/// this function — the enum is never read out of a `task_runs` row because v2 has
/// no `status` column. See `plans/2026-04-29-task-flow-v2-phase-1-plan.md` §3 for
/// the full contract, including the eventual-consistency guarantee with respect to
/// concurrent `SessionFactsRecorder` writes.
///
/// Decision order (each predicate trumps everything below it):
///
/// 1. `run.cancelled_at.is_some()` → [`TaskRunStatus::Cancelled`]. Terminal user
///    intent — no derived signal can override it.
/// 2. `run.confirmed_at.is_some()` → [`TaskRunStatus::Completed`]. The user picked
///    a winner; the run is done. A bound session that exited non-zero before the
///    confirm does not retroactively flip the run to Failed.
/// 3. `run.failed_at.is_some()` → [`TaskRunStatus::Failed`]. **Legacy carrier
///    only.** Populated by the one-shot v1→v2 user-DB migration for rows whose
///    legacy `status` column was `'failed'`. v2-native code never writes this
///    column.
/// 4. Any bound session has a non-zero `exit_code` AND `selected_session_id` is
///    `None` → [`TaskRunStatus::Failed`]. "No winner picked yet, and at least one
///    candidate crashed."
/// 5. The run has at least one bound session AND every bound session has
///    `first_idle_at.is_some()` → [`TaskRunStatus::AwaitingSelection`]. Sticky by
///    construction: `first_idle_at` is write-once at the recorder layer, so the
///    "all bound have ever_idle" predicate can only flip false→true, never back.
/// 6. Otherwise → [`TaskRunStatus::Running`]. Default for newly-created runs that
///    haven't spawned sessions yet, mid-flight runs, etc.
///
/// "Bound" means `facts.task_run_id == Some(run.id)`. Sessions with a different
/// `task_run_id` (or `None`) do not influence the derived status.
pub fn compute_run_status(run: &TaskRun, sessions: &[SessionFacts]) -> TaskRunStatus {
    if run.cancelled_at.is_some() {
        return TaskRunStatus::Cancelled;
    }
    if run.confirmed_at.is_some() {
        return TaskRunStatus::Completed;
    }
    if run.failed_at.is_some() {
        return TaskRunStatus::Failed;
    }

    let bound = bound_sessions(run, sessions);

    let any_failed = bound
        .iter()
        .any(|s| matches!(s.exit_code, Some(code) if code != 0));
    let has_winner = run.selected_session_id.is_some();
    if any_failed && !has_winner {
        return TaskRunStatus::Failed;
    }

    let all_ever_idle = !bound.is_empty() && bound.iter().all(|s| s.first_idle_at.is_some());
    if all_ever_idle {
        return TaskRunStatus::AwaitingSelection;
    }

    TaskRunStatus::Running
}

fn bound_sessions<'a>(run: &TaskRun, sessions: &'a [SessionFacts]) -> Vec<&'a SessionFacts> {
    sessions
        .iter()
        .filter(|s| s.task_run_id.as_deref() == Some(run.id.as_str()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::TaskStage;
    use chrono::TimeZone;

    fn ts(epoch: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(epoch, 0).single().expect("valid timestamp")
    }

    fn make_run(id: &str) -> TaskRun {
        TaskRun {
            id: id.to_string(),
            task_id: "task-1".to_string(),
            stage: TaskStage::Implemented,
            preset_id: None,
            base_branch: None,
            target_branch: None,
            selected_session_id: None,
            selected_artifact_id: None,
            selection_mode: None,
            started_at: Some(ts(1_000)),
            completed_at: None,
            cancelled_at: None,
            confirmed_at: None,
            failed_at: None,
            failure_reason: None,
            created_at: ts(1_000),
            updated_at: ts(1_000),
            derived_status: None,
        }
    }

    fn bound(run_id: &str) -> SessionFacts {
        SessionFacts {
            task_run_id: Some(run_id.to_string()),
            exit_code: None,
            first_idle_at: None,
        }
    }

    fn unbound(other_run_id: Option<&str>) -> SessionFacts {
        SessionFacts {
            task_run_id: other_run_id.map(String::from),
            exit_code: None,
            first_idle_at: None,
        }
    }

    // --- Case 1: Cancelled trumps every derived signal ---

    #[test]
    fn cancelled_trumps_all() {
        let mut run = make_run("r1");
        run.cancelled_at = Some(ts(2_000));
        // Even with confirmed_at, failed_at, and a crashed bound session, Cancelled wins.
        run.confirmed_at = Some(ts(1_500));
        run.failed_at = Some(ts(1_800));
        let mut crashed = bound("r1");
        crashed.exit_code = Some(1);
        assert_eq!(
            compute_run_status(&run, &[crashed]),
            TaskRunStatus::Cancelled
        );
    }

    #[test]
    fn cancelled_unset_does_not_force_cancelled() {
        // Two-way binding: flipping cancelled_at None must yield a non-Cancelled result.
        let run = make_run("r1");
        assert_ne!(
            compute_run_status(&run, &[]),
            TaskRunStatus::Cancelled,
            "with cancelled_at = None and no other terminal signals, must not derive Cancelled"
        );
    }

    // --- Case 2: Confirmed trumps Failed ---

    #[test]
    fn confirmed_trumps_failures() {
        let mut run = make_run("r1");
        run.confirmed_at = Some(ts(2_000));
        let mut crashed = bound("r1");
        crashed.exit_code = Some(1);
        assert_eq!(
            compute_run_status(&run, &[crashed]),
            TaskRunStatus::Completed
        );
    }

    #[test]
    fn confirmed_unset_does_not_force_completed() {
        let run = make_run("r1");
        let s = bound("r1");
        assert_ne!(
            compute_run_status(&run, &[s]),
            TaskRunStatus::Completed,
            "confirmed_at=None must not derive Completed"
        );
    }

    // --- Case 3: legacy failed_at carrier ---

    #[test]
    fn legacy_failed_at_carrier() {
        let mut run = make_run("r1");
        run.failed_at = Some(ts(2_000));
        // No bound sessions, no other signals — failed_at alone triggers Failed.
        assert_eq!(compute_run_status(&run, &[]), TaskRunStatus::Failed);
    }

    #[test]
    fn legacy_failed_at_unset_does_not_force_failed() {
        let run = make_run("r1");
        assert_ne!(
            compute_run_status(&run, &[]),
            TaskRunStatus::Failed,
            "failed_at=None and no crashed sessions must not derive Failed"
        );
    }

    // --- Case 4: nonzero exit + no winner = Failed ---

    #[test]
    fn nonzero_exit_no_winner() {
        let run = make_run("r1");
        let mut crashed = bound("r1");
        crashed.exit_code = Some(2);
        assert_eq!(
            compute_run_status(&run, &[crashed]),
            TaskRunStatus::Failed
        );
    }

    #[test]
    fn zero_exit_with_no_winner_does_not_derive_failed() {
        // Two-way binding: exit_code 0 (clean exit) with no winner is NOT Failed.
        let run = make_run("r1");
        let mut clean = bound("r1");
        clean.exit_code = Some(0);
        assert_ne!(
            compute_run_status(&run, &[clean]),
            TaskRunStatus::Failed,
            "exit_code=0 must not be treated as failure"
        );
    }

    // --- Case 5: nonzero exit but a winner was already chosen → not Failed ---

    #[test]
    fn nonzero_exit_with_winner_masks_failed() {
        let mut run = make_run("r1");
        run.selected_session_id = Some("s_other".to_string());
        let mut crashed = bound("r1");
        crashed.exit_code = Some(1);
        // selected_session_id set → "successful sibling" → Failed branch is skipped.
        // Without confirmed_at it derives Running.
        assert_eq!(
            compute_run_status(&run, &[crashed]),
            TaskRunStatus::Running
        );
    }

    // --- Case 6: all bound sessions have first_idle_at → AwaitingSelection ---

    #[test]
    fn all_bound_ever_idle_is_awaiting_selection() {
        let run = make_run("r1");
        let mut a = bound("r1");
        a.first_idle_at = Some(ts(1_500));
        let mut b = bound("r1");
        b.first_idle_at = Some(ts(1_600));
        assert_eq!(
            compute_run_status(&run, &[a, b]),
            TaskRunStatus::AwaitingSelection
        );
    }

    // --- Case 7: mixed idle status falls back to Running ---

    #[test]
    fn mixed_idle_falls_back_to_running() {
        let run = make_run("r1");
        let mut a = bound("r1");
        a.first_idle_at = Some(ts(1_500));
        let b = bound("r1"); // first_idle_at = None → not yet idle
        assert_eq!(
            compute_run_status(&run, &[a, b]),
            TaskRunStatus::Running
        );
    }

    // --- Case 8: empty bound set → Running default ---

    #[test]
    fn empty_bound_is_running() {
        let run = make_run("r1");
        assert_eq!(compute_run_status(&run, &[]), TaskRunStatus::Running);
    }

    // --- Case 9: foreign sessions (different task_run_id) are ignored ---

    #[test]
    fn unbound_session_ignored() {
        let run = make_run("r1");
        // This facts row is bound to a different run; it must not count toward r1's bound set
        // even though it has all the signals that would otherwise flip status.
        let mut foreign = unbound(Some("r2"));
        foreign.first_idle_at = Some(ts(1_500));
        foreign.exit_code = Some(1);
        // No bound facts for r1 → empty_bound default → Running.
        assert_eq!(
            compute_run_status(&run, &[foreign]),
            TaskRunStatus::Running
        );
    }

    #[test]
    fn unbound_with_bound_sibling_uses_only_bound_for_idle_check() {
        // Two-way binding for the bound-filter: a foreign idle facts row should not
        // satisfy the all_bound_ever_idle predicate when the bound facts row has not
        // yet gone idle.
        let run = make_run("r1");
        let mut foreign = unbound(Some("r2"));
        foreign.first_idle_at = Some(ts(1_500));
        let bound_active = bound("r1"); // first_idle_at = None
        assert_eq!(
            compute_run_status(&run, &[foreign, bound_active]),
            TaskRunStatus::Running
        );
    }

    #[test]
    fn null_task_run_id_facts_are_ignored() {
        // A facts row with task_run_id = None (a session not bound to any run)
        // must never appear in the bound set, even when the run id "matches" None.
        let run = make_run("r1");
        let mut orphan = unbound(None);
        orphan.first_idle_at = Some(ts(1_500));
        assert_eq!(
            compute_run_status(&run, &[orphan]),
            TaskRunStatus::Running
        );
    }
}
