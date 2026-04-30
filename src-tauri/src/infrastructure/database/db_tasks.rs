use super::connection::Database;
use crate::domains::tasks::entity::{
    ProjectWorkflowDefault, Task, TaskArtifact, TaskArtifactKind, TaskArtifactVersion, TaskRun,
    TaskStage, TaskStageConfig, TaskVariant,
};
use crate::domains::tasks::service::TaskNotFoundError;
use crate::infrastructure::database::timestamps::utc_from_epoch_seconds_lossy;
use anyhow::{Result, anyhow};
use chrono::Utc;
use rusqlite::{OptionalExtension, Row, params};
use std::path::{Path, PathBuf};

pub trait TaskMethods {
    fn create_task(&self, task: &Task) -> Result<()>;
    fn get_task_by_id(&self, id: &str) -> Result<Task>;
    fn get_task_by_name(&self, repo_path: &Path, name: &str) -> Result<Task>;
    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<Task>>;
    fn delete_task(&self, id: &str) -> Result<()>;

    fn set_task_stage(&self, id: &str, stage: TaskStage) -> Result<()>;
    fn set_task_variant(&self, id: &str, variant: TaskVariant) -> Result<()>;
    fn set_task_host(
        &self,
        id: &str,
        host_session_id: Option<&str>,
        task_branch: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<()>;
    fn set_task_display_name(&self, id: &str, display_name: Option<&str>) -> Result<()>;
    fn set_task_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()>;
    fn set_task_issue(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()>;
    fn set_task_pr(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
        pr_state: Option<&str>,
    ) -> Result<()>;
    fn set_task_failure_flag(&self, id: &str, failure_flag: bool) -> Result<()>;
    fn set_task_attention_required(&self, id: &str, attention_required: bool) -> Result<()>;
    fn set_task_source(
        &self,
        id: &str,
        source_kind: Option<&str>,
        source_url: Option<&str>,
    ) -> Result<()>;
    fn set_task_request_body(&self, id: &str, request_body: &str) -> Result<()>;
    fn set_task_current_spec(&self, id: &str, spec: Option<&str>) -> Result<()>;
    fn set_task_current_plan(&self, id: &str, plan: Option<&str>) -> Result<()>;
    fn set_task_current_summary(&self, id: &str, summary: Option<&str>) -> Result<()>;

    fn upsert_task_stage_config(&self, config: &TaskStageConfig) -> Result<()>;
    fn list_task_stage_configs(&self, task_id: &str) -> Result<Vec<TaskStageConfig>>;
    fn delete_task_stage_configs(&self, task_id: &str) -> Result<()>;
    fn list_project_workflow_defaults(
        &self,
        repository_path: &str,
    ) -> Result<Vec<ProjectWorkflowDefault>>;
    fn upsert_project_workflow_default(&self, pwd: &ProjectWorkflowDefault) -> Result<()>;
    fn delete_project_workflow_default(
        &self,
        repository_path: &str,
        stage: TaskStage,
    ) -> Result<()>;
    fn get_task_stage_config(
        &self,
        task_id: &str,
        stage: TaskStage,
    ) -> Result<Option<TaskStageConfig>>;

    fn find_task_for_pr_number(
        &self,
        repository_path: &str,
        pr_number: i64,
    ) -> Result<Option<Task>>;
}

pub trait TaskRunMethods {
    fn create_task_run(&self, run: &TaskRun) -> Result<()>;
    fn get_task_run(&self, id: &str) -> Result<TaskRun>;
    fn list_task_runs(&self, task_id: &str) -> Result<Vec<TaskRun>>;
    /// Record a user-initiated cancel. Sets `cancelled_at = now()`. Idempotent at the
    /// SQL level (UPDATE on already-cancelled row is a no-op-ish overwrite); callers
    /// that need to preserve the original cancel timestamp should check first.
    fn set_task_run_cancelled_at(&self, id: &str) -> Result<()>;
    /// Record a user-initiated confirm. Sets `confirmed_at = now()`. Selection state
    /// (`selected_session_id` / `selected_artifact_id`) must be set separately via
    /// [`Self::set_task_run_selection`] before or after this call — `compute_run_status`
    /// reads `confirmed_at` to derive `Completed` regardless of selection state.
    fn set_task_run_confirmed_at(&self, id: &str) -> Result<()>;
    /// Record a failure timestamp. **Migration-only.** v2-native code should never
    /// call this; the derived getter computes Failed from session `exit_code`. The
    /// only writer is the v1→v2 user-DB migration (Wave H), which populates this
    /// column for legacy rows where `status='failed'`.
    fn set_task_run_failed_at(&self, id: &str) -> Result<()>;
    fn set_task_run_failure_reason(&self, id: &str, reason: Option<&str>) -> Result<()>;
    fn set_task_run_completed_at(&self, id: &str) -> Result<()>;
    fn set_task_run_selection(
        &self,
        id: &str,
        selected_session_id: Option<&str>,
        selected_artifact_id: Option<&str>,
        selection_mode: Option<&str>,
    ) -> Result<()>;
    fn delete_task_run(&self, id: &str) -> Result<()>;

    /// Locate the most recently started **active** run for `task_id` at `stage`.
    /// In v2 "active" means no terminal timestamp set: cancelled_at IS NULL AND
    /// confirmed_at IS NULL AND failed_at IS NULL. v1's equivalent matched on
    /// `status = 'running'`; this is the v2 equivalent over the raw fact
    /// columns. If there are multiple in-flight runs (shouldn't happen in
    /// practice) the newest started_at wins.
    fn find_active_task_run_for_task(
        &self,
        task_id: &str,
        stage: TaskStage,
    ) -> Result<Option<TaskRun>>;
}

pub trait TaskArtifactMethods {
    fn create_task_artifact(&self, artifact: &TaskArtifact) -> Result<()>;
    fn list_task_artifacts(&self, task_id: &str) -> Result<Vec<TaskArtifact>>;
    fn list_task_artifacts_of_kind(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Vec<TaskArtifact>>;
    fn list_task_artifact_versions(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Vec<TaskArtifactVersion>>;
    fn get_current_task_artifact(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Option<TaskArtifact>>;
    fn mark_task_artifact_current(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
        artifact_id: &str,
    ) -> Result<()>;
    fn delete_task_artifacts_for_task(&self, task_id: &str) -> Result<()>;
}

impl TaskMethods for Database {
    fn create_task(&self, task: &Task) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO tasks (
                id, name, display_name,
                repository_path, repository_name,
                variant, stage, request_body,
                current_spec, current_plan, current_summary,
                source_kind, source_url,
                task_host_session_id, task_branch, base_branch,
                issue_number, issue_url, pr_number, pr_url, pr_state,
                failure_flag, epic_id, attention_required,
                created_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                ?21, ?22, ?23, ?24, ?25, ?26
            )",
            params![
                task.id,
                task.name,
                task.display_name,
                task.repository_path.to_string_lossy(),
                task.repository_name,
                task.variant.as_str(),
                task.stage.as_str(),
                task.request_body,
                task.current_spec,
                task.current_plan,
                task.current_summary,
                task.source_kind,
                task.source_url,
                task.task_host_session_id,
                task.task_branch,
                task.base_branch,
                task.issue_number,
                task.issue_url,
                task.pr_number,
                task.pr_url,
                task.pr_state,
                task.failure_flag,
                task.epic_id,
                task.attention_required,
                task.created_at.timestamp(),
                task.updated_at.timestamp(),
            ],
        )?;
        Ok(())
    }

    fn get_task_by_id(&self, id: &str) -> Result<Task> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_SELECT_WHERE_ID)?;
        match stmt.query_row(params![id], row_to_task) {
            Ok(task) => Ok(task),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(TaskNotFoundError {
                task_id: id.to_string(),
            }
            .into()),
            Err(err) => Err(anyhow!("failed to load task ({id}): {err}")),
        }
    }

    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<Task>> {
        let conn = self.get_conn()?;
        let repo = repo_path.to_string_lossy().into_owned();
        let mut stmt = conn.prepare(TASK_SELECT_WHERE_REPO_ORDER)?;
        let rows = stmt.query_map(params![repo], row_to_task)?;
        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }
        Ok(tasks)
    }

