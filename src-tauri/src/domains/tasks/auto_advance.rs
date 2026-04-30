use crate::domains::sessions::entity::PrState;
use crate::domains::tasks::entity::TaskStage;
use crate::infrastructure::database::TaskMethods;
use anyhow::Result;

/// React to a forge `ForgePrDetailsRefreshed` event by advancing the task
/// linked to `pr_number`. Decision is a pure function of
/// `(current_stage, failure_flag, pr_state)`:
///
/// | current stage     | flag  | pr_state         | next stage | flag op    | warn |
/// |-------------------|-------|------------------|------------|------------|------|
/// | Implemented       | *     | Open, Succeeding | Pushed     | clear if set | no |
/// | Implemented       | false | Failed           | (none)     | set true   | no   |
/// | Implemented       | true  | Failed           | (none)     | no change  | no   |
/// | Implemented       | *     | Mred             | Done       | clear if set | no |
/// | Pushed            | *     | Open, Succeeding | (none)     | clear if set | no |
/// | Pushed            | false | Failed           | (none)     | set true   | no   |
/// | Pushed            | true  | Failed           | (none)     | no change  | no   |
/// | Pushed            | *     | Mred             | Done       | clear if set | no |
/// | Done              | *     | *                | (none)     | none       | yes  |
/// | Cancelled         | *     | *                | (none)     | none       | no   |
/// | Draft, Ready, Brainstormed, Planned | * | *  | (none)     | none       | no   |
///
/// Idempotent — re-emitting the same event must not double-advance because
/// the post-event stage is itself a fixed-point under the same input.
pub fn on_pr_state_refreshed(
    db: &dyn TaskMethods,
    repository_path: &str,
    pr_number: i64,
    pr_state: PrState,
) -> Result<()> {
    let Some(task) = db.find_task_for_pr_number(repository_path, pr_number)? else {
        return Ok(());
    };

    // Phase 3: cancellation is orthogonal to stage. A cancelled task
    // does not auto-advance regardless of PR state. Reopening (clear
    // `cancelled_at`) lets the next event resume normal advancement.
    if task.cancelled_at.is_some() {
        return Ok(());
    }

    let decision = decide_next_stage(task.stage, task.failure_flag, &pr_state);

    if let Some(new_stage) = decision.next_stage
        && new_stage != task.stage
    {
        log::info!(
            "auto-advance: task {} {} -> {} via PR #{pr_number} {}",
            task.id,
            task.stage.as_str(),
            new_stage.as_str(),
            pr_state.as_str(),
        );
        db.set_task_stage(&task.id, new_stage)?;
    }

    if let Some(failure_flag) = decision.failure_flag
        && failure_flag != task.failure_flag
    {
        log::info!(
            "auto-advance: task {} failure_flag {} -> {} via PR #{pr_number} {}",
            task.id,
            task.failure_flag,
            failure_flag,
            pr_state.as_str(),
        );
        db.set_task_failure_flag(&task.id, failure_flag)?;
    }

    if decision.warn_terminal {
        log::warn!(
            "auto-advance: task {} already at {} but received PR #{pr_number} {} event (likely stale)",
            task.id,
            task.stage.as_str(),
            pr_state.as_str(),
        );
    }

    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct Decision {
    next_stage: Option<TaskStage>,
    failure_flag: Option<bool>,
    warn_terminal: bool,
}

fn decide_next_stage(current: TaskStage, failure_flag: bool, pr_state: &PrState) -> Decision {
    match (current, pr_state) {
        (TaskStage::Implemented, PrState::Open | PrState::Succeeding) => Decision {
            next_stage: Some(TaskStage::Pushed),
            failure_flag: failure_flag.then_some(false),
            warn_terminal: false,
        },
        (TaskStage::Implemented | TaskStage::Pushed, PrState::Failed) => Decision {
            next_stage: None,
            failure_flag: (!failure_flag).then_some(true),
            warn_terminal: false,
        },
        (TaskStage::Implemented | TaskStage::Pushed, PrState::Mred) => Decision {
            next_stage: Some(TaskStage::Done),
            failure_flag: failure_flag.then_some(false),
            warn_terminal: false,
        },
        (TaskStage::Pushed, PrState::Open | PrState::Succeeding) => Decision {
            next_stage: None,
            failure_flag: failure_flag.then_some(false),
            warn_terminal: false,
        },
        (TaskStage::Done, _) => Decision {
            next_stage: None,
            failure_flag: None,
            warn_terminal: true,
        },
        // Phase 3 Wave E: cancellation no longer lives in `stage`. The
        // cancelled-task short-circuit moved to the caller (which now
        // checks `task.cancelled_at.is_some()` before calling
        // `decide_next_stage`); this match is reached only for
        // non-cancelled tasks.
        (TaskStage::Draft | TaskStage::Ready | TaskStage::Brainstormed | TaskStage::Planned, _) => {
            Decision {
                next_stage: None,
                failure_flag: None,
                warn_terminal: false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use crate::domains::tasks::entity::{Task, TaskStage, TaskVariant};
    use crate::infrastructure::database::{Database, TaskMethods};
    use chrono::Utc;
    use std::path::PathBuf;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn seed_task(db: &Database, id: &str, stage: TaskStage) -> Task {
        let now = Utc::now();
        let task = Task {
            id: id.into(),
            name: id.into(),
            display_name: None,
            repository_path: PathBuf::from("/r"),
            repository_name: "repo".into(),
            variant: TaskVariant::Regular,
            stage: TaskStage::Draft,
            request_body: "req".into(),
            current_spec: None,
            current_plan: None,
            current_summary: None,
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
        db.create_task(&task).unwrap();
        if stage != TaskStage::Draft {
            for next in stage_path_from_draft_to(stage) {
                db.set_task_stage(id, next).unwrap();
            }
        }
        db.get_task_by_id(id).unwrap()
    }

    fn stage_path_from_draft_to(target: TaskStage) -> Vec<TaskStage> {
        match target {
            TaskStage::Draft => vec![],
            TaskStage::Ready => vec![TaskStage::Ready],
            TaskStage::Brainstormed => vec![TaskStage::Ready, TaskStage::Brainstormed],
            TaskStage::Planned => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
            ],
            TaskStage::Implemented => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
            ],
            TaskStage::Pushed => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
                TaskStage::Pushed,
            ],
            TaskStage::Done => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
                TaskStage::Pushed,
                TaskStage::Done,
            ],
        }
    }

    fn link_session(db: &Database, task_id: &str, pr_number: i64) {
        let now = Utc::now();
        let session_id = format!("sess-{task_id}");
        let session = Session {
            id: session_id.clone(),
            name: session_id.clone(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/r"),
            repository_name: "repo".into(),
            branch: format!("lucode/{task_id}"),
            parent_branch: "main".into(),
            original_parent_branch: Some("main".into()),
            worktree_path: PathBuf::from(format!("/tmp/{session_id}")),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_agent_model: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: Some(pr_number),
            pr_url: None,
            pr_state: None,
            is_consolidation: false,
            consolidation_sources: None,
            consolidation_round_id: None,
            consolidation_role: None,
            consolidation_report: None,
            consolidation_report_source: None,
            consolidation_base_session_id: None,
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: None,
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: Some(task_id.into()),
            task_stage: None,
            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
            is_spec: false,
            cancelled_at: None,
        };
        db.create_session(&session).unwrap();
    }

    #[test]
    fn implemented_plus_open_advances_to_pushed() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Open).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Pushed);
    }

    #[test]
    fn implemented_plus_mred_skips_to_done() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Mred).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Done);
    }

    #[test]
    fn pushed_plus_mred_advances_to_done() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Pushed);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Mred).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Done);
    }

    #[test]
    fn pushed_plus_open_is_noop() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Pushed);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Open).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Pushed);
    }

    #[test]
    fn failed_pr_at_implemented_flips_failure_flag_without_advancing_stage() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Failed).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Implemented);
        assert!(after.failure_flag);
    }

    #[test]
    fn failed_pr_at_pushed_flips_failure_flag_without_regressing_stage() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Pushed);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Failed).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Pushed);
        assert!(after.failure_flag);
    }

    #[test]
    fn failed_then_succeeding_clears_failure_flag() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Failed).unwrap();
        on_pr_state_refreshed(&db, "/r", 42, PrState::Succeeding).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Pushed);
        assert!(!after.failure_flag);
    }

    #[test]
    fn failure_flag_set_persists_across_event_replay() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Failed).unwrap();
        on_pr_state_refreshed(&db, "/r", 42, PrState::Failed).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Implemented);
        assert!(after.failure_flag);
    }

    #[test]
    fn done_plus_open_is_noop_terminal() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Done);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Open).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Done);
    }

    #[test]
    fn no_task_for_pr_is_noop() {
        let db = db();
        on_pr_state_refreshed(&db, "/r", 999, PrState::Open).unwrap();
    }

    /// Phase 3 Wave E: cancellation is `task.cancelled_at`, not a stage.
    /// A cancelled task carrying any PR state must not auto-advance,
    /// regardless of how the PR resolves. The `cancelled_at.is_some()`
    /// guard at the top of `on_pr_state_refreshed` is the load-bearing
    /// check; this test fails on revert (e.g. if the guard is removed,
    /// `Mred` would advance the task to `Done`).
    #[test]
    fn cancelled_task_plus_mred_is_noop() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        db.set_task_cancelled_at(&task.id, Some(Utc::now()))
            .unwrap();
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Mred).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(
            after.stage,
            TaskStage::Implemented,
            "cancelled task must not auto-advance even on Mred"
        );
        assert!(
            after.cancelled_at.is_some(),
            "cancellation must persist across the noop event"
        );
    }

    #[test]
    fn implemented_plus_open_is_idempotent_on_second_call() {
        let db = db();
        let task = seed_task(&db, "t1", TaskStage::Implemented);
        link_session(&db, &task.id, 42);

        on_pr_state_refreshed(&db, "/r", 42, PrState::Open).unwrap();
        on_pr_state_refreshed(&db, "/r", 42, PrState::Open).unwrap();

        let after = db.get_task_by_id(&task.id).unwrap();
        assert_eq!(after.stage, TaskStage::Pushed);
    }
}
