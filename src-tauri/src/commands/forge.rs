use dashmap::DashSet;
use once_cell::sync::Lazy;
use std::sync::Arc;

use crate::get_project_manager;
use base64::Engine;
use log::{error, info, warn};
use lucode::domains::git::service::GitlabCli;
use lucode::domains::git::service::{
    ForgeCommitMode, ForgeCreateSessionPrParams, ForgeError, ForgeIssueDetails, ForgeIssueSummary,
    ForgePrDetails, ForgePrResult, ForgePrSummary, ForgeReviewComment, ForgeSourceConfig,
    ForgeType, create_provider, detect_forge, rename_branch,
};
use lucode::infrastructure::events::{SchaltEvent, emit_event};
use lucode::services::MergeMode;
use lucode::services::{ConnectionVerdict, PrState, SessionMethods, log_diagnostics};
use lucode::shared::session_metadata_gateway::SessionMetadataGateway;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

static ACTIVE_CONNECTION_ISSUES: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeConnectionIssueEventPayload {
    hostname: String,
    session_name: Option<String>,
    verdict: ConnectionVerdict,
    tauri_probe_ok: bool,
    subprocess_probe_ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgePrDetailsRefreshedPayload {
    project_path: String,
    pr_number: i64,
    pr_state: PrState,
}

fn parse_forge_pr_number(url: &str) -> Option<i64> {
    let trimmed = url.trim_end_matches('/');
    for marker in ["/pull/", "/merge_requests/"] {
        if let Some((_, tail)) = trimmed.rsplit_once(marker) {
            let number = tail.split(['?', '#']).next()?.trim();
            return number.parse().ok();
        }
    }
    None
}

fn pr_number_from_details(id: &str, details: &ForgePrDetails) -> Option<i64> {
    id.parse()
        .ok()
        .or_else(|| details.summary.id.parse().ok())
        .or_else(|| {
            details
                .summary
                .url
                .as_deref()
                .and_then(parse_forge_pr_number)
        })
}

fn is_merged_state(state: &str) -> bool {
    state.eq_ignore_ascii_case("merged")
}

fn is_ci_green(details: &ForgePrDetails) -> bool {
    if details
        .ci_status
        .as_ref()
        .is_some_and(|ci| ci.state.eq_ignore_ascii_case("success"))
    {
        return true;
    }

    match &details.provider_data {
        lucode::domains::git::service::ForgeProviderData::GitHub { status_checks, .. } => {
            !status_checks.is_empty()
                && status_checks.iter().all(|check| {
                    check
                        .conclusion
                        .as_deref()
                        .is_some_and(|conclusion| conclusion.eq_ignore_ascii_case("success"))
                })
        }
        lucode::domains::git::service::ForgeProviderData::GitLab {
            pipeline_status, ..
        } => pipeline_status
            .as_deref()
            .is_some_and(|status| status.eq_ignore_ascii_case("success")),
        lucode::domains::git::service::ForgeProviderData::None => false,
    }
}

fn pr_state_from_details(details: &ForgePrDetails) -> PrState {
    if is_merged_state(&details.summary.state) {
        PrState::Mred
    } else if is_ci_green(details) {
        PrState::Succeeding
    } else {
        PrState::Open
    }
}

fn format_forge_error(err: ForgeError) -> String {
    err.to_string()
}

async fn resolve_project(
    project_path: &str,
) -> Result<Arc<lucode::project_manager::Project>, String> {
    let path = std::path::PathBuf::from(project_path);
    let manager = get_project_manager().await;
    manager
        .get_project_for_path(&path)
        .await
        .map_err(|e| format!("Project not available: {e}"))
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
pub async fn forge_get_status(
    app: AppHandle,
    project_path: String,
) -> Result<ForgeStatusPayload, String> {
    let project = resolve_project(&project_path).await?;

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
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ForgeIssueSummary>, String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .search_issues(&project.path, query.as_deref(), limit, &source)
        .await
    {
        Ok(result) => {
            clear_connection_issue(hostname_hint);
            Ok(result)
        }
        Err(err) => {
            error!("Forge issue search failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_get_issue_details(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
) -> Result<ForgeIssueDetails, String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .get_issue_details(&project.path, &id, &source)
        .await
    {
        Ok(details) => {
            clear_connection_issue(hostname_hint);
            Ok(details)
        }
        Err(err) => {
            error!("Forge issue detail fetch failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_search_prs(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ForgePrSummary>, String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .search_prs(&project.path, query.as_deref(), limit, &source)
        .await
    {
        Ok(result) => {
            clear_connection_issue(hostname_hint);
            Ok(result)
        }
        Err(err) => {
            error!("Forge PR search failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_get_pr_details(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
) -> Result<ForgePrDetails, String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider.get_pr_details(&project.path, &id, &source).await {
        Ok(details) => {
            clear_connection_issue(hostname_hint);
            if let Some(pr_number) = pr_number_from_details(&id, &details) {
                let pr_state = pr_state_from_details(&details);
                {
                    let core = project.schaltwerk_core.read().await;
                    if let Err(err) = core.db.update_session_pr_state_by_pr_number(
                        &project.path,
                        pr_number,
                        pr_state.clone(),
                    ) {
                        warn!("Failed to persist PR state for PR #{pr_number}: {err}");
                    }
                }
                let payload = ForgePrDetailsRefreshedPayload {
                    project_path: project.path.to_string_lossy().to_string(),
                    pr_number,
                    pr_state,
                };
                if let Err(err) = emit_event(&app, SchaltEvent::ForgePrDetailsRefreshed, &payload) {
                    warn!("Failed to emit forge PR details refresh event: {err}");
                }
                if let Err(err) = emit_event(&app, SchaltEvent::SessionsRefreshed, &project.path) {
                    warn!("Failed to emit sessions refresh after PR state update: {err}");
                }
            }
            Ok(details)
        }
        Err(err) => {
            error!("Forge PR detail fetch failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
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
    pub project_path: Option<String>,
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
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let project = match &args.project_path {
        Some(pp) => resolve_project(pp).await?,
        None => {
            let manager = get_project_manager().await;
            manager
                .current_project()
                .await
                .map_err(|e| format!("No active project: {e}"))?
        }
    };
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
        args.source.forge_type, args.session_name, session_branch, base_branch, pr_branch_name
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

    let hostname_hint = args.source.hostname.as_deref();

    let pr_result = match provider.create_session_pr(params).await {
        Ok(result) => {
            clear_connection_issue(hostname_hint);
            result
        }
        Err(err) => {
            error!("Forge PR/MR creation failed: {err}");
            return Err(handle_connection_failure(
                &app,
                err,
                hostname_hint,
                Some(&args.session_name),
            ));
        }
    };

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

    if let Some(pr_number) = parse_forge_pr_number(&pr_result.url) {
        let core = project.schaltwerk_core.read().await;
        let session = core
            .session_manager()
            .get_session(&args.session_name)
            .map_err(|e| format!("Failed to get session for PR link update: {e}"))?;
        if let Err(err) =
            core.db
                .update_session_pr_info(&session.id, Some(pr_number), Some(&pr_result.url))
        {
            warn!(
                "Failed to persist PR/MR link for session '{}': {err}",
                args.session_name
            );
        }
        if let Err(err) = emit_event(&app, SchaltEvent::SessionsRefreshed, &project_path) {
            warn!("Failed to emit sessions refresh after PR link update: {err}");
        }
    }

    if args.cancel_after_pr
        && let Err(err) = schaltwerk_core_cancel_session(
            app.clone(),
            args.session_name.clone(),
            Some(project_path.to_string_lossy().to_string()),
        )
        .await
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
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
) -> Result<Vec<ForgeReviewComment>, String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .get_review_comments(&project.path, &id, &source)
        .await
    {
        Ok(result) => {
            clear_connection_issue(hostname_hint);
            Ok(result)
        }
        Err(err) => {
            error!("Forge review comments fetch failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_approve_pr(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
) -> Result<(), String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider.approve_pr(&project.path, &id, &source).await {
        Ok(_) => {
            clear_connection_issue(hostname_hint);
            Ok(())
        }
        Err(err) => {
            error!("Forge PR approval failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_merge_pr(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
    squash: bool,
    delete_branch: bool,
) -> Result<(), String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .merge_pr(&project.path, &id, squash, delete_branch, &source)
        .await
    {
        Ok(_) => {
            clear_connection_issue(hostname_hint);
            Ok(())
        }
        Err(err) => {
            error!("Forge PR merge failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_comment_on_pr(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
    message: String,
) -> Result<(), String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .comment_on_pr(&project.path, &id, &message, &source)
        .await
    {
        Ok(_) => {
            clear_connection_issue(hostname_hint);
            Ok(())
        }
        Err(err) => {
            error!("Forge PR comment failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_comment_on_issue(
    app: AppHandle,
    project_path: String,
    source: ForgeSourceConfig,
    id: String,
    message: String,
) -> Result<(), String> {
    let project = resolve_project(&project_path).await?;

    let provider = create_provider(source.forge_type).map_err(format_forge_error)?;
    provider
        .ensure_installed()
        .await
        .map_err(format_forge_error)?;

    let hostname_hint = source.hostname.as_deref();

    match provider
        .comment_on_issue(&project.path, &id, &message, &source)
        .await
    {
        Ok(_) => {
            clear_connection_issue(hostname_hint);
            Ok(())
        }
        Err(err) => {
            error!("Forge issue comment failed: {err}");
            Err(handle_connection_failure(&app, err, hostname_hint, None))
        }
    }
}

#[tauri::command]
pub async fn forge_proxy_image(
    image_url: String,
    forge_type: String,
    hostname: Option<String>,
) -> Result<String, String> {
    if forge_type != "gitlab" {
        return Err("Image proxy only supported for GitLab".into());
    }

    let cli = GitlabCli::new();
    let token = cli
        .get_auth_token(hostname.as_deref())
        .map_err(|e| format!("Failed to get GitLab token: {e}"))?;

    log::debug!("[forge_proxy_image] Fetching image: {image_url}");

    let output = std::process::Command::new("curl")
        .args([
            "-sS",
            "-L",
            "--max-time",
            "15",
            "-H",
            &format!("PRIVATE-TOKEN: {token}"),
            &image_url,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[forge_proxy_image] curl failed: {stderr}");
        return Err(format!("Image fetch failed: {stderr}"));
    }

    if output.stdout.is_empty() {
        return Err("Image fetch returned empty response".into());
    }

    let content_type = infer_image_content_type(&image_url);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:{content_type};base64,{b64}"))
}

fn infer_image_content_type(url: &str) -> &str {
    let lower = url.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

fn emit_forge_status(app: &AppHandle, status: &ForgeStatusPayload) -> Result<(), String> {
    emit_event(app, SchaltEvent::ForgeStatusChanged, status)
        .map_err(|e| format!("Failed to emit forge status event: {e}"))
}

fn handle_connection_failure(
    app: &AppHandle,
    err: ForgeError,
    hostname_hint: Option<&str>,
    session_name: Option<&str>,
) -> String {
    let classified = err.classify_connection_error();
    if let ForgeError::ConnectionFailed { hostname, .. } = &classified {
        let final_host = if hostname != "unknown" {
            hostname.clone()
        } else if let Some(hint) = hostname_hint {
            hint.to_string()
        } else {
            hostname.clone()
        };
        schedule_connection_diagnostics(app, final_host, session_name.map(|s| s.to_string()));
    }
    format_forge_error(classified)
}

fn schedule_connection_diagnostics(
    app: &AppHandle,
    hostname: String,
    session_name: Option<String>,
) {
    if !ACTIVE_CONNECTION_ISSUES.insert(hostname.clone()) {
        return;
    }

    let app_handle = app.clone();
    tokio::spawn(async move {
        let session_for_report = session_name
            .clone()
            .unwrap_or_else(|| "forge-ui".to_string());
        let report = log_diagnostics(&hostname, &session_for_report);
        let payload = ForgeConnectionIssueEventPayload {
            hostname: hostname.clone(),
            session_name,
            verdict: report.verdict,
            tauri_probe_ok: report.tauri_tcp_probe_ok,
            subprocess_probe_ok: report.subprocess_probe_ok,
        };
        if let Err(err) = emit_event(&app_handle, SchaltEvent::ForgeConnectionIssue, &payload) {
            warn!("Failed to emit forge connection issue event: {err}");
        }
    });
}

fn clear_connection_issue(hostname: Option<&str>) {
    if let Some(host) = hostname {
        ACTIVE_CONNECTION_ISSUES.remove(host);
    }
}