    fn delete_task(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn get_task_by_name(&self, repo_path: &Path, name: &str) -> Result<Task> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_SELECT_WHERE_REPO_NAME)?;
        stmt.query_row(
            params![repo_path.to_string_lossy(), name],
            row_to_task,
        )
        .map_err(|e| anyhow!("task not found ({name}): {e}"))
    }

    fn set_task_stage(&self, id: &str, stage: TaskStage) -> Result<()> {
        update_task_field(self, "stage = ?1", params![stage.as_str(), Utc::now().timestamp(), id])
    }

    fn set_task_variant(&self, id: &str, variant: TaskVariant) -> Result<()> {
        update_task_field(self, "variant = ?1", params![variant.as_str(), Utc::now().timestamp(), id])
    }

    fn set_task_host(
        &self,
        id: &str,
        host_session_id: Option<&str>,
        task_branch: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE tasks SET
                task_host_session_id = ?1,
                task_branch = ?2,
                base_branch = ?3,
                updated_at = ?4
             WHERE id = ?5",
            params![
                host_session_id,
                task_branch,
                base_branch,
                Utc::now().timestamp(),
                id,
            ],
        )?;
        Ok(())
    }

    fn set_task_display_name(&self, id: &str, display_name: Option<&str>) -> Result<()> {
        update_task_field(self, "display_name = ?1", params![display_name, Utc::now().timestamp(), id])
    }

    fn set_task_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()> {
        update_task_field(self, "epic_id = ?1", params![epic_id, Utc::now().timestamp(), id])
    }

    fn set_task_issue(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE tasks SET issue_number = ?1, issue_url = ?2, updated_at = ?3 WHERE id = ?4",
            params![issue_number, issue_url, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_task_pr(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
        pr_state: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE tasks SET pr_number = ?1, pr_url = ?2, pr_state = ?3, updated_at = ?4 WHERE id = ?5",
            params![pr_number, pr_url, pr_state, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_task_failure_flag(&self, id: &str, failure_flag: bool) -> Result<()> {
        update_task_field(self, "failure_flag = ?1", params![failure_flag, Utc::now().timestamp(), id])
    }

    fn set_task_attention_required(&self, id: &str, attention_required: bool) -> Result<()> {
        update_task_field(
            self,
            "attention_required = ?1",
            params![attention_required, Utc::now().timestamp(), id],
        )
    }

    fn set_task_source(
        &self,
        id: &str,
        source_kind: Option<&str>,
        source_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE tasks SET source_kind = ?1, source_url = ?2, updated_at = ?3 WHERE id = ?4",
            params![source_kind, source_url, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_task_request_body(&self, id: &str, request_body: &str) -> Result<()> {
        update_task_field(self, "request_body = ?1", params![request_body, Utc::now().timestamp(), id])
    }

    fn set_task_current_spec(&self, id: &str, spec: Option<&str>) -> Result<()> {
        update_task_field(self, "current_spec = ?1", params![spec, Utc::now().timestamp(), id])
    }

    fn set_task_current_plan(&self, id: &str, plan: Option<&str>) -> Result<()> {
        update_task_field(self, "current_plan = ?1", params![plan, Utc::now().timestamp(), id])
    }

    fn set_task_current_summary(&self, id: &str, summary: Option<&str>) -> Result<()> {
        update_task_field(self, "current_summary = ?1", params![summary, Utc::now().timestamp(), id])
    }

    fn upsert_task_stage_config(&self, config: &TaskStageConfig) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO task_stage_configs (task_id, stage, preset_id, auto_chain)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(task_id, stage) DO UPDATE SET
                preset_id = excluded.preset_id,
                auto_chain = excluded.auto_chain",
            params![
                config.task_id,
                config.stage.as_str(),
                config.preset_id,
                config.auto_chain,
            ],
        )?;
        Ok(())
    }

    fn list_task_stage_configs(&self, task_id: &str) -> Result<Vec<TaskStageConfig>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT task_id, stage, preset_id, auto_chain
             FROM task_stage_configs
             WHERE task_id = ?1
             ORDER BY stage",
        )?;
        let rows = stmt.query_map(params![task_id], row_to_task_stage_config)?;
        let mut configs = Vec::new();
        for row in rows {
            configs.push(row?);
        }
        Ok(configs)
    }

    fn delete_task_stage_configs(&self, task_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM task_stage_configs WHERE task_id = ?1",
            params![task_id],
        )?;
        Ok(())
    }

    fn list_project_workflow_defaults(
        &self,
        repository_path: &str,
    ) -> Result<Vec<ProjectWorkflowDefault>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT repository_path, stage, preset_id, auto_chain
             FROM project_workflow_defaults
             WHERE repository_path = ?1
             ORDER BY stage",
        )?;
        let rows = stmt.query_map(params![repository_path], row_to_project_workflow_default)?;
        let mut defaults = Vec::new();
        for row in rows {
            defaults.push(row?);
        }
        Ok(defaults)
    }

    fn upsert_project_workflow_default(&self, pwd: &ProjectWorkflowDefault) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO project_workflow_defaults
                (repository_path, stage, preset_id, auto_chain, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4,
                COALESCE((SELECT created_at FROM project_workflow_defaults WHERE repository_path = ?1 AND stage = ?2), ?5),
                ?5)
             ON CONFLICT(repository_path, stage) DO UPDATE SET
                preset_id = excluded.preset_id,
                auto_chain = excluded.auto_chain,
                updated_at = excluded.updated_at",
            params![
                pwd.repository_path,
                pwd.stage.as_str(),
                pwd.preset_id,
                pwd.auto_chain,
                now,
            ],
        )?;
        Ok(())
    }

    fn delete_project_workflow_default(
        &self,
        repository_path: &str,
        stage: TaskStage,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM project_workflow_defaults WHERE repository_path = ?1 AND stage = ?2",
            params![repository_path, stage.as_str()],
        )?;
        Ok(())
    }

    fn get_task_stage_config(
        &self,
        task_id: &str,
        stage: TaskStage,
    ) -> Result<Option<TaskStageConfig>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT task_id, stage, preset_id, auto_chain
             FROM task_stage_configs
             WHERE task_id = ?1 AND stage = ?2
             LIMIT 1",
        )?;
        let result = stmt.query_row(params![task_id, stage.as_str()], row_to_task_stage_config);
        match result {
            Ok(config) => Ok(Some(config)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn find_task_for_pr_number(
        &self,
        repository_path: &str,
        pr_number: i64,
    ) -> Result<Option<Task>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_SELECT_FOR_PR_NUMBER)?;
        let mut rows = stmt
            .query_map(params![repository_path, pr_number], row_to_task)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if rows.len() > 1 {
            log::warn!(
                "find_task_for_pr_number({repository_path}, {pr_number}) matched {} tasks; picking most recently updated",
                rows.len()
            );
            rows.sort_by_key(|task| std::cmp::Reverse(task.updated_at));
        }
        Ok(rows.into_iter().next())
    }
}

