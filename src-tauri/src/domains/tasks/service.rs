use crate::domains::sessions::db_sessions::{SessionMethods, SessionTaskLineage};
use crate::domains::sessions::entity::Session;
use crate::domains::sessions::lifecycle::cancellation::{
    CancellationConfig, CancellationCoordinator,
};
use crate::domains::sessions::repository::SessionDbManager;
use crate::domains::sessions::service::SessionManager;
pub use crate::domains::tasks::entity::{
    ProjectWorkflowDefault, SlotKind, Task, TaskArtifact, TaskArtifactKind, TaskArtifactVersion,
    TaskRun, TaskRunStatus, TaskStage, TaskStageConfig, TaskVariant,
};
use crate::domains::tasks::reconciler;
pub use crate::domains::tasks::orchestration::{
    BranchMerger, ClarifyRunStarted, MergeConflictDuringConfirm, ProductionMerger,
    ProductionProvisioner, ProvisionedRunSession, ProvisionedSession, SessionProvisioner,
    StageAdvanceAfterMergeFailed, StageRunStarted, TaskOrchestrator,
};
pub use crate::domains::tasks::presets::{
    ExpandedRunSlot, PresetShape, PresetSlot, SelectionMode, expand_preset, selection_mode_for,
};
pub use crate::domains::tasks::runs::{SelectionKind, TaskRunService};
use crate::infrastructure::database::{Database, TaskArtifactMethods, TaskMethods, TaskRunMethods};
use anyhow::{Result, anyhow};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tokio::task::JoinSet;
use uuid::Uuid;

/// TaskService is the domain-level facade over the task aggregate.
///
/// It is deliberately narrow: create / read / update the canonical fields
/// on a task, and write artifact history while mirroring the "current" text
/// into the convenient `current_spec` / `current_plan` / `current_summary`
/// columns on the task row.
///
/// Keeping this orthogonal to sessions lets us land it before sessions wire
/// up their `task_run_id` lineage in Task 3.
pub struct TaskService<'a> {
    db: &'a Database,
}

pub struct CreateTaskInput<'a> {
    pub name: &'a str,
    pub display_name: Option<&'a str>,
    pub repository_path: &'a Path,
    pub repository_name: &'a str,
    pub request_body: &'a str,
    pub variant: TaskVariant,
    pub epic_id: Option<&'a str>,
    pub base_branch: Option<&'a str>,
    pub source_kind: Option<&'a str>,
    pub source_url: Option<&'a str>,
    pub issue_number: Option<i64>,
    pub issue_url: Option<&'a str>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresetSource {
    TaskOverride,
    ProjectDefault,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedStagePreset {
    pub preset_id: Option<String>,
    pub auto_chain: bool,
    pub source: PresetSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSessionCancelFailure {
    pub session_id: String,
    pub session_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskCascadeCancelError {
    pub task_id: String,
    pub failures: Vec<TaskSessionCancelFailure>,
}

impl std::fmt::Display for TaskCascadeCancelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "failed to cancel {} linked session(s) for task '{}'",
            self.failures.len(),
            self.task_id
        )
    }
}

impl std::error::Error for TaskCascadeCancelError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskNotFoundError {
    pub task_id: String,
}

impl std::fmt::Display for TaskNotFoundError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "task not found ({})", self.task_id)
    }
}

impl std::error::Error for TaskNotFoundError {}

impl<'a> TaskService<'a> {
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    pub fn create_task(&self, input: CreateTaskInput<'_>) -> Result<Task> {
        let now = Utc::now();
        let task = Task {
            id: Uuid::new_v4().to_string(),
            name: input.name.to_string(),
            display_name: input.display_name.map(str::to_string),
            repository_path: PathBuf::from(input.repository_path),
            repository_name: input.repository_name.to_string(),
            variant: input.variant,
            stage: TaskStage::Draft,
            request_body: input.request_body.to_string(),
            current_spec: None,
            current_plan: None,
            current_summary: None,
            source_kind: input.source_kind.map(str::to_string),
            source_url: input.source_url.map(str::to_string),
            task_host_session_id: None,
            task_branch: None,
            base_branch: input.base_branch.map(str::to_string),
            issue_number: input.issue_number,
            issue_url: input.issue_url.map(str::to_string),
            pr_number: input.pr_number,
            pr_url: input.pr_url.map(str::to_string),
            pr_state: None,
            failure_flag: false,
            epic_id: input.epic_id.map(str::to_string),
            attention_required: false,
            created_at: now,
            updated_at: now,
            cancelled_at: None,
            task_runs: Vec::new(),
        };
        self.db.create_task(&task)?;
        Ok(task)
    }

    pub fn get_task(&self, id: &str) -> Result<Task> {
        self.with_runs(self.db.get_task_by_id(id)?)
    }

    pub fn get_task_by_name(&self, repo: &Path, name: &str) -> Result<Task> {
        self.db.get_task_by_name(repo, name)
    }

    pub fn list_tasks(&self, repo: &Path) -> Result<Vec<Task>> {
        self.db
            .list_tasks(repo)?
            .into_iter()
            .map(|task| self.with_runs(task))
            .collect()
    }

    pub fn reconcile_stage_drift(&self, repo: &Path) -> Result<usize> {
        reconciler::reconcile_all(self.db, repo)
    }

