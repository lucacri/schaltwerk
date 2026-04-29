use crate::{
    domains::git::service as git,
    domains::sessions::db_sessions::SessionMethods,
    domains::sessions::entity::{Epic, PrState, Session, SessionState, SessionStatus, Spec},
    infrastructure::database::{
        AppConfigMethods, Database, EpicMethods, ProjectConfigMethods, SpecMethods,
    },
};
use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use git2::Repository;
use log::{debug, warn};
use rusqlite::params;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ConsolidationRoundRecord {
    pub id: String,
    pub repository_path: String,
    pub version_group_id: String,
    pub round_type: String,
    pub confirmation_mode: String,
    pub status: String,
    pub vertical: String,
    pub source_session_ids: Vec<String>,
    pub recommended_session_id: Option<String>,
    pub recommended_by_session_id: Option<String>,
    pub confirmed_session_id: Option<String>,
    pub confirmed_by: Option<String>,
}

fn consolidation_round_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ConsolidationRoundRecord> {
    let source_ids: String = row.get(6)?;
    Ok(ConsolidationRoundRecord {
        id: row.get(0)?,
        repository_path: row.get(1)?,
        version_group_id: row.get(2)?,
        round_type: row.get(3)?,
        confirmation_mode: row.get(4)?,
        status: row.get(5)?,
        source_session_ids: serde_json::from_str(&source_ids).unwrap_or_default(),
        recommended_session_id: row.get(7).ok(),
        recommended_by_session_id: row.get(8).ok(),
        confirmed_session_id: row.get(9).ok(),
        confirmed_by: row.get(10).ok(),
        vertical: row.get(11).unwrap_or_else(|_| "other".to_string()),
    })
}

pub const CONSOLIDATION_VERTICALS: [&str; 10] = [
    "frontend",
    "backend",
    "fullstack",
    "infra",
    "testing",
    "planning",
    "design",
    "docs",
    "data",
    "other",
];

