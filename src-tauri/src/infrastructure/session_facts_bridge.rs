//! Application-layer bridge that lets terminal/attention call
//! [`crate::domains::sessions::facts_recorder::SessionFactsRecorder`] without
//! crossing the `domains::terminal → domains::sessions` boundary.
//!
//! `domains/terminal/lifecycle.rs` and `infrastructure/attention_bridge.rs`
//! cannot import `domains::sessions` directly (the `arch_domain_isolation`
//! rule and infrastructure layering rules forbid the path even though
//! infrastructure is allowed to import any domain by itself). This module is
//! the seam.
//!
//! The bridge fetches the active project's `Database` through
//! [`crate::project_manager::PROJECT_MANAGER`] and writes through the
//! recorder. If no project is active (early startup, after project unload)
//! the call silently no-ops with a debug-level log — same shape as v1's
//! `notify_agent_exit` did.
//!
//! This is **not** the v1 `OnceCell<dyn …Recorder>` dispatcher pattern that
//! v2 §9 retired. The recorder is a thin wrapper around `SessionMethods`,
//! constructed inline at the call site against the active project's
//! `Database`. There is no global registry to forget to install, no
//! async↔sync bridging dance, no `Arc<dyn Recorder>` runtime lookup.

use crate::domains::sessions::facts_recorder::SessionFactsRecorder;
use crate::infrastructure::database::Database;
use crate::project_manager::PROJECT_MANAGER;
use chrono::{DateTime, Utc};
use log::{debug, warn};
use std::path::Path;

/// Resolve a session by name on `db` then write its first-idle fact through
/// the recorder. Pulled out as a standalone fn so it can be tested directly
/// against an in-memory `Database` without setting up the global
/// `PROJECT_MANAGER`. Returns the row id that was written, or `None` if the
/// session was not found (the bridge intentionally treats unknown names as a
/// no-op so the terminal layer never panics on stale ids).
fn record_first_idle_on_db(
    db: &Database,
    repo_path: &Path,
    session_name: &str,
    first_idle_at: DateTime<Utc>,
) -> Option<String> {
    let session = match crate::domains::sessions::db_sessions::SessionMethods::get_session_by_name(
        db,
        repo_path,
        session_name,
    ) {
        Ok(s) => s,
        Err(err) => {
            debug!(
                "session_facts_bridge: session '{session_name}' not found, skipping record_first_idle ({err})"
            );
            return None;
        }
    };

    let recorder = SessionFactsRecorder::new(db);
    if let Err(err) = recorder.record_first_idle(&session.id, first_idle_at) {
        warn!(
            "session_facts_bridge: record_first_idle failed for session '{session_name}': {err}"
        );
        return None;
    }
    Some(session.id)
}

/// Look up the session by name on the active project, then record the PTY
/// exit (`exited_at` + `exit_code`). No-op if there is no active project,
/// the session lookup fails, or the write fails — failures are logged at
/// `debug`/`warn` so the terminal layer never panics over them.
///
/// `session_name` is what `extract_session_name(terminal_id)` returns from
/// `domains::terminal::lifecycle`; orchestrator terminals do not have a
/// session row to update and the lookup will skip.
pub async fn record_session_exit_by_name(session_name: &str, exit_code: Option<i32>) {
    let Some(pm) = PROJECT_MANAGER.get() else {
        debug!(
            "session_facts_bridge: no PROJECT_MANAGER yet, skipping record_exit for {session_name}"
        );
        return;
    };
    let Ok(handle) = pm.current_core_handle().await else {
        debug!(
            "session_facts_bridge: no active project, skipping record_exit for {session_name}"
        );
        return;
    };

    let session = match crate::domains::sessions::db_sessions::SessionMethods::get_session_by_name(
        &handle.db,
        &handle.repo_path,
        session_name,
    ) {
        Ok(s) => s,
        Err(err) => {
            debug!(
                "session_facts_bridge: session '{session_name}' not found, skipping record_exit ({err})"
            );
            return;
        }
    };

    let recorder = SessionFactsRecorder::new(&handle.db);
    if let Err(err) = recorder.record_exit(&session.id, Utc::now(), exit_code) {
        warn!(
            "session_facts_bridge: record_exit failed for session '{session_name}': {err}"
        );
    }
}

/// Record a session's first idle event (write-once at the SQL layer; second
/// call is a clean no-op). Called by the attention bridge when a session
/// enters `WaitingForInput`.
///
/// `session_name` is what `extract_session_name(terminal_id)` /
/// `session_id_from_terminal_id` returns from the terminal layer — a session
/// **name**, not a row id. This function looks the row up by name first, then
/// writes through `SessionFactsRecorder::record_first_idle` which expects the
/// UUID row id. Without the lookup the UPDATE was filtering on the wrong
/// column and committing zero rows for every session, leaving `first_idle_at`
/// permanently NULL — including for consolidation candidates whose stuck
/// state prompted the v2 smoke-test fix.
pub async fn record_session_first_idle_by_name(session_name: &str) {
    let Some(pm) = PROJECT_MANAGER.get() else {
        debug!(
            "session_facts_bridge: no PROJECT_MANAGER yet, skipping record_first_idle for {session_name}"
        );
        return;
    };
    let Ok(handle) = pm.current_core_handle().await else {
        debug!(
            "session_facts_bridge: no active project, skipping record_first_idle for {session_name}"
        );
        return;
    };

    record_first_idle_on_db(&handle.db, &handle.repo_path, session_name, Utc::now());
}