    fn with_runs(&self, mut task: Task) -> Result<Task> {
        task.task_runs = self.db.list_task_runs(&task.id)?;
        Ok(task)
    }

    pub fn delete_task(&self, id: &str) -> Result<()> {
        self.db.delete_task(id)
    }

    pub fn cancel_task(&self, id: &str) -> Result<()> {
        let task = self.db.get_task_by_id(id)?;
        if task.cancelled_at.is_some() {
            return Ok(());
        }
        self.db.set_task_cancelled_at(id, Some(Utc::now()))
    }

    /// Cancel the task and every linked active session in parallel.
    ///
    /// Best-effort cleanup (Option B): the task lifecycle is anchored to the host
    /// session. If the host cancels successfully (or there is no host), the task
    /// advances to `Cancelled` even when sibling cleanup fails. This avoids the
    /// "half-cancelled" state where the host worktree is gone but the parent
    /// task is still at `Ready`/`Implemented`/etc., which left no clean recovery
    /// path for the user (couldn't re-promote, couldn't re-cancel cleanly).
    ///
    /// Sibling failures are still reported via `TaskCascadeCancelError` so the
    /// UI can surface a "retry cleanup" affordance. Task runs whose sessions
    /// are still alive remain in their prior status so a retry can act on them.
    /// If the host itself fails to cancel, the task is left at its prior stage
    /// and the cascade error is returned — there's no winner to anchor the
    /// lifecycle transition.
    pub async fn cancel_task_cascading(&self, repo_path: &Path, id: &str) -> Result<Task> {
        let task = self.db.get_task_by_id(id)?;
        if task.cancelled_at.is_some() {
            return self.get_task(id);
        }

        let host_session_id = task.task_host_session_id.clone();
        let linked_sessions = self.collect_active_task_sessions(repo_path, &task)?;
        let mut join_set = JoinSet::new();

        for session in linked_sessions {
            let db = self.db.clone();
            let repo_path = repo_path.to_path_buf();
            join_set.spawn(async move {
                let db_manager = SessionDbManager::new(db, repo_path.clone());
                let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
                let result = coordinator
                    .cancel_session_async(&session, CancellationConfig::default())
                    .await;
                (session, result.map(|_| ()))
            });
        }

        let mut failures = Vec::new();
        let mut host_cancelled = host_session_id.is_none();
        let mut host_failed = false;

        while let Some(outcome) = join_set.join_next().await {
            match outcome {
                Ok((session, Ok(()))) => {
                    if host_session_id.as_deref() == Some(session.id.as_str()) {
                        host_cancelled = true;
                    }
                }
                Ok((session, Err(error))) => {
                    if host_session_id.as_deref() == Some(session.id.as_str()) {
                        host_failed = true;
                    }
                    failures.push(TaskSessionCancelFailure {
                        session_id: session.id.clone(),
                        session_name: session.name.clone(),
                        reason: error.to_string(),
                    });
                }
                Err(error) => failures.push(TaskSessionCancelFailure {
                    session_id: "joinset".to_string(),
                    session_name: "joinset".to_string(),
                    reason: format!("task cancel worker join error: {error}"),
                }),
            }
        }

        if host_failed {
            return Err(TaskCascadeCancelError {
                task_id: id.to_string(),
                failures,
            }
            .into());
        }

        if host_cancelled {
            for run in self.db.list_task_runs(id)? {
                // v2: "active" runs are those with no terminal timestamp set.
                // Skip terminal runs — same effect as v1's "skip
                // Completed/Failed/Cancelled" filter.
                let is_active = run.cancelled_at.is_none()
                    && run.confirmed_at.is_none()
                    && run.failed_at.is_none();
                if !is_active {
                    continue;
                }
                let active_left = self.collect_active_run_sessions(repo_path, &run.id)?;
                if active_left.is_empty() {
                    self.db.set_task_run_cancelled_at(&run.id)?;
                }
            }

            self.db.set_task_cancelled_at(id, Some(Utc::now()))?;
        }

        if !failures.is_empty() {
            return Err(TaskCascadeCancelError {
                task_id: id.to_string(),
                failures,
            }
            .into());
        }

        self.get_task(id)
    }

    pub fn reopen_task(&self, id: &str) -> Result<()> {
        let task = self.db.get_task_by_id(id)?;
        if task.cancelled_at.is_some() {
            self.db.set_task_cancelled_at(id, None)?;
        }
        self.db.set_task_stage(id, TaskStage::Draft)
    }

    pub fn reopen_task_to_stage(&self, id: &str, target_stage: TaskStage) -> Result<Task> {
        let task = self.db.get_task_by_id(id)?;
        if !matches!(
            target_stage,
            TaskStage::Ready
                | TaskStage::Brainstormed
                | TaskStage::Planned
                | TaskStage::Implemented
                | TaskStage::Pushed
        ) {
            return Err(anyhow!("invalid reopen target: {}", target_stage.as_str()));
        }
        if !(task.cancelled_at.is_some() || task.stage == TaskStage::Done) {
            return Err(anyhow!(
                "task '{}' must be done or cancelled before reopening",
                task.id
            ));
        }

        self.db.set_task_stage(id, target_stage)?;
        if task.cancelled_at.is_some() {
            self.db.set_task_cancelled_at(id, None)?;
        }
        if task.failure_flag {
            self.db.set_task_failure_flag(id, false)?;
        }
        self.get_task(id)
    }

