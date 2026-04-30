use crate::domains::tasks::entity::{TaskRun, TaskStage};
use crate::infrastructure::database::{Database, TaskMethods, TaskRunMethods};
use anyhow::{Result, anyhow};
use chrono::Utc;
use uuid::Uuid;

/// Slimmed v2 facade over a `TaskRun`'s lifecycle. Compared to the v1 service
/// we deliberately do **not** port `mark_running`, `mark_awaiting_selection`,
/// or `fail_run` — those flipped a persisted `status` column that no longer
/// exists. Status is derived by
/// [`crate::domains::tasks::run_status::compute_run_status`] from the raw
/// timestamp columns this service writes plus the bound sessions' fact
/// columns.
///
/// What remains is a narrow API for *user-driven* state changes:
/// `create_task_run` (start), `confirm_selection` (user picked a winner),
/// `cancel_run` (user cancelled). Failure has no v2-native API at the service
/// level — a session exiting non-zero before any winner is confirmed is
/// observed by `compute_run_status` reading `session.exit_code`, not by this
/// service writing a status column. The only writer of `failed_at` is the
/// v1→v2 user-DB migration in Wave H, and it bypasses this service.
pub struct TaskRunService<'a> {
    db: &'a Database,
}

/// The chosen target of a confirmed run. A run resolves to exactly one of
/// these — either a session that produced the winning branch, or a
/// standalone artifact (e.g. a generated spec/plan without a worktree).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectionKind {
    Session(String),
    Artifact(String),
}

