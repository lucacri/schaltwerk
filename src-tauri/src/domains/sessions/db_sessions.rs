use crate::domains::sessions::entity::{PrState, Session, SessionState, SessionStatus};
use crate::infrastructure::database::Database;
use crate::infrastructure::database::timestamps::{
    utc_from_epoch_seconds_lossy, utc_from_epoch_seconds_lossy_opt,
};
use anyhow::Result;
use chrono::Utc;
use rusqlite::{Result as SqlResult, ToSql, params};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Instant;

pub trait SessionMethods {
    fn create_session(&self, session: &Session) -> Result<()>;
    fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session>;
    fn get_session_by_id(&self, id: &str) -> Result<Session>;
    fn get_session_task_content(
        &self,
        repo_path: &Path,
        name: &str,
    ) -> Result<(Option<String>, Option<String>, SessionState)>;
    fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>>;
    fn list_all_active_sessions(&self) -> Result<Vec<Session>>;
    fn list_sessions_by_state(&self, repo_path: &Path, state: SessionState)
    -> Result<Vec<Session>>;
    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()>;
    fn set_session_activity(
        &self,
        id: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Result<()>;
    fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()>;
    fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()>;
    fn update_session_parent_branch(&self, id: &str, new_parent_branch: &str) -> Result<()>;
    fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()>;
    fn update_session_state(&self, id: &str, state: SessionState) -> Result<()>;
    fn update_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn append_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn update_session_initial_prompt(&self, id: &str, prompt: &str) -> Result<()>;
    fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()>;
    fn set_session_original_settings(&self, session_id: &str, agent_type: &str) -> Result<()>;
    fn set_session_original_settings_with_model(
        &self,
        session_id: &str,
        agent_type: &str,
        model: Option<&str>,
    ) -> Result<()>;
    fn clear_session_run_state(&self, session_id: &str) -> Result<()>;
    fn set_session_resume_allowed(&self, id: &str, allowed: bool) -> Result<()>;
    fn set_session_amp_thread_id(&self, id: &str, thread_id: &str) -> Result<()>;
    fn rename_draft_session(&self, repo_path: &Path, old_name: &str, new_name: &str) -> Result<()>;
    fn set_session_version_info(
        &self,
        id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()>;
    fn update_session_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()>;
    fn delete_session(&self, id: &str) -> Result<()>;
    fn update_session_pr_info(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()>;
    fn update_session_pr_state_by_pr_number(
        &self,
        repo_path: &Path,
        pr_number: i64,
        pr_state: PrState,
    ) -> Result<usize>;
    fn update_session_issue_info(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()>;
    fn update_session_promotion_reason(&self, id: &str, reason: Option<&str>) -> Result<()>;
    fn update_session_pr_info_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()>;
    fn update_session_promotion_reason_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        reason: Option<&str>,
    ) -> Result<()>;
    fn update_session_ready_to_merge_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        ready: bool,
    ) -> Result<()>;

    /// Record a PTY exit fact on the session row. Sets both `exited_at` and
    /// `exit_code` in one statement. Always overwrites prior values — the
    /// terminal layer is responsible for not re-writing an exit when one
    /// already happened (in practice the recorder only fires from
    /// `handle_agent_crash` once per PTY child).
    fn set_session_exited_at(
        &self,
        id: &str,
        exited_at: chrono::DateTime<chrono::Utc>,
        exit_code: Option<i32>,
    ) -> Result<()>;

    /// Record the **first** time this session entered idle / `WaitingForInput`.
    /// Write-once at the SQL level (`WHERE first_idle_at IS NULL`): a second
    /// call commits zero rows and returns `Ok(())`. This is the load-bearing
    /// invariant for sticky `AwaitingSelection` in
    /// [`crate::domains::tasks::run_status::compute_run_status`] — see Phase 1
    /// plan §1 and the Wave G3 regression test.
    fn set_session_first_idle_at(
        &self,
        id: &str,
        first_idle_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<()>;

    /// Return every session bound to the given `task_run_id`. The Sessions
    /// returned by this query include the v2 fact columns
    /// (`exited_at`, `exit_code`, `first_idle_at`) — unlike the legacy
    /// `list_sessions` / `get_session_by_id` queries which still source from a
    /// SELECT that predates these columns. Callers wiring
    /// `compute_run_status` should use this method.
    fn get_sessions_by_task_run_id(&self, task_run_id: &str) -> Result<Vec<Session>>;

    /// Stamp the task-lineage columns on a session row. Phase 3 dropped
    /// the legacy `task_role` mirror — only `run_role` (the in-DB role
    /// string) and `slot_key` (the preset-slot identifier) are written.
    fn set_session_task_lineage(
        &self,
        session_id: &str,
        task_id: Option<&str>,
        task_run_id: Option<&str>,
        task_stage: Option<&str>,
        run_role: Option<&str>,
        slot_key: Option<&str>,
    ) -> Result<()>;

    /// Lookup a session's task-lineage projection (the small subset of fields
    /// the orchestration layer reads). Returns the lineage even when the
    /// session has no task association — the callers handle the all-NULL
    /// case.
    fn get_session_task_lineage(&self, session_id: &str) -> Result<SessionTaskLineage>;

    /// Find the (id, branch) of the session bound to `task_run_id` with
    /// `run_role`. Used by clarify-run idempotency to detect an existing
    /// agent session before spawning a duplicate.
    fn find_session_for_task_run(
        &self,
        task_run_id: &str,
        run_role: &str,
    ) -> Result<Option<TaskRunSessionRef>>;

    /// List every session bound to a given `task_run_id`, regardless of
    /// `run_role`. Used by orchestration to inspect the full sibling set
    /// of a run.
    fn list_sessions_for_task_run(&self, task_run_id: &str) -> Result<Vec<SessionForRun>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTaskLineage {
    pub task_id: Option<String>,
    pub task_run_id: Option<String>,
    pub task_stage: Option<String>,
    pub run_role: Option<String>,
    pub slot_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskRunSessionRef {
    pub session_id: String,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionForRun {
    pub session_id: String,
    pub session_name: String,
    pub run_role: Option<String>,
}

const SQLITE_MAX_VARIABLE_NUMBER: usize = 999;

#[derive(Debug, Clone)]
struct SessionSummaryRow {
    id: String,
    name: String,
    display_name: Option<String>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    epic_id: Option<String>,
    repository_path: PathBuf,
    repository_name: String,
    branch: String,
    parent_branch: String,
    original_parent_branch: Option<String>,
    worktree_path: PathBuf,
    status: SessionStatus,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
    last_activity: Option<chrono::DateTime<Utc>>,
    ready_to_merge: bool,
    original_agent_type: Option<String>,
    original_agent_model: Option<String>,
    pending_name_generation: bool,
    was_auto_generated: bool,
    session_state: SessionState,
    resume_allowed: bool,
    amp_thread_id: Option<String>,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    pr_state: Option<String>,
    is_consolidation: bool,
    consolidation_sources: Option<String>,
    consolidation_round_id: Option<String>,
    consolidation_role: Option<String>,
    consolidation_report: Option<String>,
    consolidation_report_source: Option<String>,
    consolidation_base_session_id: Option<String>,
    consolidation_recommended_session_id: Option<String>,
    consolidation_confirmation_mode: Option<String>,
    promotion_reason: Option<String>,
    ci_autofix_enabled: bool,
    merged_at: Option<i64>,
    task_id: Option<String>,
    task_stage: Option<String>,
}

impl Database {
    fn hydrate_session_summaries(
        &self,
        conn: &rusqlite::Connection,
        summaries: Vec<SessionSummaryRow>,
    ) -> Result<Vec<Session>> {
        if summaries.is_empty() {
            return Ok(Vec::new());
        }

        let all_ids: Vec<String> = summaries.iter().map(|s| s.id.clone()).collect();

        let initial_prompts = Self::fetch_text_column_with_conn(conn, &all_ids, "initial_prompt")?;
        let spec_contents = Self::fetch_text_column_with_conn(conn, &all_ids, "spec_content")?;

        Ok(summaries
            .into_iter()
            .map(|summary| {
                let initial_prompt = initial_prompts.get(&summary.id).cloned().unwrap_or(None);
                let spec_content = spec_contents.get(&summary.id).cloned().unwrap_or(None);

                Session {
                    id: summary.id,
                    name: summary.name,
                    display_name: summary.display_name,
                    version_group_id: summary.version_group_id,
                    version_number: summary.version_number,
                    epic_id: summary.epic_id,
                    repository_path: summary.repository_path,
                    repository_name: summary.repository_name,
                    branch: summary.branch,
                    parent_branch: summary.parent_branch,
                    original_parent_branch: summary.original_parent_branch,
                    worktree_path: summary.worktree_path,
                    status: summary.status,
                    created_at: summary.created_at,
                    updated_at: summary.updated_at,
                    last_activity: summary.last_activity,
                    initial_prompt,
                    ready_to_merge: summary.ready_to_merge,
                    original_agent_type: summary.original_agent_type,
                    original_agent_model: summary.original_agent_model,
                    pending_name_generation: summary.pending_name_generation,
                    was_auto_generated: summary.was_auto_generated,
                    spec_content,
                    session_state: summary.session_state,
                    resume_allowed: summary.resume_allowed,
                    amp_thread_id: summary.amp_thread_id,
                    issue_number: summary.issue_number,
                    issue_url: summary.issue_url,
                    pr_number: summary.pr_number,
                    pr_url: summary.pr_url,
                    pr_state: summary.pr_state.and_then(|state| state.parse().ok()),
                    is_consolidation: summary.is_consolidation,
                    consolidation_sources: summary
                        .consolidation_sources
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    consolidation_round_id: summary.consolidation_round_id,
                    consolidation_role: summary.consolidation_role,
                    consolidation_report: summary.consolidation_report,
                    consolidation_report_source: summary.consolidation_report_source,
                    consolidation_base_session_id: summary.consolidation_base_session_id,
                    consolidation_recommended_session_id: summary
                        .consolidation_recommended_session_id,
                    consolidation_confirmation_mode: summary.consolidation_confirmation_mode,
                    promotion_reason: summary.promotion_reason,
                    ci_autofix_enabled: summary.ci_autofix_enabled,
                    merged_at: summary.merged_at.map(utc_from_epoch_seconds_lossy),
                    task_id: summary.task_id,
                    task_stage: summary.task_stage.and_then(|stage| stage.parse().ok()),
                    task_run_id: None,
                    run_role: None,
                    slot_key: None,
                    exited_at: None,
                    exit_code: None,
                    first_idle_at: None,
                }
            })
            .collect())
    }

    fn fetch_text_column_with_conn(
        conn: &rusqlite::Connection,
        ids: &[String],
        column: &str,
    ) -> Result<HashMap<String, Option<String>>> {
        let mut values = HashMap::new();
        if ids.is_empty() {
            return Ok(values);
        }

        for chunk in ids.chunks(SQLITE_MAX_VARIABLE_NUMBER) {
            if chunk.is_empty() {
                continue;
            }

            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!("SELECT id, {column} FROM sessions WHERE id IN ({placeholders})");
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|id| id as &dyn ToSql).collect();
            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?;

            for row in rows {
                let (id, value) = row?;
                values.insert(id, value);
            }
        }

        Ok(values)
    }
}

impl SessionMethods for Database {
    fn create_session(&self, session: &Session) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "INSERT INTO sessions (
                id, name, display_name, version_group_id, version_number, epic_id,
                repository_path, repository_name,
                branch, parent_branch, original_parent_branch, worktree_path,
                status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                original_agent_type, pending_name_generation, was_auto_generated,
                spec_content, session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42, ?43, ?44, ?45)",
            params![
                session.id,
                session.name,
                session.display_name,
                session.version_group_id,
                session.version_number,
                session.epic_id,
                session.repository_path.to_string_lossy(),
                session.repository_name,
                session.branch,
                session.parent_branch,
                session.original_parent_branch,
                session.worktree_path.to_string_lossy(),
                session.status.as_str(),
                session.created_at.timestamp(),
                session.updated_at.timestamp(),
                session.last_activity.map(|dt| dt.timestamp()),
                session.initial_prompt,
                session.ready_to_merge,
                session.original_agent_type,
                session.pending_name_generation,
                session.was_auto_generated,
                session.spec_content,
                session.session_state.as_str(),
                session.resume_allowed,
                session.amp_thread_id,
                session.issue_number,
                session.issue_url,
                session.pr_number,
                session.pr_url,
                session.is_consolidation,
                session
                    .consolidation_sources
                    .as_ref()
                    .and_then(|v| serde_json::to_string(v).ok()),
                session.consolidation_round_id,
                session.consolidation_role,
                session.consolidation_report,
                session.consolidation_report_source,
                session.consolidation_base_session_id,
                session.consolidation_recommended_session_id,
                session.consolidation_confirmation_mode,
                session.promotion_reason,
                session.ci_autofix_enabled,
                session.merged_at.map(|dt| dt.timestamp()),
                session.pr_state.as_ref().map(|state| state.as_str()),
                session.original_agent_model,
                session.task_id,
                session.task_stage.as_ref().map(|stage| stage.as_str()),
            ],
        )?;

        Ok(())
    }

    fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, epic_id, repository_path, repository_name,
                    branch, parent_branch, original_parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2"
        )?;

        let session = stmt.query_row(params![repo_path.to_string_lossy(), name], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2).ok(),
                version_group_id: row.get(3).ok(),
                version_number: row.get(4).ok(),
                epic_id: row.get(5).ok(),
                repository_path: PathBuf::from(row.get::<_, String>(6)?),
                repository_name: row.get(7)?,
                branch: row.get(8)?,
                parent_branch: row.get(9)?,
                original_parent_branch: row.get(10).ok(),
                worktree_path: PathBuf::from(row.get::<_, String>(11)?),
                status: row
                    .get::<_, String>(12)?
                    .parse()
                    .unwrap_or(SessionStatus::Active),
                created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
                updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
                last_activity: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(15)?),
                initial_prompt: row.get(16)?,
                ready_to_merge: row.get(17).unwrap_or(false),
                original_agent_type: row.get(18).ok(),
                original_agent_model: row.get(42).ok(),
                pending_name_generation: row.get(19).unwrap_or(false),
                was_auto_generated: row.get(20).unwrap_or(false),
                spec_content: row.get(21).ok(),
                session_state: row
                    .get::<_, String>(22)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(SessionState::Running),
                resume_allowed: row.get(23).unwrap_or(true),
                amp_thread_id: row.get(24).ok(),
                issue_number: row.get(25).ok(),
                issue_url: row.get(26).ok(),
                pr_number: row.get(27).ok(),
                pr_url: row.get(28).ok(),
                is_consolidation: row.get(29).unwrap_or(false),
                consolidation_sources: row
                    .get::<_, Option<String>>(30)
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                consolidation_round_id: row.get(31).ok(),
                consolidation_role: row.get(32).ok(),
                consolidation_report: row.get(33).ok(),
                consolidation_report_source: row.get(34).ok(),
                consolidation_base_session_id: row.get(35).ok(),
                consolidation_recommended_session_id: row.get(36).ok(),
                consolidation_confirmation_mode: row.get(37).ok(),
                promotion_reason: row.get(38).ok(),
                ci_autofix_enabled: row.get(39).unwrap_or(false),
                merged_at: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(40)?),
                pr_state: row
                    .get::<_, Option<String>>(41)
                    .ok()
                    .flatten()
                    .and_then(|state| state.parse().ok()),
                task_id: row.get(43).ok(),
                task_stage: row
                    .get::<_, Option<String>>(44)
                    .ok()
                    .flatten()
                    .and_then(|stage| stage.parse().ok()),
                task_run_id: None,
                run_role: None,
                slot_key: None,
                exited_at: None,
                exit_code: None,
                first_idle_at: None,
            })
        })?;

        Ok(session)
    }

    fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, epic_id, repository_path, repository_name,
                    branch, parent_branch, original_parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
             FROM sessions
             WHERE id = ?1"
        )?;

        let session = stmt.query_row(params![id], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2).ok(),
                version_group_id: row.get(3).ok(),
                version_number: row.get(4).ok(),
                epic_id: row.get(5).ok(),
                repository_path: PathBuf::from(row.get::<_, String>(6)?),
                repository_name: row.get(7)?,
                branch: row.get(8)?,
                parent_branch: row.get(9)?,
                original_parent_branch: row.get(10).ok(),
                worktree_path: PathBuf::from(row.get::<_, String>(11)?),
                status: row
                    .get::<_, String>(12)?
                    .parse()
                    .unwrap_or(SessionStatus::Active),
                created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
                updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
                last_activity: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(15)?),
                initial_prompt: row.get(16)?,
                ready_to_merge: row.get(17).unwrap_or(false),
                original_agent_type: row.get(18).ok(),
                original_agent_model: row.get(42).ok(),
                pending_name_generation: row.get(19).unwrap_or(false),
                was_auto_generated: row.get(20).unwrap_or(false),
                spec_content: row.get(21).ok(),
                session_state: row
                    .get::<_, String>(22)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(SessionState::Running),
                resume_allowed: row.get(23).unwrap_or(true),
                amp_thread_id: row.get(24).ok(),
                issue_number: row.get(25).ok(),
                issue_url: row.get(26).ok(),
                pr_number: row.get(27).ok(),
                pr_url: row.get(28).ok(),
                is_consolidation: row.get(29).unwrap_or(false),
                consolidation_sources: row
                    .get::<_, Option<String>>(30)
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                consolidation_round_id: row.get(31).ok(),
                consolidation_role: row.get(32).ok(),
                consolidation_report: row.get(33).ok(),
                consolidation_report_source: row.get(34).ok(),
                consolidation_base_session_id: row.get(35).ok(),
                consolidation_recommended_session_id: row.get(36).ok(),
                consolidation_confirmation_mode: row.get(37).ok(),
                promotion_reason: row.get(38).ok(),
                ci_autofix_enabled: row.get(39).unwrap_or(false),
                merged_at: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(40)?),
                pr_state: row
                    .get::<_, Option<String>>(41)
                    .ok()
                    .flatten()
                    .and_then(|state| state.parse().ok()),
                task_id: row.get(43).ok(),
                task_stage: row
                    .get::<_, Option<String>>(44)
                    .ok()
                    .flatten()
                    .and_then(|stage| stage.parse().ok()),
                task_run_id: None,
                run_role: None,
                slot_key: None,
                exited_at: None,
                exit_code: None,
                first_idle_at: None,
            })
        })?;

        Ok(session)
    }

    fn get_session_task_content(
        &self,
        repo_path: &Path,
        name: &str,
    ) -> Result<(Option<String>, Option<String>, SessionState)> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT spec_content, initial_prompt, session_state
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2",
        )?;

        let result = stmt.query_row(params![repo_path.to_string_lossy(), name], |row| {
            let spec_content: Option<String> = row.get(0)?;
            let initial_prompt: Option<String> = row.get(1)?;
            let session_state_str: String = row.get(2)?;
            let session_state = SessionState::from_str(&session_state_str)
                .map_err(|_e| rusqlite::Error::InvalidQuery)?;
            Ok((spec_content, initial_prompt, session_state))
        })?;

        Ok(result)
    }

    fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>> {
        log::debug!("list_sessions: start repo={}", repo_path.display());
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, epic_id, repository_path, repository_name,
                        branch, parent_branch, original_parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
                 FROM sessions
                 WHERE repository_path = ?1
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map(params![repo_path.to_string_lossy()], |row| {
                Ok(SessionSummaryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    version_group_id: row.get(3).ok(),
                    version_number: row.get(4).ok(),
                    epic_id: row.get(5).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(6)?),
                    repository_name: row.get(7)?,
                    branch: row.get(8)?,
                    parent_branch: row.get(9)?,
                    original_parent_branch: row.get(10).ok(),
                    worktree_path: PathBuf::from(row.get::<_, String>(11)?),
                    status: row
                        .get::<_, String>(12)?
                        .parse()
                        .unwrap_or(SessionStatus::Active),
                    created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
                    updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
                    last_activity: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(15)?),
                    ready_to_merge: row.get(16).unwrap_or(false),
                    original_agent_type: row.get(17).ok(),
                    original_agent_model: row.get(40).ok(),
                    pending_name_generation: row.get(18).unwrap_or(false),
                    was_auto_generated: row.get(19).unwrap_or(false),
                    session_state: row
                        .get::<_, String>(20)
                        .ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                    resume_allowed: row.get(21).unwrap_or(true),
                    amp_thread_id: row.get(22).ok(),
                    issue_number: row.get(23).ok(),
                    issue_url: row.get(24).ok(),
                    pr_number: row.get(25).ok(),
                    pr_url: row.get(26).ok(),
                    is_consolidation: row.get(27).unwrap_or(false),
                    consolidation_sources: row.get(28).ok(),
                    consolidation_round_id: row.get(29).ok(),
                    consolidation_role: row.get(30).ok(),
                    consolidation_report: row.get(31).ok(),
                    consolidation_report_source: row.get(32).ok(),
                    consolidation_base_session_id: row.get(33).ok(),
                    consolidation_recommended_session_id: row.get(34).ok(),
                    consolidation_confirmation_mode: row.get(35).ok(),
                    promotion_reason: row.get(36).ok(),
                    ci_autofix_enabled: row.get(37).unwrap_or(false),
                    merged_at: row.get(38).ok(),
                    pr_state: row.get(39).ok(),
                    task_id: row.get(41).ok(),
                    task_stage: row.get(42).ok(),
                })
            })?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_sessions: {} rows (summary={}ms, hydrate={}ms)",
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn list_all_active_sessions(&self) -> Result<Vec<Session>> {
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, epic_id, repository_path, repository_name,
                        branch, parent_branch, original_parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
                 FROM sessions
                 WHERE status = 'active'
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(SessionSummaryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    version_group_id: row.get(3).ok(),
                    version_number: row.get(4).ok(),
                    epic_id: row.get(5).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(6)?),
                    repository_name: row.get(7)?,
                    branch: row.get(8)?,
                    parent_branch: row.get(9)?,
                    original_parent_branch: row.get(10).ok(),
                    worktree_path: PathBuf::from(row.get::<_, String>(11)?),
                    status: row
                        .get::<_, String>(12)?
                        .parse()
                        .unwrap_or(SessionStatus::Active),
                    created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
                    updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
                    last_activity: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(15)?),
                    ready_to_merge: row.get(16).unwrap_or(false),
                    original_agent_type: row.get(17).ok(),
                    original_agent_model: row.get(40).ok(),
                    pending_name_generation: row.get(18).unwrap_or(false),
                    was_auto_generated: row.get(19).unwrap_or(false),
                    session_state: row
                        .get::<_, String>(20)
                        .ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                    resume_allowed: row.get(21).unwrap_or(true),
                    amp_thread_id: row.get(22).ok(),
                    issue_number: row.get(23).ok(),
                    issue_url: row.get(24).ok(),
                    pr_number: row.get(25).ok(),
                    pr_url: row.get(26).ok(),
                    is_consolidation: row.get(27).unwrap_or(false),
                    consolidation_sources: row.get(28).ok(),
                    consolidation_round_id: row.get(29).ok(),
                    consolidation_role: row.get(30).ok(),
                    consolidation_report: row.get(31).ok(),
                    consolidation_report_source: row.get(32).ok(),
                    consolidation_base_session_id: row.get(33).ok(),
                    consolidation_recommended_session_id: row.get(34).ok(),
                    consolidation_confirmation_mode: row.get(35).ok(),
                    promotion_reason: row.get(36).ok(),
                    ci_autofix_enabled: row.get(37).unwrap_or(false),
                    merged_at: row.get(38).ok(),
                    pr_state: row.get(39).ok(),
                    task_id: row.get(41).ok(),
                    task_stage: row.get(42).ok(),
                })
            })?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_all_active_sessions: {} rows (summary={}ms, hydrate={}ms)",
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET status = ?1, updated_at = ?2
             WHERE id = ?3",
            params![status.as_str(), Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn set_session_activity(
        &self,
        id: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET last_activity = ?1 WHERE id = ?2",
            params![timestamp.timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET display_name = ?1, pending_name_generation = FALSE, updated_at = ?2 WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_parent_branch(&self, id: &str, new_parent_branch: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET parent_branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_parent_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET pending_name_generation = ?1 WHERE id = ?2",
            params![pending, id],
        )?;
        Ok(())
    }

    fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET ready_to_merge = ?1, updated_at = ?2
             WHERE id = ?3",
            params![ready, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_session_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET epic_id = ?1, updated_at = ?2
             WHERE id = ?3",
            params![epic_id, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn list_sessions_by_state(
        &self,
        repo_path: &Path,
        state: SessionState,
    ) -> Result<Vec<Session>> {
        log::debug!(
            "list_sessions_by_state: start repo={} state={:?}",
            repo_path.display(),
            state
        );
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, epic_id, repository_path, repository_name,
                        branch, parent_branch, original_parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed, amp_thread_id, issue_number, issue_url, pr_number, pr_url, is_consolidation, consolidation_sources, consolidation_round_id, consolidation_role, consolidation_report, consolidation_report_source, consolidation_base_session_id, consolidation_recommended_session_id, consolidation_confirmation_mode, promotion_reason, ci_autofix_enabled, merged_at, pr_state, original_agent_model, task_id, task_stage
                 FROM sessions
                 WHERE repository_path = ?1 AND session_state = ?2
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map(
                params![repo_path.to_string_lossy(), state.as_str()],
                |row| {
                    Ok(SessionSummaryRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        display_name: row.get(2).ok(),
                        version_group_id: row.get(3).ok(),
                        version_number: row.get(4).ok(),
                        epic_id: row.get(5).ok(),
                        repository_path: PathBuf::from(row.get::<_, String>(6)?),
                        repository_name: row.get(7)?,
                        branch: row.get(8)?,
                        parent_branch: row.get(9)?,
                        original_parent_branch: row.get(10).ok(),
                        worktree_path: PathBuf::from(row.get::<_, String>(11)?),
                        status: row
                            .get::<_, String>(12)?
                            .parse()
                            .unwrap_or(SessionStatus::Active),
                        created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
                        updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
                        last_activity: utc_from_epoch_seconds_lossy_opt(
                            row.get::<_, Option<i64>>(15)?,
                        ),
                        ready_to_merge: row.get(16).unwrap_or(false),
                        original_agent_type: row.get(17).ok(),
                        original_agent_model: row.get(40).ok(),
                        pending_name_generation: row.get(18).unwrap_or(false),
                        was_auto_generated: row.get(19).unwrap_or(false),
                        session_state: row
                            .get::<_, String>(20)
                            .ok()
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(SessionState::Running),
                        resume_allowed: row.get(21).unwrap_or(true),
                        amp_thread_id: row.get(22).ok(),
                        issue_number: row.get(23).ok(),
                        issue_url: row.get(24).ok(),
                        pr_number: row.get(25).ok(),
                        pr_url: row.get(26).ok(),
                        is_consolidation: row.get(27).unwrap_or(false),
                        consolidation_sources: row.get(28).ok(),
                        consolidation_round_id: row.get(29).ok(),
                        consolidation_role: row.get(30).ok(),
                        consolidation_report: row.get(31).ok(),
                        consolidation_report_source: row.get(32).ok(),
                        consolidation_base_session_id: row.get(33).ok(),
                        consolidation_recommended_session_id: row.get(34).ok(),
                        consolidation_confirmation_mode: row.get(35).ok(),
                        promotion_reason: row.get(36).ok(),
                        ci_autofix_enabled: row.get(37).unwrap_or(false),
                        merged_at: row.get(38).ok(),
                        pr_state: row.get(39).ok(),
                        task_id: row.get(41).ok(),
                        task_stage: row.get(42).ok(),
                    })
                },
            )?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_sessions_by_state({}): {} rows (summary={}ms, hydrate={}ms)",
            state.as_str(),
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn update_session_state(&self, id: &str, state: SessionState) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET session_state = ?1, updated_at = ?2
             WHERE id = ?3",
            params![state.as_str(), Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET spec_content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn append_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET spec_content = CASE 
                 WHEN spec_content IS NULL OR spec_content = '' THEN ?1
                 ELSE spec_content || char(10) || ?1
             END,
             updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_session_initial_prompt(&self, id: &str, prompt: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET initial_prompt = ?1, updated_at = ?2
             WHERE id = ?3",
            params![prompt, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn set_session_original_settings(&self, session_id: &str, agent_type: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET original_agent_type = ?1 WHERE id = ?2",
            params![agent_type, session_id],
        )?;
        Ok(())
    }

    fn set_session_original_settings_with_model(
        &self,
        session_id: &str,
        agent_type: &str,
        model: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET original_agent_type = ?1, original_agent_model = ?2 WHERE id = ?3",
            params![agent_type, model, session_id],
        )?;
        Ok(())
    }

    fn set_session_version_info(
        &self,
        id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET version_group_id = ?1, version_number = ?2, updated_at = ?3 WHERE id = ?4",
            params![group_id, version_number, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn clear_session_run_state(&self, session_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET last_activity = NULL, original_agent_type = NULL, original_agent_model = NULL WHERE id = ?1",
            params![session_id],
        )?;
        // Also delete git stats since specs don't have worktrees
        conn.execute(
            "DELETE FROM git_stats WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    fn set_session_resume_allowed(&self, id: &str, allowed: bool) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET resume_allowed = ?1, updated_at = ?2 WHERE id = ?3",
            params![allowed, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_session_amp_thread_id(&self, id: &str, thread_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET amp_thread_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![thread_id, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn rename_draft_session(&self, repo_path: &Path, old_name: &str, new_name: &str) -> Result<()> {
        let conn = self.get_conn()?;

        // First check if the session exists and is a spec
        let session = self.get_session_by_name(repo_path, old_name)?;
        if session.session_state != SessionState::Spec {
            return Err(anyhow::anyhow!("Can only rename spec sessions"));
        }

        // Check if the new name is already taken
        if self.get_session_by_name(repo_path, new_name).is_ok() {
            return Err(anyhow::anyhow!(
                "Session with name '{new_name}' already exists"
            ));
        }

        // Calculate new worktree path based on new session name
        let new_worktree_path = repo_path.join(".lucode").join("worktrees").join(new_name);

        // Update the session name and worktree path
        conn.execute(
            "UPDATE sessions 
             SET name = ?1, worktree_path = ?2, updated_at = ?3 
             WHERE repository_path = ?4 AND name = ?5",
            params![
                new_name,
                new_worktree_path.to_string_lossy(),
                Utc::now().timestamp(),
                repo_path.to_string_lossy(),
                old_name
            ],
        )?;

        Ok(())
    }

    fn delete_session(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn update_session_pr_info(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let pr_state = if pr_number.is_some() || pr_url.is_some() {
            Some(PrState::Open.as_str())
        } else {
            None
        };
        conn.execute(
            "UPDATE sessions SET pr_number = ?1, pr_url = ?2, pr_state = ?3, updated_at = ?4 WHERE id = ?5",
            params![pr_number, pr_url, pr_state, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_pr_state_by_pr_number(
        &self,
        repo_path: &Path,
        pr_number: i64,
        pr_state: PrState,
    ) -> Result<usize> {
        let conn = self.get_conn()?;
        let changed = conn.execute(
            "UPDATE sessions
             SET pr_state = ?1, updated_at = ?2
             WHERE repository_path = ?3 AND pr_number = ?4",
            params![
                pr_state.as_str(),
                Utc::now().timestamp(),
                repo_path.to_string_lossy(),
                pr_number
            ],
        )?;
        Ok(changed)
    }

    fn update_session_issue_info(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET issue_number = ?1, issue_url = ?2, updated_at = ?3 WHERE id = ?4",
            params![issue_number, issue_url, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_promotion_reason(&self, id: &str, reason: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET promotion_reason = ?1, updated_at = ?2 WHERE id = ?3",
            params![reason, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_pr_info_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let pr_state = if pr_number.is_some() || pr_url.is_some() {
            Some(PrState::Open.as_str())
        } else {
            None
        };
        conn.execute(
            "UPDATE sessions SET pr_number = ?1, pr_url = ?2, pr_state = ?3, updated_at = ?4 WHERE repository_path = ?5 AND name = ?6",
            params![pr_number, pr_url, pr_state, Utc::now().timestamp(), repo_path.to_string_lossy(), name],
        )?;
        Ok(())
    }

    fn update_session_promotion_reason_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET promotion_reason = ?1, updated_at = ?2 WHERE repository_path = ?3 AND name = ?4",
            params![reason, Utc::now().timestamp(), repo_path.to_string_lossy(), name],
        )?;
        Ok(())
    }

    fn update_session_ready_to_merge_by_name(
        &self,
        repo_path: &Path,
        name: &str,
        ready: bool,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET ready_to_merge = ?1, updated_at = ?2 WHERE repository_path = ?3 AND name = ?4",
            params![ready, Utc::now().timestamp(), repo_path.to_string_lossy(), name],
        )?;
        Ok(())
    }

    fn set_session_exited_at(
        &self,
        id: &str,
        exited_at: chrono::DateTime<chrono::Utc>,
        exit_code: Option<i32>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE sessions
                SET exited_at = ?1, exit_code = ?2, updated_at = ?3
                WHERE id = ?4",
            params![exited_at.timestamp(), exit_code, now, id],
        )?;
        Ok(())
    }

    fn set_session_first_idle_at(
        &self,
        id: &str,
        first_idle_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        // Write-once: the IS NULL guard makes a second call a 0-row UPDATE.
        conn.execute(
            "UPDATE sessions
                SET first_idle_at = ?1, updated_at = ?2
                WHERE id = ?3 AND first_idle_at IS NULL",
            params![first_idle_at.timestamp(), now, id],
        )?;
        Ok(())
    }

    fn set_session_task_lineage(
        &self,
        session_id: &str,
        task_id: Option<&str>,
        task_run_id: Option<&str>,
        task_stage: Option<&str>,
        run_role: Option<&str>,
        slot_key: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let rows = conn.execute(
            "UPDATE sessions SET
                task_id = ?1,
                task_run_id = ?2,
                task_stage = ?3,
                run_role = ?4,
                slot_key = ?5,
                updated_at = ?6
             WHERE id = ?7",
            params![
                task_id,
                task_run_id,
                task_stage,
                run_role,
                slot_key,
                Utc::now().timestamp(),
                session_id,
            ],
        )?;
        if rows == 0 {
            return Err(anyhow::anyhow!(
                "session '{session_id}' not found while stamping task lineage"
            ));
        }
        Ok(())
    }

    fn get_session_task_lineage(&self, session_id: &str) -> Result<SessionTaskLineage> {
        let conn = self.get_conn()?;
        let lineage = conn.query_row(
            "SELECT task_id, task_run_id, task_stage, run_role, slot_key
             FROM sessions WHERE id = ?1",
            params![session_id],
            |row| {
                Ok(SessionTaskLineage {
                    task_id: row.get::<_, Option<String>>(0).ok().flatten(),
                    task_run_id: row.get::<_, Option<String>>(1).ok().flatten(),
                    task_stage: row.get::<_, Option<String>>(2).ok().flatten(),
                    run_role: row.get::<_, Option<String>>(3).ok().flatten(),
                    slot_key: row.get::<_, Option<String>>(4).ok().flatten(),
                })
            },
        )?;
        Ok(lineage)
    }

    fn find_session_for_task_run(
        &self,
        task_run_id: &str,
        run_role: &str,
    ) -> Result<Option<TaskRunSessionRef>> {
        let conn = self.get_conn()?;
        let result: rusqlite::Result<TaskRunSessionRef> = conn.query_row(
            "SELECT id, branch
             FROM sessions
             WHERE task_run_id = ?1 AND run_role = ?2
             LIMIT 1",
            params![task_run_id, run_role],
            |row| {
                Ok(TaskRunSessionRef {
                    session_id: row.get(0)?,
                    branch: row.get(1)?,
                })
            },
        );
        match result {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn list_sessions_for_task_run(&self, task_run_id: &str) -> Result<Vec<SessionForRun>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, run_role
             FROM sessions
             WHERE task_run_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![task_run_id], |row| {
            Ok(SessionForRun {
                session_id: row.get(0)?,
                session_name: row.get(1)?,
                run_role: row.get::<_, Option<String>>(2).ok().flatten(),
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    fn get_sessions_by_task_run_id(&self, task_run_id: &str) -> Result<Vec<Session>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT
                id, name, display_name, version_group_id, version_number, epic_id,
                repository_path, repository_name, branch, parent_branch,
                original_parent_branch, worktree_path,
                status, created_at, updated_at, last_activity, initial_prompt,
                ready_to_merge, original_agent_type, original_agent_model,
                pending_name_generation, was_auto_generated, spec_content,
                session_state, resume_allowed, amp_thread_id,
                issue_number, issue_url, pr_number, pr_url, pr_state,
                is_consolidation, consolidation_sources,
                consolidation_round_id, consolidation_role,
                consolidation_report, consolidation_report_source,
                consolidation_base_session_id,
                consolidation_recommended_session_id,
                consolidation_confirmation_mode, promotion_reason,
                ci_autofix_enabled, merged_at,
                task_id, task_stage,
                task_run_id, run_role, slot_key,
                exited_at, exit_code, first_idle_at
             FROM sessions
             WHERE task_run_id = ?1
             ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map(params![task_run_id], row_to_session_with_facts)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

fn row_to_session_with_facts(row: &rusqlite::Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2).ok(),
        version_group_id: row.get(3).ok(),
        version_number: row.get(4).ok(),
        epic_id: row.get(5).ok(),
        repository_path: PathBuf::from(row.get::<_, String>(6)?),
        repository_name: row.get(7)?,
        branch: row.get(8)?,
        parent_branch: row.get(9)?,
        original_parent_branch: row.get(10).ok(),
        worktree_path: PathBuf::from(row.get::<_, String>(11)?),
        status: row
            .get::<_, String>(12)?
            .parse()
            .unwrap_or(SessionStatus::Active),
        created_at: utc_from_epoch_seconds_lossy(row.get(13)?),
        updated_at: utc_from_epoch_seconds_lossy(row.get(14)?),
        last_activity: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(15)?),
        initial_prompt: row.get(16)?,
        ready_to_merge: row.get(17).unwrap_or(false),
        original_agent_type: row.get(18).ok(),
        original_agent_model: row.get(19).ok(),
        pending_name_generation: row.get(20).unwrap_or(false),
        was_auto_generated: row.get(21).unwrap_or(false),
        spec_content: row.get(22).ok(),
        session_state: row
            .get::<_, String>(23)
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(SessionState::Running),
        resume_allowed: row.get(24).unwrap_or(true),
        amp_thread_id: row.get(25).ok(),
        issue_number: row.get(26).ok(),
        issue_url: row.get(27).ok(),
        pr_number: row.get(28).ok(),
        pr_url: row.get(29).ok(),
        pr_state: row
            .get::<_, Option<String>>(30)
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok()),
        is_consolidation: row.get(31).unwrap_or(false),
        consolidation_sources: row
            .get::<_, Option<String>>(32)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok()),
        consolidation_round_id: row.get(33).ok(),
        consolidation_role: row.get(34).ok(),
        consolidation_report: row.get(35).ok(),
        consolidation_report_source: row.get(36).ok(),
        consolidation_base_session_id: row.get(37).ok(),
        consolidation_recommended_session_id: row.get(38).ok(),
        consolidation_confirmation_mode: row.get(39).ok(),
        promotion_reason: row.get(40).ok(),
        ci_autofix_enabled: row.get(41).unwrap_or(false),
        merged_at: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(42)?),
        task_id: row.get(43).ok(),
        task_stage: row
            .get::<_, Option<String>>(44)
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok()),
        task_run_id: row.get(45).ok(),
        run_role: row.get(46).ok(),
        slot_key: row.get(47).ok(),
        exited_at: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(48)?),
        exit_code: row.get(49).ok(),
        first_idle_at: utc_from_epoch_seconds_lossy_opt(row.get::<_, Option<i64>>(50)?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use rusqlite::params;

    #[test]
    fn test_list_sessions_parses_millis_timestamps() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let repo_path = PathBuf::from("/tmp/repo");

        let created_at = Utc.timestamp_opt(1_700_000_000, 0).single().unwrap();
        let updated_at = Utc.timestamp_opt(1_700_000_100, 0).single().unwrap();

        let session = Session {
            id: "millis-session".to_string(),
            name: "millis-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".to_string(),
            branch: "lucode/millis-session".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repo_path.join(".lucode/worktrees/millis-session"),
            status: SessionStatus::Active,
            created_at,
            updated_at,
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let conn = db.get_conn().expect("failed to borrow connection");
        conn.execute(
            "UPDATE sessions SET created_at = created_at * 1000, updated_at = updated_at * 1000 WHERE id = ?1",
            params![session.id],
        )
        .expect("failed to update timestamps to millis");

        let sessions = db
            .list_sessions(&repo_path)
            .expect("failed to list sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].created_at.timestamp(), created_at.timestamp());
        assert_eq!(sessions[0].updated_at.timestamp(), updated_at.timestamp());
    }

    #[test]
    fn test_session_pr_fields_persist() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");

        let session = Session {
            id: "test-session-1".to_string(),
            name: "test-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            branch: "lucode/test-session".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: PathBuf::from("/tmp/repo/.lucode/worktrees/test-session"),
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
            pr_number: Some(142),
            pr_url: Some("https://github.com/owner/repo/pull/142".to_string()),
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let loaded = db
            .get_session_by_id("test-session-1")
            .expect("failed to load session");

        assert_eq!(loaded.pr_number, Some(142));
        assert_eq!(
            loaded.pr_url,
            Some("https://github.com/owner/repo/pull/142".to_string())
        );
    }

    #[test]
    fn test_update_session_pr_info() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");

        let session = Session {
            id: "test-session-2".to_string(),
            name: "test-session-2".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            branch: "lucode/test-session-2".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: PathBuf::from("/tmp/repo/.lucode/worktrees/test-session-2"),
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        db.update_session_pr_info(
            "test-session-2",
            Some(99),
            Some("https://github.com/owner/repo/pull/99"),
        )
        .expect("failed to update PR info");

        let loaded = db
            .get_session_by_id("test-session-2")
            .expect("failed to load session");

        assert_eq!(loaded.pr_number, Some(99));
        assert_eq!(
            loaded.pr_url,
            Some("https://github.com/owner/repo/pull/99".to_string())
        );
        assert_eq!(loaded.pr_state, Some(PrState::Open));

        db.update_session_pr_state_by_pr_number(
            &PathBuf::from("/tmp/repo"),
            99,
            PrState::Succeeding,
        )
        .expect("failed to update PR state");

        let updated = db
            .get_session_by_id("test-session-2")
            .expect("failed to load updated session");
        assert_eq!(updated.pr_state, Some(PrState::Succeeding));

        db.update_session_pr_info("test-session-2", None, None)
            .expect("failed to clear PR info");

        let cleared = db
            .get_session_by_id("test-session-2")
            .expect("failed to load cleared session");
        assert_eq!(cleared.pr_number, None);
        assert_eq!(cleared.pr_url, None);
        assert_eq!(cleared.pr_state, None);
    }

    #[test]
    fn test_repo_order_index_structure_and_plan() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let conn = db.get_conn().expect("failed to borrow connection");

        let mut columns_stmt = conn
            .prepare("PRAGMA index_info('idx_sessions_repo_order')")
            .expect("failed to prepare PRAGMA index_info");
        let columns = columns_stmt
            .query_map([], |row| row.get::<_, String>(2))
            .expect("failed to query index info")
            .collect::<Result<Vec<_>, _>>()
            .expect("failed to collect index info");
        assert_eq!(
            columns,
            vec!["repository_path", "ready_to_merge", "last_activity"],
            "idx_sessions_repo_order should cover repository_path, ready_to_merge, last_activity"
        );

        let plan_sql = "EXPLAIN QUERY PLAN SELECT id FROM sessions WHERE repository_path = ?1 ORDER BY ready_to_merge ASC, last_activity DESC";
        let mut stmt = conn
            .prepare(plan_sql)
            .expect("failed to prepare EXPLAIN statement");
        let mut rows = stmt
            .query(params!["/tmp/repo"])
            .expect("failed to run EXPLAIN");

        while let Some(row) = rows.next().expect("failed to read EXPLAIN row") {
            let detail: String = row.get(3).expect("failed to read detail column");
            assert!(
                !detail.to_uppercase().contains("TEMP B-TREE"),
                "query plan unexpectedly uses a temp B-tree: {detail}"
            );
        }
    }

    #[test]
    fn test_status_order_index_structure_and_plan() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let conn = db.get_conn().expect("failed to borrow connection");

        let mut columns_stmt = conn
            .prepare("PRAGMA index_info('idx_sessions_status_order')")
            .expect("failed to prepare PRAGMA index_info");
        let columns = columns_stmt
            .query_map([], |row| row.get::<_, String>(2))
            .expect("failed to query index info")
            .collect::<Result<Vec<_>, _>>()
            .expect("failed to collect index info");
        assert_eq!(
            columns,
            vec!["status", "ready_to_merge", "last_activity"],
            "idx_sessions_status_order should cover status, ready_to_merge, last_activity"
        );

        let plan_sql = "EXPLAIN QUERY PLAN SELECT id FROM sessions WHERE status = ?1 ORDER BY ready_to_merge ASC, last_activity DESC";
        let mut stmt = conn
            .prepare(plan_sql)
            .expect("failed to prepare EXPLAIN statement");
        let mut rows = stmt
            .query(params!["active"])
            .expect("failed to run EXPLAIN");

        while let Some(row) = rows.next().expect("failed to read EXPLAIN row") {
            let detail: String = row.get(3).expect("failed to read detail column");
            assert!(
                !detail.to_uppercase().contains("TEMP B-TREE"),
                "query plan unexpectedly uses a temp B-tree: {detail}"
            );
        }
    }

    #[test]
    fn test_spec_content_returned_for_running_sessions() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let repo_path = PathBuf::from("/tmp/repo");

        let session = Session {
            id: "running-with-spec".to_string(),
            name: "running-with-spec".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".to_string(),
            branch: "lucode/running-with-spec".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: PathBuf::from("/tmp/repo/.lucode/worktrees/running-with-spec"),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: Some("Initial prompt text".to_string()),
            ready_to_merge: false,
            original_agent_type: Some("claude".to_string()),
            original_agent_model: None,

            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: Some("# Spec Content\nThis is the spec description".to_string()),
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let sessions = db
            .list_sessions(&repo_path)
            .expect("failed to list sessions");
        assert_eq!(sessions.len(), 1);

        let loaded = &sessions[0];
        assert_eq!(loaded.session_state, SessionState::Running);
        assert_eq!(
            loaded.spec_content,
            Some("# Spec Content\nThis is the spec description".to_string()),
            "spec_content should be returned for running sessions, not just specs"
        );
        assert_eq!(
            loaded.initial_prompt,
            Some("Initial prompt text".to_string()),
            "initial_prompt should also be returned"
        );
    }

    #[test]
    fn test_consolidation_sources_persist() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");

        let sources = vec!["session-a".to_string(), "session-b".to_string()];
        let session = Session {
            id: "consolidation-session".to_string(),
            name: "consolidation-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            branch: "lucode/consolidation-session".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: PathBuf::from("/tmp/repo/.lucode/worktrees/consolidation-session"),
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
            is_consolidation: true,
            consolidation_sources: Some(sources.clone()),
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let loaded = db
            .get_session_by_id("consolidation-session")
            .expect("failed to load session");

        assert!(loaded.is_consolidation);
        assert_eq!(loaded.consolidation_sources, Some(sources.clone()));

        let by_name = db
            .get_session_by_name(&PathBuf::from("/tmp/repo"), "consolidation-session")
            .expect("failed to load by name");
        assert_eq!(by_name.consolidation_sources, Some(sources.clone()));

        let listed = db
            .list_sessions(&PathBuf::from("/tmp/repo"))
            .expect("failed to list sessions");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].consolidation_sources, Some(sources));

        let no_sources_session = Session {
            id: "no-sources-session".to_string(),
            name: "no-sources-session".to_string(),
            consolidation_sources: None,
            is_consolidation: false,
            ..session
        };
        db.create_session(&no_sources_session)
            .expect("failed to create session without sources");

        let loaded_none = db
            .get_session_by_id("no-sources-session")
            .expect("failed to load session");
        assert_eq!(loaded_none.consolidation_sources, None);
    }

    #[test]
    fn test_update_session_promotion_reason() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let repo_path = PathBuf::from("/tmp/repo");
        let now = Utc::now();

        let session = Session {
            id: "promote-test".to_string(),
            name: "promote-test".to_string(),
            display_name: None,
            version_group_id: Some("group-1".to_string()),
            version_number: Some(1),
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".to_string(),
            branch: "lucode/promote-test".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repo_path.join(".lucode/worktrees/promote-test"),
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

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let loaded = db
            .get_session_by_id("promote-test")
            .expect("failed to load");
        assert_eq!(loaded.promotion_reason, None);

        db.update_session_promotion_reason("promote-test", Some("Best test coverage"))
            .expect("failed to update promotion reason");

        let loaded = db
            .get_session_by_id("promote-test")
            .expect("failed to load");
        assert_eq!(
            loaded.promotion_reason,
            Some("Best test coverage".to_string())
        );

        let listed = db.list_sessions(&repo_path).expect("failed to list");
        assert_eq!(
            listed[0].promotion_reason,
            Some("Best test coverage".to_string())
        );
    }

    #[test]
    fn test_consolidation_round_fields_persist() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let repo_path = PathBuf::from("/tmp/repo");
        let now = Utc::now();

        let session = Session {
            id: "round-fields".to_string(),
            name: "round-fields".to_string(),
            display_name: None,
            version_group_id: Some("group-1".to_string()),
            version_number: Some(3),
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".to_string(),
            branch: "lucode/round-fields".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repo_path.join(".lucode/worktrees/round-fields"),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: Some("compare candidates".to_string()),
            ready_to_merge: false,
            original_agent_type: Some("claude".to_string()),
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
            is_consolidation: true,
            consolidation_sources: Some(vec!["feature_v1".to_string(), "feature_v2".to_string()]),
            consolidation_round_id: Some("round-1".to_string()),
            consolidation_role: Some("candidate".to_string()),
            consolidation_report: Some("## Decision\nKeep v1 base and port v2 tests.".to_string()),
            consolidation_report_source: None,
            consolidation_base_session_id: Some("feature_v1".to_string()),
            consolidation_recommended_session_id: Some("feature-merge-1".to_string()),
            consolidation_confirmation_mode: Some("confirm".to_string()),
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,

            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        };

        db.create_session(&session)
            .expect("failed to create session");

        let loaded = db
            .get_session_by_name(&repo_path, "round-fields")
            .expect("failed to load session");

        assert_eq!(loaded.consolidation_round_id.as_deref(), Some("round-1"));
        assert_eq!(loaded.consolidation_role.as_deref(), Some("candidate"));
        assert_eq!(
            loaded.consolidation_report.as_deref(),
            Some("## Decision\nKeep v1 base and port v2 tests.")
        );
        assert_eq!(
            loaded.consolidation_base_session_id.as_deref(),
            Some("feature_v1")
        );
        assert_eq!(
            loaded.consolidation_recommended_session_id.as_deref(),
            Some("feature-merge-1")
        );
        assert_eq!(
            loaded.consolidation_confirmation_mode.as_deref(),
            Some("confirm")
        );
    }

    fn make_session_for_run(id: &str, repo: &Path, task_run_id: Option<&str>) -> Session {
        Session {
            id: id.to_string(),
            name: id.to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo.to_path_buf(),
            repository_name: "repo".to_string(),
            branch: format!("lucode/{id}"),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repo.join(format!(".lucode/worktrees/{id}")),
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

            task_run_id: task_run_id.map(String::from),
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        }
    }

    /// `create_session` predates Wave B, so it uses the legacy INSERT that does not
    /// include `task_run_id`. Tests that need the linkage poke it into the row
    /// after creation via raw UPDATE — this matches what `SessionFactsRecorder`
    /// will do indirectly once Wave G wires the recorder into session lifecycle.
    fn link_session_to_run(db: &Database, session_id: &str, task_run_id: &str) {
        let conn = db.get_conn().expect("conn");
        conn.execute(
            "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
            params![task_run_id, session_id],
        )
        .expect("link");
    }

    #[test]
    fn set_session_exited_at_writes_both_columns() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        let session = make_session_for_run("s1", &repo, None);
        db.create_session(&session).expect("create");

        let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
        db.set_session_exited_at("s1", exit_ts, Some(7))
            .expect("set exit");
        link_session_to_run(&db, "s1", "run-1");

        let bound = db.get_sessions_by_task_run_id("run-1").expect("by run");
        assert_eq!(bound.len(), 1);
        let s = &bound[0];
        assert_eq!(
            s.exited_at.map(|t| t.timestamp()),
            Some(exit_ts.timestamp())
        );
        assert_eq!(s.exit_code, Some(7));
    }

    #[test]
    fn set_session_exited_at_with_none_exit_code_leaves_column_null() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_session_for_run("s1", &repo, None))
            .expect("create");
        link_session_to_run(&db, "s1", "run-1");

        let exit_ts = Utc.timestamp_opt(2_000, 0).single().unwrap();
        db.set_session_exited_at("s1", exit_ts, None).expect("set");

        let bound = db.get_sessions_by_task_run_id("run-1").expect("by run");
        let s = &bound[0];
        assert!(s.exited_at.is_some());
        assert!(s.exit_code.is_none());
    }

    #[test]
    fn set_session_first_idle_at_writes_when_null() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_session_for_run("s1", &repo, None))
            .expect("create");
        link_session_to_run(&db, "s1", "run-1");

        let idle_ts = Utc.timestamp_opt(3_000, 0).single().unwrap();
        db.set_session_first_idle_at("s1", idle_ts).expect("set");

        let bound = db.get_sessions_by_task_run_id("run-1").expect("by run");
        let s = &bound[0];
        assert_eq!(
            s.first_idle_at.map(|t| t.timestamp()),
            Some(idle_ts.timestamp())
        );
    }

    /// **Load-bearing regression test** for sticky AwaitingSelection. If a future
    /// change replaces the `WHERE first_idle_at IS NULL` guard, or bumps it to a
    /// `LATEST` semantic, AwaitingSelection will start flapping. See Phase 1 plan
    /// §1, "first_idle_at is write-once".
    #[test]
    fn set_session_first_idle_at_is_write_once_second_call_is_a_noop() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_session_for_run("s1", &repo, None))
            .expect("create");
        link_session_to_run(&db, "s1", "run-1");

        let first = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let later = Utc.timestamp_opt(4_500, 0).single().unwrap();
        db.set_session_first_idle_at("s1", first).expect("first");
        db.set_session_first_idle_at("s1", later)
            .expect("second call must succeed without error");

        let bound = db.get_sessions_by_task_run_id("run-1").expect("by run");
        let s = &bound[0];
        assert_eq!(
            s.first_idle_at.map(|t| t.timestamp()),
            Some(first.timestamp()),
            "second call must NOT overwrite the original first_idle_at"
        );
    }

    #[test]
    fn first_idle_at_per_session_is_independent() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_session_for_run("a", &repo, None))
            .expect("create a");
        db.create_session(&make_session_for_run("b", &repo, None))
            .expect("create b");
        link_session_to_run(&db, "a", "run-1");
        link_session_to_run(&db, "b", "run-1");

        let ta = Utc.timestamp_opt(3_000, 0).single().unwrap();
        let tb = Utc.timestamp_opt(4_000, 0).single().unwrap();
        db.set_session_first_idle_at("a", ta).expect("a");
        db.set_session_first_idle_at("b", tb).expect("b");

        let bound = db.get_sessions_by_task_run_id("run-1").expect("by run");
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

    #[test]
    fn get_sessions_by_task_run_id_filters_to_bound_only() {
        let db = Database::new_in_memory().expect("db");
        let repo = PathBuf::from("/tmp/repo");
        db.create_session(&make_session_for_run("bound", &repo, None))
            .expect("bound");
        db.create_session(&make_session_for_run("foreign", &repo, None))
            .expect("foreign");
        db.create_session(&make_session_for_run("orphan", &repo, None))
            .expect("orphan");
        link_session_to_run(&db, "bound", "target-run");
        link_session_to_run(&db, "foreign", "other-run");
        // orphan stays unlinked (task_run_id IS NULL)

        let bound = db.get_sessions_by_task_run_id("target-run").expect("query");
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0].id, "bound");
    }

    #[test]
    fn get_sessions_by_task_run_id_returns_empty_for_unknown_run() {
        let db = Database::new_in_memory().expect("db");
        let bound = db.get_sessions_by_task_run_id("does-not-exist").expect("query");
        assert!(bound.is_empty());
    }
}