    pub fn advance_stage(&self, id: &str, stage: TaskStage) -> Result<()> {
        let current = self.db.get_task_by_id(id)?;
        if !current.stage.can_advance_to(stage) {
            return Err(anyhow!(
                "illegal stage transition: {} -> {}",
                current.stage.as_str(),
                stage.as_str()
            ));
        }
        self.db.set_task_stage(id, stage)
    }

    /// Service-layer entry point for the auto-advance state machine.
    /// Delegates to `auto_advance::on_pr_state_refreshed` so commands can
    /// react to forge events without importing from `domains::*` directly.
    pub fn react_to_pr_state_refresh(
        &self,
        repository_path: &str,
        pr_number: i64,
        pr_state: crate::domains::sessions::entity::PrState,
    ) -> Result<()> {
        crate::domains::tasks::auto_advance::on_pr_state_refreshed(
            self.db,
            repository_path,
            pr_number,
            pr_state,
        )
    }

    pub fn on_branch_merged_without_pr(&self, task_id: &str) -> Result<()> {
        let task = self.db.get_task_by_id(task_id)?;
        if task.cancelled_at.is_some() {
            return Ok(());
        }
        match task.stage {
            TaskStage::Implemented | TaskStage::Pushed => {
                self.db.set_task_stage(task_id, TaskStage::Done)?;
                if task.failure_flag {
                    self.db.set_task_failure_flag(task_id, false)?;
                }
            }
            TaskStage::Done => {}
            TaskStage::Draft | TaskStage::Ready | TaskStage::Brainstormed | TaskStage::Planned => {}
        }
        Ok(())
    }

    pub async fn cancel_task_run_cascading(
        &self,
        repo_path: &Path,
        run_id: &str,
    ) -> Result<TaskRun> {
        let run = self.db.get_task_run(run_id)?;
        if run.cancelled_at.is_some() {
            return Ok(run);
        }

        let linked_sessions = self.collect_active_run_sessions(repo_path, run_id)?;
        let mut join_set = JoinSet::new();

        for session in linked_sessions {
            let manager = SessionManager::new(self.db.clone(), repo_path.to_path_buf());
            join_set.spawn(async move {
                let session_name = session.name.clone();
                manager.fast_cancel_session(&session_name).await
            });
        }

        let mut failures = Vec::new();
        while let Some(outcome) = join_set.join_next().await {
            match outcome {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(error.to_string()),
                Err(error) => failures.push(format!("task run cancel worker join error: {error}")),
            }
        }

        if !failures.is_empty() {
            return Err(anyhow!(
                "failed to cancel {} session(s) for run {}: {}",
                failures.len(),
                run_id,
                failures.join("; ")
            ));
        }

        self.db.set_task_run_selection(run_id, None, None, None)?;
        self.db.set_task_run_cancelled_at(run_id)?;
        self.db.get_task_run(run_id)
    }

    /// Write a task artifact and mirror it into the convenience column on the
    /// task row. Only `Spec`, `Plan`, and `Summary` have mirrored columns —
    /// other artifact kinds (request/review/decision/attachment/link) go
    /// exclusively to `task_artifacts`.
    pub fn update_content(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
        content: &str,
        produced_by_session_id: Option<&str>,
        produced_by_run_id: Option<&str>,
    ) -> Result<TaskArtifact> {
        // Task must exist — surface an explicit error rather than letting
        // the FK cascade no-op confuse callers.
        self.db.get_task_by_id(task_id)?;

        let now = Utc::now();
        let artifact = TaskArtifact {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            artifact_kind: kind,
            title: None,
            content: Some(content.to_string()),
            url: None,
            metadata_json: None,
            is_current: false,
            produced_by_run_id: produced_by_run_id.map(str::to_string),
            produced_by_session_id: produced_by_session_id.map(str::to_string),
            created_at: now,
            updated_at: now,
        };
        self.db.create_task_artifact(&artifact)?;
        self.db
            .mark_task_artifact_current(task_id, kind, &artifact.id)?;

        match kind {
            TaskArtifactKind::Spec => self.db.set_task_current_spec(task_id, Some(content))?,
            TaskArtifactKind::Plan => self.db.set_task_current_plan(task_id, Some(content))?,
            TaskArtifactKind::Summary => {
                self.db.set_task_current_summary(task_id, Some(content))?;
            }
            _ => {}
        }

        Ok(artifact)
    }

    pub fn artifact_history(
        &self,
        task_id: &str,
        kind: TaskArtifactKind,
    ) -> Result<Vec<TaskArtifactVersion>> {
        self.db.get_task_by_id(task_id)?;

        let mut history = Vec::new();
        if let Some(current) = self.db.get_current_task_artifact(task_id, kind)? {
            history.push(TaskArtifactVersion {
                history_id: None,
                task_id: current.task_id,
                artifact_kind: current.artifact_kind,
                content: current.content,
                produced_by_run_id: current.produced_by_run_id,
                produced_by_session_id: current.produced_by_session_id,
                is_current: true,
                superseded_at: None,
            });
        }
        history.extend(self.db.list_task_artifact_versions(task_id, kind)?);
        Ok(history)
    }