impl TaskRunMethods for Database {
    fn create_task_run(&self, run: &TaskRun) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO task_runs (
                id, task_id, stage, preset_id,
                base_branch, target_branch,
                selected_session_id, selected_artifact_id, selection_mode,
                started_at, completed_at,
                cancelled_at, confirmed_at, failed_at,
                failure_reason,
                created_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
             )",
            params![
                run.id,
                run.task_id,
                run.stage.as_str(),
                run.preset_id,
                run.base_branch,
                run.target_branch,
                run.selected_session_id,
                run.selected_artifact_id,
                run.selection_mode,
                run.started_at.map(|t| t.timestamp()),
                run.completed_at.map(|t| t.timestamp()),
                run.cancelled_at.map(|t| t.timestamp()),
                run.confirmed_at.map(|t| t.timestamp()),
                run.failed_at.map(|t| t.timestamp()),
                run.failure_reason,
                run.created_at.timestamp(),
                run.updated_at.timestamp(),
            ],
        )?;
        Ok(())
    }

    fn get_task_run(&self, id: &str) -> Result<TaskRun> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_RUN_SELECT_WHERE_ID)?;
        stmt.query_row(params![id], row_to_task_run)
            .map_err(|e| anyhow!("task run not found ({id}): {e}"))
    }

    fn list_task_runs(&self, task_id: &str) -> Result<Vec<TaskRun>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_RUN_SELECT_WHERE_TASK)?;
        let rows = stmt.query_map(params![task_id], row_to_task_run)?;
        let mut runs = Vec::new();
        for row in rows {
            runs.push(row?);
        }
        Ok(runs)
    }

    fn set_task_run_cancelled_at(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE task_runs SET cancelled_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, id],
        )?;
        Ok(())
    }

    fn set_task_run_confirmed_at(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE task_runs SET confirmed_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, id],
        )?;
        Ok(())
    }

    fn set_task_run_failed_at(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE task_runs SET failed_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, id],
        )?;
        Ok(())
    }

    fn set_task_run_failure_reason(&self, id: &str, reason: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE task_runs SET failure_reason = ?1, updated_at = ?2 WHERE id = ?3",
            params![reason, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_task_run_completed_at(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE task_runs SET completed_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, id],
        )?;
        Ok(())
    }

    fn set_task_run_selection(
        &self,
        id: &str,
        selected_session_id: Option<&str>,
        selected_artifact_id: Option<&str>,
        selection_mode: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE task_runs SET
                selected_session_id = ?1,
                selected_artifact_id = ?2,
                selection_mode = ?3,
                updated_at = ?4
             WHERE id = ?5",
            params![
                selected_session_id,
                selected_artifact_id,
                selection_mode,
                Utc::now().timestamp(),
                id,
            ],
        )?;
        Ok(())
    }

    fn delete_task_run(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM task_runs WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn find_active_task_run_for_task(
        &self,
        task_id: &str,
        stage: TaskStage,
    ) -> Result<Option<TaskRun>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_RUN_SELECT_ACTIVE_FOR_TASK_STAGE)?;
        let row = stmt
            .query_row(params![task_id, stage.as_str()], row_to_task_run)
            .optional()?;
        Ok(row)
    }
}

