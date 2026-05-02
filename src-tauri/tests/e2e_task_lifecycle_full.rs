//! Phase 7 Wave E.0: programmatic full-lifecycle e2e for the v2 task
//! aggregate.
//!
//! Walks Draft → Ready → Brainstormed → Planned → Implemented → Pushed
//! → Done, simulating a 3-candidate run at each stage that ends in a
//! confirmed winner. Asserts `compute_run_status` results at every
//! transition through the production write/read paths
//! (`db.create_task_run`, `recorder.record_first_idle`,
//! `db.set_task_run_confirmed_at`, etc.). A separate test covers the
//! cancel + reopen orthogonality (Phase 3 invariant).
//!
//! Mirrors the e2e_run_lifecycle pattern but extends it to the full
//! state-transition surface so a future regression in any stage flip
//! is caught at CI time, not at user smoke-test time.

use chrono::{TimeZone, Utc};
use lucode::domains::sessions::db_sessions::SessionMethods;
use lucode::domains::sessions::entity::Session;
use lucode::domains::sessions::facts_recorder::SessionFactsRecorder;
use lucode::domains::tasks::entity::{Task, TaskRunStatus, TaskStage, TaskVariant};
use lucode::domains::tasks::run_status::{SessionFacts, compute_run_status};
use lucode::domains::tasks::runs::TaskRunService;
use lucode::infrastructure::database::{Database, TaskMethods, TaskRunMethods};
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

fn make_session(id: &str, run_id: &str, slot_key: &str) -> Session {
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
        slot_key: Some(slot_key.into()),
        exited_at: None,
        exit_code: None,
        first_idle_at: None,
        is_spec: false,
        cancelled_at: None,
    }
}

fn link_session_to_run(db: &Database, session_id: &str, run_id: &str) {
    let conn = db.get_conn().expect("conn");
    conn.execute(
        "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
        rusqlite::params![run_id, session_id],
    )
    .expect("link");
}

fn facts_for_run(db: &Database, run_id: &str) -> Vec<SessionFacts> {
    db.get_sessions_by_task_run_id(run_id)
        .expect("bound sessions")
        .into_iter()
        .map(|s| SessionFacts {
            task_run_id: s.task_run_id.clone(),
            exit_code: s.exit_code,
            first_idle_at: s.first_idle_at,
        })
        .collect()
}

/// Drive a single multi-candidate stage run from creation to confirmed
/// winner. Returns the run id for downstream assertions.
fn drive_stage_run(
    db: &Database,
    task_id: &str,
    stage: TaskStage,
    slot_count: usize,
) -> String {
    let runs = TaskRunService::new(db);
    let run = runs
        .create_task_run(task_id, stage, None, None, None)
        .expect("create run");

    // Provision N slot sessions.
    for i in 0..slot_count {
        let sid = format!("{}-{}-{}", task_id, run.id, i);
        let slot = format!("slot-{}", char::from(b'a' + i as u8));
        let session = make_session(&sid, &run.id, &slot);
        db.create_session(&session).expect("create session");
        link_session_to_run(db, &sid, &run.id);
    }

    // Initially the run is Running (no idle, no exit, no terminal flag).
    let facts = facts_for_run(db, &run.id);
    let read_run = TaskRunMethods::get_task_run(db, &run.id).expect("read run");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::Running,
        "freshly-spawned {stage:?} run should derive Running",
    );

    // Each slot reports first_idle.
    let recorder = SessionFactsRecorder::new(db);
    for i in 0..slot_count {
        let sid = format!("{}-{}-{}", task_id, run.id, i);
        recorder
            .record_first_idle(&sid, Utc::now())
            .expect("first_idle");
    }

    let facts = facts_for_run(db, &run.id);
    let read_run = TaskRunMethods::get_task_run(db, &run.id).expect("read run");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::AwaitingSelection,
        "all-slots-idle {stage:?} run should derive AwaitingSelection",
    );

    // Confirm winner: pick the first slot.
    let winner_id = format!("{}-{}-0", task_id, run.id);
    db.set_task_run_selection(&run.id, Some(&winner_id), None, Some("manual"))
        .expect("set winner");
    db.set_task_run_confirmed_at(&run.id)
        .expect("confirm");

    let facts = facts_for_run(db, &run.id);
    let read_run = TaskRunMethods::get_task_run(db, &run.id).expect("read run");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::Completed,
        "confirmed {stage:?} run should derive Completed",
    );

    run.id
}