#[derive(Debug, Clone)]
pub struct ConsolidationOutcomeCandidateInput {
    pub session_id: String,
    pub session_name: String,
    pub agent_type: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ConsolidationOutcomeInput {
    pub round_id: String,
    pub version_group_id: String,
    pub round_type: String,
    pub vertical: String,
    pub confirmed_session_id: String,
    pub confirmed_session_name: String,
    pub confirmed_by: String,
    pub candidates: Vec<ConsolidationOutcomeCandidateInput>,
}

#[derive(Debug, Clone)]
pub struct ConsolidationStatsFilter {
    pub repository_path: Option<String>,
    pub vertical: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsolidationStatsProject {
    pub repository_path: String,
    pub repository_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsolidationModelWinRate {
    pub model: String,
    pub agent_types: Vec<String>,
    pub wins: u32,
    pub losses: u32,
    pub total: u32,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsolidationStats {
    pub selected_project: Option<String>,
    pub selected_vertical: Option<String>,
    pub projects: Vec<ConsolidationStatsProject>,
    pub verticals: Vec<String>,
    pub last_week: Vec<ConsolidationModelWinRate>,
    pub all_time: Vec<ConsolidationModelWinRate>,
}

pub fn default_consolidation_vertical(round_type: &str) -> &'static str {
    if round_type == "plan" {
        "planning"
    } else {
        "other"
    }
}

pub fn normalize_consolidation_vertical(vertical: &str) -> &str {
    let trimmed = vertical.trim();
    if CONSOLIDATION_VERTICALS.contains(&trimmed) {
        trimmed
    } else {
        "other"
    }
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

    pub fn update_spec_improve_plan_round_id(
        &self,
        id: &str,
        round_id: Option<&str>,
    ) -> Result<()> {
        SpecMethods::update_spec_improve_plan_round_id(&self.db, id, round_id)
            .map_err(|e| anyhow!("Failed to update spec improve plan round: {e}"))
    }

    pub fn get_spec_by_improve_plan_round_id(&self, round_id: &str) -> Result<Spec> {
        self.db
            .get_spec_by_improve_plan_round_id(&self.repo_path, round_id)
            .map_err(|e| anyhow!("Failed to get spec for improve plan round '{round_id}': {e}"))
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

    pub fn update_session_pr_state_by_pr_number(
        &self,
        pr_number: i64,
        pr_state: PrState,
    ) -> Result<usize> {
        self.db
            .update_session_pr_state_by_pr_number(&self.repo_path, pr_number, pr_state)
            .map_err(|e| anyhow!("Failed to update session PR state: {e}"))
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
                        let spec_content = spec.content.clone();
                        crate::domains::sessions::cache::cache_spec_content(
                            &self.repo_path,
                            &spec.name,
                            (Some(spec.content), None),
                        );
                        return Ok((Some(spec_content), None));
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

    pub fn set_session_original_settings_with_model(
        &self,
        session_id: &str,
        agent_type: &str,
        model: Option<&str>,
    ) -> Result<()> {
        self.db
            .set_session_original_settings_with_model(session_id, agent_type, model)
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

    pub fn get_consolidation_default_favorite(
        &self,
    ) -> Result<crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite> {
        self.db
            .get_consolidation_default_favorite()
            .map_err(|e| anyhow!("Failed to get consolidation default favorite: {e}"))
    }

    pub fn set_consolidation_default_favorite(
        &self,
        value: &crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite,
    ) -> Result<()> {
        self.db
            .set_consolidation_default_favorite(value)
            .map_err(|e| anyhow!("Failed to set consolidation default favorite: {e}"))
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
        self.upsert_consolidation_round_with_type(
            round_id,
            version_group_id,
            source_session_ids,
            confirmation_mode,
            "implementation",
            "other",
        )
    }

    pub fn upsert_consolidation_round_with_type(
        &self,
        round_id: &str,
        version_group_id: &str,
        source_session_ids: &[String],
        confirmation_mode: &str,
        round_type: &str,
        vertical: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        let now = Utc::now().timestamp();
        let vertical = normalize_consolidation_vertical(vertical);
        conn.execute(
            "INSERT INTO consolidation_rounds (
                id, repository_path, version_group_id, round_type, confirmation_mode, status, source_session_ids, created_at, updated_at, vertical
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                round_type = excluded.round_type,
                confirmation_mode = excluded.confirmation_mode,
                source_session_ids = excluded.source_session_ids,
                updated_at = excluded.updated_at,
                vertical = excluded.vertical",
            params![
                round_id,
                self.repo_path.to_string_lossy().to_string(),
                version_group_id,
                round_type,
                confirmation_mode,
                serde_json::to_string(source_session_ids)?,
                now,
                vertical,
            ],
        )?;
        Ok(())
    }

    pub fn get_consolidation_round(&self, round_id: &str) -> Result<ConsolidationRoundRecord> {
        let conn = self.db.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, repository_path, version_group_id, round_type, confirmation_mode, status, source_session_ids,
                    recommended_session_id, recommended_by_session_id, confirmed_session_id, confirmed_by, vertical
             FROM consolidation_rounds
             WHERE repository_path = ?1 AND id = ?2",
        )?;
        let round = stmt.query_row(
            params![self.repo_path.to_string_lossy().to_string(), round_id],
            consolidation_round_from_row,
        )?;
        Ok(round)
    }

    pub fn get_active_consolidation_round_by_group_and_type(
        &self,
        version_group_id: &str,
        round_type: &str,
    ) -> Result<Option<ConsolidationRoundRecord>> {
        let conn = self.db.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, repository_path, version_group_id, round_type, confirmation_mode, status, source_session_ids,
                    recommended_session_id, recommended_by_session_id, confirmed_session_id, confirmed_by, vertical
             FROM consolidation_rounds
             WHERE repository_path = ?1
               AND version_group_id = ?2
               AND round_type = ?3
               AND status NOT IN ('promoted', 'cancelled')
             ORDER BY updated_at DESC
             LIMIT 1",
        )?;
        match stmt.query_row(
            params![
                self.repo_path.to_string_lossy().to_string(),
                version_group_id,
                round_type,
            ],
            consolidation_round_from_row,
        ) {
            Ok(round) => Ok(Some(round)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
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

    pub fn update_consolidation_round_status(&self, round_id: &str, status: &str) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE consolidation_rounds
             SET status = ?1,
                 updated_at = ?2
             WHERE repository_path = ?3 AND id = ?4",
            params![
                status,
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                round_id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_consolidation_round(&self, round_id: &str) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "DELETE FROM consolidation_rounds
             WHERE repository_path = ?1 AND id = ?2",
            params![self.repo_path.to_string_lossy().to_string(), round_id],
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

    pub fn confirm_consolidation_round_with_outcome(
        &self,
        input: ConsolidationOutcomeInput,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        let now = Utc::now().timestamp();
        let repository_path = self.repo_path.to_string_lossy().to_string();
        let repository_name = self
            .repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Project")
            .to_string();
        let vertical = normalize_consolidation_vertical(&input.vertical).to_string();

        conn.execute(
            "INSERT OR IGNORE INTO consolidation_outcomes (
                round_id, repository_path, repository_name, version_group_id, round_type, vertical,
                confirmed_session_id, confirmed_session_name, confirmed_by, confirmed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                input.round_id,
                repository_path,
                repository_name,
                input.version_group_id,
                input.round_type,
                vertical,
                input.confirmed_session_id,
                input.confirmed_session_name,
                input.confirmed_by,
                now,
            ],
        )?;

        for candidate in &input.candidates {
            let outcome = if candidate.session_id == input.confirmed_session_id
                || candidate.session_name == input.confirmed_session_name
            {
                "winner"
            } else {
                "loser"
            };
            conn.execute(
                "INSERT OR IGNORE INTO consolidation_outcome_candidates (
                    round_id, session_id, session_name, agent_type, model, outcome
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    input.round_id,
                    candidate.session_id,
                    candidate.session_name,
                    candidate.agent_type,
                    candidate.model,
                    outcome,
                ],
            )?;
        }

        conn.execute(
            "UPDATE consolidation_rounds
             SET confirmed_session_id = ?1,
                 confirmed_by = ?2,
                 status = 'promoted',
                 updated_at = ?3
             WHERE id = ?4",
            params![
                input.confirmed_session_id,
                input.confirmed_by,
                now,
                input.round_id,
            ],
        )?;
        Ok(())
    }

    pub fn update_consolidation_outcome_vertical(
        &self,
        round_id: &str,
        vertical: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        let vertical = normalize_consolidation_vertical(vertical);
        conn.execute(
            "UPDATE consolidation_outcomes SET vertical = ?1 WHERE round_id = ?2",
            params![vertical, round_id],
        )?;
        conn.execute(
            "UPDATE consolidation_rounds SET vertical = ?1, updated_at = ?2 WHERE id = ?3",
            params![vertical, Utc::now().timestamp(), round_id],
        )?;
        Ok(())
    }

    pub fn get_consolidation_stats(
        &self,
        filter: ConsolidationStatsFilter,
    ) -> Result<ConsolidationStats> {
        let conn = self.db.get_conn()?;
        let selected_project = filter.repository_path.clone();
        let selected_vertical = filter.vertical.clone();

        let mut projects_stmt = conn.prepare(
            "SELECT DISTINCT repository_path, repository_name
             FROM consolidation_outcomes
             ORDER BY repository_name ASC, repository_path ASC",
        )?;
        let projects = projects_stmt
            .query_map([], |row| {
                Ok(ConsolidationStatsProject {
                    repository_path: row.get(0)?,
                    repository_name: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut verticals_stmt = conn.prepare(
            "SELECT DISTINCT vertical
             FROM consolidation_outcomes
             ORDER BY vertical ASC",
        )?;
        let mut verticals = verticals_stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for vertical in CONSOLIDATION_VERTICALS {
            if !verticals.iter().any(|value| value == vertical) {
                verticals.push(vertical.to_string());
            }
        }
        verticals.sort();

        let all_time = self.aggregate_consolidation_stats(&filter, None)?;
        let last_week = self.aggregate_consolidation_stats(
            &filter,
            Some(Utc::now().timestamp() - 7 * 24 * 60 * 60),
        )?;

        Ok(ConsolidationStats {
            selected_project,
            selected_vertical,
            projects,
            verticals,
            last_week,
            all_time,
        })
    }

    fn aggregate_consolidation_stats(
        &self,
        filter: &ConsolidationStatsFilter,
        since_ts: Option<i64>,
    ) -> Result<Vec<ConsolidationModelWinRate>> {
        let conn = self.db.get_conn()?;
        let mut sql = String::from(
            "SELECT COALESCE(c.model, c.agent_type, 'unknown') AS model_key,
                    c.agent_type,
                    c.outcome
             FROM consolidation_outcome_candidates c
             JOIN consolidation_outcomes o ON o.round_id = c.round_id
             WHERE 1=1",
        );
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(repository_path) = filter.repository_path.as_deref() {
            sql.push_str(" AND o.repository_path = ?");
            values.push(Box::new(repository_path.to_string()));
        }
        if let Some(vertical) = filter
            .vertical
            .as_deref()
            .map(normalize_consolidation_vertical)
            .filter(|vertical| !vertical.is_empty())
        {
            sql.push_str(" AND o.vertical = ?");
            values.push(Box::new(vertical.to_string()));
        }
        if let Some(since_ts) = since_ts {
            sql.push_str(" AND o.confirmed_at >= ?");
            values.push(Box::new(since_ts));
        }

        let value_refs = values
            .iter()
            .map(|value| value.as_ref() as &dyn rusqlite::ToSql)
            .collect::<Vec<_>>();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(value_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;

        #[derive(Default)]
        struct Accumulator {
            agent_types: BTreeSet<String>,
            wins: u32,
            losses: u32,
        }

        let mut grouped: BTreeMap<String, Accumulator> = BTreeMap::new();
        for row in rows {
            let (model, agent_type, outcome) = row?;
            let accumulator = grouped.entry(model).or_default();
            if let Some(agent_type) = agent_type.filter(|value| !value.trim().is_empty()) {
                accumulator.agent_types.insert(agent_type);
            }
            if outcome == "winner" {
                accumulator.wins += 1;
            } else {
                accumulator.losses += 1;
            }
        }

        let mut stats = grouped
            .into_iter()
            .map(|(model, acc)| {
                let total = acc.wins + acc.losses;
                ConsolidationModelWinRate {
                    model,
                    agent_types: acc.agent_types.into_iter().collect(),
                    wins: acc.wins,
                    losses: acc.losses,
                    total,
                    win_rate: if total == 0 {
                        0.0
                    } else {
                        acc.wins as f64 / total as f64
                    },
                }
            })
            .collect::<Vec<_>>();
        stats.sort_by(|a, b| {
            b.win_rate
                .partial_cmp(&a.win_rate)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.total.cmp(&a.total))
                .then_with(|| a.model.cmp(&b.model))
        });
        Ok(stats)
    }

    pub fn update_session_consolidation_report(
        &self,
        session_name: &str,
        report: &str,
        base_session_id: Option<&str>,
        recommended_session_id: Option<&str>,
        source: &str,
    ) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE sessions
             SET consolidation_report = ?1,
                 consolidation_report_source = ?2,
                 consolidation_base_session_id = COALESCE(?3, consolidation_base_session_id),
                 consolidation_recommended_session_id = COALESCE(?4, consolidation_recommended_session_id),
                 updated_at = ?5,
                 last_activity = ?5
             WHERE repository_path = ?6 AND name = ?7",
            params![
                report,
                source,
                base_session_id,
                recommended_session_id,
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                session_name,
            ],
        )?;
        Ok(())
    }

    pub fn clear_session_consolidation_metadata(&self, session_id: &str) -> Result<()> {
        let conn = self.db.get_conn()?;
        conn.execute(
            "UPDATE sessions
             SET is_consolidation = 0,
                 consolidation_sources = NULL,
                 consolidation_round_id = NULL,
                 consolidation_role = NULL,
                 consolidation_report = NULL,
                 consolidation_report_source = NULL,
                 consolidation_base_session_id = NULL,
                 consolidation_recommended_session_id = NULL,
                 consolidation_confirmation_mode = NULL,
                 updated_at = ?1
             WHERE repository_path = ?2 AND id = ?3",
            params![
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                session_id,
            ],
        )?;
        Ok(())
    }

    pub fn clear_auto_stub_consolidation_report_by_name(
        &self,
        session_name: &str,
    ) -> Result<usize> {
        let conn = self.db.get_conn()?;
        let affected = conn.execute(
            "UPDATE sessions
             SET consolidation_report = NULL,
                 consolidation_report_source = NULL,
                 consolidation_base_session_id = NULL,
                 consolidation_recommended_session_id = NULL,
                 updated_at = ?1
             WHERE repository_path = ?2
               AND name = ?3
               AND consolidation_report_source = ?4",
            params![
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                session_name,
                crate::domains::sessions::consolidation_stub::STUB_SOURCE,
            ],
        )?;
        Ok(affected)
    }

    pub fn clear_auto_stub_consolidation_report_by_id(&self, session_id: &str) -> Result<usize> {
        let conn = self.db.get_conn()?;
        let affected = conn.execute(
            "UPDATE sessions
             SET consolidation_report = NULL,
                 consolidation_report_source = NULL,
                 consolidation_base_session_id = NULL,
                 consolidation_recommended_session_id = NULL,
                 updated_at = ?1
             WHERE repository_path = ?2
               AND id = ?3
               AND consolidation_report_source = ?4",
            params![
                Utc::now().timestamp(),
                self.repo_path.to_string_lossy().to_string(),
                session_id,
                crate::domains::sessions::consolidation_stub::STUB_SOURCE,
            ],
        )?;
        Ok(affected)
    }
}

#[cfg(test)]
impl SessionDbManager {
    pub fn db_ref(&self) -> &Database {
        &self.db
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
    use chrono::Utc;
    use std::path::Path;
    use tempfile::TempDir;

    fn make_test_session(repo_path: &Path) -> Session {
        Session {
            id: "session-1".to_string(),
            name: "session-1".to_string(),
            display_name: Some("Session 1".to_string()),
            version_group_id: Some("group-1".to_string()),
            version_number: Some(1),
            epic_id: None,
            repository_path: repo_path.to_path_buf(),
            repository_name: "repo".to_string(),
            branch: "lucode/session-1".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: None,
            worktree_path: repo_path.join(".lucode/worktrees/session-1"),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: Some(Utc::now()),
            initial_prompt: Some("prompt".to_string()),
            ready_to_merge: false,
            original_agent_type: Some("claude".to_string()),
            original_agent_model: Some("gpt".to_string()),
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
            consolidation_sources: Some(vec!["source-a".to_string(), "source-b".to_string()]),
            consolidation_round_id: Some("round-1".to_string()),
            consolidation_role: Some("candidate".to_string()),
            consolidation_report: Some("report".to_string()),
            consolidation_report_source: Some("agent".to_string()),
            consolidation_base_session_id: Some("base-1".to_string()),
            consolidation_recommended_session_id: Some("winner-1".to_string()),
            consolidation_confirmation_mode: Some("confirm".to_string()),
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,
            task_role: None,
            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        }
    }

    #[test]
    fn clear_session_consolidation_metadata_resets_all_flags() {
        let tmp = TempDir::new().expect("temp dir");
        let repo_path = tmp.path().to_path_buf();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let repo = SessionDbManager::new(db.clone(), repo_path.clone());
        let session = make_test_session(&repo_path);

        db.create_session(&session).expect("create session");

        repo.clear_session_consolidation_metadata(&session.id)
            .expect("clear metadata");

        let reloaded = db
            .get_session_by_name(&repo_path, &session.name)
            .expect("reload session");
        assert!(!reloaded.is_consolidation);
        assert!(reloaded.consolidation_role.is_none());
        assert!(reloaded.consolidation_round_id.is_none());
        assert!(reloaded.consolidation_base_session_id.is_none());
        assert!(reloaded.consolidation_recommended_session_id.is_none());
        assert!(reloaded.consolidation_report.is_none());
        assert!(reloaded.consolidation_report_source.is_none());
        assert!(reloaded.consolidation_sources.is_none());
        assert!(reloaded.consolidation_confirmation_mode.is_none());
        assert_eq!(reloaded.version_group_id.as_deref(), Some("group-1"));
    }
}
