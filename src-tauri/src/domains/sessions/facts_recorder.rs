use crate::domains::sessions::db_sessions::SessionMethods;
use crate::infrastructure::database::Database;
use anyhow::Result;
use chrono::{DateTime, Utc};

/// Thin facade over the session-row writes that
/// [`crate::domains::tasks::run_status::compute_run_status`] depends on.
///
/// **Purpose.** v1 routed PTY-exit and idle facts through `OnceCell`
/// dispatchers (`run_lifecycle_notify` + `run_lifecycle_dispatch`) that flipped
/// `task_runs.status` indirectly via async↔sync bridges. The v2 design (§9 of
/// the rewrite plan) replaces that with direct calls: callers grab a
/// `SessionFactsRecorder` against the active project's `Database` and write
/// the raw fact column. There is no global registry, no event-bus
/// coordination, no async↔sync dance.
///
/// **What this layer guarantees.** The recorder enforces the *naming* contract
/// ("record this fact" is the action; the underlying setter is implementation
/// detail) and serves as the single documentation point for the write-once
/// invariant on `first_idle_at`. The actual write-once enforcement happens at
/// the SQL layer (`WHERE first_idle_at IS NULL` in
/// [`SessionMethods::set_session_first_idle_at`]); this struct does not
/// pre-check, because between a hypothetical pre-check and the UPDATE another
/// caller could win the race. Trust the SQL.
///
/// **Lifetime.** The recorder borrows a `&Database` for its scope and is
/// cheap to construct. Callers should build one inline at the call site
/// rather than threading a long-lived `Arc<SessionFactsRecorder>` through the
/// codebase. (Wave I introduces the application-layer observer that bridges
/// terminal events into recorder calls.)
pub struct SessionFactsRecorder<'a> {
    db: &'a Database,
}