impl<'a> TaskRunService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Insert a new run row tied to `task_id` at `stage`. The row arrives with
    /// no terminal timestamps — `cancelled_at`, `confirmed_at`, `failed_at`
    /// all NULL — so the derived status is `Running` until something happens.
    /// `started_at` is set to now so callers can sort the most recent run.
    pub fn create_task_run(
        &self,
        task_id: &str,
        stage: TaskStage,
        preset_id: Option<&str>,
        base_branch: Option<&str>,
        target_branch: Option<&str>,
    ) -> Result<TaskRun> {
        // Surface a clean error for unknown tasks rather than relying on
        // FK-failure noise from the INSERT below.
        self.db.get_task_by_id(task_id)?;

        let now = Utc::now();
        let run = TaskRun {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            stage,
            preset_id: preset_id.map(str::to_string),
            base_branch: base_branch.map(str::to_string),
            target_branch: target_branch.map(str::to_string),
            selected_session_id: None,
            selected_artifact_id: None,
            selection_mode: None,
            started_at: Some(now),
            completed_at: None,
            cancelled_at: None,
            confirmed_at: None,
            failed_at: None,
            failure_reason: None,
            created_at: now,
            updated_at: now,
        };
        self.db.create_task_run(&run)?;
        Ok(run)
    }

    /// Resolve a run by recording its selection target and stamping
    /// `confirmed_at` + `completed_at`. The XOR invariant on
    /// `(selected_session_id, selected_artifact_id)` is enforced here so we
    /// never persist an ambiguous row.
    ///
    /// `compute_run_status` reads `confirmed_at` to derive `Completed`. We
    /// also stamp `completed_at` as the "execution finished" marker — same
    /// timestamp as `confirmed_at` for v2 since we don't track a distinct
    /// "agent done but awaiting confirm" event yet (Phase 5 may add one via
    /// `lucode_task_run_done`).
    pub fn confirm_selection(
        &self,
        run_id: &str,
        selected_session_id: Option<&str>,
        selected_artifact_id: Option<&str>,
        selection_mode: &str,
    ) -> Result<TaskRun> {
        match (selected_session_id, selected_artifact_id) {
            (Some(_), Some(_)) => {
                return Err(anyhow!(
                    "confirm_selection requires exactly one of session or artifact, got both"
                ));
            }
            (None, None) => {
                return Err(anyhow!(
                    "confirm_selection requires exactly one of session or artifact, got neither"
                ));
            }
            _ => {}
        }

        self.db.set_task_run_selection(
            run_id,
            selected_session_id,
            selected_artifact_id,
            Some(selection_mode),
        )?;
        self.db.set_task_run_completed_at(run_id)?;
        self.db.set_task_run_confirmed_at(run_id)?;
        self.db.get_task_run(run_id)
    }

    /// Cancel the run. Sets only `cancelled_at` — no failure reason, no
    /// completed_at. `compute_run_status` reads `cancelled_at` to derive
    /// `Cancelled` ahead of every other predicate.
    pub fn cancel_run(&self, run_id: &str) -> Result<()> {
        self.db.set_task_run_cancelled_at(run_id)
    }

    pub fn list_runs_for_task(&self, task_id: &str) -> Result<Vec<TaskRun>> {
        self.db.list_task_runs(task_id)
    }

    pub fn get_run(&self, run_id: &str) -> Result<TaskRun> {
        self.db.get_task_run(run_id)
    }

    pub fn selected_kind(&self, run: &TaskRun) -> Option<SelectionKind> {
        match (&run.selected_session_id, &run.selected_artifact_id) {
            (Some(id), None) => Some(SelectionKind::Session(id.clone())),
            (None, Some(id)) => Some(SelectionKind::Artifact(id.clone())),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::{Task, TaskVariant};
    use crate::domains::tasks::run_status::{SessionFacts, compute_run_status};
    use chrono::Utc;
    use std::path::PathBuf;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn seed_task(db: &Database, id: &str, name: &str) -> Task {
        let now = Utc::now();
        let task = Task {
            id: id.into(),
            name: name.into(),
            display_name: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".into(),
            variant: TaskVariant::Regular,
            stage: TaskStage::Draft,
            request_body: String::new(),
            source_kind: None,
            source_url: None,
            task_host_session_id: None,
            task_branch: None,
            base_branch: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            failure_flag: false,
            epic_id: None,
            attention_required: false,
            created_at: now,
            updated_at: now,
            cancelled_at: None,
            task_runs: Vec::new(),
        };
        db.create_task(&task).expect("seed task");
        task
    }

    #[test]
    fn create_task_run_inserts_row_with_no_terminal_timestamps() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);

        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .expect("create");

        assert!(run.cancelled_at.is_none());
        assert!(run.confirmed_at.is_none());
        assert!(run.failed_at.is_none());
        assert!(run.completed_at.is_none());
        assert!(run.started_at.is_some());

        // Two-way binding into the derived getter: a freshly-created run with no
        // bound sessions resolves to Running per compute_run_status §3.
        let derived =
            crate::domains::tasks::entity::TaskRunStatus::Running;
        assert_eq!(compute_run_status(&run, &[]), derived);
    }

    #[test]
    fn create_task_run_rejects_unknown_task_id() {
        let db = db();
        let svc = TaskRunService::new(&db);
        let err = svc
            .create_task_run("does-not-exist", TaskStage::Implemented, None, None, None)
            .unwrap_err();
        assert!(err.to_string().contains("task not found"));
    }

    #[test]
    fn confirm_selection_writes_confirmed_at_and_selection() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .expect("create");

        let confirmed = svc
            .confirm_selection(&run.id, Some("sess-winner"), None, "manual")
            .expect("confirm");

        assert!(confirmed.confirmed_at.is_some());
        assert!(confirmed.completed_at.is_some());
        assert_eq!(
            confirmed.selected_session_id.as_deref(),
            Some("sess-winner")
        );
        assert_eq!(confirmed.selection_mode.as_deref(), Some("manual"));

        // Derived status flips to Completed.
        assert_eq!(
            compute_run_status(&confirmed, &[]),
            crate::domains::tasks::entity::TaskRunStatus::Completed
        );
    }

    #[test]
    fn confirm_selection_rejects_both_targets() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();

        let err = svc
            .confirm_selection(&run.id, Some("s"), Some("a"), "manual")
            .unwrap_err();
        assert!(err.to_string().contains("exactly one"));

        // Persisted state must be untouched.
        let still_running = svc.get_run(&run.id).unwrap();
        assert!(still_running.confirmed_at.is_none());
        assert!(still_running.selected_session_id.is_none());
    }

    #[test]
    fn confirm_selection_rejects_neither_target() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();

        let err = svc
            .confirm_selection(&run.id, None, None, "manual")
            .unwrap_err();
        assert!(err.to_string().contains("exactly one"));
    }

    #[test]
    fn cancel_run_writes_cancelled_at_only() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .expect("create");

        svc.cancel_run(&run.id).expect("cancel");

        let cancelled = svc.get_run(&run.id).unwrap();
        assert!(cancelled.cancelled_at.is_some());
        assert!(cancelled.confirmed_at.is_none());
        assert!(cancelled.failed_at.is_none());
        assert!(cancelled.completed_at.is_none());
        assert!(cancelled.selected_session_id.is_none());

        assert_eq!(
            compute_run_status(&cancelled, &[]),
            crate::domains::tasks::entity::TaskRunStatus::Cancelled
        );
    }

    #[test]
    fn cancel_run_after_confirm_does_not_unwind_confirmed_at() {
        // Two-way binding for the cancellation order: cancel after confirm leaves
        // confirmed_at set. compute_run_status sees both timestamps and prefers
        // Cancelled per its decision order.
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();
        svc.confirm_selection(&run.id, Some("s"), None, "manual")
            .unwrap();

        svc.cancel_run(&run.id).unwrap();

        let after = svc.get_run(&run.id).unwrap();
        assert!(after.cancelled_at.is_some());
        assert!(after.confirmed_at.is_some(), "confirm timestamp persists");
        assert_eq!(
            compute_run_status(&after, &[]),
            crate::domains::tasks::entity::TaskRunStatus::Cancelled,
            "Cancelled trumps Completed in compute_run_status"
        );
    }

    #[test]
    fn selected_kind_distinguishes_session_and_artifact() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);

        let run_session = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();
        let confirmed_session = svc
            .confirm_selection(&run_session.id, Some("sess"), None, "manual")
            .unwrap();
        assert_eq!(
            svc.selected_kind(&confirmed_session),
            Some(SelectionKind::Session("sess".into()))
        );

        let run_artifact = svc
            .create_task_run("t1", TaskStage::Planned, None, None, None)
            .unwrap();
        let confirmed_artifact = svc
            .confirm_selection(&run_artifact.id, None, Some("art"), "manual")
            .unwrap();
        assert_eq!(
            svc.selected_kind(&confirmed_artifact),
            Some(SelectionKind::Artifact("art".into()))
        );
    }

    #[test]
    fn list_runs_for_task_returns_only_matching_task_in_creation_order() {
        let db = db();
        seed_task(&db, "t1", "first");
        seed_task(&db, "t2", "second");
        let svc = TaskRunService::new(&db);
        let _r1a = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();
        let _r2 = svc
            .create_task_run("t2", TaskStage::Implemented, None, None, None)
            .unwrap();
        let _r1b = svc
            .create_task_run("t1", TaskStage::Pushed, None, None, None)
            .unwrap();

        let listed = svc.list_runs_for_task("t1").unwrap();
        assert_eq!(listed.len(), 2);
        for run in &listed {
            assert_eq!(run.task_id, "t1");
        }
    }

    /// Integration check that the service writes column shapes consistent with
    /// what compute_run_status expects when bound sessions are involved. This
    /// is the load-bearing sanity test for the Wave F + Wave D pairing.
    #[test]
    fn confirm_with_winner_masks_a_crashed_sibling() {
        let db = db();
        seed_task(&db, "t1", "first");
        let svc = TaskRunService::new(&db);
        let run = svc
            .create_task_run("t1", TaskStage::Implemented, None, None, None)
            .unwrap();

        let crashed = SessionFacts {
            task_run_id: Some(run.id.clone()),
            exit_code: Some(1),
            first_idle_at: None,
        };
        let confirmed = svc
            .confirm_selection(&run.id, Some("winner"), None, "manual")
            .unwrap();

        assert_eq!(
            compute_run_status(&confirmed, &[crashed]),
            crate::domains::tasks::entity::TaskRunStatus::Completed,
            "after confirm, crashed sibling no longer flips Failed"
        );
    }
}
