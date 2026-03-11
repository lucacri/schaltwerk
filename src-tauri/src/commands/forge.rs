use crate::get_project_manager;
use log::{error, info, warn};
use lucode::domains::git::service::{
    create_provider, detect_forge, rename_branch, ForgeCommitMode,
    ForgeCreateSessionPrParams, ForgeError, ForgeIssueSummary, ForgeIssueDetails,
    ForgePrDetails, ForgePrResult, ForgePrSummary, ForgeReviewComment, ForgeSourceConfig,
    ForgeType,
};
use lucode::infrastructure::events::{SchaltEvent, emit_event};
use lucode::services::MergeMode;
use lucode::shared::session_metadata_gateway::SessionMetadataGateway;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

fn format_forge_error(err: ForgeError) -> String {
    err.to_string()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatusPayload {
    pub forge_type: ForgeType,
    pub installed: bool,
    pub authenticated: bool,
    pub user_login: Option<String>,
    pub hostname: Option<String>,
}

#[tauri::command]
pub async fn forge_get_status(app: AppHandle) -> Result<ForgeStatusPayload, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let forge_type = detect_forge(&project.path);

    let provider = match create_provider(forge_type) {
        Ok(p) => p,
        Err(_) => {
            let payload = ForgeStatusPayload {
                forge_type,
                installed: false,
                authenticated: false,
                user_login: None,
                hostname: None,
            };
            emit_forge_status(&app, &payload)?;
            return Ok(payload);
        }
    };

    let installed = provider.ensure_installed().await.is_ok();

    let (authenticated, user_login, hostname) = if installed {
        match provider.check_auth(None).await {
            Ok(status) => (status.authenticated, status.user_login, status.hostname),
            Err(_) => (false, None, None),
        }
    } else {
        (false, None, None)
    };

    let payload = ForgeStatusPayload {
        forge_type,
        installed,
        authenticated,
        user_login,
        hostname,
    };

    emit_forge_status(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
pub async fn forge_search_issues(
    _app: AppHandle,
    source: ForgeSourceConfig,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ForgeIssueSummary>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .search_issues(&project.path, query.as_deref(), limit, &source)
        .await
        .map_err(|e| {
            error!("Forge issue search failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_get_issue_details(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
) -> Result<ForgeIssueDetails, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .get_issue_details(&project.path, &id, &source)
        .await
        .map_err(|e| {
            error!("Forge issue detail fetch failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_search_prs(
    _app: AppHandle,
    source: ForgeSourceConfig,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ForgePrSummary>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .search_prs(&project.path, query.as_deref(), limit, &source)
        .await
        .map_err(|e| {
            error!("Forge PR search failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_get_pr_details(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
) -> Result<ForgePrDetails, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .get_pr_details(&project.path, &id, &source)
        .await
        .map_err(|e| {
            error!("Forge PR detail fetch failed: {e}");
            format_forge_error(e)
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateForgeSessionPrArgs {
    pub session_name: String,
    pub title: String,
    pub body: Option<String>,
    pub base_branch: Option<String>,
    pub pr_branch_name: Option<String>,
    pub commit_message: Option<String>,
    pub source: ForgeSourceConfig,
    pub mode: MergeMode,
    #[serde(default)]
    pub cancel_after_pr: bool,
}

#[tauri::command]
pub async fn forge_create_session_pr(
    app: AppHandle,
    args: CreateForgeSessionPrArgs,
) -> Result<ForgePrResult, String> {
    use crate::commands::schaltwerk_core::schaltwerk_core_cancel_session;

    let provider = create_provider(args.source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;
    let project_path = project.path.clone();

    let (session_worktree, session_branch, parent_branch, session_state) = {
        let core = project.schaltwerk_core.read().await;
        let session = core
            .session_manager()
            .get_session(&args.session_name)
            .map_err(|e| format!("Session not found: {e}"))?;
        (
            session.worktree_path.clone(),
            session.branch.clone(),
            session.parent_branch.clone(),
            session.session_state,
        )
    };

    if session_state == lucode::domains::sessions::SessionState::Spec {
        return Err("Cannot create PR/MR for a spec session. Start the session first.".to_string());
    }

    let base_branch = args
        .base_branch
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            let trimmed = parent_branch.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| "main".to_string());

    let pr_branch_name = args
        .pr_branch_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| session_branch.clone());

    let forge_mode = match args.mode {
        MergeMode::Squash => ForgeCommitMode::Squash,
        MergeMode::Reapply => ForgeCommitMode::Reapply,
    };

    info!(
        "Creating {:?} PR/MR for session '{}' (branch='{}', base='{}', head='{}')",
        args.source.forge_type,
        args.session_name,
        session_branch,
        base_branch,
        pr_branch_name
    );

    let params = ForgeCreateSessionPrParams {
        repo_path: &project_path,
        session_worktree_path: &session_worktree,
        session_slug: &args.session_name,
        session_branch: &session_branch,
        base_branch: &base_branch,
        pr_branch_name: &pr_branch_name,
        title: &args.title,
        body: args.body.as_deref(),
        commit_message: args.commit_message.as_deref(),
        mode: forge_mode,
        source: &args.source,
    };

    let pr_result = provider
        .create_session_pr(params)
        .await
        .map_err(|err| {
            error!("Forge PR/MR creation failed: {err}");
            format_forge_error(err)
        })?;

    if pr_result.branch != session_branch {
        info!(
            "PR/MR branch '{}' differs from session branch '{}', updating session",
            pr_result.branch, session_branch
        );

        if let Err(e) = rename_branch(&session_worktree, &session_branch, &pr_result.branch) {
            warn!(
                "Failed to rename local branch from '{}' to '{}': {e}",
                session_branch, pr_result.branch
            );
        }

        {
            let core = project.schaltwerk_core.read().await;
            let session = core
                .session_manager()
                .get_session(&args.session_name)
                .map_err(|e| format!("Failed to get session for branch update: {e}"))?;

            if let Err(e) = SessionMetadataGateway::new(core.database())
                .update_session_branch(&session.id, &pr_result.branch)
            {
                warn!(
                    "Failed to update session branch in database to '{}': {e}",
                    pr_result.branch
                );
            }
        }

        emit_event(&app, SchaltEvent::SessionsRefreshed, &project_path)
            .map_err(|e| format!("Failed to emit sessions refresh: {e}"))?;
    }

    if args.cancel_after_pr
        && let Err(err) =
            schaltwerk_core_cancel_session(app.clone(), args.session_name.clone()).await
    {
        error!(
            "PR/MR created but auto-cancel failed for session '{}': {err}",
            args.session_name
        );
    }

    Ok(pr_result)
}

#[tauri::command]
pub async fn forge_get_review_comments(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
) -> Result<Vec<ForgeReviewComment>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .get_review_comments(&project.path, &id, &source)
        .await
        .map_err(|e| {
            error!("Forge review comments fetch failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_approve_pr(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
) -> Result<(), String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .approve_pr(&project.path, &id, &source)
        .await
        .map_err(|e| {
            error!("Forge PR approval failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_merge_pr(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
    squash: bool,
    delete_branch: bool,
) -> Result<(), String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .merge_pr(&project.path, &id, squash, delete_branch, &source)
        .await
        .map_err(|e| {
            error!("Forge PR merge failed: {e}");
            format_forge_error(e)
        })
}

#[tauri::command]
pub async fn forge_comment_on_pr(
    _app: AppHandle,
    source: ForgeSourceConfig,
    id: String,
    message: String,
) -> Result<(), String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider.ensure_installed().await.map_err(format_forge_error)?;

    provider
        .comment_on_pr(&project.path, &id, &message, &source)
        .await
        .map_err(|e| {
            error!("Forge PR comment failed: {e}");
            format_forge_error(e)
        })
}

fn emit_forge_status(app: &AppHandle, status: &ForgeStatusPayload) -> Result<(), String> {
    emit_event(app, SchaltEvent::ForgeStatusChanged, status)
        .map_err(|e| format!("Failed to emit forge status event: {e}"))
}