impl<'a> SessionFactsRecorder<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Record a PTY exit. Writes `exited_at` and `exit_code` in one statement.
    /// The terminal layer should only call this once per PTY child (the
    /// natural lifecycle of a session); calling twice overwrites the prior
    /// value. The recorder does not guard against re-writes because PTY
    /// children only exit once.
    pub fn record_exit(
        &self,
        session_id: &str,
        exited_at: DateTime<Utc>,
        exit_code: Option<i32>,
    ) -> Result<()> {
        self.db.set_session_exited_at(session_id, exited_at, exit_code)
    }

    /// Record the **first** time `session_id` enters `WaitingForInput`.
    ///
    /// **Write-once.** The DB layer's `WHERE first_idle_at IS NULL` clause
    /// makes a second call commit zero rows. Callers do not need to track
    /// whether they have already recorded the fact; the recorder treats
    /// duplicates as a successful no-op. Returns `Ok(())` either way.
    ///
    /// This is the load-bearing invariant for sticky `AwaitingSelection` —
    /// see Phase 1 plan §1 ("first_idle_at is write-once") and the regression
    /// test that pins it (`first_idle_call_after_initial_does_not_overwrite`).
    pub fn record_first_idle(
        &self,
        session_id: &str,
        first_idle_at: DateTime<Utc>,
    ) -> Result<()> {
        self.db.set_session_first_idle_at(session_id, first_idle_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use chrono::TimeZone;
    use std::path::PathBuf;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn make_session(id: &str) -> Session {
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
            task_run_id: Some("run-1".into()),
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

    #[test]
    fn record_exit_writes_both_columns() {
        let db = db();
        db.create_session(&make_session("s1")).unwrap();
        link_to_run(&db, "s1", "run-1");

        let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
        let recorder = SessionFactsRecorder::new(&db);
        recorder.record_exit("s1", exit_ts, Some(42)).unwrap();

        let bound = db.get_sessions_by_task_run_id("run-1").unwrap();
        assert_eq!(bound.len(), 1);
        let s = &bound[0];
        assert_eq!(
            s.exited_at.map(|t| t.timestamp()),
            Some(exit_ts.timestamp())
        );
        assert_eq!(s.exit_code, Some(42));
    }

    #[test]
    fn record_exit_with_none_exit_code_persists_null() {
        let db = db();
        db.create_session(&make_session("s1")).unwrap();
        link_to_run(&db, "s1", "run-1");

        let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
        let recorder = SessionFactsRecorder::new(&db);
        recorder.record_exit("s1", exit_ts, None).unwrap();

        let s = &db.get_sessions_by_task_run_id("run-1").unwrap()[0];
        assert!(s.exited_at.is_some());
        assert!(s.exit_code.is_none());
    }

    #[test]
    fn record_first_idle_writes_when_null() {
        let db = db();
        db.create_session(&make_session("s1")).unwrap();
        link_to_run(&db, "s1", "run-1");

        let idle_ts = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let recorder = SessionFactsRecorder::new(&db);
        recorder.record_first_idle("s1", idle_ts).unwrap();

        let s = &db.get_sessions_by_task_run_id("run-1").unwrap()[0];
        assert_eq!(
            s.first_idle_at.map(|t| t.timestamp()),
            Some(idle_ts.timestamp())
        );
    }

    /// **Load-bearing regression test.** Pins the write-once invariant directly
    /// at the recorder boundary — if the SQL guard or the recorder logic ever
    /// changes to a "latest idle" semantic, sticky AwaitingSelection breaks
    /// and this test fails. Plan §1 + Wave G3.
    #[test]
    fn first_idle_call_after_initial_does_not_overwrite() {
        let db = db();
        db.create_session(&make_session("s1")).unwrap();
        link_to_run(&db, "s1", "run-1");

        let first = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let later = Utc.timestamp_opt(4_500, 0).single().unwrap();
        let recorder = SessionFactsRecorder::new(&db);
        recorder.record_first_idle("s1", first).unwrap();
        recorder
            .record_first_idle("s1", later)
            .expect("second call must succeed without error");

        let s = &db.get_sessions_by_task_run_id("run-1").unwrap()[0];
        assert_eq!(
            s.first_idle_at.map(|t| t.timestamp()),
            Some(first.timestamp()),
            "second record_first_idle must NOT overwrite the original timestamp"
        );
    }

    #[test]
    fn first_idle_three_or_more_calls_still_yields_first_timestamp() {
        // Defensive: confirm write-once holds for arbitrary call counts, not just
        // a single retry. The SQL guard makes this trivially true but it's worth
        // pinning so an over-eager refactor doesn't introduce a "max(2)" cap.
        let db = db();
        db.create_session(&make_session("s1")).unwrap();
        link_to_run(&db, "s1", "run-1");

        let recorder = SessionFactsRecorder::new(&db);
        let first = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let second = Utc.timestamp_opt(4_000, 0).single().unwrap();
        let third = Utc.timestamp_opt(5_000, 0).single().unwrap();

        recorder.record_first_idle("s1", first).unwrap();
        recorder.record_first_idle("s1", second).unwrap();
        recorder.record_first_idle("s1", third).unwrap();

        let s = &db.get_sessions_by_task_run_id("run-1").unwrap()[0];
        assert_eq!(
            s.first_idle_at.map(|t| t.timestamp()),
            Some(first.timestamp())
        );
    }

    #[test]
    fn per_session_first_idle_is_independent() {
        let db = db();
        db.create_session(&make_session("a")).unwrap();
        db.create_session(&make_session("b")).unwrap();
        link_to_run(&db, "a", "run-1");
        link_to_run(&db, "b", "run-1");

        let recorder = SessionFactsRecorder::new(&db);
        let ta = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let tb = Utc.timestamp_opt(4_000, 0).single().unwrap();
        recorder.record_first_idle("a", ta).unwrap();
        recorder.record_first_idle("b", tb).unwrap();

        let bound = db.get_sessions_by_task_run_id("run-1").unwrap();
        let by_id: std::collections::HashMap<_, _> =
            bound.iter().map(|s| (s.id.as_str(), s)).collect();
        assert_eq!(
            by_id["a"].first_idle_at.map(|t| t.timestamp()),
            Some(ta.timestamp())
        );
        assert_eq!(
            by_id["b"].first_idle_at.map(|t| t.timestamp()),
            Some(tb.timestamp())
        );
    }

    // The pairing test that crosses both `sessions` and `tasks` domains
    // (recorder + compute_run_status) lives in `tests/run_status_integration.rs`
    // because the architecture-isolation test forbids cross-domain imports
    // inside `src/domains/`. The unit tests above pin the recorder side; the
    // top-level test pins the round-trip into the derived getter.
}
