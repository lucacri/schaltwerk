use crate::{get_core_handle_for_project_path, get_project_with_handle};
use lucode::errors::SchaltError;
use lucode::services::TaskFlowError;
// v1's domains/legacy_import (importing legacy archived sessions into tasks) is
// not ported to v2. Phase 1 ships only the v1→v2 task_runs schema migration in
// infrastructure/database/migrations/v1_to_v2_task_runs.rs. The three
// `lucode_legacy_sessions_*` Tauri commands are dropped accordingly; the v2
// frontend can re-introduce them in a later phase if/when the import pathway
// is needed.
use lucode::domains::sessions::service::SessionManager;
use lucode::domains::tasks::service::{
    ClarifyRunStarted, CreateTaskInput, MergeConflictDuringConfirm, PresetShape, PresetSlot,
    ProductionMerger, ProductionProvisioner, ProjectWorkflowDefault, StageAdvanceAfterMergeFailed,
    StageRunStarted, Task, TaskArtifactKind, TaskArtifactVersion, TaskCascadeCancelError,
    TaskNotFoundError, TaskOrchestrator, TaskRun, TaskRunService, TaskService, TaskStage,
    TaskStageConfig, TaskVariant,
};
use lucode::services::{
    TaskWithBodies, enrich_runs_with_derived_status, enrich_task_runs_with_derived_status,
    enrich_tasks_with_derived_run_statuses,
};
use lucode::infrastructure::database::AppConfigMethods;
use lucode::infrastructure::database::Database;
use lucode::infrastructure::database::db_tasks::TaskMethods;
use lucode::infrastructure::events::{SchaltEvent, TasksRefreshedPayload, emit_event};
use lucode::services::Session;
use serde::Deserialize;
use std::path::Path;
use std::str::FromStr;

use crate::commands::schaltwerk_core::terminals;

fn derive_repository_name(repo_path: &Path) -> String {
    repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| repo_path.to_string_lossy().to_string())
}

fn parse_enum<T: FromStr<Err = String>>(label: &str, value: &str) -> Result<T, TaskFlowError> {
    T::from_str(value).map_err(|e| TaskFlowError::InvalidInput {
        field: label.to_string(),
        message: e,
    })
}

fn get_project_workflow_defaults_for_repo(
    db: &Database,
    repository_path: String,
) -> anyhow::Result<Vec<ProjectWorkflowDefault>> {
    db.list_project_workflow_defaults(&repository_path)
}

fn set_project_workflow_default_for_repo(
    db: &Database,
    repository_path: String,
    stage: String,
    preset_id: Option<String>,
    auto_chain: bool,
) -> anyhow::Result<Vec<ProjectWorkflowDefault>> {
    let stage = parse_enum::<TaskStage>("stage", &stage).map_err(anyhow::Error::msg)?;
    db.upsert_project_workflow_default(&ProjectWorkflowDefault {
        repository_path: repository_path.clone(),
        stage,
        preset_id,
        auto_chain,
    })?;
    db.list_project_workflow_defaults(&repository_path)
}

fn delete_project_workflow_default_for_repo(
    db: &Database,
    repository_path: String,
    stage: String,
) -> anyhow::Result<Vec<ProjectWorkflowDefault>> {
    let stage = parse_enum::<TaskStage>("stage", &stage).map_err(anyhow::Error::msg)?;
    db.delete_project_workflow_default(&repository_path, stage)?;
    db.list_project_workflow_defaults(&repository_path)
}

fn emit_task_mutation_events<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    payload: &TasksRefreshedPayload,
) {
    if let Err(err) = emit_event(app, SchaltEvent::TasksRefreshed, payload) {
        log::warn!("Failed to emit TasksRefreshed after task mutation: {err}");
    }
    if let Err(err) = emit_event(
        app,
        SchaltEvent::SessionsRefreshed,
        &serde_json::Value::Null,
    ) {
        log::warn!("Failed to emit SessionsRefreshed after task mutation: {err}");
    }
}

fn notify_task_mutation_with_db<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &Database,
    repo_path: &Path,
) {
    let mut tasks = match TaskService::new(db).list_tasks(repo_path) {
        Ok(tasks) => tasks,
        Err(err) => {
            log::warn!(
                "Failed to list tasks for TasksRefreshed payload: {err}. \
                 Skipping refresh emit to preserve current frontend state."
            );
            return;
        }
    };
    if let Err(err) = enrich_tasks_with_derived_run_statuses(&mut tasks, db) {
        log::warn!(
            "Failed to enrich tasks with derived run statuses for TasksRefreshed payload: {err}. \
             Emitting payload with status=null; the next read will reconcile."
        );
    }
    let payload = TasksRefreshedPayload {
        project_path: repo_path.to_string_lossy().to_string(),
        tasks,
    };
    emit_task_mutation_events(app, &payload);
}

async fn notify_task_mutation<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_path: Option<&str>,
) {
    let payload = match with_core_handle(project_path, |db, repo_path| {
        let mut tasks = TaskService::new(db).list_tasks(repo_path)?;
        if let Err(err) = enrich_tasks_with_derived_run_statuses(&mut tasks, db) {
            log::warn!(
                "Failed to enrich tasks with derived run statuses inside notify_task_mutation: {err}. \
                 Emitting payload with status=null; the next read will reconcile."
            );
        }
        Ok(TasksRefreshedPayload {
            project_path: repo_path.to_string_lossy().to_string(),
            tasks,
        })
    })
    .await
    {
        Ok(payload) => payload,
        Err(err) => {
            log::warn!(
                "Failed to build TasksRefreshed payload after task mutation: {err}. \
                 Skipping refresh emit to preserve current frontend state; the next \
                 successful read will reconcile."
            );
            return;
        }
    };
    emit_task_mutation_events(app, &payload);
}

async fn cancel_task_with_context<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &Database,
    repo_path: &Path,
    id: &str,
    project_path: Option<&str>,
) -> Result<Task, TaskFlowError> {
    let svc = TaskService::new(db);
    svc.get_task(id).map_err(|_| TaskFlowError::TaskNotFound {
        task_id: id.to_string(),
    })?;

    let task = svc
        .cancel_task_cascading(repo_path, id)
        .await
        .map_err(|error| {
            if let Some(cascade) = error.downcast_ref::<TaskCascadeCancelError>() {
                TaskFlowError::TaskCancelFailed {
                    task_id: cascade.task_id.clone(),
                    failures: cascade
                        .failures
                        .iter()
                        .map(|f| {
                            format!(
                                "session '{}' ({}): {}",
                                f.session_name, f.session_id, f.reason
                            )
                        })
                        .collect(),
                }
            } else {
                TaskFlowError::DatabaseError {
                    message: error.to_string(),
                }
            }
        })?;

    notify_task_mutation_with_db(app, db, repo_path);
    let _ = project_path;
    Ok(task)
}

/// Single helper for task commands that need `(Database, repo_path)` and
/// nothing else. Replaces the v1 `with_read_db` / `with_write_db` split,
/// which was meaningful only when the underlying lock provided exclusion
/// — `Arc<RwLock<SchaltwerkCore>>` did not, so the read/write distinction
/// was always cosmetic. The DB pool's WAL + `synchronous=NORMAL` is the
/// real synchronization primitive.
async fn with_core_handle<R>(
    project_path: Option<&str>,
    op: impl FnOnce(&Database, &Path) -> anyhow::Result<R>,
) -> Result<R, TaskFlowError> {
    let handle = get_core_handle_for_project_path(project_path).await?;
    op(&handle.db, &handle.repo_path).map_err(TaskFlowError::from)
}

fn preserved_content_for_session(
    manager: &SessionManager,
    session: &Session,
) -> anyhow::Result<String> {
    let (spec_content, initial_prompt) = manager.get_session_task_content(&session.name)?;

    Ok(spec_content
        .or(initial_prompt)
        .unwrap_or_else(|| session.initial_prompt.clone().unwrap_or_default()))
}

fn find_task_for_session(
    db: &Database,
    repo_path: &Path,
    session: &Session,
) -> anyhow::Result<Option<Task>> {
    let svc = TaskService::new(db);

    if let Some(task_id) = session.task_id.as_deref() {
        return match svc.get_task(task_id) {
            Ok(task) => Ok(Some(task)),
            Err(err) => {
                if err.downcast_ref::<TaskNotFoundError>().is_some() {
                    Ok(None)
                } else {
                    Err(err)
                }
            }
        };
    }

    if let Ok(task) = db.get_task_by_name(repo_path, &session.name) {
        return Ok(Some(task));
    }

    Ok(db
        .list_tasks(repo_path)?
        .into_iter()
        .find(|task| task.task_host_session_id.as_deref() == Some(session.name.as_str())))
}

fn sync_task_metadata_from_session(
    db: &Database,
    task: &Task,
    session: &Session,
) -> anyhow::Result<()> {
    if task.epic_id != session.epic_id {
        db.set_task_epic_id(&task.id, session.epic_id.as_deref())?;
    }

    if task.issue_number != session.issue_number || task.issue_url != session.issue_url {
        db.set_task_issue(&task.id, session.issue_number, session.issue_url.as_deref())?;
    }

    if task.pr_number != session.pr_number
        || task.pr_url != session.pr_url
        || task.pr_state.as_deref() != session.pr_state.as_ref().map(|state| state.as_str())
    {
        db.set_task_pr(
            &task.id,
            session.pr_number,
            session.pr_url.as_deref(),
            session.pr_state.as_ref().map(|state| state.as_str()),
        )?;
    }

    Ok(())
}

