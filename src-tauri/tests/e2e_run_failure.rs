//! End-to-end test for the v2 run-failure derivation.
//!
//! Proves: a bound session exiting non-zero with no winner flips the derived
//! status to Failed; once the user confirms a sibling as the winner, the
//! Failed signal is masked and the run derives Completed.

use chrono::{TimeZone, Utc};
use lucode::domains::sessions::db_sessions::SessionMethods;
use lucode::domains::sessions::entity::Session;
use lucode::domains::sessions::facts_recorder::SessionFactsRecorder;
use lucode::domains::tasks::entity::{Task, TaskRunStatus, TaskStage, TaskVariant};
use lucode::domains::tasks::run_status::{SessionFacts, compute_run_status};
use lucode::domains::tasks::runs::TaskRunService;
use lucode::infrastructure::database::{Database, TaskMethods};
use std::path::PathBuf;
use tempfile::TempDir;

fn make_db() -> Database {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("test.db");
    let db = Database::new(Some(path)).expect("db");
    std::mem::forget(dir);
    db
}

fn seed_task(db: &Database, id: &str) {
    let now = Utc::now();
    db.create_task(&Task {
        id: id.into(),
        name: id.into(),
        display_name: None,
        repository_path: PathBuf::from("/tmp/repo"),
        repository_name: "repo".into(),
        variant: TaskVariant::Regular,
        stage: TaskStage::Draft,
        request_body: String::new(),
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
    })
    .unwrap();
}

fn make_session(id: &str, run_id: &str) -> Session {
    Session {
        id: id.into(),
        name: id.into(),
        display_name: None,
        version_group_id: None,
        version_number: None,
        epic_id: None,
        repository_path: PathBuf::from("/tmp/repo"),
        repository_name: "repo".into(),
        branch: format!("lucode/{id}"),
        parent_branch: "main".into(),
        original_parent_branch: Some("main".into()),
        worktree_path: PathBuf::from(format!("/tmp/wt-{id}")),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        last_activity: None,
        initial_prompt: None,
        ready_to_merge: false,
        original_agent_type: None,
        original_agent_model: None,
        pending_name_generation: false,
        was_auto_generated: false,
        spec_content: None,
        resume_allowed: true,
        amp_thread_id: None,
        issue_number: None,
        issue_url: None,
        pr_number: None,
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
        task_id: None,
        task_stage: None,
        task_run_id: Some(run_id.into()),
        run_role: None,
        slot_key: None,
        exited_at: None,
        exit_code: None,
        first_idle_at: None,
        is_spec: false,
        cancelled_at: None,
    }
}

fn link(db: &Database, session_id: &str, run_id: &str) {
    let conn = db.get_conn().unwrap();
    conn.execute(
        "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
        rusqlite::params![run_id, session_id],
    )
    .unwrap();
}

fn facts(db: &Database, run_id: &str) -> Vec<SessionFacts> {
    db.get_sessions_by_task_run_id(run_id)
        .unwrap()
        .into_iter()
        .map(|s| SessionFacts {
            task_run_id: s.task_run_id,
            exit_code: s.exit_code,
            first_idle_at: s.first_idle_at,
        })
        .collect()
}

#[test]
fn nonzero_exit_with_no_winner_derives_failed_then_confirm_masks_to_completed() {
    let db = make_db();
    seed_task(&db, "t1");
    let svc = TaskRunService::new(&db);
    let recorder = SessionFactsRecorder::new(&db);

    let run = svc
        .create_task_run("t1", TaskStage::Implemented, None, None, None)
        .unwrap();

    // Two bound candidate sessions.
    db.create_session(&make_session("a", &run.id)).unwrap();
    db.create_session(&make_session("b", &run.id)).unwrap();
    link(&db, "a", &run.id);
    link(&db, "b", &run.id);

    // Both running, neither idle, neither exited → Running.
    assert_eq!(
        compute_run_status(&run, &facts(&db, &run.id)),
        TaskRunStatus::Running
    );

    // Session `a` crashes. No winner picked → Failed.
    let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
    recorder.record_exit("a", exit_ts, Some(137)).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts(&db, &run.id)),
        TaskRunStatus::Failed
    );

    // User confirms session `b` as the winner. selected_session_id is set
    // and confirmed_at is stamped. compute_run_status checks confirmed_at
    // before the failure path, so this immediately flips to Completed and
    // the crashed sibling no longer triggers Failed.
    let confirmed = svc
        .confirm_selection(&run.id, Some("b"), None, "manual")
        .unwrap();
    assert_eq!(
        compute_run_status(&confirmed, &facts(&db, &run.id)),
        TaskRunStatus::Completed
    );
}

#[test]
fn cancelled_run_with_crashed_session_still_derives_cancelled() {
    // Cancelled is the highest-priority predicate; it trumps Failed even when
    // a session has exited non-zero. Two-way binding for the decision order.
    let db = make_db();
    seed_task(&db, "t1");
    let svc = TaskRunService::new(&db);
    let recorder = SessionFactsRecorder::new(&db);

    let run = svc
        .create_task_run("t1", TaskStage::Implemented, None, None, None)
        .unwrap();
    db.create_session(&make_session("a", &run.id)).unwrap();
    link(&db, "a", &run.id);

    let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
    recorder.record_exit("a", exit_ts, Some(1)).unwrap();
    svc.cancel_run(&run.id).unwrap();

    let cancelled_run = svc.get_run(&run.id).unwrap();
    assert_eq!(
        compute_run_status(&cancelled_run, &facts(&db, &run.id)),
        TaskRunStatus::Cancelled,
        "Cancelled trumps Failed in compute_run_status decision order"
    );
}