impl TaskArtifactMethods for Database {
    fn create_task_artifact(&self, artifact: &TaskArtifact) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO task_artifacts (
                id, task_id, artifact_kind, title, content, url, metadata_json,
                is_current, produced_by_run_id, produced_by_session_id,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                artifact.id,
                artifact.task_id,
                artifact.artifact_kind.as_str(),
                artifact.title,
                artifact.content,
                artifact.url,
                artifact.metadata_json,
                artifact.is_current,
                artifact.produced_by_run_id,
                artifact.produced_by_session_id,
                artifact.created_at.timestamp(),
                artifact.updated_at.timestamp(),
            ],
        )?;
        Ok(())
    }

    fn list_task_artifacts(&self, task_id: &str) -> Result<Vec<TaskArtifact>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_ARTIFACT_SELECT_WHERE_TASK)?;
        let rows = stmt.query_map(params![task_id], row_to_task_artifact)?;
        let mut artifacts = Vec::new();
        for row in rows {
            artifacts.push(row?);
        }
        Ok(artifacts)
    }

    fn list_task_artifacts_of_kind(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Vec<TaskArtifact>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_ARTIFACT_SELECT_WHERE_TASK_KIND)?;
        let rows = stmt.query_map(params![task_id, kind.as_str()], row_to_task_artifact)?;
        let mut artifacts = Vec::new();
        for row in rows {
            artifacts.push(row?);
        }
        Ok(artifacts)
    }

    fn list_task_artifact_versions(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Vec<TaskArtifactVersion>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, artifact_kind, content, produced_by_run_id, produced_by_session_id, superseded_at
             FROM task_artifact_versions
             WHERE task_id = ?1 AND artifact_kind = ?2
             ORDER BY superseded_at DESC, id DESC",
        )?;
        let rows = stmt.query_map(
            params![task_id, kind.as_str()],
            row_to_task_artifact_version,
        )?;
        let mut versions = Vec::new();
        for row in rows {
            versions.push(row?);
        }
        Ok(versions)
    }

    fn get_current_task_artifact(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Option<TaskArtifact>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(TASK_ARTIFACT_SELECT_WHERE_CURRENT)?;
        let result = stmt.query_row(params![task_id, kind.as_str()], row_to_task_artifact);
        match result {
            Ok(artifact) => Ok(Some(artifact)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn mark_task_artifact_current(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
        artifact_id: &str,
    ) -> Result<()> {
        let mut conn = self.get_conn()?;
        let tx = conn.transaction()?;
        let prior_current = tx
            .query_row(
                TASK_ARTIFACT_SELECT_WHERE_CURRENT,
                params![task_id, kind.as_str()],
                row_to_task_artifact,
            )
            .optional()?;
        let superseded_at = Utc::now().timestamp();
        if let Some(prior_current) = prior_current
            && prior_current.id != artifact_id
            && let Some(content) = prior_current.content
        {
            tx.execute(
                "INSERT INTO task_artifact_versions (
                    task_id, artifact_kind, content, produced_by_run_id, produced_by_session_id, superseded_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    task_id,
                    kind.as_str(),
                    content,
                    prior_current.produced_by_run_id,
                    prior_current.produced_by_session_id,
                    superseded_at,
                ],
            )?;
        }
        tx.execute(
            "UPDATE task_artifacts SET is_current = 0
             WHERE task_id = ?1 AND artifact_kind = ?2",
            params![task_id, kind.as_str()],
        )?;
        let affected = tx.execute(
            "UPDATE task_artifacts SET is_current = 1, updated_at = ?1
             WHERE id = ?2 AND task_id = ?3 AND artifact_kind = ?4",
            params![superseded_at, artifact_id, task_id, kind.as_str()],
        )?;
        if affected == 0 {
            return Err(anyhow!(
                "no task_artifacts row matches id={artifact_id} task_id={task_id} kind={kind:?}"
            ));
        }
        tx.commit()?;
        Ok(())
    }

    fn delete_task_artifacts_for_task(&self, task_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM task_artifacts WHERE task_id = ?1",
            params![task_id],
        )?;
        Ok(())
    }
}