fn draft_task_from_session(
    db: &Database,
    repo_path: &Path,
    manager: &SessionManager,
    session: &Session,
    requested_name: Option<&str>,
) -> anyhow::Result<Task> {
    let repo_name = derive_repository_name(repo_path);
    let svc = TaskService::new(db);
    let preserved_content = preserved_content_for_session(manager, session)?;
    let requested_body = session
        .initial_prompt
        .clone()
        .unwrap_or_else(|| preserved_content.clone());

    if let Some(existing) = find_task_for_session(db, repo_path, session)? {
        if existing.request_body != requested_body {
            db.set_task_request_body(&existing.id, &requested_body)?;
        }

        // Phase 4 Wave F: derived getter — fetches current Spec artifact body.
        let existing_spec = existing.current_spec(db).map_err(TaskFlowError::from)?;
        if !preserved_content.is_empty()
            && existing_spec.as_deref() != Some(preserved_content.as_str())
        {
            svc.update_content(
                &existing.id,
                TaskArtifactKind::Spec,
                &preserved_content,
                None,
                None,
            )?;
        }

        if existing.task_host_session_id.as_deref() == Some(session.name.as_str()) {
            db.set_task_host(
                &existing.id,
                None,
                existing.task_branch.as_deref(),
                existing.base_branch.as_deref(),
            )?;
        }

        sync_task_metadata_from_session(db, &existing, session)?;
        svc.reopen_task(&existing.id)?;
        return svc.get_task(&existing.id);
    }

    let created = svc.create_task(CreateTaskInput {
        name: requested_name.unwrap_or(&session.name),
        display_name: session.display_name.as_deref(),
        repository_path: repo_path,
        repository_name: &repo_name,
        request_body: &requested_body,
        variant: TaskVariant::Regular,
        epic_id: session.epic_id.as_deref(),
        base_branch: Some(session.parent_branch.as_str()),
        source_kind: None,
        source_url: None,
        issue_number: session.issue_number,
        issue_url: session.issue_url.as_deref(),
        pr_number: session.pr_number,
        pr_url: session.pr_url.as_deref(),
    })?;

    if !preserved_content.is_empty() && preserved_content != requested_body {
        svc.update_content(
            &created.id,
            TaskArtifactKind::Spec,
            &preserved_content,
            None,
            None,
        )?;
    }

    svc.get_task(&created.id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn lucode_task_create(
    app: tauri::AppHandle,
    name: String,
    display_name: Option<String>,
    request_body: String,
    variant: Option<String>,
    epic_id: Option<String>,
    base_branch: Option<String>,
    source_kind: Option<String>,
    source_url: Option<String>,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let variant = match variant {
        Some(v) => parse_enum::<TaskVariant>("variant", &v)?,
        None => TaskVariant::Regular,
    };

    let task = with_core_handle(project_path.as_deref(), move |db, repo_path| {
        let repo_name = derive_repository_name(repo_path);
        let svc = TaskService::new(db);
        svc.create_task(CreateTaskInput {
            name: &name,
            display_name: display_name.as_deref(),
            repository_path: repo_path,
            repository_name: &repo_name,
            request_body: &request_body,
            variant,
            epic_id: epic_id.as_deref(),
            base_branch: base_branch.as_deref(),
            source_kind: source_kind.as_deref(),
            source_url: source_url.as_deref(),
            issue_number,
            issue_url: issue_url.as_deref(),
            pr_number,
            pr_url: pr_url.as_deref(),
        })
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_list(project_path: Option<String>) -> Result<Vec<Task>, TaskFlowError> {
    with_core_handle(project_path.as_deref(), |db, repo_path| {
        let mut tasks = TaskService::new(db).list_tasks(repo_path)?;
        // Phase 7 Wave A.1: every embedded TaskRun on the wire carries
        // `derived_status` populated via compute_run_status. Body fields
        // are deliberately omitted from the list shape (see plan §0.3).
        enrich_tasks_with_derived_run_statuses(&mut tasks, db)?;
        Ok(tasks)
    })
    .await
}

// lucode_legacy_sessions_* commands removed — see import block comment above.

#[tauri::command]
pub async fn lucode_project_workflow_defaults_get(
    repository_path: String,
    project_path: Option<String>,
) -> Result<Vec<ProjectWorkflowDefault>, TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        get_project_workflow_defaults_for_repo(db, repository_path)
    })
    .await
}

#[tauri::command]
pub async fn lucode_project_workflow_defaults_set(
    app: tauri::AppHandle,
    repository_path: String,
    stage: String,
    preset_id: Option<String>,
    auto_chain: bool,
    project_path: Option<String>,
) -> Result<Vec<ProjectWorkflowDefault>, TaskFlowError> {
    let defaults = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        set_project_workflow_default_for_repo(db, repository_path, stage, preset_id, auto_chain)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(defaults)
}

#[tauri::command]
pub async fn lucode_project_workflow_defaults_delete(
    app: tauri::AppHandle,
    repository_path: String,
    stage: String,
    project_path: Option<String>,
) -> Result<Vec<ProjectWorkflowDefault>, TaskFlowError> {
    let defaults = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        delete_project_workflow_default_for_repo(db, repository_path, stage)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(defaults)
}

#[tauri::command]
pub async fn lucode_task_get(
    id: String,
    project_path: Option<String>,
) -> Result<TaskWithBodies, TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let mut task = TaskService::new(db)
            .get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        // Phase 7 Wave A.1: get-by-id is the body-bearing surface. Enrich
        // the embedded runs with `derived_status` first, then wrap with the
        // three current artifact bodies via the derived getters on Task.
        enrich_task_runs_with_derived_status(&mut task, db)?;
        TaskWithBodies::from_task(task, db)
    })
    .await
}

