//! End-to-end test for the v2 run-lifecycle pipeline.
//!
//! Composes Wave E (DB methods), Wave F (TaskRunService), Wave G
//! (SessionFactsRecorder), and Wave D (compute_run_status) against a real
//! on-disk SQLite DB. Proves that the full Phase 1 stack agrees on derived
//! status for the canonical happy path:
//!
//!   create task → start run → spawn session → record idle → derived
//!   AwaitingSelection → record clean exit → still AwaitingSelection (because
//!   write-once first_idle_at + exit_code 0 is not a failure) → confirm
//!   selection → derived Completed.
//!
//! Lives at top-level `tests/` because the assertions cross sessions, tasks,
//! and infrastructure layers — `arch_domain_isolation` forbids cross-domain
//! imports inside `src/domains/`.

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

fn seed_task(db: &Database, id: &str) -> Task {
    let now = Utc::now();
    let task = Task {
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
    };
    db.create_task(&task).expect("seed task");
    task
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

fn link_session_to_run(db: &Database, session_id: &str, run_id: &str) {
    let conn = db.get_conn().unwrap();
    conn.execute(
        "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
        rusqlite::params![run_id, session_id],
    )
    .unwrap();
}

fn facts_for_run(db: &Database, run_id: &str) -> Vec<SessionFacts> {
    db.get_sessions_by_task_run_id(run_id)
        .expect("query")
        .into_iter()
        .map(|s| SessionFacts {
            task_run_id: s.task_run_id,
            exit_code: s.exit_code,
            first_idle_at: s.first_idle_at,
        })
        .collect()
}

#[test]
fn happy_path_run_to_confirmed_completion() {
    let db = make_db();
    seed_task(&db, "t1");
    let svc = TaskRunService::new(&db);
    let recorder = SessionFactsRecorder::new(&db);

    // Step 1: start the run. No bound sessions yet, no terminal timestamps.
    let run = svc
        .create_task_run("t1", TaskStage::Implemented, None, None, None)
        .expect("start");
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, &run.id)),
        TaskRunStatus::Running,
        "fresh run with no sessions derives Running"
    );

    // Step 2: spawn a single bound session.
    db.create_session(&make_session("s1", &run.id))
        .expect("create session");
    link_session_to_run(&db, "s1", &run.id);
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, &run.id)),
        TaskRunStatus::Running,
        "bound session present but never idle → Running"
    );

    // Step 3: agent reports idle. Sticky AwaitingSelection.
    let idle_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
    recorder.record_first_idle("s1", idle_ts).expect("idle");
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, &run.id)),
        TaskRunStatus::AwaitingSelection,
        "all bound sessions ever-idle → AwaitingSelection"
    );

    // Step 4: agent exits cleanly. Stays AwaitingSelection — clean exit is not
    // failure, and idle stickiness holds.
    let exit_ts = Utc.timestamp_opt(2_500, 0).single().unwrap();
    recorder
        .record_exit("s1", exit_ts, Some(0))
        .expect("clean exit");
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, &run.id)),
        TaskRunStatus::AwaitingSelection,
        "clean exit must not flip Failed; idle is still sticky"
    );

    // Step 5: user confirms. Derived flips to Completed.
    let confirmed = svc
        .confirm_selection(&run.id, Some("s1"), None, "manual")
        .expect("confirm");
    assert_eq!(
        compute_run_status(&confirmed, &facts_for_run(&db, &run.id)),
        TaskRunStatus::Completed
    );
}

#[test]
fn cancel_after_start_immediately_derives_cancelled() {
    let db = make_db();
    seed_task(&db, "t1");
    let svc = TaskRunService::new(&db);

    let run = svc
        .create_task_run("t1", TaskStage::Implemented, None, None, None)
        .unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, &run.id)),
        TaskRunStatus::Running
    );

    svc.cancel_run(&run.id).unwrap();
    let cancelled = svc.get_run(&run.id).unwrap();
    assert_eq!(
        compute_run_status(&cancelled, &facts_for_run(&db, &run.id)),
        TaskRunStatus::Cancelled
    );
}