#[test]
fn full_lifecycle_walks_draft_to_done_with_consistent_derived_state() {
    let db = make_db();
    let task = seed_task(&db, "alpha");

    // Stage transitions in v2 are advanced explicitly by the caller via
    // db.set_task_stage. compute_run_status is orthogonal — it derives
    // run state from session facts, not from task.stage. We assert both.

    // Draft → Ready (typically via lucode_task_promote_to_ready in the
    // app; here we set the stage directly to focus on the lifecycle
    // contract, not the orchestration plumbing).
    db.set_task_stage(&task.id, TaskStage::Ready)
        .expect("promote to ready");

    // Brainstorm: 3 candidates → confirm winner.
    drive_stage_run(&db, &task.id, TaskStage::Brainstormed, 3);
    db.set_task_stage(&task.id, TaskStage::Brainstormed)
        .expect("advance to brainstormed");

    // Plan: 2 candidates this time.
    drive_stage_run(&db, &task.id, TaskStage::Planned, 2);
    db.set_task_stage(&task.id, TaskStage::Planned)
        .expect("advance to planned");

    // Implement: single candidate.
    drive_stage_run(&db, &task.id, TaskStage::Implemented, 1);
    db.set_task_stage(&task.id, TaskStage::Implemented)
        .expect("advance to implemented");

    // Push + Done are stage transitions; they don't gate on a multi-
    // candidate run in v2 (PR push is handled by the forge integration,
    // not a candidate-bearing run).
    db.set_task_stage(&task.id, TaskStage::Pushed)
        .expect("advance to pushed");
    db.set_task_stage(&task.id, TaskStage::Done)
        .expect("advance to done");

    let final_task = TaskMethods::get_task_by_id(&db, &task.id).expect("read task");
    assert_eq!(final_task.stage, TaskStage::Done);
    assert!(final_task.cancelled_at.is_none());
    assert!(
        TaskStage::Done.is_terminal(),
        "Done is the terminal stage in v2",
    );

    // Every run we drove ended in Completed.
    let runs = TaskRunMethods::list_task_runs(&db, &task.id).expect("list runs");
    assert_eq!(runs.len(), 3, "three stage runs (brainstorm/plan/implement)");
    for run in &runs {
        let facts = facts_for_run(&db, &run.id);
        assert_eq!(
            compute_run_status(run, &facts),
            TaskRunStatus::Completed,
            "every stage run for completed lifecycle should derive Completed",
        );
    }
}

#[test]
fn cancel_then_reopen_preserves_branches_and_clears_cancelled_at() {
    let db = make_db();
    let task = seed_task(&db, "cancel-test");

    // Provision a run mid-flight.
    drive_stage_run(&db, &task.id, TaskStage::Brainstormed, 2);
    db.set_task_stage(&task.id, TaskStage::Brainstormed)
        .expect("advance");

    // Cancel: Phase 3 invariant — cancelled_at is orthogonal to stage.
    let cancel_ts = Utc.timestamp_opt(5_000, 0).single().expect("ts");
    db.set_task_cancelled_at(&task.id, Some(cancel_ts))
        .expect("cancel");

    let cancelled = TaskMethods::get_task_by_id(&db, &task.id).expect("read");
    assert!(cancelled.cancelled_at.is_some(), "cancel stamped");
    assert_eq!(
        cancelled.stage,
        TaskStage::Brainstormed,
        "stage stays — cancelled_at is orthogonal",
    );
    assert!(cancelled.is_cancelled());

    // Reopen: clear cancelled_at, optionally reset stage to Draft.
    db.set_task_cancelled_at(&task.id, None)
        .expect("reopen — clear cancelled_at");
    db.set_task_stage(&task.id, TaskStage::Draft)
        .expect("reopen — reset stage to Draft");

    let reopened = TaskMethods::get_task_by_id(&db, &task.id).expect("read");
    assert!(reopened.cancelled_at.is_none(), "cancelled_at cleared");
    assert_eq!(reopened.stage, TaskStage::Draft);
    assert!(!reopened.is_cancelled());

    // The previously-completed brainstorm run is preserved (history
    // intact). Its derived status is still Completed.
    let runs = TaskRunMethods::list_task_runs(&db, &task.id).expect("list");
    assert_eq!(runs.len(), 1);
    let facts = facts_for_run(&db, &runs[0].id);
    assert_eq!(
        compute_run_status(&runs[0], &facts),
        TaskRunStatus::Completed,
        "reopen preserves run history; previously-completed run stays Completed",
    );
}

