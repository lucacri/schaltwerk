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
use crate::project_manager::PROJECT_MANAGER;
use chrono::Utc;
use log::{debug, warn};

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
    let Ok(core_lock) = pm.current_schaltwerk_core().await else {
        debug!(
            "session_facts_bridge: no active project, skipping record_exit for {session_name}"
        );
        return;
    };

    let core = core_lock.read().await;
    let session = match crate::domains::sessions::db_sessions::SessionMethods::get_session_by_name(
        &core.db,
        &core.repo_path,
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

    let recorder = SessionFactsRecorder::new(&core.db);
    if let Err(err) = recorder.record_exit(&session.id, Utc::now(), exit_code) {
        warn!(
            "session_facts_bridge: record_exit failed for session '{session_name}': {err}"
        );
    }
}

/// Record a session's first idle event (write-once at the SQL layer; second
/// call is a clean no-op). Called by the attention bridge when a session
/// enters `WaitingForInput`.
pub async fn record_session_first_idle_by_id(session_id: &str) {
    let Some(pm) = PROJECT_MANAGER.get() else {
        debug!(
            "session_facts_bridge: no PROJECT_MANAGER yet, skipping record_first_idle for {session_id}"
        );
        return;
    };
    let Ok(core_lock) = pm.current_schaltwerk_core().await else {
        debug!(
            "session_facts_bridge: no active project, skipping record_first_idle for {session_id}"
        );
        return;
    };

    let core = core_lock.read().await;
    let recorder = SessionFactsRecorder::new(&core.db);
    if let Err(err) = recorder.record_first_idle(session_id, Utc::now()) {
        warn!(
            "session_facts_bridge: record_first_idle failed for session '{session_id}': {err}"
        );
    }
}