#[cfg(test)]
mod tests {
    use super::record_first_idle_on_db;
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::Session;
    use crate::infrastructure::database::Database;
    use chrono::{TimeZone, Utc};
    use std::path::PathBuf;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn make_consolidation_candidate(name: &str, repo: &PathBuf) -> Session {
        Session {
            id: format!("uuid-{name}"),
            name: name.into(),
            display_name: None,
            version_group_id: None,
            version_number: Some(1),
            epic_id: None,
            repository_path: repo.clone(),
            repository_name: "repo".into(),
            branch: format!("lucode/{name}"),
            parent_branch: "main".into(),
            original_parent_branch: Some("main".into()),
            worktree_path: repo.join(format!(".lucode/worktrees/{name}")),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: Some("claude".into()),
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
            is_consolidation: true,
            consolidation_sources: Some(vec!["src_v1".into(), "src_v2".into()]),
            consolidation_round_id: Some("round-7b43".into()),
            consolidation_role: Some("candidate".into()),
            consolidation_report: None,
            consolidation_report_source: None,
            consolidation_base_session_id: None,
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: Some("confirm".into()),
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,
            // The load-bearing axis for this regression: NO task_run_id.
            // Consolidation candidates only carry consolidation_round_id, so
            // they fall outside compute_run_status' AwaitingSelection
            // derivation but their first_idle_at fact must still persist.
            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
            is_spec: false,
            cancelled_at: None,
        }
    }

    /// **Load-bearing regression test** for the v2 smoke-test stuck-round bug.
    /// Pins:
    ///   1. The bridge must look up sessions by NAME (what the terminal layer
    ///      hands us), not by row id, before writing.
    ///   2. The write must succeed for sessions whose only lineage is
    ///      `consolidation_round_id` (no task_run_id).
    ///   3. The first_idle_at column round-trips through the production read
    ///      path (`get_session_by_name`).
    ///
    /// Without the lookup-by-name fix the SQL `WHERE id = ?` filter ran
    /// against a name and matched zero rows — `first_idle_at` stayed NULL for
    /// every consolidation candidate, leaving the user stuck because
    /// compute_run_status, the UI banner, and the MCP idle-detection all
    /// share the same first_idle_at column.
    #[test]
    fn first_idle_round_trips_for_consolidation_candidate_via_name_lookup() {
        let db = db();
        let repo = PathBuf::from("/tmp/repo");
        let session = make_consolidation_candidate("src-merge_v1", &repo);
        db.create_session(&session).expect("insert");

        let idle_ts = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let written_id = record_first_idle_on_db(&db, &repo, "src-merge_v1", idle_ts);
        assert_eq!(
            written_id.as_deref(),
            Some(session.id.as_str()),
            "bridge must resolve name 'src-merge_v1' to row id 'uuid-src-merge_v1'"
        );

        let read_back = db
            .get_session_by_name(&repo, "src-merge_v1")
            .expect("read back");
        assert_eq!(
            read_back.first_idle_at.map(|t| t.timestamp()),
            Some(idle_ts.timestamp()),
            "first_idle_at must round-trip through the production read path \
             for a consolidation candidate (no task_run_id, only consolidation_round_id)"
        );
        assert_eq!(read_back.task_run_id, None, "fixture sanity: candidate has no task_run_id");
        assert_eq!(
            read_back.consolidation_round_id.as_deref(),
            Some("round-7b43"),
            "fixture sanity: candidate has consolidation_round_id"
        );
    }

    /// Repeated calls (each WaitingForInput re-fire) must not overwrite the
    /// first timestamp — the SQL `WHERE first_idle_at IS NULL` guard makes
    /// the second write a clean no-op.
    #[test]
    fn second_call_does_not_overwrite_first_idle_for_candidate() {
        let db = db();
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_consolidation_candidate("src-merge_v1", &repo))
            .expect("insert");

        let first = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let later = Utc.timestamp_opt(9_000, 0).single().unwrap();

        record_first_idle_on_db(&db, &repo, "src-merge_v1", first);
        record_first_idle_on_db(&db, &repo, "src-merge_v1", later);

        let read_back = db
            .get_session_by_name(&repo, "src-merge_v1")
            .expect("read back");
        assert_eq!(
            read_back.first_idle_at.map(|t| t.timestamp()),
            Some(first.timestamp()),
            "second record_first_idle must not overwrite the original timestamp"
        );
    }

    /// Unknown names return `None` and are a graceful no-op — the bridge
    /// must never panic when the terminal layer hands us a stale name.
    #[test]
    fn unknown_session_name_is_a_clean_no_op() {
        let db = db();
        let repo = PathBuf::from("/tmp/repo");
        let now = Utc::now();
        let result = record_first_idle_on_db(&db, &repo, "does-not-exist", now);
        assert!(result.is_none(), "unknown name must return None");
    }
}
