//! Cross-domain integration test for the v2 derived run status pipeline.
//!
//! The unit tests inside each domain pin the halves:
//! - `sessions::facts_recorder::tests::*` pins the recorder writes (including
//!   the load-bearing `first_idle_call_after_initial_does_not_overwrite`).
//! - `tasks::run_status::tests::*` pins the pure derivation function against
//!   synthetic `SessionFacts` fixtures.
//!
//! This test exists at the top level — outside `src/domains/` — because the
//! `arch_domain_isolation` test forbids `sessions → tasks` and `tasks →
//! sessions` imports inside the domain layer. The end-to-end pairing has to
//! live somewhere that can cross both, and integration tests qualify.
//!
//! What this pins: the recorder writes session-row facts that, when read back
//! via `get_sessions_by_task_run_id` and projected into `SessionFacts`, agree
//! with `compute_run_status`'s reading of those facts. If a future schema
//! change drops or renames a column on either side, this test fails.

use chrono::{TimeZone, Utc};
use lucode::domains::sessions::db_sessions::SessionMethods;
use lucode::domains::sessions::entity::{Session, SessionState, SessionStatus};
use lucode::domains::sessions::facts_recorder::SessionFactsRecorder;
use lucode::domains::tasks::entity::{TaskRun, TaskRunStatus, TaskStage};
use lucode::domains::tasks::run_status::{SessionFacts, compute_run_status};
use lucode::infrastructure::database::Database;
use std::path::PathBuf;
use tempfile::TempDir;

/// Build a fresh on-disk SQLite database in a temp dir. Integration tests cannot
/// use `Database::new_in_memory` because that constructor is gated behind
/// `#[cfg(test)]` in the lib crate and only visible from unit tests inside
/// `src/`. The TempDir lives until the returned tuple is dropped.
fn make_db() -> Database {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("test.db");
    let db = Database::new(Some(path)).expect("db");
    // The TempDir would be dropped here normally; leak it for the test's
    // lifetime so the file path stays valid. `just test` runs each test in a
    // fresh process so this leak is bounded.
    std::mem::forget(dir);
    db
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
        status: SessionStatus::Active,
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
        session_state: SessionState::Running,
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

fn link_to_run(db: &Database, session_id: &str, run_id: &str) {
    let conn = db.get_conn().unwrap();
    conn.execute(
        "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
        rusqlite::params![run_id, session_id],
    )
    .unwrap();
}

fn make_run(id: &str) -> TaskRun {
    let now = Utc.timestamp_opt(1_000, 0).single().unwrap();
    TaskRun {
        id: id.into(),
        task_id: "t1".into(),
        stage: TaskStage::Implemented,
        preset_id: None,
        base_branch: None,
        target_branch: None,
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
    }
}

fn facts_for_run(db: &Database, run_id: &str) -> Vec<SessionFacts> {
    db.get_sessions_by_task_run_id(run_id)
        .expect("query")
        .iter()
        .map(|s| SessionFacts {
            task_run_id: s.task_run_id.clone(),
            exit_code: s.exit_code,
            first_idle_at: s.first_idle_at,
        })
        .collect()
}

#[test]
fn recorder_writes_round_trip_into_compute_run_status_for_idle_path() {
    let db = make_db();
    db.create_session(&make_session("a", "run-1")).unwrap();
    db.create_session(&make_session("b", "run-1")).unwrap();
    link_to_run(&db, "a", "run-1");
    link_to_run(&db, "b", "run-1");

    let recorder = SessionFactsRecorder::new(&db);
    let run = make_run("run-1");

    // Initially, no bound session has gone idle. Derived = Running.
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::Running
    );

    // Only `a` goes idle. Mixed-idle → still Running.
    let ts_a = Utc.timestamp_opt(2_000, 0).single().unwrap();
    recorder.record_first_idle("a", ts_a).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::Running
    );

    // Now `b` goes idle. All bound idle → AwaitingSelection.
    let ts_b = Utc.timestamp_opt(3_000, 0).single().unwrap();
    recorder.record_first_idle("b", ts_b).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::AwaitingSelection
    );

    // Repeat record_first_idle on `a` with a later timestamp.
    // Write-once invariant must hold; status stays AwaitingSelection.
    let ts_late = Utc.timestamp_opt(9_999, 0).single().unwrap();
    recorder.record_first_idle("a", ts_late).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::AwaitingSelection
    );
}

#[test]
fn recorder_writes_round_trip_into_compute_run_status_for_failure_path() {
    let db = make_db();
    db.create_session(&make_session("a", "run-1")).unwrap();
    db.create_session(&make_session("b", "run-1")).unwrap();
    link_to_run(&db, "a", "run-1");
    link_to_run(&db, "b", "run-1");

    let recorder = SessionFactsRecorder::new(&db);
    let run = make_run("run-1");

    // Both alive, neither idle → Running.
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::Running
    );

    // `a` exits non-zero. No winner yet → Failed.
    let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
    recorder.record_exit("a", exit_ts, Some(1)).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db, "run-1")),
        TaskRunStatus::Failed
    );

    // Two-way binding: clean exit (code 0) on `a` would not flip Failed.
    // Reset by creating a fresh DB so we can compare cleanly.
    let db2 = make_db();
    db2.create_session(&make_session("a", "run-1")).unwrap();
    db2.create_session(&make_session("b", "run-1")).unwrap();
    link_to_run(&db2, "a", "run-1");
    link_to_run(&db2, "b", "run-1");
    let r2 = SessionFactsRecorder::new(&db2);
    r2.record_exit("a", exit_ts, Some(0)).unwrap();
    assert_eq!(
        compute_run_status(&run, &facts_for_run(&db2, "run-1")),
        TaskRunStatus::Running,
        "exit code 0 must not derive Failed"
    );
}