    pub fn set_stage_config(&self, config: &TaskStageConfig) -> Result<()> {
        self.db.upsert_task_stage_config(config)
    }

    pub fn list_stage_configs(&self, task_id: &str) -> Result<Vec<TaskStageConfig>> {
        self.db.list_task_stage_configs(task_id)
    }

    pub fn resolve_stage_preset(
        &self,
        task: &Task,
        stage: TaskStage,
    ) -> Result<ResolvedStagePreset> {
        if let Some(cfg) = self.db.get_task_stage_config(&task.id, stage)? {
            return Ok(ResolvedStagePreset {
                preset_id: cfg.preset_id,
                auto_chain: cfg.auto_chain,
                source: PresetSource::TaskOverride,
            });
        }

        if let Some(default) = self
            .db
            .list_project_workflow_defaults(&task.repository_path.to_string_lossy())?
            .into_iter()
            .find(|d| d.stage == stage)
        {
            return Ok(ResolvedStagePreset {
                preset_id: default.preset_id,
                auto_chain: default.auto_chain,
                source: PresetSource::ProjectDefault,
            });
        }

        Ok(ResolvedStagePreset {
            preset_id: None,
            auto_chain: false,
            source: PresetSource::None,
        })
    }

    pub fn attach_issue(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()> {
        self.db.set_task_issue(id, issue_number, issue_url)
    }

    pub fn attach_pr(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
        pr_state: Option<&str>,
    ) -> Result<()> {
        self.db.set_task_pr(id, pr_number, pr_url, pr_state)
    }

    pub fn set_attention(&self, id: &str, attention_required: bool) -> Result<()> {
        self.db.set_task_attention_required(id, attention_required)
    }

    fn collect_active_task_sessions(&self, repo_path: &Path, task: &Task) -> Result<Vec<Session>> {
        let db_manager = SessionDbManager::new(self.db.clone(), repo_path.to_path_buf());
        let mut sessions = BTreeMap::new();

        // Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal
        // axis; the legacy `status` column is no longer authoritative. "Active"
        // here means "not cancelled and not a spec".
        if let Some(task_host_session_id) = task.task_host_session_id.as_deref()
            && let Ok(session) = db_manager.get_session_by_id(task_host_session_id)
            && session.cancelled_at.is_none()
            && !session.is_spec
        {
            sessions.insert(session.id.clone(), session);
        }

        for session in db_manager.list_sessions()? {
            if session.cancelled_at.is_some() || session.is_spec {
                continue;
            }
            if session.task_id.as_deref() == Some(task.id.as_str()) {
                sessions.insert(session.id.clone(), session);
            }
        }

        Ok(sessions.into_values().collect())
    }

    fn collect_active_run_sessions(&self, repo_path: &Path, run_id: &str) -> Result<Vec<Session>> {
        let db_manager = SessionDbManager::new(self.db.clone(), repo_path.to_path_buf());
        let mut sessions = Vec::new();

        for session in db_manager.list_sessions()? {
            // Phase 4 Wave B.2: filter by the orthogonal axes, not the legacy
            // status column.
            if session.cancelled_at.is_some() || session.is_spec {
                continue;
            }
            let SessionTaskLineage { task_run_id, .. } =
                self.db.get_session_task_lineage(&session.id)?;
            if task_run_id.as_deref() == Some(run_id) {
                sessions.push(session);
            }
        }

        Ok(sessions)
    }
}

/// Ensure the `task_id` on a session row matches the expected task, surfacing
/// an explicit error otherwise. Used by TaskRun lineage wiring to guarantee
/// every child session is bound to its run's task.
pub fn require_session_task(
    db: &Database,
    session_task_id: Option<&str>,
    task_id: &str,
) -> Result<()> {
    let actual = session_task_id.ok_or_else(|| anyhow!("session has no task_id binding"))?;
    if actual != task_id {
        return Err(anyhow!(
            "session task_id mismatch (got {actual}, expected {task_id})"
        ));
    }
    let _ = db.get_task_by_id(task_id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::db_sessions::SessionMethods;
    use crate::domains::sessions::entity::Session;
    use crate::domains::sessions::repository::SessionDbManager;
    use crate::infrastructure::database::Database;
    use chrono::Utc;
    use serial_test::serial;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    struct CancelFixture {
        _tmp: TempDir,
        repo_path: PathBuf,
        db: Database,
    }

    impl CancelFixture {
        fn new() -> Self {
            let tmp = TempDir::new().expect("tempdir");
            let repo_path = tmp.path().to_path_buf();

            Command::new("git")
                .args(["init"])
                .current_dir(&repo_path)
                .output()
                .expect("git init");
            Command::new("git")
                .args(["config", "user.email", "test@example.com"])
                .current_dir(&repo_path)
                .output()
                .expect("git config email");
            Command::new("git")
                .args(["config", "user.name", "Test User"])
                .current_dir(&repo_path)
                .output()
                .expect("git config name");
            Command::new("git")
                .args(["branch", "-M", "master"])
                .current_dir(&repo_path)
                .output()
                .expect("git branch rename");
            std::fs::write(repo_path.join("README.md"), "Initial").expect("write README");
            Command::new("git")
                .args(["add", "."])
                .current_dir(&repo_path)
                .output()
                .expect("git add");
            Command::new("git")
                .args(["commit", "-m", "init"])
                .current_dir(&repo_path)
                .output()
                .expect("git commit");

            let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
            Self {
                _tmp: tmp,
                repo_path,
                db,
            }
        }

        fn db_manager(&self) -> SessionDbManager {
            SessionDbManager::new(self.db.clone(), self.repo_path.clone())
        }

        fn task_service(&self) -> TaskService<'_> {
            TaskService::new(&self.db)
        }

        fn run_service(&self) -> TaskRunService<'_> {
            TaskRunService::new(&self.db)
        }

        fn create_task(&self, name: &str) -> Task {
            self.task_service()
                .create_task(CreateTaskInput {
                    name,
                    display_name: Some("Alpha"),
                    repository_path: &self.repo_path,
                    repository_name: "repo",
                    request_body: "please implement X",
                    variant: TaskVariant::Regular,
                    epic_id: None,
                    base_branch: Some("master"),
                    source_kind: None,
                    source_url: None,
                    issue_number: None,
                    issue_url: None,
                    pr_number: None,
                    pr_url: None,
                })
                .expect("create task")
        }

        fn create_session(
            &self,
            session_id: &str,
            name: &str,
            branch: &str,
            task_id: Option<&str>,
            task_run_id: Option<&str>,
            run_role: Option<&str>,
        ) -> Session {
            let worktree_path = self.repo_path.join(".lucode/worktrees").join(session_id);
            std::fs::create_dir_all(
                worktree_path
                    .parent()
                    .expect("worktree parent directory exists"),
            )
            .expect("create worktree parent");
            let output = Command::new("git")
                .args(["worktree", "add", "-b", branch])
                .arg(&worktree_path)
                .arg("master")
                .current_dir(&self.repo_path)
                .output()
                .expect("git worktree add");
            assert!(
                output.status.success(),
                "git worktree add failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );

            let session = Session {
                id: session_id.to_string(),
                name: name.to_string(),
                display_name: None,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                repository_path: self.repo_path.clone(),
                repository_name: "repo".to_string(),
                branch: branch.to_string(),
                parent_branch: "master".to_string(),
                original_parent_branch: Some("master".to_string()),
                worktree_path: worktree_path.clone(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                last_activity: None,
                initial_prompt: None,
                ready_to_merge: false,
                original_agent_type: Some("claude".to_string()),
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
                task_id: task_id.map(str::to_string),
                task_stage: None,
                task_run_id: None,
                run_role: run_role.map(str::to_string),
                slot_key: None,
                exited_at: None,
                exit_code: None,
                first_idle_at: None,
                is_spec: false,
                cancelled_at: None,
            };

            let db_manager = self.db_manager();
            db_manager.create_session(&session).expect("create session");
            self.db
                .set_session_task_lineage(&session.id, task_id, task_run_id, None, run_role, None)
                .expect("set session lineage");

            session
        }
    }

    fn basic_input<'a>() -> CreateTaskInput<'a> {
        CreateTaskInput {
            name: "alpha",
            display_name: Some("Alpha"),
            repository_path: Path::new("/repo"),
            repository_name: "repo",
            request_body: "please implement X",
            variant: TaskVariant::Regular,
            epic_id: None,
            base_branch: Some("main"),
            source_kind: None,
            source_url: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
        }
    }

    #[test]
    fn create_task_persists_with_draft_stage_and_uuid_id() {
        let db = db();
        let svc = TaskService::new(&db);

        let task = svc.create_task(basic_input()).expect("create");

        assert_eq!(task.stage, TaskStage::Draft);
        assert_eq!(task.name, "alpha");
        assert_eq!(task.request_body, "please implement X");
        assert_eq!(task.base_branch.as_deref(), Some("main"));
        assert!(Uuid::parse_str(&task.id).is_ok());

        // fetch by name round-trips
        let fetched = svc
            .get_task_by_name(&PathBuf::from("/repo"), "alpha")
            .unwrap();
        assert_eq!(fetched.id, task.id);
    }

    #[test]
    fn update_content_writes_artifact_and_mirrors_current_columns() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.update_content(&task.id, TaskArtifactKind::Spec, "spec v1", None, None)
            .unwrap();
        svc.update_content(&task.id, TaskArtifactKind::Plan, "plan v1", None, None)
            .unwrap();
        // Second spec artifact should become current and mirror the new text.
        svc.update_content(&task.id, TaskArtifactKind::Spec, "spec v2", None, None)
            .unwrap();

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.current_spec.as_deref(), Some("spec v2"));
        assert_eq!(reloaded.current_plan.as_deref(), Some("plan v1"));
        assert!(reloaded.current_summary.is_none());

        let current_spec_artifact = db
            .get_current_task_artifact(&task.id, TaskArtifactKind::Spec)
            .unwrap()
            .expect("current spec");
        assert_eq!(current_spec_artifact.content.as_deref(), Some("spec v2"));
    }