fn update_task_field(
    db: &Database,
    assignment: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<()> {
    // Caller layout: [value(s for assignment), updated_at, id]
    let conn = db.get_conn()?;
    let n = params.len();
    debug_assert!(n >= 3, "update_task_field requires at least value, ts, id");
    let sql = format!(
        "UPDATE tasks SET {assignment}, updated_at = ?{ts_idx} WHERE id = ?{id_idx}",
        ts_idx = n - 1,
        id_idx = n
    );
    conn.execute(&sql, params)?;
    Ok(())
}

const TASK_SELECT_COLUMNS: &str = "
    id, name, display_name,
    repository_path, repository_name,
    variant, stage, request_body,
    current_spec, current_plan, current_summary,
    source_kind, source_url,
    task_host_session_id, task_branch, base_branch,
    issue_number, issue_url, pr_number, pr_url, pr_state,
    failure_flag, epic_id, attention_required,
    created_at, updated_at
";

const TASK_SELECT_WHERE_ID: &str = "
    SELECT
        id, name, display_name,
        repository_path, repository_name,
        variant, stage, request_body,
        current_spec, current_plan, current_summary,
        source_kind, source_url,
        task_host_session_id, task_branch, base_branch,
        issue_number, issue_url, pr_number, pr_url, pr_state,
        failure_flag, epic_id, attention_required,
        created_at, updated_at
    FROM tasks WHERE id = ?1
";

const TASK_SELECT_WHERE_REPO_ORDER: &str = "
    SELECT
        id, name, display_name,
        repository_path, repository_name,
        variant, stage, request_body,
        current_spec, current_plan, current_summary,
        source_kind, source_url,
        task_host_session_id, task_branch, base_branch,
        issue_number, issue_url, pr_number, pr_url, pr_state,
        failure_flag, epic_id, attention_required,
        created_at, updated_at
    FROM tasks WHERE repository_path = ?1 ORDER BY updated_at DESC, name ASC
";

const TASK_RUN_SELECT_COLUMNS: &str = "
    id, task_id, stage, preset_id,
    base_branch, target_branch,
    selected_session_id, selected_artifact_id, selection_mode,
    started_at, completed_at,
    cancelled_at, confirmed_at, failed_at,
    failure_reason,
    created_at, updated_at
";

const TASK_RUN_SELECT_WHERE_ID: &str = "
    SELECT id, task_id, stage, preset_id,
           base_branch, target_branch,
           selected_session_id, selected_artifact_id, selection_mode,
           started_at, completed_at,
           cancelled_at, confirmed_at, failed_at,
           failure_reason,
           created_at, updated_at
    FROM task_runs WHERE id = ?1
";

const TASK_RUN_SELECT_WHERE_TASK: &str = "
    SELECT id, task_id, stage, preset_id,
           base_branch, target_branch,
           selected_session_id, selected_artifact_id, selection_mode,
           started_at, completed_at,
           cancelled_at, confirmed_at, failed_at,
           failure_reason,
           created_at, updated_at
    FROM task_runs WHERE task_id = ?1 ORDER BY created_at DESC
";

const TASK_SELECT_WHERE_REPO_NAME: &str = "
    SELECT
        id, name, display_name,
        repository_path, repository_name,
        variant, stage, request_body,
        current_spec, current_plan, current_summary,
        source_kind, source_url,
        task_host_session_id, task_branch, base_branch,
        issue_number, issue_url, pr_number, pr_url, pr_state,
        failure_flag, epic_id, attention_required,
        created_at, updated_at
    FROM tasks WHERE repository_path = ?1 AND name = ?2
";

const TASK_SELECT_FOR_PR_NUMBER: &str = "
    SELECT DISTINCT
        t.id, t.name, t.display_name,
        t.repository_path, t.repository_name,
        t.variant, t.stage, t.request_body,
        t.current_spec, t.current_plan, t.current_summary,
        t.source_kind, t.source_url,
        t.task_host_session_id, t.task_branch, t.base_branch,
        t.issue_number, t.issue_url, t.pr_number, t.pr_url, t.pr_state,
        t.failure_flag, t.epic_id, t.attention_required,
        t.created_at, t.updated_at
    FROM tasks t
    JOIN sessions s ON s.task_id = t.id
    WHERE s.repository_path = ?1
      AND s.pr_number = ?2
      AND t.stage <> 'cancelled'
    ORDER BY t.updated_at DESC
";

/// v2 'active' run query: no terminal timestamp on the row. Replaces v1's
/// `WHERE status = 'running'`. The (cancelled_at, confirmed_at, failed_at)
/// IS NULL trio is the negation of every terminal predicate
/// `compute_run_status` checks before the failure path.
const TASK_RUN_SELECT_ACTIVE_FOR_TASK_STAGE: &str = "
    SELECT id, task_id, stage, preset_id,
           base_branch, target_branch,
           selected_session_id, selected_artifact_id, selection_mode,
           started_at, completed_at,
           cancelled_at, confirmed_at, failed_at,
           failure_reason,
           created_at, updated_at
    FROM task_runs
    WHERE task_id = ?1 AND stage = ?2
      AND cancelled_at IS NULL
      AND confirmed_at IS NULL
      AND failed_at IS NULL
    ORDER BY started_at DESC, created_at DESC
    LIMIT 1
";

const TASK_ARTIFACT_SELECT_WHERE_TASK: &str = "
    SELECT id, task_id, artifact_kind, title, content, url, metadata_json,
           is_current, produced_by_run_id, produced_by_session_id,
           created_at, updated_at
    FROM task_artifacts WHERE task_id = ?1 ORDER BY created_at DESC
";

const TASK_ARTIFACT_SELECT_WHERE_TASK_KIND: &str = "
    SELECT id, task_id, artifact_kind, title, content, url, metadata_json,
           is_current, produced_by_run_id, produced_by_session_id,
           created_at, updated_at
    FROM task_artifacts WHERE task_id = ?1 AND artifact_kind = ?2
    ORDER BY created_at DESC
";

const TASK_ARTIFACT_SELECT_WHERE_CURRENT: &str = "
    SELECT id, task_id, artifact_kind, title, content, url, metadata_json,
           is_current, produced_by_run_id, produced_by_session_id,
           created_at, updated_at
    FROM task_artifacts
    WHERE task_id = ?1 AND artifact_kind = ?2 AND is_current = 1
    LIMIT 1
";

// Suppress unused-const warning while these aliases live in the file but no public
// reader is wired up yet; Wave I will reference them when porting orchestration.
#[allow(dead_code)]
const _UNUSED_COLUMN_LISTS: &[&str] = &[TASK_SELECT_COLUMNS, TASK_RUN_SELECT_COLUMNS];

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    let variant_str: String = row.get(5)?;
    let stage_str: String = row.get(6)?;
    let variant: TaskVariant = variant_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    let stage: TaskStage = stage_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(Task {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        repository_path: PathBuf::from(row.get::<_, String>(3)?),
        repository_name: row.get(4)?,
        variant,
        stage,
        request_body: row.get(7)?,
        current_spec: row.get(8)?,
        current_plan: row.get(9)?,
        current_summary: row.get(10)?,
        source_kind: row.get(11)?,
        source_url: row.get(12)?,
        task_host_session_id: row.get(13)?,
        task_branch: row.get(14)?,
        base_branch: row.get(15)?,
        issue_number: row.get(16)?,
        issue_url: row.get(17)?,
        pr_number: row.get(18)?,
        pr_url: row.get(19)?,
        pr_state: row.get(20)?,
        failure_flag: row.get(21)?,
        epic_id: row.get(22)?,
        attention_required: row.get(23)?,
        created_at: utc_from_epoch_seconds_lossy(row.get(24)?),
        updated_at: utc_from_epoch_seconds_lossy(row.get(25)?),
        // Wave B: field exists, column lands in Wave C and is read in
        // Wave E once `tasks.cancelled_at` is part of TASK_SELECT_COLUMNS.
        cancelled_at: None,
        task_runs: Vec::new(),
    })
}

