use crate::{
    domains::git::service as git,
    domains::sessions::db_sessions::SessionMethods,
    domains::sessions::entity::{Epic, Session, SessionState, SessionStatus, Spec},
    infrastructure::database::{
        AppConfigMethods, Database, EpicMethods, ProjectConfigMethods, SpecMethods,
    },
};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use git2::Repository;
use log::{debug, warn};
use rusqlite::params;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ConsolidationRoundRecord {
    pub id: String,
    pub repository_path: String,
    pub version_group_id: String,
    pub confirmation_mode: String,
    pub status: String,
    pub source_session_ids: Vec<String>,
    pub recommended_session_id: Option<String>,
    pub recommended_by_session_id: Option<String>,
    pub confirmed_session_id: Option<String>,
    pub confirmed_by: Option<String>,
}

#[derive(Clone)]
pub struct SessionDbManager {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl SessionDbManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        Self { db, repo_path }
    }

    fn normalize_spec_state(&self, session: &mut Session) -> Result<()> {
        if session.status == SessionStatus::Spec && session.session_state != SessionState::Spec {
            warn!(
                "Correcting inconsistent session_state for spec session '{}': {:?} -> Spec",
                session.name, session.session_state
            );
            self.db
                .update_session_state(&session.id, SessionState::Spec)?;
            session.session_state = SessionState::Spec;
        }

        Ok(())
    }

    fn try_open_repo(&self) -> Option<Repository> {
        match Repository::open(&self.repo_path) {
            Ok(repo) => Some(repo),
            Err(err) => {
                debug!(
                    "Skipping parent branch normalization: failed to open repo '{}': {err}",
                    self.repo_path.display()
                );
                None
            }
        }
    }

    fn normalize_parent_branch_with_repo(&self, repo: Option<&Repository>, session: &mut Session) {
        let trimmed = session.parent_branch.trim();
        if trimmed.is_empty() {
            return;
        }

        let Some(repo) = repo else {
            return;
        };

        match git::normalize_branch_to_local(repo, trimmed) {
            Ok(local_branch) => {
                if local_branch == session.parent_branch {
                    return;
                }

                debug!(
                    "Normalized parent branch for session '{}' from '{}' to '{}'",
                    session.name, session.parent_branch, local_branch
                );

                if let Err(err) = self
                    .db
                    .update_session_parent_branch(&session.id, &local_branch)
                {
                    warn!(
                        "Failed to persist normalized parent branch '{}' for session '{}': {}",
                        local_branch, session.name, err
                    );
                }

                session.parent_branch = local_branch;
            }
            Err(err) => {
                if repo.revparse_single(trimmed).is_ok() {
                    debug!(
                        "Parent branch '{}' for session '{}' resolves via revspec; leaving as-is",
                        trimmed, session.name
                    );
                    return;
                }

                warn!(
                    "Unable to normalize parent branch '{}' for session '{}': {}",
                    trimmed, session.name, err
                );
            }
        }
    }

    pub fn create_session(&self, session: &Session) -> Result<()> {
        self.db
            .create_session(session)
            .map_err(|e| anyhow!("Failed to create session in database: {e}"))
    }

    pub fn get_session_by_name(&self, name: &str) -> Result<Session> {
        let mut session = self
            .db
            .get_session_by_name(&self.repo_path, name)
            .map_err(|e| anyhow!("Failed to get session '{name}': {e}"))?;

        self.normalize_spec_state(&mut session)?;
        let repo = self.try_open_repo();
        self.normalize_parent_branch_with_repo(repo.as_ref(), &mut session);
        Ok(session)
    }

    pub fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let mut session = self
            .db
            .get_session_by_id(id)
            .map_err(|e| anyhow!("Failed to get session with id '{id}': {e}"))?;

        self.normalize_spec_state(&mut session)?;
        let repo = self.try_open_repo();
        self.normalize_parent_branch_with_repo(repo.as_ref(), &mut session);
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut sessions = self.db.list_sessions(&self.repo_path)?;
        let repo = self.try_open_repo();
        let repo_ref = repo.as_ref();
        for session in sessions.iter_mut() {
            self.normalize_spec_state(session)?;
            self.normalize_parent_branch_with_repo(repo_ref, session);
        }

        Ok(sessions
            .into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        let mut sessions = self
            .db
            .list_sessions_by_state(&self.repo_path, state.clone())?;
        let repo = self.try_open_repo();
        let repo_ref = repo.as_ref();
        for session in sessions.iter_mut() {
            self.normalize_spec_state(session)?;
            self.normalize_parent_branch_with_repo(repo_ref, session);
        }

        Ok(sessions
            .into_iter()
            .filter(|session| {
                session.status != SessionStatus::Cancelled && session.session_state == state
            })
            .collect())
    }

    pub fn list_specs(&self) -> Result<Vec<Spec>> {
        self.db
            .list_specs(&self.repo_path)
            .map_err(|e| anyhow!("Failed to list specs: {e}"))
    }

    pub fn list_epics(&self) -> Result<Vec<Epic>> {
        self.db
            .list_epics(&self.repo_path)
            .map_err(|e| anyhow!("Failed to list epics: {e}"))
    }

    pub fn create_epic(&self, epic: &Epic) -> Result<()> {
        self.db
            .create_epic(&self.repo_path, epic)
            .map_err(|e| anyhow!("Failed to create epic '{}': {e}", epic.name))
    }

    pub fn get_epic_by_id(&self, id: &str) -> Result<Epic> {
        self.db
            .get_epic_by_id(&self.repo_path, id)
            .map_err(|e| anyhow!("Failed to get epic '{id}': {e}"))
    }

    pub fn get_epic_by_name(&self, name: &str) -> Result<Epic> {
        self.db
            .get_epic_by_name(&self.repo_path, name)
            .map_err(|e| anyhow!("Failed to get epic '{name}': {e}"))
    }

    pub fn update_epic(&self, id: &str, name: &str, color: Option<&str>) -> Result<()> {
        self.db
            .update_epic(&self.repo_path, id, name, color)
            .map_err(|e| anyhow!("Failed to update epic '{id}': {e}"))
    }

    pub fn clear_epic_assignments(&self, epic_id: &str) -> Result<()> {
        self.db
            .clear_epic_assignments(&self.repo_path, epic_id)
            .map_err(|e| anyhow!("Failed to clear epic assignments: {e}"))
    }

    pub fn delete_epic(&self, id: &str) -> Result<()> {
        self.db
            .delete_epic(&self.repo_path, id)
            .map_err(|e| anyhow!("Failed to delete epic '{id}': {e}"))
    }

    pub fn get_spec_by_name(&self, name: &str) -> Result<Spec> {
        self.db
            .get_spec_by_name(&self.repo_path, name)
            .map_err(|e| anyhow!("Failed to get spec '{name}': {e}"))
    }

    pub fn create_spec(&self, spec: &Spec) -> Result<()> {
        self.db
            .create_spec(spec)
            .map_err(|e| anyhow!("Failed to create spec '{}': {e}", spec.name))
    }

    pub fn update_spec_content_by_id(&self, id: &str, content: &str) -> Result<()> {
        SpecMethods::update_spec_content(&self.db, id, content)
            .map_err(|e| anyhow!("Failed to update spec content: {e}"))
    }

    pub fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        SpecMethods::update_spec_display_name(&self.db, id, display_name)
            .map_err(|e| anyhow!("Failed to update spec display name: {e}"))
    }

    pub fn update_spec_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()> {
        SpecMethods::update_spec_epic_id(&self.db, id, epic_id)
            .map_err(|e| anyhow!("Failed to update spec epic: {e}"))
    }

    pub fn delete_spec(&self, id: &str) -> Result<()> {
        self.db
            .delete_spec(id)
            .map_err(|e| anyhow!("Failed to delete spec: {e}"))
    }

    pub fn update_session_status(&self, session_id: &str, status: SessionStatus) -> Result<()> {
        self.db
            .update_session_status(session_id, status)
            .map_err(|e| anyhow!("Failed to update session status: {e}"))
    }

    pub fn update_session_state(&self, session_id: &str, state: SessionState) -> Result<()> {
        self.db
            .update_session_state(session_id, state)
            .map_err(|e| anyhow!("Failed to update session state: {e}"))
    }

    pub fn update_session_ready_to_merge(&self, session_id: &str, ready: bool) -> Result<()> {
        self.db
            .update_session_ready_to_merge(session_id, ready)
            .map_err(|e| anyhow!("Failed to update session ready_to_merge: {e}"))
    }

    pub fn update_session_ready_to_merge_by_name(&self, name: &str, ready: bool) -> Result<()> {
        self.db
            .update_session_ready_to_merge_by_name(&self.repo_path, name, ready)
            .map_err(|e| anyhow!("Failed to update session ready_to_merge: {e}"))
    }

    pub fn update_session_pr_info(
        &self,
        session_id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()> {
        self.db
            .update_session_pr_info(session_id, pr_number, pr_url)
            .map_err(|e| anyhow!("Failed to update session PR info: {e}"))
    }

    pub fn update_session_pr_info_by_name(
        &self,
        name: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()> {
        self.db
            .update_session_pr_info_by_name(&self.repo_path, name, pr_number, pr_url)
            .map_err(|e| anyhow!("Failed to update session PR info: {e}"))
    }

    pub fn update_session_epic_id(&self, session_id: &str, epic_id: Option<&str>) -> Result<()> {
        self.db
            .update_session_epic_id(session_id, epic_id)
            .map_err(|e| anyhow!("Failed to update session epic: {e}"))
    }

    pub fn update_session_initial_prompt(&self, session_id: &str, prompt: &str) -> Result<()> {
        self.db
            .update_session_initial_prompt(session_id, prompt)
            .map_err(|e| anyhow!("Failed to update session initial prompt: {e}"))
    }

    pub fn update_spec_content(&self, session_id: &str, content: &str) -> Result<()> {
        let spec = self
            .db
            .get_spec_by_id(session_id)
            .context("Spec not found while updating content")?;

        self.update_spec_content_by_id(&spec.id, content)?;
        crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, &spec.name);
        Ok(())
    }

    pub fn append_spec_content(&self, session_id: &str, content: &str) -> Result<()> {
        // Specs: replace with append semantics on specs table
        if let Ok(spec) = self.db.get_spec_by_id(session_id) {
            let combined = if spec.content.is_empty() {
                content.to_string()
            } else {
                format!("{}\n{}", spec.content, content)
            };
            self.update_spec_content_by_id(&spec.id, &combined)?;
            crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, &spec.name);
            return Ok(());
        }

        self.db
            .append_spec_content(session_id, content)
            .map_err(|e| anyhow!("Failed to append spec content: {e}"))?;

        if let Ok(session) = self.db.get_session_by_id(session_id) {
            crate::domains::sessions::cache::invalidate_spec_content(
                &self.repo_path,
                &session.name,
            );
        }

        Ok(())
    }

    pub fn get_session_task_content(&self, name: &str) -> Result<(Option<String>, Option<String>)> {
        if let Some(cached) =
            crate::domains::sessions::cache::get_cached_spec_content(&self.repo_path, name)
        {
            log::debug!("Cache hit for spec content: {name}");
            return Ok(cached);
        }

        let (spec_content, initial_prompt, session_state) = match self
            .db
            .get_session_task_content(&self.repo_path, name)
        {
            Ok(result) => result,
            Err(error) => {
                if error
                    .downcast_ref::<rusqlite::Error>()
                    .is_some_and(|sql_error| {
                        matches!(sql_error, rusqlite::Error::QueryReturnedNoRows)
                    })
                {
                    // Try the specs table as a fallback
                    if let Ok(spec) = self.db.get_spec_by_name(&self.repo_path, name) {
                        let result = (Some(spec.content.clone()), None, SessionState::Spec);
                        crate::domains::sessions::cache::cache_spec_content(
                            &self.repo_path,
                            name,
                            (Some(spec.content), None),
                        );
                        return Ok((result.0.clone(), result.1.clone()));
                    }

                    warn!(
                        "Spec content requested for missing session '{name}', returning empty payload"
                    );
                    crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, name);
                    return Ok((None, None));
                }

                return Err(anyhow!("Failed to get session agent content: {error}"));
            }
        };

        let result = (spec_content, initial_prompt);

        if matches!(
            session_state,
            crate::domains::sessions::entity::SessionState::Running
        ) {
            log::debug!("Caching spec content for running session: {name}");
            crate::domains::sessions::cache::cache_spec_content(
                &self.repo_path,
                name,
                result.clone(),
            );
        }

        Ok(result)
    }

    pub fn set_session_original_settings(&self, session_id: &str, agent_type: &str) -> Result<()> {
        self.db
            .set_session_original_settings(session_id, agent_type)
            .map_err(|e| anyhow!("Failed to set session original settings: {e}"))
    }

    pub fn set_session_activity(
        &self,
        session_id: &str,
        activity_time: chrono::DateTime<Utc>,
    ) -> Result<()> {
        self.db
            .set_session_activity(session_id, activity_time)
            .map_err(|e| anyhow!("Failed to set session activity: {e}"))
    }

    pub fn set_session_version_info(
        &self,
        session_id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        self.db
            .set_session_version_info(session_id, group_id, version_number)
            .map_err(|e| anyhow!("Failed to set session version info: {e}"))
    }

    pub fn clear_session_run_state(&self, session_id: &str) -> Result<()> {
        self.db
            .clear_session_run_state(session_id)
            .map_err(|e| anyhow!("Failed to clear session run state: {e}"))
    }

    pub fn set_session_resume_allowed(&self, session_id: &str, allowed: bool) -> Result<()> {
        self.db
            .set_session_resume_allowed(session_id, allowed)
            .map_err(|e| anyhow!("Failed to set resume_allowed: {e}"))
    }

    pub fn set_session_amp_thread_id(&self, session_id: &str, thread_id: &str) -> Result<()> {
        self.db
            .set_session_amp_thread_id(session_id, thread_id)
            .map_err(|e| anyhow!("Failed to set amp_thread_id: {e}"))
    }

    pub fn rename_draft_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        self.db
            .rename_draft_session(&self.repo_path, old_name, new_name)
            .map_err(|e| anyhow!("Failed to rename spec session: {e}"))
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.db
            .delete_session(session_id)
            .map_err(|e| anyhow!("Failed to delete session '{session_id}': {e}"))
    }

    pub fn update_session_promotion_reason(
        &self,
        session_id: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        self.db
            .update_session_promotion_reason(session_id, reason)
            .map_err(|e| anyhow!("Failed to update promotion reason: {e}"))
    }

    pub fn update_session_promotion_reason_by_name(
        &self,
        name: &str,
        reason: Option<&str>,
    ) -> Result<()> {
        self.db
            .update_session_promotion_reason_by_name(&self.repo_path, name, reason)
            .map_err(|e| anyhow!("Failed to update promotion reason: {e}"))
    }

    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        let session = self.get_session_by_id(session_id)?;
        git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch)?;
        Ok(())
    }

    pub fn get_project_setup_script(&self) -> Result<Option<String>> {
        self.db
            .get_project_setup_script(&self.repo_path)
            .map_err(|e| anyhow!("Failed to get project setup script: {e}"))
    }

    pub fn get_agent_type(&self) -> Result<String> {
        self.db
            .get_agent_type()
            .map_err(|e| anyhow!("Failed to get agent type: {e}"))
    }

    pub fn get_orchestrator_agent_type(&self) -> Result<String> {
        self.db
            .get_orchestrator_agent_type()
            .map_err(|e| anyhow!("Failed to get orchestrator agent type: {e}"))
    }

    pub fn get_spec_clarification_agent_type(&self) -> Result<String> {
        self.db
            .get_spec_clarification_agent_type()
            .map_err(|e| anyhow!("Failed to get spec clarification agent type: {e}"))
    }

    pub fn set_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db
            .set_agent_type(agent_type)
            .map_err(|e| anyhow!("Failed to set agent type: {e}"))
    }

    pub fn set_orchestrator_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db
            .set_orchestrator_agent_type(agent_type)
            .map_err(|e| anyhow!("Failed to set orchestrator agent type: {e}"))
    }

    pub fn set_spec_clarification_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db
            .set_spec_clarification_agent_type(agent_type)
            .map_err(|e| anyhow!("Failed to set spec clarification agent type: {e}"))
    }

    pub fn session_exists(&self, name: &str) -> bool {
        if self.get_session_by_name(name).is_ok() {
            return true;
        }

        self.get_spec_by_name(name).is_ok()
    }

    pub fn upsert_consolidation_round(
        &self,
        round_id: &str,
        version_group_id: &str,
        source_session_ids: &[String],
        confirmation_mode: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO consolidation_rounds (
                id, repository_path, version_group_id, confirmation_mode, status, source_session_ids, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, ?6)
            ON CONFLICT(id) DO UPDATE SET
                confirmation_mode = excluded.confirmation_mode,
                source_session_ids = excluded.source_session_ids,
                updated_at = excluded.updated_at",
            params![
                round_id,
                self.repo_path.to_string_lossy().to_string(),
                version_group_id,
                confirmation_mode,
                serde_json::to_string(source_session_ids)?,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn get_consolidation_round(&self, round_id: &str) -> Result<ConsolidationRoundRecord> {
        let conn = self.db.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, repository_path, version_group_id, confirmation_mode, status, source_session_ids,
                    recommended_session_id, recommended_by_session_id, confirmed_session_id, confirmed_by
             FROM consolidation_rounds
             WHERE repository_path = ?1 AND id = ?2",
        )?;
        let round = stmt.query_row(
            params![self.repo_path.to_string_lossy().to_string(), round_id],
            |row| {
                let source_ids: String = row.get(5)?;
                Ok(ConsolidationRoundRecord {
                    id: row.get(0)?,
                    repository_path: row.get(1)?,
                    version_group_id: row.get(2)?,
                    confirmation_mode: row.get(3)?,
                    status: row.get(4)?,
                    source_session_ids: serde_json::from_str(&source_ids).unwrap_or_default(),
                    recommended_session_id: row.get(6).ok(),
                    recommended_by_session_id: row.get(7).ok(),
                    confirmed_session_id: row.get(8).ok(),
                    confirmed_by: row.get(9).ok(),
                })
            },
        )?;
        Ok(round)
    }

    pub fn update_consolidation_round_recommendation(
        &self,
        round_id: &str,
        recommended_session_id: Option<&str>,
        recommended_by_session_id: Option<&str>,
        status: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE consolidation_rounds
             SET recommended_session_id = ?1,
                 recommended_by_session_id = ?2,
                 status = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            params![
                recommended_session_id,
                recommended_by_session_id,
                status,
                Utc::now().timestamp(),
                round_id,
            ],
        )?;
        Ok(())
    }

    pub fn update_consolidation_round_confirmation(
        &self,
        round_id: &str,
        confirmed_session_id: &str,
        confirmed_by: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE consolidation_rounds
             SET confirmed_session_id = ?1,
                 confirmed_by = ?2,
                 status = 'promoted',
                 updated_at = ?3
             WHERE id = ?4",
            params![
                confirmed_session_id,
                confirmed_by,
                Utc::now().timestamp(),
                round_id
            ],
        )?;
        Ok(())
    }

    pub fn update_session_consolidation_report(
        &self,
        session_name: &str,
        report: &str,
        base_session_id: Option<&str>,
        recommended_session_id: Option<&str>,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE sessions
             SET consolidation_report = ?1,
                 consolidation_base_session_id = COALESCE(?2, consolidation_base_session_id),
                 consolidation_recommended_session_id = COALESCE(?3, consolidation_recommended_session_id),
                 updated_at = ?4,
                 last_activity = ?4
             WHERE repository_path = ?5 AND name = ?6",
            params![
                report,
                base_session_id,
                recommended_session_id,
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                session_name,
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
impl SessionDbManager {
    pub fn db_ref(&self) -> &Database {
        &self.db
    }
}