#[test]
fn cancelling_run_mid_flight_derives_cancelled_status() {
    let db = make_db();
    let task = seed_task(&db, "run-cancel");
    db.set_task_stage(&task.id, TaskStage::Ready).expect("ready");

    let runs = TaskRunService::new(&db);
    let run = runs
        .create_task_run(&task.id, TaskStage::Brainstormed, None, None, None)
        .expect("create run");

    // Provision two slots, neither idle yet.
    for i in 0..2 {
        let sid = format!("{}-{}-{}", task.id, run.id, i);
        let session = make_session(
            &sid,
            &run.id,
            &format!("slot-{}", char::from(b'a' + i as u8)),
        );
        db.create_session(&session).expect("create");
        link_session_to_run(&db, &sid, &run.id);
    }

    // Run is Running.
    let facts = facts_for_run(&db, &run.id);
    let read_run = TaskRunMethods::get_task_run(&db, &run.id).expect("read");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::Running,
    );

    // Cancel the run. set_task_run_cancelled_at writes a stamp internally.
    db.set_task_run_cancelled_at(&run.id)
        .expect("cancel run");

    let facts = facts_for_run(&db, &run.id);
    let read_run = TaskRunMethods::get_task_run(&db, &run.id).expect("read");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::Cancelled,
        "run.cancelled_at trumps every other signal — derives Cancelled",
    );

    // Task stage stays at whatever it was; cancellation is orthogonal.
    let read_task = TaskMethods::get_task_by_id(&db, &task.id).expect("read");
    assert_eq!(read_task.stage, TaskStage::Ready);
    assert!(read_task.cancelled_at.is_none());
}

#[test]
fn slot_failure_without_winner_derives_failed_run_status() {
    let db = make_db();
    let task = seed_task(&db, "fail-test");
    db.set_task_stage(&task.id, TaskStage::Ready).expect("ready");

    let runs = TaskRunService::new(&db);
    let run = runs
        .create_task_run(&task.id, TaskStage::Brainstormed, None, None, None)
        .expect("create run");

    let sid_a = format!("{}-{}-a", task.id, run.id);
    let sid_b = format!("{}-{}-b", task.id, run.id);
    db.create_session(&make_session(&sid_a, &run.id, "slot-a"))
        .expect("create a");
    db.create_session(&make_session(&sid_b, &run.id, "slot-b"))
        .expect("create b");
    link_session_to_run(&db, &sid_a, &run.id);
    link_session_to_run(&db, &sid_b, &run.id);

    // Slot A exits non-zero; slot B is still alive.
    db.set_session_exited_at(&sid_a, Utc::now(), Some(2))
        .expect("exit a");

    let facts = facts_for_run(&db, &run.id);
    let read_run = TaskRunMethods::get_task_run(&db, &run.id).expect("read");
    assert_eq!(
        compute_run_status(&read_run, &facts),
        TaskRunStatus::Failed,
        "non-zero exit on a bound slot before any winner derives Failed",
    );
}