fn row_to_task_run(row: &Row<'_>) -> rusqlite::Result<TaskRun> {
    let stage_str: String = row.get(2)?;
    let stage: TaskStage = stage_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(TaskRun {
        id: row.get(0)?,
        task_id: row.get(1)?,
        stage,
        preset_id: row.get(3)?,
        base_branch: row.get(4)?,
        target_branch: row.get(5)?,
        selected_session_id: row.get(6)?,
        selected_artifact_id: row.get(7)?,
        selection_mode: row.get(8)?,
        started_at: row
            .get::<_, Option<i64>>(9)?
            .map(utc_from_epoch_seconds_lossy),
        completed_at: row
            .get::<_, Option<i64>>(10)?
            .map(utc_from_epoch_seconds_lossy),
        cancelled_at: row
            .get::<_, Option<i64>>(11)?
            .map(utc_from_epoch_seconds_lossy),
        confirmed_at: row
            .get::<_, Option<i64>>(12)?
            .map(utc_from_epoch_seconds_lossy),
        failed_at: row
            .get::<_, Option<i64>>(13)?
            .map(utc_from_epoch_seconds_lossy),
        failure_reason: row.get(14)?,
        created_at: utc_from_epoch_seconds_lossy(row.get(15)?),
        updated_at: utc_from_epoch_seconds_lossy(row.get(16)?),
    })
}