#[tauri::command]
pub async fn lucode_task_update_content(
    app: tauri::AppHandle,
    id: String,
    artifact_kind: String,
    content: String,
    produced_by_session_id: Option<String>,
    produced_by_run_id: Option<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let kind = parse_enum::<TaskArtifactKind>("artifact_kind", &artifact_kind)?;

    let task = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        svc.update_content(
            &id,
            kind,
            &content,
            produced_by_session_id.as_deref(),
            produced_by_run_id.as_deref(),
        )?;
        svc.get_task(&id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_advance_stage(
    app: tauri::AppHandle,
    id: String,
    stage: String,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let stage = parse_enum::<TaskStage>("stage", &stage)?;

    let task = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        svc.advance_stage(&id, stage)?;
        svc.get_task(&id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_attach_issue(
    app: tauri::AppHandle,
    id: String,
    issue_number: Option<i64>,
    issue_url: Option<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let task = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        svc.attach_issue(&id, issue_number, issue_url.as_deref())?;
        svc.get_task(&id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_attach_pr(
    app: tauri::AppHandle,
    id: String,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    pr_state: Option<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let task = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        svc.attach_pr(&id, pr_number, pr_url.as_deref(), pr_state.as_deref())?;
        svc.get_task(&id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_delete(
    app: tauri::AppHandle,
    id: String,
    project_path: Option<String>,
) -> Result<(), TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&id)
            .map_err(|_| anyhow::anyhow!("task '{id}' not found"))?;
        svc.delete_task(&id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(())
}

#[tauri::command]
pub async fn lucode_task_cancel(
    app: tauri::AppHandle,
    id: String,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref())
        .await
        .map_err(|message| SchaltError::DatabaseError { message })?;

    let task_lock = project.task_locks.lock_for(&id);
    let _guard = task_lock.lock().await;

    cancel_task_with_context(
        &app,
        &handle.db,
        &handle.repo_path,
        &id,
        project_path.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn lucode_task_capture_session(
    app: tauri::AppHandle,
    session_name: String,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let handle = get_core_handle_for_project_path(project_path.as_deref()).await?;
    let manager = handle.session_manager();
    let session = manager
        .get_session(&session_name)
        .map_err(|e| TaskFlowError::DatabaseError {
            message: format!("failed to load session '{session_name}': {e}"),
        })?;

    if session.is_spec || session.cancelled_at.is_some() {
        return Err(TaskFlowError::InvalidInput {
            field: "session_name".to_string(),
            message: format!("session '{session_name}' is not running"),
        });
    }

    let task = draft_task_from_session(&handle.db, &handle.repo_path, &manager, &session, None)
        .map_err(TaskFlowError::from)?;

    terminals::close_session_terminals_if_any(&session_name).await;
    manager
        .fast_cancel_session(&session_name)
        .await
        .map_err(|e| TaskFlowError::DatabaseError {
            message: format!("failed to cancel session '{session_name}': {e}"),
        })?;
    if let Err(err) = manager.cleanup_orphaned_worktrees() {
        log::error!(
            "lucode_task_capture_session: failed to clean orphaned worktrees after capturing session '{session_name}' (task id={task_id}, name='{task_name}'): {err}. Task was captured successfully but stale worktrees may remain in .lucode/worktrees/.",
            task_id = task.id,
            task_name = task.name
        );
    }

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_capture_version_group(
    app: tauri::AppHandle,
    base_name: String,
    session_names: Vec<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let handle = get_core_handle_for_project_path(project_path.as_deref()).await?;
    let manager = handle.session_manager();

    let mut running_sessions = Vec::new();
    for session_name in &session_names {
        let session = match manager.get_session(session_name) {
            Ok(session) if !session.is_spec && session.cancelled_at.is_none() => session,
            Ok(_) => continue,
            Err(err) => {
                log::warn!(
                    "Skipping missing session '{session_name}' while capturing version group '{base_name}': {err}"
                );
                continue;
            }
        };
        running_sessions.push(session);
    }

    let anchor = running_sessions
        .first()
        .cloned()
        .ok_or_else(|| format!("no running sessions found for version group '{base_name}'"))?;

    let task = draft_task_from_session(
        &handle.db,
        &handle.repo_path,
        &manager,
        &anchor,
        Some(&base_name),
    )
    .map_err(TaskFlowError::from)?;

    for session in &running_sessions {
        terminals::close_session_terminals_if_any(&session.name).await;
        manager
            .fast_cancel_session(&session.name)
            .await
            .map_err(|e| format!("failed to cancel session '{}': {e}", session.name))?;
    }
    if let Err(err) = manager.cleanup_orphaned_worktrees() {
        log::error!(
            "lucode_task_capture_version_group: failed to clean orphaned worktrees after capturing version group '{base_name}' (task id={task_id}, name='{task_name}'): {err}. Task was captured successfully but stale worktrees may remain in .lucode/worktrees/.",
            task_id = task.id,
            task_name = task.name
        );
    }

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_set_stage_config(
    app: tauri::AppHandle,
    task_id: String,
    stage: String,
    preset_id: Option<String>,
    auto_chain: bool,
    project_path: Option<String>,
) -> Result<Vec<TaskStageConfig>, TaskFlowError> {
    let stage = parse_enum::<TaskStage>("stage", &stage)?;

    let configs = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&task_id)
            .map_err(|_| anyhow::anyhow!("task '{task_id}' not found"))?;
        svc.set_stage_config(&TaskStageConfig {
            task_id: task_id.clone(),
            stage,
            preset_id,
            auto_chain,
        })?;
        svc.list_stage_configs(&task_id)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(configs)
}

#[tauri::command]
pub async fn lucode_task_list_stage_configs(
    task_id: String,
    project_path: Option<String>,
) -> Result<Vec<TaskStageConfig>, TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&task_id)
            .map_err(|_| anyhow::anyhow!("task '{task_id}' not found"))?;
        svc.list_stage_configs(&task_id)
    })
    .await
}

#[tauri::command]
pub async fn lucode_task_run_list(
    task_id: String,
    project_path: Option<String>,
) -> Result<Vec<TaskRun>, TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let svc = TaskService::new(db);
        svc.get_task(&task_id)
            .map_err(|_| anyhow::anyhow!("task '{task_id}' not found"))?;
        let mut runs = TaskRunService::new(db).list_runs_for_task(&task_id)?;
        // Phase 7 Wave A.1: every wire run carries `derived_status` via
        // compute_run_status over the bound session-fact rows.
        enrich_runs_with_derived_status(&mut runs, db)?;
        Ok(runs)
    })
    .await
}

#[tauri::command]
pub async fn lucode_task_run_get(
    run_id: String,
    project_path: Option<String>,
) -> Result<TaskRun, TaskFlowError> {
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        let mut run = TaskRunService::new(db)
            .get_run(&run_id)
            .map_err(|_| anyhow::anyhow!("task run '{run_id}' not found"))?;
        let mut single = std::slice::from_mut(&mut run);
        enrich_runs_with_derived_status(&mut single, db)?;
        Ok(run)
    })
    .await
}

#[tauri::command]
pub async fn lucode_task_artifact_history(
    task_id: String,
    artifact_kind: String,
    project_path: Option<String>,
) -> Result<Vec<TaskArtifactVersion>, TaskFlowError> {
    let kind = parse_enum::<TaskArtifactKind>("artifact_kind", &artifact_kind)?;
    with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        TaskService::new(db).artifact_history(&task_id, kind)
    })
    .await
}

#[tauri::command]
pub async fn lucode_task_run_cancel(
    app: tauri::AppHandle,
    run_id: String,
    project_path: Option<String>,
) -> Result<TaskRun, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;

    let task_id = TaskRunService::new(&handle.db)
        .get_run(&run_id)
        .map_err(|err| format!("task run '{run_id}' not found: {err}"))?
        .task_id
        .clone();

    let task_lock = project.task_locks.lock_for(&task_id);
    let _guard = task_lock.lock().await;

    let run = TaskService::new(&handle.db)
        .cancel_task_run_cascading(&handle.repo_path, &run_id)
        .await
        .map_err(TaskFlowError::from)?;
    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(run)
}