    #[test]
    fn task_artifact_history_returns_current_plus_history_newest_first() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.update_content(
            &task.id,
            TaskArtifactKind::Spec,
            "spec v1",
            Some("session-1"),
            Some("run-1"),
        )
        .unwrap();
        svc.update_content(
            &task.id,
            TaskArtifactKind::Spec,
            "spec v2",
            Some("session-2"),
            Some("run-2"),
        )
        .unwrap();
        svc.update_content(
            &task.id,
            TaskArtifactKind::Spec,
            "spec v3",
            Some("session-3"),
            Some("run-3"),
        )
        .unwrap();

        let history = svc
            .artifact_history(&task.id, TaskArtifactKind::Spec)
            .expect("artifact history");
        let contents: Vec<_> = history
            .iter()
            .map(|entry| entry.content.as_deref().unwrap_or_default())
            .collect();

        assert_eq!(contents, vec!["spec v3", "spec v2", "spec v1"]);
        assert!(history[0].is_current);
        assert_eq!(history[0].produced_by_run_id.as_deref(), Some("run-3"));
        assert!(history[0].superseded_at.is_none());
        assert!(!history[1].is_current);
        assert!(history[1].superseded_at.is_some());
    }

    #[test]
    fn cancel_and_reopen_flip_stage_between_cancelled_and_draft() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.cancel_task(&task.id).unwrap();
        assert!(svc.get_task(&task.id).unwrap().is_cancelled());

        svc.reopen_task(&task.id).unwrap();
        let reopened = svc.get_task(&task.id).unwrap();
        assert_eq!(reopened.stage, TaskStage::Draft);
        assert!(!reopened.is_cancelled());
    }

    #[test]
    fn advance_stage_walks_canonical_flow() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
            TaskStage::Pushed,
            TaskStage::Done,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
            assert_eq!(svc.get_task(&task.id).unwrap().stage, stage);
        }
    }

    #[test]
    fn advance_stage_rejects_skipping_stages() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        let err = svc.advance_stage(&task.id, TaskStage::Planned).unwrap_err();
        assert!(err.to_string().contains("illegal stage transition"));
        assert_eq!(svc.get_task(&task.id).unwrap().stage, TaskStage::Draft);
    }

    #[test]
    fn advance_stage_allows_cancellation_from_any_non_terminal_stage() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.cancel_task(&task.id).unwrap();
        let cancelled = svc.get_task(&task.id).unwrap();
        assert!(cancelled.is_cancelled());
        assert_eq!(cancelled.stage, TaskStage::Ready);
    }

    #[test]
    fn advance_stage_allows_ready_back_to_draft_but_no_other_backwards_edges() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.advance_stage(&task.id, TaskStage::Draft).unwrap();
        assert_eq!(svc.get_task(&task.id).unwrap().stage, TaskStage::Draft);

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.advance_stage(&task.id, TaskStage::Brainstormed)
            .unwrap();

        let err = svc.advance_stage(&task.id, TaskStage::Ready).unwrap_err();
        assert!(err.to_string().contains("illegal stage transition"));
    }

    #[test]
    fn advance_stage_rejects_no_op_to_same_stage() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        let err = svc.advance_stage(&task.id, TaskStage::Draft).unwrap_err();
        assert!(err.to_string().contains("illegal stage transition"));
    }

    #[test]
    fn advance_stage_rejects_transitions_from_done() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
            TaskStage::Pushed,
            TaskStage::Done,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
        }
        assert_eq!(svc.get_task(&task.id).unwrap().stage, TaskStage::Done);

        let err = svc
            .advance_stage(&task.id, TaskStage::Pushed)
            .unwrap_err();
        assert!(err.to_string().contains("illegal stage transition"));
    }

    #[test]
    fn attach_issue_and_pr_round_trips_via_service() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.attach_issue(&task.id, Some(1), Some("https://i/1"))
            .unwrap();
        svc.attach_pr(&task.id, Some(2), Some("https://pr/2"), Some("open"))
            .unwrap();

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.issue_number, Some(1));
        assert_eq!(reloaded.issue_url.as_deref(), Some("https://i/1"));
        assert_eq!(reloaded.pr_number, Some(2));
        assert_eq!(reloaded.pr_url.as_deref(), Some("https://pr/2"));
        assert_eq!(reloaded.pr_state.as_deref(), Some("open"));
    }

    #[tokio::test]
    #[serial]
    async fn cancel_task_cascading_kills_task_host_and_all_active_runs() {
        let fixture = CancelFixture::new();
        let svc = fixture.task_service();
        let runs = fixture.run_service();
        let task = fixture.create_task("alpha");

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.advance_stage(&task.id, TaskStage::Brainstormed)
            .unwrap();
        svc.advance_stage(&task.id, TaskStage::Planned).unwrap();
        svc.advance_stage(&task.id, TaskStage::Implemented).unwrap();

        let host = fixture.create_session(
            "host-session",
            "host-session",
            "lucode/alpha",
            None,
            None,
            None,
        );
        fixture
            .db
            .set_task_host(&task.id, Some(&host.id), Some(&host.branch), Some("master"))
            .unwrap();

        let candidate_run = runs
            .create_task_run(&task.id, TaskStage::Implemented, None, Some("master"), None)
            .unwrap();
        let candidate = fixture.create_session(
            "candidate-session",
            "candidate-session",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&candidate_run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let clarify_run = runs
            .create_task_run(&task.id, TaskStage::Implemented, None, Some("master"), None)
            .unwrap();
        let clarify = fixture.create_session(
            "clarify-session",
            "clarify-session",
            "lucode/alpha-clarify",
            Some(&task.id),
            Some(&clarify_run.id),
            Some(SlotKind::Clarify.as_str()),
        );

        let completed_run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();
        runs.cancel_run(&completed_run.id).unwrap();

        let cancelled = svc
            .cancel_task_cascading(&fixture.repo_path, &task.id)
            .await
            .expect("cancel task");

        assert!(cancelled.is_cancelled());
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&host.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&candidate.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&clarify.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
        assert_eq!(
            runs.get_run(&candidate_run.id).unwrap().cancelled_at.is_some(),
            true
        );
        assert_eq!(
            runs.get_run(&clarify_run.id).unwrap().cancelled_at.is_some(),
            true
        );
        assert_eq!(
            runs.get_run(&completed_run.id).unwrap().cancelled_at.is_some(),
            true
        );
    }

    #[tokio::test]
    #[serial]
    async fn cancel_task_cascading_is_idempotent_on_already_cancelled_task() {
        let fixture = CancelFixture::new();
        let svc = fixture.task_service();
        let task = fixture.create_task("alpha");

        svc.cancel_task(&task.id).unwrap();
        let cancelled = svc
            .cancel_task_cascading(&fixture.repo_path, &task.id)
            .await
            .expect("idempotent cancel");

        assert!(cancelled.is_cancelled());
    }

    #[tokio::test]
    #[serial]
    async fn cancel_task_cascading_returns_per_session_failures_when_some_sessions_block() {
        let fixture = CancelFixture::new();
        let svc = fixture.task_service();
        let runs = fixture.run_service();
        let task = fixture.create_task("alpha");

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();

        let host = fixture.create_session(
            "host-session",
            "host-session",
            "lucode/alpha",
            None,
            None,
            None,
        );
        fixture
            .db
            .set_task_host(&task.id, Some(&host.id), Some(&host.branch), Some("master"))
            .unwrap();

        let blocked_run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();
        let blocked = fixture.create_session(
            "blocked-session",
            "blocked-session",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&blocked_run.id),
            Some(SlotKind::Candidate.as_str()),
        );
        std::fs::write(blocked.worktree_path.join("dirty.txt"), "dirty").unwrap();

        let error = svc
            .cancel_task_cascading(&fixture.repo_path, &task.id)
            .await
            .expect_err("dirty session should surface as cascade failure");
        let cascade = error
            .downcast_ref::<TaskCascadeCancelError>()
            .expect("typed cascade error");

        assert_eq!(cascade.task_id, task.id);
        assert_eq!(cascade.failures.len(), 1);
        assert_eq!(cascade.failures[0].session_id, blocked.id);
        assert!(
            cascade.failures[0].reason.contains("dirty.txt")
                || cascade.failures[0].reason.contains("UncommittedChanges")
        );
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&host.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
        let blocked_session = fixture
            .db_manager()
            .get_session_by_id(&blocked.id)
            .unwrap();
        assert!(blocked_session.cancelled_at.is_none() && !blocked_session.is_spec);
        assert!(svc.get_task(&task.id).unwrap().is_cancelled());
        let blocked = runs.get_run(&blocked_run.id).unwrap();
        assert!(
            blocked.cancelled_at.is_none()
                && blocked.confirmed_at.is_none()
                && blocked.failed_at.is_none(),
            "task run for the still-active blocked session must remain Running (no terminal timestamp set) so a retry-cleanup affordance can act on it"
        );
    }

    #[tokio::test]
    #[serial]
    async fn cancel_task_cascading_partial_failure_is_recoverable_via_reopen() {
        let fixture = CancelFixture::new();
        let svc = fixture.task_service();
        let runs = fixture.run_service();
        let task = fixture.create_task("alpha");

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();

        let host = fixture.create_session(
            "host-session",
            "host-session",
            "lucode/alpha",
            None,
            None,
            None,
        );
        fixture
            .db
            .set_task_host(&task.id, Some(&host.id), Some(&host.branch), Some("master"))
            .unwrap();

        let blocked_run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();
        let blocked = fixture.create_session(
            "blocked-session",
            "blocked-session",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&blocked_run.id),
            Some(SlotKind::Candidate.as_str()),
        );
        std::fs::write(blocked.worktree_path.join("dirty.txt"), "dirty").unwrap();

        let _ = svc
            .cancel_task_cascading(&fixture.repo_path, &task.id)
            .await
            .expect_err("dirty session should surface as cascade failure");

        assert!(svc.get_task(&task.id).unwrap().is_cancelled());

        let reopened = svc
            .reopen_task_to_stage(&task.id, TaskStage::Ready)
            .expect("user can re-promote a cancelled-with-deferred-cleanup task");
        assert_eq!(reopened.stage, TaskStage::Ready);
    }

    #[tokio::test]
    #[serial]
    async fn task_run_cancel_kills_all_slot_sessions() {
        let fixture = CancelFixture::new();
        let svc = fixture.task_service();
        let runs = fixture.run_service();
        let task = fixture.create_task("alpha");

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.advance_stage(&task.id, TaskStage::Brainstormed)
            .unwrap();

        let run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();
        let first = fixture.create_session(
            "run-session-1",
            "run-session-1",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );
        let second = fixture.create_session(
            "run-session-2",
            "run-session-2",
            "lucode/alpha-run-02",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let cancelled = svc
            .cancel_task_run_cascading(&fixture.repo_path, &run.id)
            .await
            .expect("cancel run");

        assert!(cancelled.cancelled_at.is_some());
        assert!(cancelled.selected_session_id.is_none());
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&first.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
        assert_eq!(
            fixture
                .db_manager()
                .get_session_by_id(&second.id)
                .unwrap()
                .cancelled_at
                .is_some(),
            true,
            "Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis",
        );
    }

    #[tokio::test]
    #[serial]
    async fn task_run_cancel_is_idempotent() {
        let fixture = CancelFixture::new();
        let runs = fixture.run_service();
        let task = fixture.create_task("alpha");
        let run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();
        runs.cancel_run(&run.id).unwrap();

        let cancelled = fixture
            .task_service()
            .cancel_task_run_cascading(&fixture.repo_path, &run.id)
            .await
            .expect("idempotent cancel");

        assert!(cancelled.cancelled_at.is_some());
    }

    #[test]
    fn task_reopen_advances_cancelled_task_to_target_stage() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.cancel_task(&task.id).unwrap();

        let reopened = svc
            .reopen_task_to_stage(&task.id, TaskStage::Planned)
            .expect("reopen");

        assert_eq!(reopened.stage, TaskStage::Planned);
    }

    #[test]
    fn task_reopen_rejects_invalid_target_stage() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
            TaskStage::Pushed,
            TaskStage::Done,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
        }

        let err = svc
            .reopen_task_to_stage(&task.id, TaskStage::Draft)
            .expect_err("done -> draft must be rejected");
        assert!(err.to_string().contains("invalid reopen target"));
    }

    #[test]
    fn task_reopen_preserves_artifacts() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        svc.update_content(&task.id, TaskArtifactKind::Spec, "spec v1", None, None)
            .unwrap();
        svc.update_content(&task.id, TaskArtifactKind::Plan, "plan v1", None, None)
            .unwrap();
        svc.update_content(
            &task.id,
            TaskArtifactKind::Summary,
            "summary v1",
            None,
            None,
        )
        .unwrap();
        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        svc.cancel_task(&task.id).unwrap();

        let reopened = svc
            .reopen_task_to_stage(&task.id, TaskStage::Implemented)
            .expect("reopen");

        assert_eq!(reopened.current_spec.as_deref(), Some("spec v1"));
        assert_eq!(reopened.current_plan.as_deref(), Some("plan v1"));
        assert_eq!(reopened.current_summary.as_deref(), Some("summary v1"));
        assert_eq!(reopened.stage, TaskStage::Implemented);
    }

    #[test]
    fn stage_config_seeding_round_trips_via_service() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for (stage, preset) in [
            (TaskStage::Brainstormed, "preset-brainstorm"),
            (TaskStage::Planned, "preset-plan"),
            (TaskStage::Implemented, "preset-impl"),
        ] {
            svc.set_stage_config(&TaskStageConfig {
                task_id: task.id.clone(),
                stage,
                preset_id: Some(preset.to_string()),
                auto_chain: stage == TaskStage::Planned,
            })
            .unwrap();
        }

        let configs = svc.list_stage_configs(&task.id).unwrap();
        assert_eq!(configs.len(), 3);
        assert!(
            configs
                .iter()
                .any(|c| c.stage == TaskStage::Planned && c.auto_chain)
        );
    }

    #[test]
    fn require_session_task_succeeds_when_ids_match_and_task_exists() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        require_session_task(&db, Some(&task.id), &task.id).expect("ok");

        let err = require_session_task(&db, None, &task.id).unwrap_err();
        assert!(err.to_string().contains("no task_id binding"));

        let err2 = require_session_task(&db, Some("wrong"), &task.id).unwrap_err();
        assert!(err2.to_string().contains("task_id mismatch"));

        let err3 = require_session_task(&db, Some(&task.id), "nonexistent").unwrap_err();
        assert!(
            err3.to_string().contains("task_id mismatch")
                || err3.to_string().contains("task not found")
        );
    }

    #[test]
    fn update_content_errors_when_task_missing() {
        let db = db();
        let svc = TaskService::new(&db);
        let err = svc
            .update_content("nope", TaskArtifactKind::Spec, "x", None, None)
            .unwrap_err();
        assert!(err.to_string().contains("task not found"));
    }

    #[test]
    fn merge_without_pr_advances_implemented_to_done() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
        }

        svc.on_branch_merged_without_pr(&task.id).unwrap();

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.stage, TaskStage::Done);
        assert!(!reloaded.failure_flag);
    }

    #[test]
    fn merge_without_pr_is_idempotent() {
        let db = db();
        let svc = TaskService::new(&db);
        let task = svc.create_task(basic_input()).unwrap();

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
        }

        svc.on_branch_merged_without_pr(&task.id).unwrap();
        svc.on_branch_merged_without_pr(&task.id).unwrap();

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.stage, TaskStage::Done);
    }
}