fn row_to_task_stage_config(row: &Row<'_>) -> rusqlite::Result<TaskStageConfig> {
    let stage_str: String = row.get(1)?;
    let stage: TaskStage = stage_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(TaskStageConfig {
        task_id: row.get(0)?,
        stage,
        preset_id: row.get(2)?,
        auto_chain: row.get(3)?,
    })
}

fn row_to_project_workflow_default(row: &Row<'_>) -> rusqlite::Result<ProjectWorkflowDefault> {
    let stage_str: String = row.get(1)?;
    let stage: TaskStage = stage_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(ProjectWorkflowDefault {
        repository_path: row.get(0)?,
        stage,
        preset_id: row.get(2)?,
        auto_chain: row.get(3)?,
    })
}

fn row_to_task_artifact(row: &Row<'_>) -> rusqlite::Result<TaskArtifact> {
    let kind_str: String = row.get(2)?;
    let kind: TaskArtifactKind = kind_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(TaskArtifact {
        id: row.get(0)?,
        task_id: row.get(1)?,
        artifact_kind: kind,
        title: row.get(3)?,
        content: row.get(4)?,
        url: row.get(5)?,
        metadata_json: row.get(6)?,
        is_current: row.get(7)?,
        produced_by_run_id: row.get(8)?,
        produced_by_session_id: row.get(9)?,
        created_at: utc_from_epoch_seconds_lossy(row.get(10)?),
        updated_at: utc_from_epoch_seconds_lossy(row.get(11)?),
    })
}