#[tauri::command]
pub async fn lucode_task_reopen(
    app: tauri::AppHandle,
    task_id: String,
    target_stage: String,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let target_stage = parse_enum::<TaskStage>("target_stage", &target_stage)?;
    let task = with_core_handle(project_path.as_deref(), move |db, _repo_path| {
        TaskService::new(db).reopen_task_to_stage(&task_id, target_stage)
    })
    .await?;

    notify_task_mutation(&app, project_path.as_deref()).await;
    Ok(task)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetSlotPayload {
    pub slot_key: String,
    pub agent_type: String,
}

impl From<PresetSlotPayload> for PresetSlot {
    fn from(value: PresetSlotPayload) -> Self {
        PresetSlot {
            slot_key: value.slot_key,
            agent_type: value.agent_type,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PresetShapePayload {
    pub candidates: Vec<PresetSlotPayload>,
    #[serde(default)]
    pub synthesize: bool,
    #[serde(default)]
    pub select: bool,
    #[serde(default)]
    pub consolidator: Option<PresetSlotPayload>,
    #[serde(default)]
    pub evaluator: Option<PresetSlotPayload>,
}

impl From<PresetShapePayload> for PresetShape {
    fn from(value: PresetShapePayload) -> Self {
        PresetShape {
            candidates: value.candidates.into_iter().map(PresetSlot::from).collect(),
            synthesize: value.synthesize,
            select: value.select,
            consolidator: value.consolidator.map(PresetSlot::from),
            evaluator: value.evaluator.map(PresetSlot::from),
        }
    }
}

pub const TASK_BRANCH_PREFIX: &str = "lucode";

/// Build the production wiring directly from a `CoreHandle`. The
/// per-task lock acquired by the caller (Wave D of Phase 2) is what
/// guards same-task ordering; the v1 bundle/snapshot dance that used to
/// be needed to escape the global write lock is gone.
fn with_production_orchestrator_handle<R>(
    handle: &lucode::project_manager::CoreHandle,
    op: impl FnOnce(
        &TaskOrchestrator<'_, ProductionProvisioner<'_>, ProductionMerger<'_>>,
    ) -> anyhow::Result<R>,
) -> Result<R, TaskFlowError> {
    let manager = handle.session_manager();
    let merge_service = handle.merge_service();
    let provisioner = ProductionProvisioner::new(&manager, &handle.db);
    let merger = ProductionMerger::new(&merge_service, &manager);
    let orch = TaskOrchestrator::new(&handle.db, &provisioner, &merger, TASK_BRANCH_PREFIX);
    op(&orch).map_err(TaskFlowError::from)
}

/// Wave D successor to `confirm_stage_against_snapshot`. Drives the async
/// confirm-stage path against the lock-free `CoreHandle` directly.
async fn confirm_stage_against_handle(
    handle: &lucode::project_manager::CoreHandle,
    run_id: &str,
    winning_session_id: &str,
    winning_branch: &str,
    selection_mode: &str,
) -> Result<Task, TaskFlowError> {
    let manager = handle.session_manager();
    let merge_service = handle.merge_service();
    let provisioner = ProductionProvisioner::new(&manager, &handle.db);
    let merger = ProductionMerger::new(&merge_service, &manager);
    let orch = TaskOrchestrator::new(&handle.db, &provisioner, &merger, TASK_BRANCH_PREFIX);

    match orch
        .confirm_stage(run_id, winning_session_id, winning_branch, selection_mode)
        .await
    {
        Ok(task) => Ok(task),
        Err(error) => Err(map_confirm_stage_error(error)),
    }
}

#[tauri::command]
pub async fn lucode_task_promote_to_ready(
    app: tauri::AppHandle,
    id: String,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;
    let task_lock = project.task_locks.lock_for(&id);
    let _guard = task_lock.lock().await;
    let task = with_production_orchestrator_handle(&handle, |orch| orch.promote_to_ready(&id))?;
    notify_task_mutation_with_db(&app, &handle.db, &handle.repo_path);
    Ok(task)
}

#[tauri::command]
pub async fn lucode_task_start_stage_run(
    app: tauri::AppHandle,
    task_id: String,
    stage: String,
    preset_id: Option<String>,
    shape: PresetShapePayload,
    project_path: Option<String>,
) -> Result<StageRunStarted, TaskFlowError> {
    let stage = parse_enum::<TaskStage>("stage", &stage)?;
    let shape: PresetShape = shape.into();

    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;
    let task_lock = project.task_locks.lock_for(&task_id);
    let _guard = task_lock.lock().await;

    let started = with_production_orchestrator_handle(&handle, |orch| {
        orch.start_stage_run(&task_id, stage, preset_id.as_deref(), &shape)
    })?;

    notify_task_mutation_with_db(&app, &handle.db, &handle.repo_path);
    Ok(started)
}

/// Spawn (or reuse) the task-bound clarify agent for this task.
///
/// The agent type defaults to the project's consolidation-default agent
/// (re-using `consolidation_default_agent_type`). We may split this into a
/// dedicated `clarify_default_agent_type` later if the two roles need
/// different defaults; treat the current shared config as a stepping stone,
/// not a long-term contract.
///
/// Idempotency is delegated to `TaskOrchestrator::start_clarify_run`: a
/// second call while the previous clarify run's status is queued, running,
/// or awaiting_selection returns the existing session id instead of
/// spawning a duplicate worktree.
#[tauri::command]
pub async fn lucode_task_start_clarify_run(
    app: tauri::AppHandle,
    task_id: String,
    project_path: Option<String>,
) -> Result<ClarifyRunStarted, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;
    let task_lock = project.task_locks.lock_for(&task_id);
    let _guard = task_lock.lock().await;

    let agent_type = handle
        .db
        .get_consolidation_default_favorite()
        .map(|f| f.agent_type)
        .map_err(TaskFlowError::from)?;
    let started = with_production_orchestrator_handle(&handle, |orch| {
        orch.start_clarify_run(&task_id, agent_type.as_deref())
    })?;

    notify_task_mutation_with_db(&app, &handle.db, &handle.repo_path);
    Ok(started)
}

/// Translate the `anyhow::Error` returned by `TaskOrchestrator::confirm_stage`
/// into the structured `SchaltError` variant the frontend matches on. Typed
/// sentinels (`MergeConflictDuringConfirm`, `StageAdvanceAfterMergeFailed`)
/// take precedence so the UI never has to substring-match localized text;
/// anything else degrades to `DatabaseError` carrying the raw display.
fn map_confirm_stage_error(error: anyhow::Error) -> TaskFlowError {
    // Phase 4 Wave E.4: returns TaskFlowError directly; the
    // StageAdvanceFailedAfterMerge variant lives natively here now.
    if let Some(conflict) = error.downcast_ref::<MergeConflictDuringConfirm>() {
        return TaskFlowError::Schalt(SchaltError::MergeConflict {
            files: conflict.files.clone(),
            message: conflict.message.clone(),
        });
    }
    if let Some(advance) = error.downcast_ref::<StageAdvanceAfterMergeFailed>() {
        return TaskFlowError::StageAdvanceFailedAfterMerge {
            task_id: "<unknown>".to_string(),
            message: advance.message.clone(),
        };
    }
    TaskFlowError::DatabaseError {
        message: error.to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunDonePayload {
    pub run_id: String,
    pub slot_session_id: String,
    /// One of "ok" | "failed". Validated in the helper; unknown strings
    /// surface as `TaskFlowError::InvalidInput { field: "status", … }`.
    pub status: String,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Phase 5: backing logic for [`lucode_task_run_done`]. Extracted so unit
/// tests can drive the validation + dispatch without going through
/// `get_project_with_handle` (which needs a tauri Runtime + project
/// manager). Mirrors the `cancel_task_with_context` shape used by
/// `lucode_task_cancel`.
pub(crate) async fn task_run_done_with_context<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    db: &Database,
    repo_path: &Path,
    payload: TaskRunDonePayload,
) -> Result<TaskRun, TaskFlowError> {
    use lucode::services::{SessionFactsRecorder, SessionMethods};

    let run_svc = TaskRunService::new(db);
    let run = run_svc.get_run(&payload.run_id).map_err(|err| {
        TaskFlowError::InvalidInput {
            field: "run_id".into(),
            message: format!("task run '{}' not found: {err}", payload.run_id),
        }
    })?;

    let lineage = db
        .get_session_task_lineage(&payload.slot_session_id)
        .map_err(|e| TaskFlowError::DatabaseError {
            message: format!(
                "lineage lookup for session '{}' failed: {e}",
                payload.slot_session_id
            ),
        })?;
    if lineage.task_run_id.as_deref() != Some(run.id.as_str()) {
        return Err(TaskFlowError::InvalidInput {
            field: "slot_session_id".into(),
            message: format!(
                "session '{}' is bound to run {:?}, not run '{}'",
                payload.slot_session_id, lineage.task_run_id, run.id,
            ),
        });
    }

    if let Some(art_id) = payload.artifact_id.as_deref() {
        log::info!(
            "lucode_task_run_done: agent reported artifact '{}' for run '{}' (Phase 5 logs only; persistence is future work)",
            art_id,
            run.id,
        );
    }

    let updated = match payload.status.as_str() {
        "ok" => {
            // Strict superset of the OSC idle heuristic: write first_idle_at
            // on the slot session. compute_run_status Case 5 trips
            // AwaitingSelection once all bound sessions have first_idle_at
            // set. Confirmation stays a separate human action.
            SessionFactsRecorder::new(db)
                .record_first_idle(&payload.slot_session_id, chrono::Utc::now())
                .map_err(|e| TaskFlowError::DatabaseError {
                    message: format!(
                        "record_first_idle for session '{}' failed: {e}",
                        payload.slot_session_id
                    ),
                })?;
            run_svc.get_run(&run.id).map_err(TaskFlowError::from)?
        }
        "failed" => {
            // Authoritative source for agent self-reported failure.
            // Does NOT touch session.exit_code: an agent that called this
            // tool didn't exit non-zero. Setting exit_code would be a lie
            // that produces false positives for any future query against
            // `WHERE exit_code IS NOT NULL` looking for process crashes.
            let reason = payload
                .error
                .as_deref()
                .unwrap_or("agent reported failure");
            run_svc
                .report_failure(&run.id, reason)
                .map_err(TaskFlowError::from)?
        }
        other => {
            return Err(TaskFlowError::InvalidInput {
                field: "status".into(),
                message: format!("unknown status '{other}'; expected 'ok' or 'failed'"),
            });
        }
    };

    notify_task_mutation_with_db(app, db, repo_path);
    Ok(updated)
}

#[tauri::command]
pub async fn lucode_task_run_done(
    app: tauri::AppHandle,
    payload: TaskRunDonePayload,
    project_path: Option<String>,
) -> Result<TaskRun, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;

    // Resolve run → task_id so the per-task lock guards run-done against any
    // concurrent same-task command.
    let task_id = TaskRunService::new(&handle.db)
        .get_run(&payload.run_id)
        .map_err(|err| TaskFlowError::InvalidInput {
            field: "run_id".into(),
            message: format!("task run '{}' not found: {err}", payload.run_id),
        })?
        .task_id
        .clone();

    let task_lock = project.task_locks.lock_for(&task_id);
    let _guard = task_lock.lock().await;

    task_run_done_with_context(&app, &handle.db, &handle.repo_path, payload).await
}

#[tauri::command]
pub async fn lucode_task_confirm_stage(
    app: tauri::AppHandle,
    run_id: String,
    winning_session_id: String,
    winning_branch: String,
    selection_mode: Option<String>,
    project_path: Option<String>,
) -> Result<Task, TaskFlowError> {
    let mode = selection_mode.unwrap_or_else(|| "manual".to_string());

    let (project, handle) = get_project_with_handle(project_path.as_deref())
        .await
        .map_err(|message| SchaltError::DatabaseError { message })?;

    // Resolve run → task_id so the per-task lock guards confirm-stage
    // against any concurrent same-task command (start_stage_run,
    // run_cancel, cancel). The lookup is one indexed read; if it fails
    // the run does not exist and we surface the v2 NotFound error.
    let task_id = TaskRunService::new(&handle.db)
        .get_run(&run_id)
        .map_err(|err| SchaltError::DatabaseError {
            message: format!("task run '{run_id}' not found: {err}"),
        })?
        .task_id
        .clone();

    let task_lock = project.task_locks.lock_for(&task_id);
    let _guard = task_lock.lock().await;

    let task = confirm_stage_against_handle(
        &handle,
        &run_id,
        &winning_session_id,
        &winning_branch,
        &mode,
    )
    .await?;

    notify_task_mutation_with_db(&app, &handle.db, &handle.repo_path);
    Ok(task)
}

#[cfg(test)]
mod payload_tests {
    use super::*;

    #[test]
    fn preset_slot_payload_deserializes_camel_case_from_frontend() {
        let json = r#"{"slotKey":"claude-0","agentType":"claude"}"#;
        let payload: PresetSlotPayload = serde_json::from_str(json).expect("camelCase deserialize");
        assert_eq!(payload.slot_key, "claude-0");
        assert_eq!(payload.agent_type, "claude");
    }

    #[test]
    fn preset_shape_payload_round_trips_with_camel_case_slots() {
        let json = r#"{
            "candidates":[{"slotKey":"claude-0","agentType":"claude"},{"slotKey":"codex-1","agentType":"codex"}],
            "synthesize":true,
            "select":false,
            "consolidator":null,
            "evaluator":{"slotKey":"opencode-2","agentType":"opencode"}
        }"#;
        let payload: PresetShapePayload =
            serde_json::from_str(json).expect("camelCase shape deserialize");
        assert_eq!(payload.candidates.len(), 2);
        assert_eq!(payload.candidates[0].slot_key, "claude-0");
        assert_eq!(payload.candidates[1].agent_type, "codex");
        assert!(payload.synthesize);
        assert!(!payload.select);
        assert!(payload.consolidator.is_none());
        let evaluator = payload.evaluator.expect("evaluator parsed");
        assert_eq!(evaluator.slot_key, "opencode-2");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lucode::errors::SchaltError;
    use async_trait::async_trait;
    use lucode::domains::git::service as git;
    use lucode::domains::tasks::service::{
        BranchMerger, ClarifyRunStarted, CreateTaskInput, ExpandedRunSlot, ProjectWorkflowDefault,
        ProvisionedSession, SessionProvisioner, SlotKind, TaskRun, TaskService,
    };
    use lucode::infrastructure::database::TaskRunMethods;
    use lucode::services::{Session, SessionMethods};
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{Arc, Mutex};
    use tauri::Listener;
    use tempfile::TempDir;

    struct TestDb {
        db: Database,
        _tmp: TempDir,
    }

    impl std::ops::Deref for TestDb {
        type Target = Database;
        fn deref(&self) -> &Database {
            &self.db
        }
    }

    fn mem_db() -> TestDb {
        let tmp = TempDir::new().expect("tempdir");
        let db_path = tmp.path().join("sessions.db");
        let db = Database::new(Some(db_path)).expect("new db");
        TestDb { db, _tmp: tmp }
    }

    // The v1 regression test
    // `production_orchestrator_bundle_releases_global_write_guard_before_returning`
    // pinned a contract that no longer exists: the
    // `ProductionOrchestratorBundle::acquire → snapshot_from_core → drop guard`
    // dance is gone. Same-task ordering is now provided by `TaskLockManager`
    // (per-task `Arc<Mutex<()>>`); cross-task concurrency is the new contract,
    // pinned by `tests/e2e_per_task_concurrency.rs` in Wave H.
    //
    // Per `feedback_regression_test_per_fix.md`: a test that pins a removed
    // invariant decays into noise, so we delete it here rather than rewrite
    // it against an invariant the test wasn't designed to express.

    /// Two-way binding for the per-task lock contract introduced in Wave D:
    /// concurrent operations on the same task id wait, while concurrent
    /// operations on different task ids do not. Drives `Project::task_locks`
    /// directly (the same `TaskLockManager` the lifecycle commands use)
    /// so that an accidental regression to a global mutex would surface
    /// here without needing a Tauri-driven integration harness.
    #[tokio::test]
    async fn project_task_locks_serialize_same_id_only() {
        use lucode::infrastructure::task_lock_manager::TaskLockManager;

        let mgr = TaskLockManager::new();
        let lock_a = mgr.lock_for("task-a");
        let _guard_a = lock_a.lock().await;

        let same = mgr.lock_for("task-a");
        assert!(
            same.try_lock().is_err(),
            "second acquire on task-a must fail try_lock while the first \
             guard is held; if try_lock succeeds, same-task ordering for \
             promote_to_ready/start_stage_run/start_clarify_run/confirm_stage/\
             run_cancel/cancel is broken"
        );

        let other = mgr.lock_for("task-b");
        let guard_other = other
            .try_lock()
            .expect("unrelated task lock must be free while task-a is held");
        drop(guard_other);
    }

    struct CancelCommandFixture {
        _tmp: TempDir,
        repo_path: PathBuf,
        db: Database,
    }

    impl CancelCommandFixture {
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

        fn create_task(&self, name: &str) -> Task {
            TaskService::new(&self.db)
                .create_task(CreateTaskInput {
                    name,
                    display_name: None,
                    repository_path: &self.repo_path,
                    repository_name: "repo",
                    request_body: "please do the thing",
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
                .expect("task")
        }

        fn create_session(
            &self,
            session_id: &str,
            name: &str,
            branch: &str,
            task_id: Option<&str>,
        ) -> Session {
            let worktree_path = self.repo_path.join(".lucode/worktrees").join(session_id);
            git::create_worktree_from_base(&self.repo_path, branch, &worktree_path, "master")
                .expect("worktree");
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
                worktree_path,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
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
                run_role: None,
                slot_key: None,
                exited_at: None,
                exit_code: None,
                first_idle_at: None,
                is_spec: false,
                cancelled_at: None,
            };
            self.db.create_session(&session).expect("session");
            self.db
                .set_session_task_lineage(&session.id, task_id, None, None, None, None)
                .expect("lineage");
            session
        }

        fn create_run_session(
            &self,
            session_id: &str,
            name: &str,
            branch: &str,
            task_id: Option<&str>,
            task_run_id: Option<&str>,
            run_role: Option<&str>,
        ) -> Session {
            let worktree_path = self.repo_path.join(".lucode/worktrees").join(session_id);
            git::create_worktree_from_base(&self.repo_path, branch, &worktree_path, "master")
                .expect("worktree");
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
                worktree_path,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
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
            self.db.create_session(&session).expect("session");
            self.db
                .set_session_task_lineage(
                    &session.id,
                    task_id,
                    task_run_id,
                    None,
                    run_role,
                    None,
                )
                .expect("lineage");
            session
        }
    }

    fn seed_task(db: &Database, name: &str) -> Task {
        let repo = PathBuf::from("/repo");
        let svc = TaskService::new(db);
        svc.create_task(CreateTaskInput {
            name,
            display_name: None,
            repository_path: &repo,
            repository_name: "repo",
            request_body: "please do the thing",
            variant: TaskVariant::Regular,
            epic_id: None,
            base_branch: Some("main"),
            source_kind: None,
            source_url: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
        })
        .expect("seed task")
    }

    #[test]
    fn derive_repository_name_uses_final_segment() {
        assert_eq!(derive_repository_name(Path::new("/repo")), "repo");
        assert_eq!(
            derive_repository_name(Path::new("/a/b/c/my-project")),
            "my-project"
        );
    }

    #[test]
    fn parse_enum_surfaces_label_on_failure() {
        let err = parse_enum::<TaskStage>("stage", "nonsense").unwrap_err();
        // Phase 4 Wave E.2: parse_enum now returns
        // `TaskFlowError::InvalidInput { field, message }` which displays
        // the field label and the underlying parse error verbatim.
        match &err {
            TaskFlowError::InvalidInput { field, message } => {
                assert_eq!(field, "stage");
                assert!(
                    message.contains("Invalid task stage"),
                    "unexpected message: {message}"
                );
            }
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn task_create_persists_with_draft_stage() {
        let testdb = mem_db();
        let db = &*testdb;
        let repo = PathBuf::from("/repo");
        let svc = TaskService::new(db);
        let repo_name = derive_repository_name(&repo);

        let task = svc
            .create_task(CreateTaskInput {
                name: "alpha",
                display_name: Some("Alpha"),
                repository_path: &repo,
                repository_name: &repo_name,
                request_body: "body",
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: Some("main"),
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("create");

        assert_eq!(task.stage, TaskStage::Draft);
        assert_eq!(task.name, "alpha");
        assert_eq!(task.repository_name, "repo");

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.id, task.id);
        assert_eq!(reloaded.stage, TaskStage::Draft);
    }

    #[test]
    fn task_update_content_mirrors_into_current_spec() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "mirror");
        let svc = TaskService::new(db);

        let kind = parse_enum::<TaskArtifactKind>("artifact_kind", "spec").unwrap();
        svc.update_content(&task.id, kind, "spec text v1", None, None)
            .expect("update");

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.current_spec(db).unwrap().as_deref(), Some("spec text v1"));
        assert!(reloaded.current_plan(db).unwrap().is_none());
        assert!(reloaded.current_summary(db).unwrap().is_none());
    }

    #[test]
    fn task_advance_stage_rejects_unknown_stage_string() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "advance");
        let svc = TaskService::new(db);

        let err = parse_enum::<TaskStage>("stage", "bogus").unwrap_err();
        assert!(matches!(err, TaskFlowError::InvalidInput { ref field, .. } if field == "stage"));

        for s in ["ready", "brainstormed", "planned"] {
            let parsed = parse_enum::<TaskStage>("stage", s).unwrap();
            svc.advance_stage(&task.id, parsed).expect("advance");
        }
        assert_eq!(svc.get_task(&task.id).unwrap().stage, TaskStage::Planned);
    }

    #[test]
    fn task_attach_pr_round_trips_pr_state() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "pr");
        let svc = TaskService::new(db);

        svc.attach_pr(&task.id, Some(42), Some("https://pr/42"), Some("open"))
            .expect("attach_pr");

        let reloaded = svc.get_task(&task.id).unwrap();
        assert_eq!(reloaded.pr_number, Some(42));
        assert_eq!(reloaded.pr_url.as_deref(), Some("https://pr/42"));
        assert_eq!(reloaded.pr_state.as_deref(), Some("open"));

        svc.attach_pr(&task.id, Some(42), Some("https://pr/42"), Some("merged"))
            .unwrap();
        assert_eq!(
            svc.get_task(&task.id).unwrap().pr_state.as_deref(),
            Some("merged")
        );
    }

    #[test]
    fn task_run_get_reports_missing_run_with_id() {
        let testdb = mem_db();
        let db = &*testdb;
        let svc = TaskRunService::new(db);
        let err = svc.get_run("nope").unwrap_err().to_string();
        assert!(err.to_string().contains("task run not found"));
    }

    fn make_session_with_task_id(task_id: Option<&str>) -> Session {
        Session {
            id: "session-id".to_string(),
            name: "session-name".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".to_string(),
            branch: "feature".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: PathBuf::from("/tmp/wt"),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            last_activity: None,
            initial_prompt: Some("the request".to_string()),
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
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
            is_spec: false,
            cancelled_at: None,
        }
    }

    #[test]
    fn find_task_for_session_returns_none_when_task_id_points_to_missing_task() {
        let testdb = mem_db();
        let db = &*testdb;
        let repo = PathBuf::from("/repo");
        let session = make_session_with_task_id(Some("does-not-exist"));

        let result = find_task_for_session(db, &repo, &session).expect("typed not-found maps to Ok");
        assert!(
            result.is_none(),
            "missing task_id must yield Ok(None), not a duplicate-creating error swallow"
        );
    }

    #[test]
    fn find_task_for_session_propagates_non_not_found_db_errors() {
        let testdb = mem_db();
        let db = &*testdb;
        let repo = PathBuf::from("/repo");
        let session = make_session_with_task_id(Some("any-id"));

        {
            let conn = db.get_conn().expect("conn");
            conn.execute("DROP TABLE tasks", [])
                .expect("drop tasks table");
        }

        let err = find_task_for_session(db, &repo, &session)
            .expect_err("DB errors must propagate so callers do not create duplicate tasks");
        assert!(
            err.downcast_ref::<TaskNotFoundError>().is_none(),
            "real DB error must not be conflated with TaskNotFoundError"
        );
    }

    #[test]
    fn preserved_content_for_session_propagates_db_error() {
        use lucode::domains::sessions::service::SessionManager as TestSessionManager;

        let tmp = TempDir::new().expect("tempdir");
        let repo_path = tmp.path().join("repo");
        std::fs::create_dir_all(&repo_path).expect("repo dir");
        let db = Database::new(Some(tmp.path().join("sessions.db"))).expect("db");

        {
            let conn = db.get_conn().expect("conn");
            conn.execute("DROP TABLE sessions", [])
                .expect("drop sessions table");
        }

        let manager = TestSessionManager::new(db, repo_path);
        let session = make_session_with_task_id(None);

        let result = preserved_content_for_session(&manager, &session);
        assert!(
            result.is_err(),
            "DB errors must surface so capture flow aborts before destroying source session"
        );
    }

    struct FakeProvisioner<'a> {
        db: &'a Database,
        next_id: RefCell<u64>,
        clarify_calls: RefCell<Vec<ClarifyCall>>,
    }

    #[derive(Debug, Clone)]
    struct ClarifyCall {
        task_id: String,
        run_id: String,
        agent_type: Option<String>,
        branch: String,
        base_branch: String,
    }

    impl<'a> FakeProvisioner<'a> {
        fn new(db: &'a Database) -> Self {
            Self {
                db,
                next_id: RefCell::new(0),
                clarify_calls: RefCell::new(Vec::new()),
            }
        }

        fn mint(&self, kind: &str) -> String {
            let mut n = self.next_id.borrow_mut();
            *n += 1;
            format!("fake-{kind}-{n:04}")
        }

        fn insert_session_stub(
            &self,
            session_id: &str,
            name: &str,
            branch: &str,
            parent_branch: &str,
        ) -> anyhow::Result<()> {
            let conn = self.db.get_conn()?;
            // Phase 4 Wave D.3: legacy `status` column removed.
            conn.execute(
                "INSERT INTO sessions (
                    id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    created_at, updated_at
                ) VALUES (?1, ?2, '/repo', 'repo', ?3, ?4, ?5, 0, 0)",
                rusqlite::params![
                    session_id,
                    name,
                    branch,
                    parent_branch,
                    format!("/tmp/{session_id}"),
                ],
            )?;
            Ok(())
        }
    }

    impl<'a> SessionProvisioner for FakeProvisioner<'a> {
        fn provision_task_host(
            &self,
            _task: &Task,
            _branch: &str,
            _base_branch: &str,
        ) -> anyhow::Result<ProvisionedSession> {
            unreachable!("provision_task_host not used in clarify tests")
        }

        fn provision_run_slot(
            &self,
            _task: &Task,
            _run: &TaskRun,
            _slot: &ExpandedRunSlot,
            _branch: &str,
            _base_branch: &str,
        ) -> anyhow::Result<ProvisionedSession> {
            unreachable!("provision_run_slot not used in clarify tests")
        }

        fn provision_clarify(
            &self,
            task: &Task,
            run: &TaskRun,
            branch: &str,
            base_branch: &str,
            agent_type: Option<&str>,
        ) -> anyhow::Result<ProvisionedSession> {
            let session_id = self.mint("clarify");
            let stub_name = format!("{}-clarify-{session_id}", task.name);
            self.insert_session_stub(&session_id, &stub_name, branch, base_branch)?;
            self.db.set_session_task_lineage(
                &session_id,
                Some(&task.id),
                Some(&run.id),
                Some(task.stage.as_str()),
                Some(SlotKind::Clarify.as_str()),
                None,
            )?;
            self.clarify_calls.borrow_mut().push(ClarifyCall {
                task_id: task.id.clone(),
                run_id: run.id.clone(),
                agent_type: agent_type.map(str::to_string),
                branch: branch.to_string(),
                base_branch: base_branch.to_string(),
            });
            Ok(ProvisionedSession {
                session_id,
                branch: branch.to_string(),
            })
        }
    }

    #[derive(Default)]
    struct NoopMerger;

    #[async_trait]
    impl BranchMerger for NoopMerger {
        async fn merge_into_task_branch(
            &self,
            _task: &Task,
            _winning_session_id: &str,
            _winning_branch: &str,
        ) -> anyhow::Result<()> {
            Ok(())
        }
    }

    fn build_orchestrator<'a>(
        db: &'a Database,
        prov: &'a FakeProvisioner<'a>,
        merger: &'a NoopMerger,
    ) -> lucode::domains::tasks::service::TaskOrchestrator<'a, FakeProvisioner<'a>, NoopMerger>
    {
        lucode::domains::tasks::service::TaskOrchestrator::new(db, prov, merger, "lucode")
    }

    #[test]
    fn start_clarify_run_creates_session_with_clarify_role_and_task_lineage() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let prov = FakeProvisioner::new(db);
        let merger = NoopMerger::default();
        let orch = build_orchestrator(db, &prov, &merger);

        let started: ClarifyRunStarted = orch
            .start_clarify_run(&task.id, Some("claude"))
            .expect("start clarify");

        assert!(!started.reused, "first call must spawn a fresh clarify run");
        assert_eq!(started.task_id, task.id);
        assert!(!started.session_id.is_empty());
        assert!(!started.run_id.is_empty());

        let lineage = db.get_session_task_lineage(&started.session_id).unwrap();
        assert_eq!(lineage.task_id.as_deref(), Some(task.id.as_str()));
        assert_eq!(lineage.run_role.as_deref(), Some("clarify"));
        assert_eq!(
            lineage.task_run_id.as_deref(),
            Some(started.run_id.as_str())
        );

        let persisted = db.get_task_run(&started.run_id).unwrap();
        assert_eq!(
            persisted.cancelled_at.is_none() && persisted.confirmed_at.is_none() && persisted.failed_at.is_none(),
            true,
            "clarify run must transition Queued -> Running after provisioning so the sidebar badge reflects active state",
        );

        let calls = prov.clarify_calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].task_id, task.id);
        assert_eq!(calls[0].run_id, started.run_id);
        assert_eq!(calls[0].agent_type.as_deref(), Some("claude"));
        assert_eq!(calls[0].base_branch, "main");
        assert!(
            calls[0].branch.contains("clarify"),
            "clarify branch must include the role marker, got: {}",
            calls[0].branch,
        );
    }

    #[test]
    fn start_clarify_run_is_idempotent_while_run_is_active() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let prov = FakeProvisioner::new(db);
        let merger = NoopMerger::default();
        let orch = build_orchestrator(db, &prov, &merger);

        let first = orch
            .start_clarify_run(&task.id, Some("claude"))
            .expect("first call");
        // v2: a "running" run has no terminal timestamp - nothing to write here.

        let second = orch
            .start_clarify_run(&task.id, Some("claude"))
            .expect("second call");

        assert_eq!(first.session_id, second.session_id);
        assert_eq!(first.run_id, second.run_id);
        assert!(
            second.reused,
            "second call must reuse the active clarify run"
        );
        assert_eq!(
            prov.clarify_calls.borrow().len(),
            1,
            "provisioner must NOT be called again while a clarify run is active",
        );
    }

    #[test]
    fn start_clarify_run_spawns_new_session_after_previous_run_completes() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let prov = FakeProvisioner::new(db);
        let merger = NoopMerger::default();
        let orch = build_orchestrator(db, &prov, &merger);

        let first = orch
            .start_clarify_run(&task.id, Some("claude"))
            .expect("first");
        db.set_task_run_confirmed_at(&first.run_id).unwrap();

        let third = orch
            .start_clarify_run(&task.id, Some("claude"))
            .expect("third");

        assert_ne!(first.session_id, third.session_id);
        assert_ne!(first.run_id, third.run_id);
        assert!(!third.reused);
        assert_eq!(prov.clarify_calls.borrow().len(), 2);
    }

    #[test]
    fn project_workflow_defaults_command_helpers_round_trip() {
        let testdb = mem_db();
        let db = &*testdb;

        let listed = set_project_workflow_default_for_repo(
            db,
            "/repo".to_string(),
            "brainstormed".to_string(),
            Some("preset-claude".to_string()),
            true,
        )
        .unwrap();
        assert_eq!(
            listed,
            vec![ProjectWorkflowDefault {
                repository_path: "/repo".to_string(),
                stage: TaskStage::Brainstormed,
                preset_id: Some("preset-claude".to_string()),
                auto_chain: true,
            }]
        );

        let fetched = get_project_workflow_defaults_for_repo(db, "/repo".to_string()).unwrap();
        assert_eq!(fetched, listed);

        let emptied = delete_project_workflow_default_for_repo(
            db,
            "/repo".to_string(),
            "brainstormed".to_string(),
        )
        .unwrap();
        assert!(emptied.is_empty());
    }

    #[tokio::test]
    async fn cancel_task_cascading_emits_one_tasks_refreshed() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let host = fixture.create_session("host-session", "host-session", "lucode/alpha", None);
        fixture
            .db
            .set_task_host(&task.id, Some(&host.id), Some(&host.branch), Some("master"))
            .unwrap();

        let app = tauri::test::mock_app();
        let tasks_refreshed = Arc::new(Mutex::new(0usize));
        let sessions_refreshed = Arc::new(Mutex::new(0usize));

        let tasks_refreshed_handle = Arc::clone(&tasks_refreshed);
        let tasks_listener = app.listen_any(SchaltEvent::TasksRefreshed.as_str(), move |_| {
            *tasks_refreshed_handle.lock().unwrap() += 1;
        });
        let sessions_refreshed_handle = Arc::clone(&sessions_refreshed);
        let sessions_listener =
            app.listen_any(SchaltEvent::SessionsRefreshed.as_str(), move |_| {
                *sessions_refreshed_handle.lock().unwrap() += 1;
            });

        let cancelled = cancel_task_with_context(
            &app.handle(),
            &fixture.db,
            &fixture.repo_path,
            &task.id,
            None,
        )
        .await
        .expect("cancel task");

        app.unlisten(tasks_listener);
        app.unlisten(sessions_listener);

        assert!(
            cancelled.is_cancelled(),
            "cancelled task must have cancelled_at set; Phase 3 records cancellation orthogonally to stage"
        );
        assert_eq!(*tasks_refreshed.lock().unwrap(), 1);
        assert_eq!(*sessions_refreshed.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn lucode_task_cancel_maps_structured_session_failures() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let blocked = fixture.create_session(
            "blocked-session",
            "blocked-session",
            "lucode/alpha-run-01",
            Some(&task.id),
        );
        std::fs::write(blocked.worktree_path.join("dirty.txt"), "dirty").unwrap();

        let app = tauri::test::mock_app();
        let error = cancel_task_with_context(
            &app.handle(),
            &fixture.db,
            &fixture.repo_path,
            &task.id,
            None,
        )
        .await
        .expect_err("cancel should fail");

        match error {
            TaskFlowError::TaskCancelFailed { task_id, failures } => {
                assert_eq!(task_id, task.id);
                assert_eq!(failures.len(), 1);
                assert!(failures[0].contains(&blocked.id));
            }
            other => panic!("expected TaskCancelFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_run_cancel_kills_all_slot_sessions_in_run() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Brainstormed)
            .unwrap();

        let runs = TaskRunService::new(&fixture.db);
        let run = runs
            .create_task_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                Some("master"),
                None,
            )
            .unwrap();

        let first = fixture.create_run_session(
            "run-session-1",
            "run-session-1",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );
        let second = fixture.create_run_session(
            "run-session-2",
            "run-session-2",
            "lucode/alpha-run-02",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let cancelled = TaskService::new(&fixture.db)
            .cancel_task_run_cascading(&fixture.repo_path, &run.id)
            .await
            .expect("cancel run");

        assert_eq!(cancelled.cancelled_at.is_some(), true);
        assert!(cancelled.selected_session_id.is_none());
        // Phase 4 Wave B.2: cancellation stamps cancelled_at on the orthogonal axis.
        assert!(
            fixture
                .db
                .get_session_by_id(&first.id)
                .unwrap()
                .cancelled_at
                .is_some()
        );
        assert!(
            fixture
                .db
                .get_session_by_id(&second.id)
                .unwrap()
                .cancelled_at
                .is_some()
        );
    }

    #[tokio::test]
    async fn task_run_cancel_is_idempotent_on_already_cancelled_run() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        let runs = TaskRunService::new(&fixture.db);
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

        let svc = TaskService::new(&fixture.db);
        let first = svc
            .cancel_task_run_cascading(&fixture.repo_path, &run.id)
            .await
            .expect("first cancel");
        let second = svc
            .cancel_task_run_cascading(&fixture.repo_path, &run.id)
            .await
            .expect("second cancel is a no-op");

        assert_eq!(first.cancelled_at.is_some(), true);
        assert_eq!(second.cancelled_at.is_some(), true);
    }

    #[test]
    fn task_reopen_advances_cancelled_task_to_target_stage() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let svc = TaskService::new(db);

        svc.update_content(&task.id, TaskArtifactKind::Spec, "spec body", None, None)
            .unwrap();
        svc.advance_stage(&task.id, TaskStage::Ready).unwrap();
        // Phase 3: cancellation is now an orthogonal timestamp, not a
        // stage. Reopen still works; it advances to the target stage
        // and clears `cancelled_at`.
        db.set_task_cancelled_at(&task.id, Some(chrono::Utc::now()))
            .unwrap();

        let reopened = svc
            .reopen_task_to_stage(&task.id, TaskStage::Brainstormed)
            .expect("reopen");

        assert_eq!(reopened.stage, TaskStage::Brainstormed);
        assert_eq!(reopened.current_spec(&db).unwrap().as_deref(), Some("spec body"));
    }

    #[test]
    fn task_reopen_rejects_invalid_target_stage() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let svc = TaskService::new(db);

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
            .expect_err("Done -> Draft must be rejected");
        assert!(
            err.to_string().contains("invalid reopen target"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn task_reopen_clears_failure_flag() {
        let testdb = mem_db();
        let db = &*testdb;
        let task = seed_task(db, "alpha");
        let svc = TaskService::new(db);

        for stage in [
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
        ] {
            svc.advance_stage(&task.id, stage).unwrap();
        }
        db.set_task_failure_flag(&task.id, true).unwrap();
        // Phase 3: cancellation is `cancelled_at`, not a stage transition.
        db.set_task_cancelled_at(&task.id, Some(chrono::Utc::now()))
            .unwrap();
        assert!(svc.get_task(&task.id).unwrap().failure_flag);

        let reopened = svc
            .reopen_task_to_stage(&task.id, TaskStage::Implemented)
            .expect("reopen");

        assert_eq!(reopened.stage, TaskStage::Implemented);
        assert!(
            !reopened.failure_flag,
            "reopen must clear the failure flag"
        );
    }

    #[test]
    fn map_confirm_stage_error_preserves_merge_conflict_files() {
        // The boundary downcast in confirm_stage_against_snapshot must
        // forward MergeConflictDuringConfirm.files into
        // SchaltError::MergeConflict.files — earlier code dropped the list
        // and passed Vec::new(), starving the merge-resolver UI.
        let sentinel = MergeConflictDuringConfirm {
            message: "Rebase produced conflicts. Conflicting paths: src/foo.rs, src/bar.rs"
                .to_string(),
            files: vec!["src/foo.rs".to_string(), "src/bar.rs".to_string()],
        };
        let err = anyhow::Error::new(sentinel);

        let mapped = super::map_confirm_stage_error(err);

        match mapped {
            TaskFlowError::Schalt(SchaltError::MergeConflict { files, message }) => {
                assert_eq!(
                    files,
                    vec!["src/foo.rs".to_string(), "src/bar.rs".to_string()],
                    "downcast must clone the file list out of the sentinel",
                );
                assert!(
                    message.contains("Conflicting paths"),
                    "downcast must preserve the original message: {message}",
                );
            }
            other => panic!("expected MergeConflict, got: {other:?}"),
        }
    }

    #[test]
    fn map_confirm_stage_error_routes_stage_advance_failure_to_typed_variant() {
        let sentinel = StageAdvanceAfterMergeFailed {
            message: "DB busy".to_string(),
        };
        let err = anyhow::Error::new(sentinel);

        let mapped = super::map_confirm_stage_error(err);

        match mapped {
            TaskFlowError::StageAdvanceFailedAfterMerge { task_id: _, message } => {
                assert_eq!(message, "DB busy");
            }
            other => panic!("expected StageAdvanceFailedAfterMerge, got: {other:?}"),
        }
    }

    #[test]
    fn map_confirm_stage_error_falls_back_to_database_error_for_unknown_anyhow() {
        let err = anyhow::anyhow!("some random failure");

        let mapped = super::map_confirm_stage_error(err);

        match mapped {
            TaskFlowError::DatabaseError { message } => {
                assert_eq!(message, "some random failure");
            }
            other => panic!("expected DatabaseError, got: {other:?}"),
        }
    }

    // --- Phase 5 Wave B: lucode_task_run_done ---

    use super::{TaskRunDonePayload, task_run_done_with_context};
    use lucode::services::{SessionFacts, TaskRunStatus, compute_run_status};

    /// Build a SessionFacts projection from a session row, mirroring what
    /// compute_run_status reads through SessionFactsRecorder writes. Keeps the
    /// test assertions colocated with the actual derivation so a future drift
    /// in either side surfaces here.
    fn session_facts_for(session: &lucode::services::Session) -> SessionFacts {
        SessionFacts {
            task_run_id: session.task_run_id.clone(),
            exit_code: session.exit_code,
            first_idle_at: session.first_idle_at,
        }
    }

    #[tokio::test]
    async fn lucode_task_run_done_with_status_ok_records_first_idle() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let runs = TaskRunService::new(&fixture.db);
        let run = runs
            .create_task_run(&task.id, TaskStage::Brainstormed, None, Some("master"), None)
            .unwrap();
        let session = fixture.create_run_session(
            "slot-session-1",
            "slot-session-1",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let app = tauri::test::mock_app();
        let payload = TaskRunDonePayload {
            run_id: run.id.clone(),
            slot_session_id: session.id.clone(),
            status: "ok".into(),
            artifact_id: None,
            error: None,
        };
        let updated = task_run_done_with_context(
            &app.handle(),
            &fixture.db,
            &fixture.repo_path,
            payload,
        )
        .await
        .expect("status=ok must succeed");

        // Negative: confirmed_at MUST stay None — this tool does not auto-confirm.
        assert!(
            updated.confirmed_at.is_none(),
            "status=ok must not auto-confirm; confirmation stays a separate human action"
        );
        assert!(updated.cancelled_at.is_none());
        assert!(updated.failed_at.is_none());

        // Positive: first_idle_at landed on the slot session.
        let after_session = fixture
            .db
            .get_sessions_by_task_run_id(&run.id)
            .unwrap()
            .into_iter()
            .find(|s| s.id == session.id)
            .expect("slot session must be found by run id");
        assert!(
            after_session.first_idle_at.is_some(),
            "status=ok must write first_idle_at on the slot session"
        );

        // Derived: AwaitingSelection (the only bound session is now idle).
        let facts = session_facts_for(&after_session);
        assert_eq!(
            compute_run_status(&updated, &[facts]),
            TaskRunStatus::AwaitingSelection,
            "with one bound idle session and no winner, derive AwaitingSelection"
        );
    }

    #[tokio::test]
    async fn lucode_task_run_done_with_status_failed_marks_run_failed() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let runs = TaskRunService::new(&fixture.db);
        let run = runs
            .create_task_run(&task.id, TaskStage::Brainstormed, None, Some("master"), None)
            .unwrap();
        let session = fixture.create_run_session(
            "slot-session-1",
            "slot-session-1",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let app = tauri::test::mock_app();
        let payload = TaskRunDonePayload {
            run_id: run.id.clone(),
            slot_session_id: session.id.clone(),
            status: "failed".into(),
            artifact_id: None,
            error: Some("boom".into()),
        };
        let updated = task_run_done_with_context(
            &app.handle(),
            &fixture.db,
            &fixture.repo_path,
            payload,
        )
        .await
        .expect("status=failed must succeed");

        // Authoritative source: failed_at + failure_reason on the run row.
        assert!(updated.failed_at.is_some());
        assert_eq!(updated.failure_reason.as_deref(), Some("boom"));
        assert!(updated.confirmed_at.is_none());
        assert!(updated.cancelled_at.is_none());

        // Negative: session.exit_code MUST stay None. The agent didn't exit;
        // setting exit_code would be a lie that produces false positives for
        // any future query against `WHERE exit_code IS NOT NULL`.
        let after_session = fixture
            .db
            .get_sessions_by_task_run_id(&run.id)
            .unwrap()
            .into_iter()
            .find(|s| s.id == session.id)
            .expect("slot session must be found by run id");
        assert!(
            after_session.exit_code.is_none(),
            "agent self-reported failure must not synthesize a fake PTY exit"
        );
        assert!(after_session.exited_at.is_none());

        // Derived: Failed (Case 3 reads failed_at).
        let facts = session_facts_for(&after_session);
        assert_eq!(
            compute_run_status(&updated, &[facts]),
            TaskRunStatus::Failed,
            "compute_run_status derives Failed from failed_at, not exit_code"
        );
    }

    #[tokio::test]
    async fn lucode_task_run_done_rejects_session_not_bound_to_run() {
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let runs = TaskRunService::new(&fixture.db);
        let run_a = runs
            .create_task_run(&task.id, TaskStage::Brainstormed, None, Some("master"), None)
            .unwrap();
        let run_b = runs
            .create_task_run(&task.id, TaskStage::Brainstormed, None, Some("master"), None)
            .unwrap();
        // Slot session is bound to run_b.
        let session = fixture.create_run_session(
            "slot-session-b",
            "slot-session-b",
            "lucode/alpha-run-b-01",
            Some(&task.id),
            Some(&run_b.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let app = tauri::test::mock_app();
        // Caller passes run_a.id with the run_b-bound session — must be rejected.
        let payload = TaskRunDonePayload {
            run_id: run_a.id.clone(),
            slot_session_id: session.id.clone(),
            status: "ok".into(),
            artifact_id: None,
            error: None,
        };
        let err = task_run_done_with_context(
            &app.handle(),
            &fixture.db,
            &fixture.repo_path,
            payload,
        )
        .await
        .expect_err("cross-run lineage must be rejected");

        match err {
            TaskFlowError::InvalidInput { field, message } => {
                assert_eq!(field, "slot_session_id");
                assert!(
                    message.contains(&run_a.id),
                    "error must name the rejected run id: {message}"
                );
            }
            other => panic!("expected InvalidInput, got {other:?}"),
        }

        // Negative: nothing written on the slot session.
        let after_session = fixture
            .db
            .get_sessions_by_task_run_id(&run_b.id)
            .unwrap()
            .into_iter()
            .find(|s| s.id == session.id)
            .expect("slot session must be found by run id");
        assert!(after_session.first_idle_at.is_none());
        assert!(after_session.exit_code.is_none());
    }

    #[tokio::test]
    async fn lucode_task_run_done_status_ok_is_idempotent() {
        // Pins the write-once invariant on first_idle_at: a second status=ok
        // call leaves the original timestamp intact. Regressing this would
        // break sticky AwaitingSelection (per Phase 1 plan §1).
        let fixture = CancelCommandFixture::new();
        let task = fixture.create_task("alpha");
        TaskService::new(&fixture.db)
            .advance_stage(&task.id, TaskStage::Ready)
            .unwrap();
        let runs = TaskRunService::new(&fixture.db);
        let run = runs
            .create_task_run(&task.id, TaskStage::Brainstormed, None, Some("master"), None)
            .unwrap();
        let session = fixture.create_run_session(
            "slot-session-1",
            "slot-session-1",
            "lucode/alpha-run-01",
            Some(&task.id),
            Some(&run.id),
            Some(SlotKind::Candidate.as_str()),
        );

        let app = tauri::test::mock_app();
        let payload = || TaskRunDonePayload {
            run_id: run.id.clone(),
            slot_session_id: session.id.clone(),
            status: "ok".into(),
            artifact_id: None,
            error: None,
        };
        let read_session = || {
            fixture
                .db
                .get_sessions_by_task_run_id(&run.id)
                .unwrap()
                .into_iter()
                .find(|s| s.id == session.id)
                .expect("slot session must be found by run id")
        };

        task_run_done_with_context(&app.handle(), &fixture.db, &fixture.repo_path, payload())
            .await
            .expect("first call");
        let first_idle = read_session()
            .first_idle_at
            .expect("first call must stamp first_idle_at");

        task_run_done_with_context(&app.handle(), &fixture.db, &fixture.repo_path, payload())
            .await
            .expect("second call must succeed (idempotent)");
        assert_eq!(
            read_session().first_idle_at,
            Some(first_idle),
            "second call must NOT overwrite first_idle_at — write-once invariant"
        );
    }
}