fn row_to_task_artifact_version(row: &Row<'_>) -> rusqlite::Result<TaskArtifactVersion> {
    let kind_str: String = row.get(2)?;
    let kind: TaskArtifactKind = kind_str.parse().map_err(|err: String| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            std::io::Error::other(err).into(),
        )
    })?;
    Ok(TaskArtifactVersion {
        history_id: row.get(0).ok(),
        task_id: row.get(1)?,
        artifact_kind: kind,
        content: row.get(3)?,
        produced_by_run_id: row.get(4)?,
        produced_by_session_id: row.get(5)?,
        is_current: false, // populated only when joined; the version table itself has no is_current
        superseded_at: row.get(6).ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::TaskStage;
    use crate::infrastructure::database::initialize_schema;
    use chrono::{DateTime, TimeZone, Utc};

    fn make_db() -> Database {
        let db = Database::new_in_memory().expect("in-memory db");
        initialize_schema(&db).expect("initialize schema");
        db
    }

    fn ts(epoch: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(epoch, 0).single().expect("valid ts")
    }

    fn make_task(id: &str, name: &str) -> Task {
        Task {
            id: id.to_string(),
            name: name.to_string(),
            display_name: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            variant: TaskVariant::Regular,
            stage: TaskStage::Draft,
            request_body: "do the thing".to_string(),
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
            created_at: ts(1_000),
            updated_at: ts(1_000),
            cancelled_at: None,
            task_runs: Vec::new(),
        }
    }

    fn make_run(id: &str, task_id: &str) -> TaskRun {
        TaskRun {
            id: id.to_string(),
            task_id: task_id.to_string(),
            stage: TaskStage::Implemented,
            preset_id: None,
            base_branch: None,
            target_branch: None,
            selected_session_id: None,
            selected_artifact_id: None,
            selection_mode: None,
            started_at: Some(ts(2_000)),
            completed_at: None,
            cancelled_at: None,
            confirmed_at: None,
            failed_at: None,
            failure_reason: None,
            created_at: ts(2_000),
            updated_at: ts(2_000),
        }
    }

    #[test]
    fn task_create_round_trips_through_get_by_id() {
        let db = make_db();
        let task = make_task("t1", "first");
        db.create_task(&task).unwrap();
        let fetched = db.get_task_by_id("t1").unwrap();
        assert_eq!(fetched.id, "t1");
        assert_eq!(fetched.name, "first");
        assert_eq!(fetched.stage, TaskStage::Draft);
        assert_eq!(fetched.variant, TaskVariant::Regular);
    }

    #[test]
    fn list_tasks_filters_by_repo_and_orders_newest_first() {
        let db = make_db();
        let mut a = make_task("t-a", "apple");
        a.updated_at = ts(1_500);
        let mut b = make_task("t-b", "banana");
        b.updated_at = ts(2_500);
        db.create_task(&a).unwrap();
        db.create_task(&b).unwrap();
        let listed = db.list_tasks(&PathBuf::from("/tmp/repo")).unwrap();
        let ids: Vec<_> = listed.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["t-b", "t-a"]);
    }

    #[test]
    fn delete_task_cascades_to_task_runs_via_fk() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        assert!(db.get_task_run("r1").is_ok());
        db.delete_task("t1").unwrap();
        assert!(db.get_task_run("r1").is_err());
    }

    #[test]
    fn task_run_create_round_trips_with_no_terminal_timestamps() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert!(fetched.cancelled_at.is_none());
        assert!(fetched.confirmed_at.is_none());
        assert!(fetched.failed_at.is_none());
        assert!(fetched.completed_at.is_none());
    }

    #[test]
    fn list_task_runs_scopes_by_task_and_orders_newest_first() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task(&make_task("t2", "second")).unwrap();
        let mut older = make_run("r-old", "t1");
        older.created_at = ts(1_000);
        let mut newer = make_run("r-new", "t1");
        newer.created_at = ts(3_000);
        let foreign = make_run("r-foreign", "t2");
        db.create_task_run(&older).unwrap();
        db.create_task_run(&newer).unwrap();
        db.create_task_run(&foreign).unwrap();
        let listed = db.list_task_runs("t1").unwrap();
        let ids: Vec<_> = listed.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["r-new", "r-old"]);
    }

    #[test]
    fn set_task_run_cancelled_at_populates_column() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        db.set_task_run_cancelled_at("r1").unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert!(fetched.cancelled_at.is_some());
        assert!(fetched.confirmed_at.is_none());
        assert!(fetched.failed_at.is_none());
    }

    #[test]
    fn set_task_run_confirmed_at_populates_column() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        db.set_task_run_confirmed_at("r1").unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert!(fetched.confirmed_at.is_some());
        assert!(fetched.cancelled_at.is_none());
        assert!(fetched.failed_at.is_none());
    }

    #[test]
    fn set_task_run_failed_at_populates_column() {
        // Migration-only setter; assert it persists correctly even though no v2-native
        // caller exercises this path.
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        db.set_task_run_failed_at("r1").unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert!(fetched.failed_at.is_some());
    }

    #[test]
    fn set_task_run_selection_persists_session_id_and_mode() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        db.set_task_run_selection("r1", Some("sess-winner"), None, Some("manual"))
            .unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert_eq!(fetched.selected_session_id.as_deref(), Some("sess-winner"));
        assert!(fetched.selected_artifact_id.is_none());
        assert_eq!(fetched.selection_mode.as_deref(), Some("manual"));
    }

    #[test]
    fn set_task_run_failure_reason_round_trips() {
        let db = make_db();
        db.create_task(&make_task("t1", "first")).unwrap();
        db.create_task_run(&make_run("r1", "t1")).unwrap();
        db.set_task_run_failure_reason("r1", Some("boom")).unwrap();
        let fetched = db.get_task_run("r1").unwrap();
        assert_eq!(fetched.failure_reason.as_deref(), Some("boom"));
    }

    #[test]
    fn task_runs_table_does_not_have_status_column() {
        // Production guard against accidental schema drift: if a future migration
        // re-introduces a status column the v2 derived getter contract breaks.
        let db = make_db();
        let conn = db.get_conn().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('task_runs') WHERE name = 'status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "v2 task_runs must never have a status column");
    }
}
