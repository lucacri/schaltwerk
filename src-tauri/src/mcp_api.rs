use http_body_util::BodyExt;
use hyper::{
    HeaderMap, Method, Request, Response, StatusCode,
    body::Incoming,
    header::{CONTENT_TYPE, HeaderValue},
};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::future::Future;
use std::path::{Path, PathBuf};
use url::form_urlencoded;
use uuid::Uuid;

use crate::commands::github::{
    CreateSessionPrArgs, GitHubPrFeedbackPayload, github_create_session_pr_impl,
    github_get_pr_feedback_impl,
};
use crate::commands::gitlab::{CreateGitlabSessionMrArgs, gitlab_create_session_mr};
use crate::commands::schaltwerk_core::agent_launcher;
use crate::commands::schaltwerk_core::{
    MergeCommandError, StartAgentParams, merge_session_with_events, schaltwerk_core_cancel_session,
    schaltwerk_core_start_claude_orchestrator, schaltwerk_core_start_session_agent_with_restart,
};
use crate::commands::sessions_refresh::{SessionsRefreshReason, request_sessions_refresh};
use crate::mcp_api::diff_api::{DiffApiError, DiffChunkRequest, DiffScope, SummaryQuery};
use crate::{
    REQUEST_PROJECT_OVERRIDE, SETTINGS_MANAGER, get_core_read, get_core_write, get_project_manager,
};
use lucode::domains::attention::get_session_attention_state;
use lucode::domains::git::service::{ForgeType, detect_forge};
use lucode::domains::sessions::apply_git_enrichment;
use lucode::services::sessions::compute_git_enrichment_parallel;
use lucode::domains::merge::MergeMode;
use lucode::domains::sessions::entity::{Session, SessionStatus, Spec, SpecStage};
use lucode::infrastructure::attention_bridge::clear_session_attention_state;
use lucode::domains::settings::{AgentPreset, setup_script::SetupScriptService};
use lucode::infrastructure::database::Database;
use lucode::infrastructure::database::SpecMethods;
use lucode::infrastructure::database::db_project_config::ProjectConfigMethods;
use lucode::infrastructure::events::{SchaltEvent, emit_event};
use lucode::schaltwerk_core::db_app_config::AppConfigMethods;
use lucode::schaltwerk_core::{SessionManager, SessionState};
use lucode::services::SessionMethods;
use lucode::shared::terminal_id::terminal_id_for_orchestrator_top;

mod diff_api;

pub async fn handle_mcp_request(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // Preserve project affinity from MCP clients (terminals) using the header
    // injected by the MCP bridge. This prevents requests from being handled by
    // whichever project is currently active in the UI.
    let project_override = project_override_from_headers(req.headers());

    if let Some(path) = project_override {
        return REQUEST_PROJECT_OVERRIDE
            .scope(RefCell::new(Some(path)), async move {
                handle_mcp_request_inner(req, app).await
            })
            .await;
    }

    let project_manager = get_project_manager().await;
    let project_count = project_manager.get_project_count().await;
    if project_count > 1 {
        warn!(
            "MCP API request missing X-Project-Path header while {project_count} projects are open — falling back to active project"
        );
    } else {
        debug!("MCP API request missing X-Project-Path header — falling back to active project");
    }

    handle_mcp_request_inner(req, app).await
}

async fn handle_mcp_request_inner(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    match (&method, path.as_str()) {
        (&Method::POST, "/api/reset") => reset_selection(req, app).await,
        (&Method::GET, "/api/diff/summary") => diff_summary(req).await,
        (&Method::GET, "/api/diff/file") => diff_chunk(req).await,
        (&Method::POST, "/api/specs") => create_draft(req, app).await,
        (&Method::GET, "/api/specs") => list_drafts().await,
        (&Method::GET, "/api/specs/summary") => list_spec_summaries().await,
        (&Method::PATCH, path) if path.starts_with("/api/specs/") && path.ends_with("/stage") => {
            let name = extract_draft_name_for_action(path, "/stage");
            update_spec_stage(req, &name, app).await
        }
        (&Method::PATCH, path)
            if path.starts_with("/api/specs/") && path.ends_with("/attention") =>
        {
            let name = extract_draft_name_for_action(path, "/attention");
            update_spec_attention(req, &name, app).await
        }
        (&Method::GET, path)
            if path.starts_with("/api/specs/")
                && !path.ends_with("/start")
                && !path.ends_with("/stage")
                && !path.ends_with("/attention") =>
        {
            let name = extract_draft_name(path, "/api/specs/");
            get_spec_content(&name).await
        }
        (&Method::PATCH, path)
            if path.starts_with("/api/specs/")
                && !path.ends_with("/start")
                && !path.ends_with("/stage")
                && !path.ends_with("/attention") =>
        {
            let name = extract_draft_name(path, "/api/specs/");
            update_spec_content(req, &name, app).await
        }
        (&Method::POST, path) if path.starts_with("/api/specs/") && path.ends_with("/start") => {
            let name = extract_draft_name_for_start(path);
            start_spec_session(req, &name, app).await
        }
        (&Method::DELETE, path) if path.starts_with("/api/specs/") => {
            let name = extract_draft_name(path, "/api/specs/");
            delete_draft(&name, app).await
        }
        (&Method::POST, "/api/sessions") => create_session(req, app).await,
        (&Method::GET, path) if path.starts_with("/api/sessions/") && path.ends_with("/spec") => {
            let name = extract_session_name_for_action(path, "/spec");
            get_session_spec(&name).await
        }
        (&Method::GET, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/pr-feedback") =>
        {
            let name = extract_session_name_for_action(path, "/pr-feedback");
            get_session_pr_feedback(&name).await
        }
        (&Method::GET, "/api/sessions") => list_sessions(req).await,
        (&Method::GET, path) if path.starts_with("/api/sessions/") => {
            let name = extract_session_name(path);
            get_session(&name).await
        }
        (&Method::POST, path) if path.starts_with("/api/sessions/") && path.ends_with("/merge") => {
            let name = extract_session_name_for_action(path, "/merge");
            merge_session(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/pull-request") =>
        {
            let name = extract_session_name_for_action(path, "/pull-request");
            create_pull_request(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/prepare-pr") =>
        {
            let name = extract_session_name_for_action(path, "/prepare-pr");
            prepare_pull_request(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/prepare-gitlab-mr") =>
        {
            let name = extract_session_name_for_action(path, "/prepare-gitlab-mr");
            prepare_gitlab_merge_request(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/prepare-merge") =>
        {
            let name = extract_session_name_for_action(path, "/prepare-merge");
            prepare_merge(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/link-pr") =>
        {
            let name = extract_session_name_for_action(path, "/link-pr");
            link_session_pr(req, &name, app).await
        }
        (&Method::DELETE, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/link-pr") =>
        {
            let name = extract_session_name_for_action(path, "/link-pr");
            unlink_session_pr(&name, app).await
        }
        (&Method::DELETE, path) if path.starts_with("/api/sessions/") => {
            let name = extract_session_name(path);
            delete_session(&name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/convert-to-spec") =>
        {
            let name = extract_session_name_for_action(path, "/convert-to-spec");
            convert_session_to_spec(&name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/promote") =>
        {
            let name = extract_session_name_for_action(path, "/promote");
            promote_session(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/sessions/") && path.ends_with("/consolidation-report") =>
        {
            let name = extract_session_name_for_action(path, "/consolidation-report");
            update_consolidation_report(req, &name, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/consolidation-rounds/") && path.ends_with("/judge") =>
        {
            let round_id = extract_round_id_for_action(path, "/judge");
            trigger_consolidation_judge(req, &round_id, app).await
        }
        (&Method::POST, path)
            if path.starts_with("/api/consolidation-rounds/") && path.ends_with("/confirm") =>
        {
            let round_id = extract_round_id_for_action(path, "/confirm");
            confirm_consolidation_winner(req, &round_id, app).await
        }
        (&Method::POST, path) if path.starts_with("/api/sessions/") && path.ends_with("/reset") => {
            let name = extract_session_name_for_action(path, "/reset");
            reset_session(req, &name, app).await
        }
        (&Method::GET, "/api/project/setup-script") => get_project_setup_script(app).await,
        (&Method::PUT, "/api/project/setup-script") => set_project_setup_script(req, app).await,
        (&Method::GET, "/api/project/worktree-base-directory") => {
            get_project_worktree_base_directory(app).await
        }
        (&Method::PUT, "/api/project/worktree-base-directory") => {
            set_project_worktree_base_directory(req, app).await
        }
        (&Method::GET, "/api/project/run-script") => get_project_run_script_api().await,
        (&Method::POST, "/api/project/run-script/execute") => execute_project_run_script().await,
        (&Method::GET, "/api/epics") => list_epics().await,
        (&Method::POST, "/api/epics") => create_epic(req, app).await,
        _ => Ok(not_found_response()),
    }
}

fn project_override_from_headers(headers: &HeaderMap) -> Option<PathBuf> {
    headers
        .get("X-Project-Path")
        .and_then(|v| v.to_str().ok())
        .map(PathBuf::from)
}

fn extract_draft_name(path: &str, prefix: &str) -> String {
    let name = &path[prefix.len()..];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_draft_name_for_start(path: &str) -> String {
    let prefix = "/api/specs/";
    let suffix = "/start";
    let name = &path[prefix.len()..path.len() - suffix.len()];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_draft_name_for_action(path: &str, action: &str) -> String {
    let prefix = "/api/specs/";
    let name = &path[prefix.len()..path.len() - action.len()];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_session_name(path: &str) -> String {
    let prefix = "/api/sessions/";
    let name = &path[prefix.len()..];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_session_name_for_action(path: &str, action: &str) -> String {
    let prefix = "/api/sessions/";
    let suffix = action;
    let name = &path[prefix.len()..path.len() - suffix.len()];
    urlencoding::decode(name)
        .unwrap_or(std::borrow::Cow::Borrowed(name))
        .to_string()
}

fn extract_round_id_for_action(path: &str, action: &str) -> String {
    let prefix = "/api/consolidation-rounds/";
    let round_id = &path[prefix.len()..path.len() - action.len()];
    urlencoding::decode(round_id)
        .unwrap_or(std::borrow::Cow::Borrowed(round_id))
        .to_string()
}

fn not_found_response() -> Response<String> {
    let mut response = Response::new("Not Found".to_string());
    *response.status_mut() = StatusCode::NOT_FOUND;
    response
}

struct CreateSpecParams<'a> {
    name: &'a str,
    content: &'a str,
    agent_type: Option<&'a str>,
    epic_id: Option<&'a str>,
    issue_number: Option<i64>,
    issue_url: Option<&'a str>,
    pr_number: Option<i64>,
    pr_url: Option<&'a str>,
    db: Option<&'a Database>,
}

fn create_spec_session_with_notifications<F>(
    manager: &SessionManager,
    params: CreateSpecParams<'_>,
    emit_sessions: F,
) -> anyhow::Result<Spec>
where
    F: Fn() -> Result<(), tauri::Error>,
{
    let session = manager.create_spec_session_with_agent(
        params.name,
        params.content,
        params.agent_type,
        None,
        params.epic_id,
    )?;
    if let Some(db) = params.db {
        if params.issue_number.is_some() || params.issue_url.is_some() {
            db.update_spec_issue_info(&session.id, params.issue_number, params.issue_url)?;
        }
        if params.pr_number.is_some() || params.pr_url.is_some() {
            db.update_spec_pr_info(&session.id, params.pr_number, params.pr_url)?;
        }
    }
    if let Err(e) = emit_sessions() {
        warn!(
            "Failed to emit SessionsRefreshed after creating spec '{}': {e}",
            params.name
        );
    }
    Ok(session)
}

fn error_response(status: StatusCode, message: String) -> Response<String> {
    let mut response = Response::new(message);
    *response.status_mut() = status;
    response
}

fn json_response(status: StatusCode, json: String) -> Response<String> {
    let mut response = Response::new(json);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn json_error_response(status: StatusCode, message: String) -> Response<String> {
    let body = serde_json::json!({ "error": message }).to_string();
    json_response(status, body)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedPresetSlot {
    agent_type: String,
    autonomy_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedPreset {
    id: String,
    name: String,
    slots: Vec<ResolvedPresetSlot>,
}

#[derive(Debug, Clone, Default)]
struct PresetLaunchOptions<'a> {
    base_branch: Option<&'a str>,
    custom_branch: Option<&'a str>,
    use_existing_branch: bool,
    epic_id: Option<&'a str>,
    issue_number: Option<i64>,
    issue_url: Option<&'a str>,
    pr_number: Option<i64>,
    pr_url: Option<&'a str>,
    version_group_id: Option<&'a str>,
    is_consolidation: bool,
    consolidation_source_ids: Option<Vec<String>>,
    consolidation_round_id: Option<&'a str>,
    consolidation_role: Option<&'a str>,
    consolidation_confirmation_mode: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct PresetLaunchMetadata {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct PresetLaunchSessionSummary {
    name: String,
    branch: String,
    agent_type: String,
    version_number: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct PresetLaunchResponse {
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_spec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    archived_spec: Option<bool>,
    preset: PresetLaunchMetadata,
    version_group_id: String,
    sessions: Vec<PresetLaunchSessionSummary>,
}

#[derive(Debug, Clone)]
struct PresetLaunchSettings {
    presets: Vec<AgentPreset>,
    autonomy_prompt_template: String,
}

fn resolve_preset(selector: &str, presets: &[AgentPreset]) -> Result<ResolvedPreset, String> {
    let normalized = selector.trim();
    if normalized.is_empty() {
        return Err("Preset selector cannot be empty".to_string());
    }

    let preset = presets
        .iter()
        .find(|preset| preset.id == normalized)
        .or_else(|| {
            presets
                .iter()
                .find(|preset| preset.name.eq_ignore_ascii_case(normalized))
        })
        .ok_or_else(|| format!("Unknown preset '{normalized}'"))?;

    if preset.slots.is_empty() {
        return Err(format!("Preset '{}' has zero slots", preset.name));
    }

    Ok(ResolvedPreset {
        id: preset.id.clone(),
        name: preset.name.clone(),
        slots: preset
            .slots
            .iter()
            .map(|slot| ResolvedPresetSlot {
                agent_type: slot.agent_type.clone(),
                autonomy_enabled: slot.autonomy_enabled.unwrap_or(false),
            })
            .collect(),
    })
}

fn validate_preset_request_conflicts(
    preset: Option<&str>,
    agent_type: Option<&str>,
) -> Result<(), String> {
    if preset.is_some() && agent_type.is_some() {
        return Err("'preset' is mutually exclusive with 'agent_type'".to_string());
    }

    Ok(())
}

fn build_preset_launch_response(
    preset: &ResolvedPreset,
    version_group_id: String,
    sessions: Vec<Session>,
) -> PresetLaunchResponse {
    let summaries = sessions
        .into_iter()
        .enumerate()
        .map(|(index, session)| PresetLaunchSessionSummary {
            name: session.name,
            branch: session.branch,
            agent_type: session
                .original_agent_type
                .unwrap_or_else(|| preset.slots[index].agent_type.clone()),
            version_number: session.version_number.unwrap_or((index + 1) as i32),
        })
        .collect();

    PresetLaunchResponse {
        mode: "preset".to_string(),
        source_spec: None,
        archived_spec: None,
        preset: PresetLaunchMetadata {
            id: preset.id.clone(),
            name: preset.name.clone(),
        },
        version_group_id,
        sessions: summaries,
    }
}

async fn rollback_created_preset_sessions(
    manager: &SessionManager,
    db: &Database,
    session_names: &[String],
) -> Vec<String> {
    let mut failures = Vec::new();

    for name in session_names.iter().rev() {
        let session = match manager.get_session(name) {
            Ok(session) => session,
            Err(err) => {
                failures.push(format!("{name}: failed to load session for rollback: {err}"));
                continue;
            }
        };

        if let Err(err) = manager.fast_cancel_session(name).await {
            failures.push(format!("{name}: {err}"));
            continue;
        }

        if let Err(err) = db.delete_session(&session.id) {
            failures.push(format!("{name}: failed to delete rolled back session: {err}"));
        }
    }

    failures
}

fn persist_session_metadata(
    db: &Database,
    session_id: &str,
    issue_number: Option<i64>,
    issue_url: Option<&str>,
    pr_number: Option<i64>,
    pr_url: Option<&str>,
) -> Result<(), String> {
    if (issue_number.is_some() || issue_url.is_some())
        && let Err(err) = db.update_session_issue_info(session_id, issue_number, issue_url)
    {
        return Err(format!("Failed to persist issue metadata: {err}"));
    }

    if (pr_number.is_some() || pr_url.is_some())
        && let Err(err) = db.update_session_pr_info(session_id, pr_number, pr_url)
    {
        return Err(format!("Failed to persist PR metadata: {err}"));
    }

    Ok(())
}

async fn create_sessions_from_preset_launch(
    manager: &SessionManager,
    db: &Database,
    name: &str,
    prompt: Option<&str>,
    preset: &ResolvedPreset,
    options: &PresetLaunchOptions<'_>,
    autonomy_prompt_template: &str,
) -> Result<PresetLaunchResponse, String> {
    use lucode::domains::sessions::service::SessionCreationParams;

    let version_group_id = options
        .version_group_id
        .map(ToString::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let consolidation_round_id = if options.is_consolidation {
        Some(
            options
                .consolidation_round_id
                .map(ToString::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        )
    } else {
        None
    };
    let total_slots = preset.slots.len();
    let mut created_sessions = Vec::new();
    let mut created_session_names = Vec::new();

    for (index, slot) in preset.slots.iter().enumerate() {
        let version_number = (index + 1) as i32;
        let session_name = if total_slots == 1 {
            name.to_string()
        } else {
            format!("{name}_v{version_number}")
        };
        let expanded_prompt = lucode::domains::sessions::autonomy::build_initial_prompt(
            prompt,
            slot.autonomy_enabled,
            autonomy_prompt_template,
        );
        let params = SessionCreationParams {
            name: &session_name,
            prompt: expanded_prompt.as_deref(),
            base_branch: options.base_branch,
            custom_branch: options.custom_branch,
            use_existing_branch: options.use_existing_branch,
            sync_with_origin: options.use_existing_branch,
            was_auto_generated: false,
            version_group_id: Some(version_group_id.as_str()),
            version_number: Some(version_number),
            epic_id: options.epic_id,
            agent_type: Some(slot.agent_type.as_str()),
            pr_number: options.pr_number,
            is_consolidation: options.is_consolidation,
            consolidation_source_ids: options.consolidation_source_ids.clone(),
            consolidation_round_id: consolidation_round_id.as_deref(),
            consolidation_role: options.consolidation_role,
            consolidation_confirmation_mode: options.consolidation_confirmation_mode,
        };

        let session = match manager.create_session_with_agent(params) {
            Ok(session) => session,
            Err(err) => {
                let rollback_failures =
                    rollback_created_preset_sessions(manager, db, &created_session_names).await;
                let rollback_suffix = if rollback_failures.is_empty() {
                    String::new()
                } else {
                    format!(" Rollback failures: {}", rollback_failures.join(", "))
                };
                return Err(format!("Failed to create preset session '{session_name}': {err}.{rollback_suffix}"));
            }
        };

        if let Err(err) = persist_session_metadata(
            db,
            &session.id,
            options.issue_number,
            options.issue_url,
            options.pr_number,
            options.pr_url,
        ) {
            created_session_names.push(session.name.clone());
            let rollback_failures =
                rollback_created_preset_sessions(manager, db, &created_session_names).await;
            let rollback_suffix = if rollback_failures.is_empty() {
                String::new()
            } else {
                format!(" Rollback failures: {}", rollback_failures.join(", "))
            };
            return Err(format!("{err}.{rollback_suffix}"));
        }

        created_session_names.push(session.name.clone());
        created_sessions.push(session);
    }

    if options.is_consolidation
        && let (Some(round_id), Some(source_ids), Some(mode)) = (
            consolidation_round_id.as_deref(),
            options.consolidation_source_ids.as_ref(),
            options.consolidation_confirmation_mode,
        )
    {
        upsert_consolidation_round(
            db,
            manager.repo_path(),
            round_id,
            &version_group_id,
            source_ids,
            mode,
        )
        .map_err(|err| format!("Failed to persist consolidation round: {err}"))?;
    }

    Ok(build_preset_launch_response(
        preset,
        version_group_id,
        created_sessions,
    ))
}

async fn start_spec_with_preset_launch(
    manager: &SessionManager,
    db: &Database,
    spec_name: &str,
    preset: &ResolvedPreset,
    options: &PresetLaunchOptions<'_>,
    autonomy_prompt_template: &str,
) -> Result<PresetLaunchResponse, String> {
    let spec = manager
        .get_spec(spec_name)
        .map_err(|err| format!("Spec '{spec_name}' not found: {err}"))?;
    let launch_options = PresetLaunchOptions {
        epic_id: spec.epic_id.as_deref().or(options.epic_id),
        ..options.clone()
    };
    let mut response = create_sessions_from_preset_launch(
        manager,
        db,
        &spec.name,
        Some(spec.content.as_str()),
        preset,
        &launch_options,
        autonomy_prompt_template,
    )
    .await?;

    if let Err(err) = manager.archive_spec_session(&spec.name) {
        let created_session_names = response
            .sessions
            .iter()
            .map(|session| session.name.clone())
            .collect::<Vec<_>>();
        let rollback_failures =
            rollback_created_preset_sessions(manager, db, &created_session_names).await;
        let rollback_suffix = if rollback_failures.is_empty() {
            String::new()
        } else {
            format!(" Rollback failures: {}", rollback_failures.join(", "))
        };
        return Err(format!(
            "Failed to archive source spec '{}': {err}.{rollback_suffix}",
            spec.name
        ));
    }

    response.source_spec = Some(spec.name);
    response.archived_spec = Some(true);
    Ok(response)
}

async fn load_preset_launch_settings(
    app: &tauri::AppHandle,
) -> Result<PresetLaunchSettings, String> {
    let settings_manager = crate::get_settings_manager(app).await?;
    let manager = settings_manager.lock().await;
    let generation_settings = manager.get_generation_settings();

    Ok(PresetLaunchSettings {
        presets: manager.get_agent_presets(),
        autonomy_prompt_template: generation_settings
            .autonomy_prompt_template
            .unwrap_or_else(lucode::domains::settings::default_autonomy_prompt_template),
    })
}

#[derive(Debug, Deserialize)]
struct PromoteSessionRequest {
    reason: String,
    #[serde(default)]
    winner_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct PromoteSessionResponse {
    session_name: String,
    siblings_cancelled: Vec<String>,
    reason: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    failures: Vec<String>,
}

#[derive(Debug)]
struct PromoteSessionOutcome {
    status: StatusCode,
    response: PromoteSessionResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConsolidationRoundRecord {
    id: String,
    repository_path: String,
    version_group_id: String,
    confirmation_mode: String,
    status: String,
    source_session_ids: Vec<String>,
    recommended_session_id: Option<String>,
    recommended_by_session_id: Option<String>,
    confirmed_session_id: Option<String>,
    confirmed_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateConsolidationReportRequest {
    report: String,
    #[serde(default)]
    base_session_id: Option<String>,
    #[serde(default)]
    recommended_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct UpdateConsolidationReportResponse {
    session_name: String,
    round_id: String,
    role: String,
    auto_judge_triggered: bool,
    auto_promoted: bool,
}

#[derive(Debug, Deserialize)]
struct TriggerConsolidationJudgeRequest {
    #[serde(default)]
    early: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct TriggerConsolidationJudgeResponse {
    round_id: String,
    judge_session_name: String,
}

#[derive(Debug, Deserialize)]
struct ConfirmConsolidationWinnerRequest {
    winner_session_id: String,
    #[serde(default)]
    override_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ConfirmConsolidationWinnerResponse {
    round_id: String,
    winner_session_name: String,
    promoted_session_name: String,
    candidate_sessions_cancelled: Vec<String>,
    source_sessions_cancelled: Vec<String>,
}

fn strip_version_suffix(name: &str) -> &str {
    if let Some(idx) = name.rfind("_v") {
        let suffix = &name[idx + 2..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return &name[..idx];
        }
    }
    name
}

fn has_version_suffix(name: &str) -> bool {
    strip_version_suffix(name) != name
}

fn parse_version_suffix(name: &str) -> Option<i32> {
    name.rsplit_once("_v")
        .and_then(|(_, suffix)| suffix.parse::<i32>().ok())
}

fn sort_sessions_for_promotion(sessions: &mut [Session]) {
    sessions.sort_by_key(|session| {
        session
            .version_number
            .or_else(|| parse_version_suffix(&session.name))
            .unwrap_or(0)
    });
}

fn find_promotion_siblings(manager: &SessionManager, session: &Session) -> anyhow::Result<Vec<Session>> {
    let all_sessions = manager.list_sessions()?;

    if session.is_consolidation && let Some(source_ids) = session.consolidation_sources.as_ref() {
        // `consolidation_sources` may contain either session UUIDs (used by tests
        // and any caller with backend access) or session names (used by the
        // frontend, which only exposes names as "session_id"). Match against both.
        let mut siblings = all_sessions
            .iter()
            .filter(|candidate| {
                candidate.status == SessionStatus::Active
                    && source_ids
                        .iter()
                        .any(|source_id| source_id == &candidate.id || source_id == &candidate.name)
            })
            .cloned()
            .collect::<Vec<_>>();

        if !siblings.is_empty() {
            sort_sessions_for_promotion(&mut siblings);
            return Ok(siblings);
        }
    }

    let mut siblings = if let Some(group_id) = session.version_group_id.as_deref() {
        all_sessions
            .iter()
            .filter(|candidate| {
                candidate.id != session.id
                    && candidate.version_group_id.as_deref() == Some(group_id)
                    && candidate.status == SessionStatus::Active
            })
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    if siblings.is_empty() {
        let base_name = strip_version_suffix(&session.name);
        siblings = all_sessions
            .into_iter()
            .filter(|candidate| {
                candidate.id != session.id
                    && candidate.status == SessionStatus::Active
                    && has_version_suffix(&candidate.name)
                    && strip_version_suffix(&candidate.name) == base_name
            })
            .collect();
    }

    sort_sessions_for_promotion(&mut siblings);
    Ok(siblings)
}

async fn execute_session_promotion<RefreshFn, CancelFn, CancelFuture>(
    manager: &SessionManager,
    name: &str,
    reason: &str,
    winner_session_id: Option<&str>,
    refresh_fn: RefreshFn,
    mut cancel_fn: CancelFn,
) -> Result<PromoteSessionOutcome, (StatusCode, String)>
where
    RefreshFn: FnOnce() -> anyhow::Result<()>,
    CancelFn: FnMut(&str) -> CancelFuture,
    CancelFuture: Future<Output = anyhow::Result<()>>,
{
    let trimmed_reason = reason.trim();
    if trimmed_reason.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "'reason' is required".to_string()));
    }

    let session = manager.get_session(name).map_err(|error| {
        (
            StatusCode::NOT_FOUND,
            format!("Session '{name}' not found: {error}"),
        )
    })?;

    if session.session_state == SessionState::Spec {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Session '{name}' is a spec and cannot be promoted"),
        ));
    }

    if session.consolidation_role.as_deref() == Some("judge") {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Judge consolidation session '{name}' cannot be promoted"),
        ));
    }

    let siblings = find_promotion_siblings(manager, &session).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list sessions: {error}"),
        )
    })?;

    if siblings.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Session '{name}' has no siblings to promote over"),
        ));
    }

    if let Some(winner_id) = winner_session_id {
        if !session.is_consolidation {
            return Err((
                StatusCode::BAD_REQUEST,
                format!(
                    "winner_session_id can only be used when promoting a consolidation session; '{name}' is not one"
                ),
            ));
        }
        return execute_consolidation_winner_promotion(
            manager,
            &session,
            siblings,
            winner_id,
            trimmed_reason,
            refresh_fn,
            cancel_fn,
        )
        .await;
    }

    manager
        .update_session_promotion_reason(name, Some(trimmed_reason))
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to store promotion reason: {error}"),
            )
        })?;

    let mut siblings_cancelled = Vec::new();
    let mut failures = Vec::new();

    for sibling in siblings {
        match cancel_fn(&sibling.name).await {
            Ok(()) => siblings_cancelled.push(sibling.name),
            Err(error) => failures.push(format!("{}: {}", sibling.name, error)),
        }
    }

    if let Err(error) = refresh_fn() {
        failures.push(format!("sessions refresh: {error}"));
    }

    let status = if failures.is_empty() {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    Ok(PromoteSessionOutcome {
        status,
        response: PromoteSessionResponse {
            session_name: name.to_string(),
            siblings_cancelled,
            reason: trimmed_reason.to_string(),
            failures,
        },
    })
}

async fn execute_consolidation_winner_promotion<RefreshFn, CancelFn, CancelFuture>(
    manager: &SessionManager,
    consolidation: &Session,
    siblings: Vec<Session>,
    winner_id: &str,
    trimmed_reason: &str,
    refresh_fn: RefreshFn,
    mut cancel_fn: CancelFn,
) -> Result<PromoteSessionOutcome, (StatusCode, String)>
where
    RefreshFn: FnOnce() -> anyhow::Result<()>,
    CancelFn: FnMut(&str) -> CancelFuture,
    CancelFuture: Future<Output = anyhow::Result<()>>,
{
    debug_assert!(
        consolidation.is_consolidation,
        "execute_consolidation_winner_promotion must be called with a consolidation session"
    );

    let source_ids = consolidation.consolidation_sources.as_ref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Consolidation session has no recorded source versions".to_string(),
        )
    })?;

    // `winner_session_id` may be either the database UUID or the session name.
    // The frontend passes session names (because the "session_id" field exposed to
    // the UI is actually the session name), while the Rust tests use UUIDs.
    // Accept both and validate that the resolved winner is one of the recorded
    // consolidation sources.
    let winner = match manager.get_session_by_id(winner_id) {
        Ok(session) => session,
        Err(_) => manager.get_session(winner_id).map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                format!("Winner session '{winner_id}' not found: {error}"),
            )
        })?,
    };

    let winner_in_sources = source_ids
        .iter()
        .any(|source| source == &winner.id || source == &winner.name);
    if !winner_in_sources {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "winner_session_id '{winner_id}' is not among the consolidation sources"
            ),
        ));
    }

    if winner.status != SessionStatus::Active {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "Winner session '{}' is not active (status: {}); cannot transplant consolidated work",
                winner.name,
                winner.status.as_str()
            ),
        ));
    }

    if winner.session_state == SessionState::Spec {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "Winner session '{}' is a spec and cannot receive a promotion",
                winner.name
            ),
        ));
    }

    // Warn before we overwrite anything the user may have left in the winner worktree.
    // The reset below is atomic (single libgit2 hard-reset moves the checked-out branch
    // ref and the working tree together), but it *will* discard any uncommitted changes
    // or untracked files not part of the consolidated result.
    match lucode::domains::git::operations::has_uncommitted_changes(&winner.worktree_path) {
        Ok(true) => log::warn!(
            "Winner session '{}' has uncommitted changes in {} — they will be overwritten by the consolidation transplant",
            winner.name,
            winner.worktree_path.display()
        ),
        Ok(false) => {}
        Err(error) => log::warn!(
            "Could not inspect winner worktree '{}' for uncommitted changes before transplant: {error}",
            winner.worktree_path.display()
        ),
    }

    // Single atomic operation: open the winner's worktree, resolve the consolidation
    // branch from the shared ref db, and hard-reset. This moves the currently
    // checked-out winner branch ref AND updates the working tree in one step, so
    // we can't leave behind a stale worktree pointing at a moved ref.
    lucode::domains::git::worktrees::reset_worktree_to_base(
        &winner.worktree_path,
        &consolidation.branch,
    )
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "Failed to transplant consolidation branch '{}' onto winner '{}' at {}: {error}",
                consolidation.branch,
                winner.name,
                winner.worktree_path.display()
            ),
        )
    })?;

    manager
        .update_session_promotion_reason(&winner.name, Some(trimmed_reason))
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to store promotion reason on winner: {error}"),
            )
        })?;

    let to_cancel: Vec<Session> = siblings
        .into_iter()
        .filter(|candidate| candidate.id != winner.id)
        .collect();

    let mut siblings_cancelled = Vec::new();
    let mut failures = Vec::new();

    for sibling in to_cancel {
        match cancel_fn(&sibling.name).await {
            Ok(()) => siblings_cancelled.push(sibling.name),
            Err(error) => failures.push(format!("{}: {}", sibling.name, error)),
        }
    }

    if let Err(error) = refresh_fn() {
        failures.push(format!("sessions refresh: {error}"));
    }

    let status = if failures.is_empty() {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };

    Ok(PromoteSessionOutcome {
        status,
        response: PromoteSessionResponse {
            session_name: winner.name,
            siblings_cancelled,
            reason: trimmed_reason.to_string(),
            failures,
        },
    })
}

fn promote_outcome_response(name: &str, outcome: PromoteSessionOutcome) -> Response<String> {
    let json = serde_json::to_string(&outcome.response).unwrap_or_else(|error| {
        error!("Failed to serialize promote response for '{name}': {error}");
        "{}".to_string()
    });

    json_response(outcome.status, json)
}

pub(crate) fn upsert_consolidation_round(
    db: &Database,
    repo_path: &Path,
    round_id: &str,
    version_group_id: &str,
    source_session_ids: &[String],
    confirmation_mode: &str,
) -> anyhow::Result<()> {
    let repo = lucode::domains::sessions::SessionDbManager::new(db.clone(), repo_path.to_path_buf());
    repo.upsert_consolidation_round(round_id, version_group_id, source_session_ids, confirmation_mode)
}

fn get_consolidation_round(
    db: &Database,
    repo_path: &Path,
    round_id: &str,
) -> anyhow::Result<ConsolidationRoundRecord> {
    let repo = lucode::domains::sessions::SessionDbManager::new(db.clone(), repo_path.to_path_buf());
    let round = repo.get_consolidation_round(round_id)?;
    Ok(ConsolidationRoundRecord {
        id: round.id,
        repository_path: round.repository_path,
        version_group_id: round.version_group_id,
        confirmation_mode: round.confirmation_mode,
        status: round.status,
        source_session_ids: round.source_session_ids,
        recommended_session_id: round.recommended_session_id,
        recommended_by_session_id: round.recommended_by_session_id,
        confirmed_session_id: round.confirmed_session_id,
        confirmed_by: round.confirmed_by,
    })
}

fn update_consolidation_round_recommendation(
    db: &Database,
    round_id: &str,
    recommended_session_id: Option<&str>,
    recommended_by_session_id: Option<&str>,
    status: &str,
) -> anyhow::Result<()> {
    let repo = lucode::domains::sessions::SessionDbManager::new(db.clone(), PathBuf::new());
    repo.update_consolidation_round_recommendation(round_id, recommended_session_id, recommended_by_session_id, status)
}

fn update_consolidation_round_confirmation(
    db: &Database,
    round_id: &str,
    confirmed_session_id: &str,
    confirmed_by: &str,
) -> anyhow::Result<()> {
    let repo = lucode::domains::sessions::SessionDbManager::new(db.clone(), PathBuf::new());
    repo.update_consolidation_round_confirmation(round_id, confirmed_session_id, confirmed_by)
}

fn update_session_consolidation_report(
    db: &Database,
    repo_path: &Path,
    session_name: &str,
    report: &str,
    base_session_id: Option<&str>,
    recommended_session_id: Option<&str>,
) -> anyhow::Result<()> {
    let repo = lucode::domains::sessions::SessionDbManager::new(db.clone(), repo_path.to_path_buf());
    repo.update_session_consolidation_report(session_name, report, base_session_id, recommended_session_id)
}

fn list_round_sessions(manager: &SessionManager, round_id: &str) -> anyhow::Result<Vec<Session>> {
    Ok(manager
        .list_sessions()?
        .into_iter()
        .filter(|session| session.consolidation_round_id.as_deref() == Some(round_id))
        .collect())
}

fn build_judge_prompt(candidate_sessions: &[Session], source_session_ids: &[String]) -> String {
    let mut prompt = String::from(
        "Review every consolidation candidate for this Lucode consolidation round.\n\n",
    );
    prompt.push_str("Source sessions:\n");
    for source in source_session_ids {
        prompt.push_str(&format!("- {source}\n"));
    }
    prompt.push_str("\nCandidates:\n");
    for candidate in candidate_sessions {
        let report = candidate
            .consolidation_report
            .as_deref()
            .unwrap_or("<missing report>");
        let base = candidate
            .consolidation_base_session_id
            .as_deref()
            .unwrap_or("<missing base>");
        prompt.push_str(&format!(
            "- {}\n  base_session_id: {}\n  report:\n{}\n\n",
            candidate.name, base, report
        ));
    }
    prompt.push_str(
        "Choose the strongest consolidation candidate. File your reasoning through lucode_consolidation_report with recommended_session_id set to the winning candidate session ID. Do not call lucode_promote directly.",
    );
    prompt
}

async fn diff_summary(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    let query = req.uri().query().unwrap_or("");
    let mut session_param: Option<String> = None;
    let mut cursor_param: Option<String> = None;
    let mut page_size_param: Option<String> = None;

    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "session" => session_param = Some(value.into_owned()),
            "cursor" => cursor_param = Some(value.into_owned()),
            "page_size" => page_size_param = Some(value.into_owned()),
            _ => {}
        }
    }

    let page_size = match parse_optional_usize(page_size_param, "page_size") {
        Ok(value) => value,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let scope = match resolve_diff_scope(session_param.as_deref()).await {
        Ok(scope) => scope,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let summary = match diff_api::compute_diff_summary(
        &scope,
        SummaryQuery {
            cursor: cursor_param,
            page_size,
        },
    ) {
        Ok(summary) => summary,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&summary) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize diff summary: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn diff_chunk(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    let query = req.uri().query().unwrap_or("");
    let mut session_param: Option<String> = None;
    let mut cursor_param: Option<String> = None;
    let mut line_limit_param: Option<String> = None;
    let mut path_param: Option<String> = None;

    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "session" => session_param = Some(value.into_owned()),
            "cursor" => cursor_param = Some(value.into_owned()),
            "line_limit" => line_limit_param = Some(value.into_owned()),
            "path" => path_param = Some(value.into_owned()),
            _ => {}
        }
    }

    let path = match path_param {
        Some(path) if !path.trim().is_empty() => path,
        _ => {
            return Ok(json_error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "path query parameter is required".into(),
            ));
        }
    };

    let line_limit = match parse_optional_usize(line_limit_param, "line_limit") {
        Ok(value) => value,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let scope = match resolve_diff_scope(session_param.as_deref()).await {
        Ok(scope) => scope,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let chunk = match diff_api::compute_diff_chunk(
        &scope,
        &path,
        DiffChunkRequest {
            cursor: cursor_param,
            line_limit,
        },
    ) {
        Ok(chunk) => chunk,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&chunk) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize diff chunk: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn get_session_spec(name: &str) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let manager = core.session_manager();
    let session = match resolve_session_by_selector(&manager, name) {
        Ok(session) => session,
        Err(err) => return Ok(diff_error_response(err)),
    };
    drop(core);

    let spec = match diff_api::fetch_session_spec(&session) {
        Ok(spec) => spec,
        Err(err) => return Ok(diff_error_response(err)),
    };

    let json = match serde_json::to_string(&spec) {
        Ok(json) => json,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize session spec: {e}"),
            ));
        }
    };

    Ok(json_response(StatusCode::OK, json))
}

async fn resolve_diff_scope(session_param: Option<&str>) -> Result<DiffScope, DiffApiError> {
    let core = get_core_read()
        .await
        .map_err(|e| internal_diff_error(format!("Internal error: {e}")))?;

    let scope = if let Some(selector) = session_param {
        let manager = core.session_manager();
        let session = resolve_session_by_selector(&manager, selector)?;
        DiffScope::for_session(&session)?
    } else {
        DiffScope::for_orchestrator(core.repo_path.clone())?
    };

    Ok(scope)
}

fn resolve_session_by_selector(
    manager: &SessionManager,
    selector: &str,
) -> Result<Session, DiffApiError> {
    manager
        .get_session_by_id(selector)
        .or_else(|_| manager.get_session(selector))
        .map_err(|_| {
            DiffApiError::new(
                StatusCode::NOT_FOUND,
                format!("Session '{selector}' not found"),
            )
        })
}

fn diff_error_response(err: DiffApiError) -> Response<String> {
    json_error_response(err.status, err.message)
}

fn parse_optional_usize(value: Option<String>, field: &str) -> Result<Option<usize>, DiffApiError> {
    if let Some(raw) = value {
        if raw.trim().is_empty() {
            return Ok(None);
        }
        let parsed = raw.parse::<usize>().map_err(|_| {
            DiffApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("{field} must be a positive integer"),
            )
        })?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

fn internal_diff_error(message: String) -> DiffApiError {
    DiffApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn setup_script_payload(setup_script: &str) -> serde_json::Value {
    let has_setup_script = !setup_script.trim().is_empty();
    let normalized_script = if has_setup_script {
        setup_script.to_string()
    } else {
        String::new()
    };

    serde_json::json!({
        "setup_script": normalized_script,
        "has_setup_script": has_setup_script
    })
}

#[derive(Debug, Serialize, Clone)]
struct SetupScriptRequestPayload {
    setup_script: String,
    has_setup_script: bool,
    pending_confirmation: bool,
    project_path: String,
}

fn parse_setup_script_request(body: &[u8]) -> Result<String, (StatusCode, String)> {
    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")))?;

    let Some(script) = payload.get("setup_script").and_then(|v| v.as_str()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            "Missing 'setup_script' field".to_string(),
        ));
    };

    Ok(script.to_string())
}

fn worktree_base_directory_payload(base_directory: Option<&str>) -> serde_json::Value {
    let has_custom_directory = base_directory
        .map(|d| !d.trim().is_empty())
        .unwrap_or(false);
    let normalized = if has_custom_directory {
        base_directory.unwrap_or("")
    } else {
        ""
    };

    serde_json::json!({
        "worktree_base_directory": normalized,
        "has_custom_directory": has_custom_directory
    })
}

fn parse_worktree_base_directory_request(
    body: &[u8],
) -> Result<Option<String>, (StatusCode, String)> {
    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")))?;

    let dir = payload
        .get("worktree_base_directory")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    Ok(dir)
}

#[derive(Debug, serde::Deserialize)]
struct LinkPrRequest {
    pr_number: i64,
    pr_url: String,
}

#[derive(Debug, serde::Serialize)]
struct LinkPrResponse {
    session: String,
    pr_number: Option<i64>,
    pr_url: Option<String>,
    linked: bool,
}

impl LinkPrResponse {
    fn linked(session: &str, pr_number: i64, pr_url: String) -> Self {
        Self {
            session: session.to_string(),
            pr_number: Some(pr_number),
            pr_url: Some(pr_url),
            linked: true,
        }
    }

    fn unlinked(session: &str) -> Self {
        Self {
            session: session.to_string(),
            pr_number: None,
            pr_url: None,
            linked: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use git2::Repository;
    use hyper::HeaderMap;
    use lucode::domains::sessions::service::SessionCreationParams;
    use lucode::domains::settings::{AgentPreset, AgentPresetSlot};
    use lucode::schaltwerk_core::Database;
    use std::cell::RefCell;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn init_test_repo() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new().expect("temp dir");
        let repo_path = tmp.path().to_path_buf();
        let repo = Repository::init(&repo_path).expect("init repo");

        // Configure git user for commits
        let mut config = repo.config().expect("config");
        config
            .set_str("user.email", "test@example.com")
            .expect("email");
        config.set_str("user.name", "Test User").expect("name");

        // Create initial commit so repo isn't empty
        std::fs::write(repo_path.join("README.md"), "# Test\n").expect("write readme");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("add path");
        index.write().expect("index write");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature = repo
            .signature()
            .unwrap_or_else(|_| git2::Signature::now("Test User", "test@example.com").unwrap());
        repo.commit(Some("HEAD"), &signature, &signature, "Initial", &tree, &[])
            .expect("commit");

        (tmp, repo_path)
    }

    fn create_manager(repo_path: &std::path::Path) -> SessionManager {
        let db_path = repo_path.join("test.db");
        let database = Database::new(Some(db_path)).expect("db");
        SessionManager::new(database, repo_path.to_path_buf())
    }

    fn make_spec_session(name: &str, content: Option<&str>) -> Spec {
        Spec {
            id: format!("spec-{name}"),
            name: name.to_string(),
            display_name: Some(format!("Display {name}")),
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            repository_path: PathBuf::from("/tmp/mock"),
            repository_name: "mock".to_string(),
            content: content.unwrap_or_default().to_string(),
            stage: SpecStage::Draft,
            attention_required: false,
            clarification_started: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn make_preset_slot(agent_type: &str, autonomy_enabled: Option<bool>) -> AgentPresetSlot {
        AgentPresetSlot {
            agent_type: agent_type.to_string(),
            variant_id: Some(format!("{agent_type}-variant")),
            autonomy_enabled,
        }
    }

    fn make_preset(id: &str, name: &str, slots: Vec<AgentPresetSlot>) -> AgentPreset {
        AgentPreset {
            id: id.to_string(),
            name: name.to_string(),
            slots,
            is_built_in: false,
        }
    }

    fn create_branch(repo_path: &Path, branch_name: &str) {
        let repo = Repository::open(repo_path).expect("open repo");
        let commit = repo
            .head()
            .expect("head")
            .peel_to_commit()
            .expect("commit");
        repo.branch(branch_name, &commit, false)
            .expect("create branch");
    }

    #[test]
    fn resolve_preset_matches_exact_id() {
        let preset = make_preset(
            "preset-smarts",
            "Smarts",
            vec![make_preset_slot("claude", Some(true))],
        );

        let resolved = resolve_preset("preset-smarts", &[preset]).expect("preset resolves");

        assert_eq!(resolved.id, "preset-smarts");
        assert_eq!(resolved.name, "Smarts");
        assert_eq!(resolved.slots.len(), 1);
        assert_eq!(resolved.slots[0].agent_type, "claude");
        assert!(resolved.slots[0].autonomy_enabled);
    }

    #[test]
    fn resolve_preset_matches_name_case_insensitively() {
        let preset = make_preset(
            "preset-smarts",
            "Smarts",
            vec![make_preset_slot("codex", None)],
        );

        let resolved = resolve_preset("sMaRtS", &[preset]).expect("preset resolves");

        assert_eq!(resolved.id, "preset-smarts");
        assert_eq!(resolved.name, "Smarts");
        assert_eq!(resolved.slots[0].agent_type, "codex");
        assert!(!resolved.slots[0].autonomy_enabled);
    }

    #[test]
    fn resolve_preset_rejects_unknown_selector() {
        let err = resolve_preset(
            "missing",
            &[make_preset(
                "preset-smarts",
                "Smarts",
                vec![make_preset_slot("claude", None)],
            )],
        )
        .expect_err("unknown preset should fail");

        assert!(err.contains("missing"));
    }

    #[test]
    fn resolve_preset_rejects_zero_slots() {
        let err = resolve_preset("preset-empty", &[make_preset("preset-empty", "Empty", vec![])])
            .expect_err("empty preset should fail");

        assert!(err.contains("zero slots"));
    }

    #[test]
    fn resolve_preset_rejects_empty_selector() {
        let presets = vec![make_preset(
            "preset-smarts",
            "Smarts",
            vec![make_preset_slot("claude", None)],
        )];
        let err = resolve_preset("   ", &presets).expect_err("empty selector should fail");
        assert!(err.contains("empty"));
    }

    #[test]
    fn resolve_preset_id_match_takes_precedence_over_name_match() {
        let presets = vec![
            make_preset(
                "Smarts",
                "First",
                vec![make_preset_slot("claude", None)],
            ),
            make_preset(
                "preset-2",
                "Smarts",
                vec![make_preset_slot("codex", None)],
            ),
        ];
        let resolved =
            resolve_preset("Smarts", &presets).expect("id match should beat name match");
        assert_eq!(resolved.id, "Smarts");
        assert_eq!(resolved.slots[0].agent_type, "claude");
    }

    #[test]
    fn validate_preset_request_conflicts_rejects_agent_with_preset() {
        let err = validate_preset_request_conflicts(Some("Smarts"), Some("claude"))
            .expect_err("preset conflicts should fail");

        assert!(err.contains("mutually exclusive"));
    }

    #[tokio::test]
    async fn create_sessions_from_preset_launch_returns_ordered_version_group_sessions() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let preset = ResolvedPreset {
            id: "preset-smarts".to_string(),
            name: "Smarts".to_string(),
            slots: vec![
                ResolvedPresetSlot {
                    agent_type: "claude".to_string(),
                    autonomy_enabled: false,
                },
                ResolvedPresetSlot {
                    agent_type: "codex".to_string(),
                    autonomy_enabled: false,
                },
            ],
        };

        let response = create_sessions_from_preset_launch(
            &manager,
            &db,
            "feature",
            Some("Ship the feature"),
            &preset,
            &PresetLaunchOptions::default(),
            "Autonomy template",
        )
        .await
        .expect("preset launch should succeed");

        assert_eq!(response.mode, "preset");
        assert_eq!(response.preset.id, "preset-smarts");
        assert_eq!(response.sessions.len(), 2);
        assert_eq!(response.sessions[0].name, "feature_v1");
        assert_eq!(response.sessions[0].agent_type, "claude");
        assert_eq!(response.sessions[0].version_number, 1);
        assert_eq!(response.sessions[1].name, "feature_v2");
        assert_eq!(response.sessions[1].agent_type, "codex");
        assert_eq!(response.sessions[1].version_number, 2);
        assert!(!response.version_group_id.is_empty());

        let first = manager.get_session("feature_v1").expect("first session");
        let second = manager.get_session("feature_v2").expect("second session");
        assert_eq!(
            first.version_group_id.as_deref(),
            Some(response.version_group_id.as_str())
        );
        assert_eq!(
            second.version_group_id.as_deref(),
            Some(response.version_group_id.as_str())
        );
        assert_eq!(first.version_number, Some(1));
        assert_eq!(second.version_number, Some(2));
    }

    #[tokio::test]
    async fn create_sessions_from_preset_launch_expands_autonomy_prompt() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let prompt = "Implement release notes support";
        let autonomy_template = "## Agent Instructions\nShip it";
        let preset = ResolvedPreset {
            id: "preset-smarts".to_string(),
            name: "Smarts".to_string(),
            slots: vec![ResolvedPresetSlot {
                agent_type: "claude".to_string(),
                autonomy_enabled: true,
            }],
        };

        let response = create_sessions_from_preset_launch(
            &manager,
            &db,
            "smart-launch",
            Some(prompt),
            &preset,
            &PresetLaunchOptions::default(),
            autonomy_template,
        )
        .await
        .expect("preset launch should succeed");

        let created = manager
            .get_session(&response.sessions[0].name)
            .expect("created session");
        let expected = lucode::domains::sessions::autonomy::build_initial_prompt(
            Some(prompt),
            true,
            autonomy_template,
        );
        assert_eq!(created.initial_prompt, expected);
    }

    #[tokio::test]
    async fn start_spec_with_preset_launch_creates_sessions_and_archives_spec() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let epic = manager
            .create_epic("preset-epic", Some("#00ff00"))
            .expect("create epic");
        manager
            .create_spec_session_with_agent(
                "preset-spec",
                "Spec-driven prompt",
                None,
                None,
                Some(&epic.id),
            )
            .expect("create spec");
        let preset = ResolvedPreset {
            id: "preset-smarts".to_string(),
            name: "Smarts".to_string(),
            slots: vec![ResolvedPresetSlot {
                agent_type: "codex".to_string(),
                autonomy_enabled: false,
            }],
        };

        let response = start_spec_with_preset_launch(
            &manager,
            &db,
            "preset-spec",
            &preset,
            &PresetLaunchOptions::default(),
            "Autonomy template",
        )
        .await
        .expect("preset start should succeed");

        assert_eq!(response.mode, "preset");
        assert_eq!(response.source_spec.as_deref(), Some("preset-spec"));
        assert_eq!(response.archived_spec, Some(true));
        assert_eq!(response.sessions.len(), 1);
        let created_name = response.sessions[0].name.clone();
        let created = manager
            .get_session(&created_name)
            .expect("created session");
        assert_eq!(created.epic_id.as_deref(), Some(epic.id.as_str()));
        assert!(manager.get_spec("preset-spec").is_err());
        assert_eq!(
            manager
                .list_archived_specs()
                .expect("archived specs")
                .iter()
                .filter(|spec| spec.session_name == "preset-spec")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn start_spec_with_preset_launch_rolls_back_partial_failure_and_keeps_spec_active() {
        let (_tmp, repo_path) = init_test_repo();
        create_branch(&repo_path, "existing-feature");
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        manager
            .create_spec_session("rollback-spec", "Spec rollback prompt")
            .expect("create spec");
        let preset = ResolvedPreset {
            id: "preset-smarts".to_string(),
            name: "Smarts".to_string(),
            slots: vec![
                ResolvedPresetSlot {
                    agent_type: "claude".to_string(),
                    autonomy_enabled: false,
                },
                ResolvedPresetSlot {
                    agent_type: "codex".to_string(),
                    autonomy_enabled: false,
                },
            ],
        };

        let options = PresetLaunchOptions {
            custom_branch: Some("existing-feature"),
            use_existing_branch: true,
            ..PresetLaunchOptions::default()
        };

        let err = start_spec_with_preset_launch(
            &manager,
            &db,
            "rollback-spec",
            &preset,
            &options,
            "Autonomy template",
        )
        .await
        .expect_err("second slot should fail and trigger rollback");

        assert!(err.contains("existing-feature"));
        assert!(manager.get_spec("rollback-spec").is_ok());
        assert!(manager.get_session("rollback-spec_v1").is_err());
        assert!(manager.list_archived_specs().expect("archived specs").is_empty());
    }

    #[test]
    fn create_spec_session_emits_sessions_refreshed_payload() {
        let (_tmp, repo_path) = init_test_repo();
        let manager = create_manager(&repo_path);
        let emitted = Arc::new(Mutex::new(false));
        let emitted_ids: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();
        let result = create_spec_session_with_notifications(
            &manager,
            CreateSpecParams {
                name: "draft-one",
                content: "Initial spec content",
                agent_type: None,
                epic_id: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
                db: None,
            },
            move || {
                let mut flag = emitted_clone.lock().expect("lock");
                *flag = true;
                Ok(())
            },
        );

        let session = result.expect("spec creation");
        assert!(
            *emitted.lock().expect("lock"),
            "SessionsRefreshed emitter should be invoked"
        );
        let sessions_after = manager
            .list_enriched_sessions()
            .expect("sessions available after refresh");
        {
            let mut ids = emitted_ids.lock().expect("lock");
            ids.extend(sessions_after.iter().map(|s| s.info.session_id.clone()));
        }
        assert!(
            emitted_ids
                .lock()
                .expect("lock")
                .iter()
                .any(|id| id == &session.name),
            "emitted sessions should include the new spec"
        );
    }

    #[test]
    fn spec_summary_from_session_surface_length_and_display_name() {
        let content = "# Spec\n\nDetails line";
        let session = make_spec_session("alpha", Some(content));
        let summary = SpecSummary::from_spec(&session);
        assert_eq!(summary.session_id, "alpha");
        assert_eq!(summary.display_name.as_deref(), Some("Display alpha"));
        assert_eq!(summary.content_length, content.chars().count());
        assert!(
            !summary.updated_at.is_empty(),
            "updated_at should be populated"
        );
    }

    #[test]
    fn spec_content_response_defaults_to_empty_when_missing() {
        let session = make_spec_session("beta", None);
        let response = SpecContentResponse::from_spec(&session);
        assert_eq!(response.session_id, "beta");
        assert_eq!(response.display_name.as_deref(), Some("Display beta"));
        assert_eq!(response.content, "");
        assert_eq!(response.content_length, 0);
    }

    #[test]
    fn project_override_header_is_parsed() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Project-Path", "/tmp/foo".parse().unwrap());

        let parsed = project_override_from_headers(&headers);

        assert_eq!(parsed, Some(PathBuf::from("/tmp/foo")));
    }

    #[test]
    fn project_override_header_absent_returns_none() {
        let headers = HeaderMap::new();

        let parsed = project_override_from_headers(&headers);

        assert!(parsed.is_none());
    }

    #[tokio::test]
    async fn request_project_override_scope_sets_and_clears() {
        let path = PathBuf::from("/tmp/scoped");

        let observed = REQUEST_PROJECT_OVERRIDE
            .scope(RefCell::new(Some(path.clone())), async move {
                REQUEST_PROJECT_OVERRIDE
                    .try_with(|cell| cell.borrow().clone())
                    .ok()
                    .flatten()
            })
            .await;

        assert_eq!(observed, Some(path));

        // Outside the scope the task-local should be unset
        let outside = REQUEST_PROJECT_OVERRIDE.try_with(|cell| cell.borrow().clone());
        assert!(outside.is_err());
    }

    #[test]
    fn setup_script_payload_marks_presence() {
        let payload = setup_script_payload("#!/bin/bash\necho hello");
        assert_eq!(payload["has_setup_script"], serde_json::json!(true));
        assert_eq!(
            payload["setup_script"],
            serde_json::json!("#!/bin/bash\necho hello")
        );

        let empty = setup_script_payload("   \n ");
        assert_eq!(empty["has_setup_script"], serde_json::json!(false));
        assert_eq!(empty["setup_script"], serde_json::json!(""));
    }

    #[test]
    fn parse_setup_script_request_requires_field() {
        let err = parse_setup_script_request(b"{}").expect_err("missing setup_script should error");
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn parse_setup_script_request_accepts_string() {
        let value = parse_setup_script_request(br#"{ "setup_script": "echo hi" }"#)
            .expect("valid script")
            .to_string();
        assert_eq!(value, "echo hi");
    }

    #[test]
    fn worktree_base_directory_payload_marks_presence() {
        let payload = worktree_base_directory_payload(Some("/tmp/worktrees"));
        assert_eq!(payload["has_custom_directory"], serde_json::json!(true));
        assert_eq!(
            payload["worktree_base_directory"],
            serde_json::json!("/tmp/worktrees")
        );

        let none_payload = worktree_base_directory_payload(None);
        assert_eq!(
            none_payload["has_custom_directory"],
            serde_json::json!(false)
        );
        assert_eq!(
            none_payload["worktree_base_directory"],
            serde_json::json!("")
        );

        let empty = worktree_base_directory_payload(Some("   "));
        assert_eq!(empty["has_custom_directory"], serde_json::json!(false));
        assert_eq!(empty["worktree_base_directory"], serde_json::json!(""));
    }

    #[test]
    fn parse_worktree_base_directory_request_returns_none_for_missing_field() {
        let result = parse_worktree_base_directory_request(b"{}").expect("empty body is valid");
        assert!(result.is_none());
    }

    #[test]
    fn parse_worktree_base_directory_request_returns_none_for_empty_string() {
        let result = parse_worktree_base_directory_request(br#"{ "worktree_base_directory": "" }"#)
            .expect("empty string is valid");
        assert!(result.is_none());
    }

    #[test]
    fn parse_worktree_base_directory_request_returns_none_for_whitespace() {
        let result =
            parse_worktree_base_directory_request(br#"{ "worktree_base_directory": "   " }"#)
                .expect("whitespace is valid");
        assert!(result.is_none());
    }

    #[test]
    fn parse_worktree_base_directory_request_accepts_path() {
        let result = parse_worktree_base_directory_request(
            br#"{ "worktree_base_directory": "/tmp/worktrees" }"#,
        )
        .expect("valid path");
        assert_eq!(result.as_deref(), Some("/tmp/worktrees"));
    }

    #[test]
    fn parse_worktree_base_directory_request_rejects_invalid_json() {
        let err = parse_worktree_base_directory_request(b"not json").expect_err("invalid json");
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn extract_session_name_for_link_pr_action() {
        assert_eq!(
            extract_session_name_for_action("/api/sessions/my-session/link-pr", "/link-pr"),
            "my-session"
        );
    }

    #[test]
    fn link_pr_response_serializes_linked_payload() {
        let json = serde_json::to_value(LinkPrResponse::linked(
            "alpha",
            42,
            "https://github.com/owner/repo/pull/42".to_string(),
        ))
        .expect("serialize response");

        assert_eq!(json["session"], "alpha");
        assert_eq!(json["pr_number"], 42);
        assert_eq!(json["pr_url"], "https://github.com/owner/repo/pull/42");
        assert_eq!(json["linked"], true);
    }

    #[test]
    fn link_pr_response_serializes_unlinked_payload() {
        let json =
            serde_json::to_value(LinkPrResponse::unlinked("alpha")).expect("serialize response");

        assert_eq!(json["session"], "alpha");
        assert!(json["pr_number"].is_null());
        assert!(json["pr_url"].is_null());
        assert_eq!(json["linked"], false);
    }

    #[test]
    fn reset_session_request_defaults_to_none() {
        let payload: ResetSessionRequest = serde_json::from_slice(b"{}").expect("payload");
        assert!(payload.agent_type.is_none());
        assert!(payload.prompt.is_none());
        assert!(payload.skip_prompt.is_none());
    }

    #[test]
    fn reset_session_request_parses_optional_fields() {
        let payload: ResetSessionRequest = serde_json::from_slice(
            br#"{ "agent_type": "claude", "prompt": "hi", "skip_prompt": true }"#,
        )
        .expect("payload");
        assert_eq!(payload.agent_type.as_deref(), Some("claude"));
        assert_eq!(payload.prompt.as_deref(), Some("hi"));
        assert_eq!(payload.skip_prompt, Some(true));
    }

    #[test]
    fn reset_selection_request_defaults_to_none() {
        let payload = parse_reset_selection_request(b"").expect("payload");
        assert!(payload.selection.is_none());
        assert!(payload.session_name.is_none());
        assert!(payload.agent_type.is_none());
        assert!(payload.prompt.is_none());
        assert!(payload.skip_prompt.is_none());
    }

    #[test]
    fn reset_selection_request_parses_fields() {
        let payload = parse_reset_selection_request(
            br#"{ "selection": "orchestrator", "agent_type": "opencode", "prompt": "go" }"#,
        )
        .expect("payload");
        assert_eq!(payload.selection.as_deref(), Some("orchestrator"));
        assert_eq!(payload.agent_type.as_deref(), Some("opencode"));
        assert_eq!(payload.prompt.as_deref(), Some("go"));
    }

    #[test]
    fn extract_draft_name_decodes_url_encoding() {
        assert_eq!(
            extract_draft_name("/api/specs/my%20spec", "/api/specs/"),
            "my spec"
        );
    }

    #[test]
    fn extract_draft_name_handles_plain_name() {
        assert_eq!(
            extract_draft_name("/api/specs/simple-name", "/api/specs/"),
            "simple-name"
        );
    }

    #[test]
    fn extract_draft_name_handles_special_characters() {
        assert_eq!(
            extract_draft_name("/api/specs/hello%2Fworld", "/api/specs/"),
            "hello/world"
        );
    }

    #[test]
    fn extract_draft_name_for_start_strips_suffix() {
        assert_eq!(
            extract_draft_name_for_start("/api/specs/my-draft/start"),
            "my-draft"
        );
    }

    #[test]
    fn extract_draft_name_for_start_decodes_url_encoding() {
        assert_eq!(
            extract_draft_name_for_start("/api/specs/my%20draft/start"),
            "my draft"
        );
    }

    #[test]
    fn extract_session_name_decodes_url_encoding() {
        assert_eq!(
            extract_session_name("/api/sessions/test%20session"),
            "test session"
        );
    }

    #[test]
    fn extract_session_name_handles_plain_name() {
        assert_eq!(
            extract_session_name("/api/sessions/plain-session"),
            "plain-session"
        );
    }

    #[test]
    fn extract_session_name_for_action_strips_action_suffix() {
        assert_eq!(
            extract_session_name_for_action("/api/sessions/my-session/merge", "/merge"),
            "my-session"
        );
    }

    #[test]
    fn extract_session_name_for_action_decodes_and_strips() {
        assert_eq!(
            extract_session_name_for_action(
                "/api/sessions/my%20session/prepare-merge",
                "/prepare-merge"
            ),
            "my session"
        );
    }

    #[test]
    fn not_found_response_has_404_status() {
        let resp = not_found_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(resp.body(), "Not Found");
    }

    #[test]
    fn error_response_sets_status_and_body() {
        let resp = error_response(StatusCode::BAD_REQUEST, "oops".to_string());
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(resp.body(), "oops");
    }

    #[test]
    fn json_response_sets_content_type_header() {
        let resp = json_response(StatusCode::OK, r#"{"ok":true}"#.to_string());
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/json"
        );
        assert_eq!(resp.body(), r#"{"ok":true}"#);
    }

    #[test]
    fn json_error_response_wraps_message_in_error_object() {
        let resp = json_error_response(StatusCode::UNPROCESSABLE_ENTITY, "bad input".to_string());
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body: serde_json::Value = serde_json::from_str(resp.body()).unwrap();
        assert_eq!(body["error"], "bad input");
    }

    #[test]
    fn parse_optional_usize_none_input() {
        let result = parse_optional_usize(None, "field").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn parse_optional_usize_empty_string() {
        let result = parse_optional_usize(Some("".to_string()), "field").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn parse_optional_usize_whitespace_only() {
        let result = parse_optional_usize(Some("   ".to_string()), "field").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn parse_optional_usize_valid_number() {
        let result = parse_optional_usize(Some("42".to_string()), "field").unwrap();
        assert_eq!(result, Some(42));
    }

    #[test]
    fn parse_optional_usize_zero() {
        let result = parse_optional_usize(Some("0".to_string()), "field").unwrap();
        assert_eq!(result, Some(0));
    }

    #[test]
    fn parse_optional_usize_invalid_string() {
        let err = parse_optional_usize(Some("abc".to_string()), "page_size").unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("page_size"));
    }

    #[test]
    fn parse_optional_usize_negative_number() {
        let err = parse_optional_usize(Some("-5".to_string()), "field").unwrap_err();
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn setup_script_payload_empty_string() {
        let payload = setup_script_payload("");
        assert_eq!(payload["has_setup_script"], serde_json::json!(false));
        assert_eq!(payload["setup_script"], serde_json::json!(""));
    }

    #[test]
    fn parse_setup_script_request_rejects_invalid_json() {
        let err = parse_setup_script_request(b"not json").unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(err.1.contains("Invalid JSON"));
    }

    #[test]
    fn parse_setup_script_request_rejects_non_string_value() {
        let err = parse_setup_script_request(br#"{ "setup_script": 42 }"#).unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn worktree_base_directory_payload_empty_string() {
        let payload = worktree_base_directory_payload(Some(""));
        assert_eq!(payload["has_custom_directory"], serde_json::json!(false));
        assert_eq!(payload["worktree_base_directory"], serde_json::json!(""));
    }

    #[test]
    fn merge_session_request_deserialization_defaults() {
        let payload: MergeSessionRequest = serde_json::from_slice(b"{}").unwrap();
        assert!(payload.mode.is_none());
        assert!(payload.commit_message.is_none());
        assert!(!payload.cancel_after_merge);
    }

    #[test]
    fn merge_session_request_deserialization_with_values() {
        let payload: MergeSessionRequest = serde_json::from_slice(
            br#"{ "mode": "squash", "commit_message": "feat: done", "cancel_after_merge": true }"#,
        )
        .unwrap();
        assert_eq!(payload.mode, Some(MergeMode::Squash));
        assert_eq!(payload.commit_message.as_deref(), Some("feat: done"));
        assert!(payload.cancel_after_merge);
    }

    #[test]
    fn pull_request_request_deserialization() {
        let payload: PullRequestRequest =
            serde_json::from_slice(br#"{ "pr_title": "My PR", "cancel_after_pr": true }"#).unwrap();
        assert_eq!(payload.pr_title, "My PR");
        assert!(payload.pr_body.is_none());
        assert!(payload.cancel_after_pr);
    }

    #[test]
    fn pull_request_request_deserialization_all_fields() {
        let payload: PullRequestRequest = serde_json::from_slice(
            br#"{
                "pr_title": "Title",
                "pr_body": "Body",
                "base_branch": "main",
                "pr_branch_name": "feature",
                "commit_message": "msg",
                "repository": "org/repo",
                "mode": "reapply",
                "cancel_after_pr": false
            }"#,
        )
        .unwrap();
        assert_eq!(payload.pr_title, "Title");
        assert_eq!(payload.pr_body.as_deref(), Some("Body"));
        assert_eq!(payload.base_branch.as_deref(), Some("main"));
        assert_eq!(payload.pr_branch_name.as_deref(), Some("feature"));
        assert_eq!(payload.commit_message.as_deref(), Some("msg"));
        assert_eq!(payload.repository.as_deref(), Some("org/repo"));
        assert_eq!(payload.mode, Some(MergeMode::Reapply));
        assert!(!payload.cancel_after_pr);
    }

    #[test]
    fn merge_session_response_serialization() {
        let response = MergeSessionResponse {
            session_name: "test".to_string(),
            parent_branch: "main".to_string(),
            session_branch: "feature".to_string(),
            mode: MergeMode::Squash,
            commit: "abc123".to_string(),
            cancel_requested: true,
            cancel_queued: true,
            cancel_error: None,
        };
        let json: serde_json::Value = serde_json::to_value(&response).unwrap();
        assert_eq!(json["session_name"], "test");
        assert_eq!(json["cancel_requested"], true);
        assert!(json["cancel_error"].is_null());
    }

    #[test]
    fn strip_version_suffix_removes_vn() {
        assert_eq!(strip_version_suffix("feature_v1"), "feature");
        assert_eq!(strip_version_suffix("feature_v2"), "feature");
        assert_eq!(strip_version_suffix("feature_v123"), "feature");
    }

    #[test]
    fn strip_version_suffix_preserves_non_versioned() {
        assert_eq!(strip_version_suffix("feature"), "feature");
        assert_eq!(strip_version_suffix("my_feature"), "my_feature");
        assert_eq!(strip_version_suffix("feature_vx"), "feature_vx");
        assert_eq!(strip_version_suffix("feature_v"), "feature_v");
    }

    #[test]
    fn promote_session_response_omits_failures_when_empty() {
        let response = PromoteSessionResponse {
            session_name: "feature_v3".to_string(),
            siblings_cancelled: vec!["feature_v1".to_string(), "feature_v2".to_string()],
            reason: "Best coverage".to_string(),
            failures: Vec::new(),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert!(json.get("failures").is_none());
    }

    #[test]
    fn consolidation_round_upsert_and_load() {
        let temp = TempDir::new().expect("temp dir");
        let repo_path = temp.path().join("repo");
        std::fs::create_dir_all(&repo_path).expect("create repo dir");
        let db = Database::new(Some(temp.path().join("test.db"))).expect("db");

        upsert_consolidation_round(
            &db,
            &repo_path,
            "round-1",
            "group-1",
            &["feature_v1".to_string(), "feature_v2".to_string()],
            "confirm",
        )
        .expect("upsert round");

        let round = get_consolidation_round(&db, &repo_path, "round-1").expect("load round");
        assert_eq!(round.id, "round-1");
        assert_eq!(round.version_group_id, "group-1");
        assert_eq!(round.confirmation_mode, "confirm");
        assert_eq!(round.status, "running");
        assert_eq!(round.source_session_ids, vec!["feature_v1", "feature_v2"]);
    }

    #[test]
    fn update_session_consolidation_report_persists_report_fields() {
        let temp = TempDir::new().expect("temp dir");
        let repo_path = temp.path().join("repo");
        std::fs::create_dir_all(&repo_path).expect("create repo dir");
        let db = Database::new(Some(temp.path().join("test.db"))).expect("db");
        let now = chrono::Utc::now();
        let session = Session {
            id: "candidate-1".to_string(),
            name: "candidate-1".to_string(),
            display_name: None,
            version_group_id: Some("group-1".to_string()),
            version_number: None,
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "repo".to_string(),
            branch: "lucode/candidate-1".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repo_path.join(".lucode/worktrees/candidate-1"),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: Some("claude".to_string()),
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
            is_consolidation: true,
            consolidation_sources: Some(vec!["feature_v1".to_string(), "feature_v2".to_string()]),
            consolidation_round_id: Some("round-1".to_string()),
            consolidation_role: Some("candidate".to_string()),
            consolidation_report: None,
            consolidation_base_session_id: None,
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: Some("confirm".to_string()),
            promotion_reason: None,
        };
        db.create_session(&session).expect("create session");

        update_session_consolidation_report(
            &db,
            &repo_path,
            "candidate-1",
            "## Decision\nKeep v1 base.",
            Some("feature_v1"),
            None,
        )
        .expect("update report");

        let updated = db.get_session_by_name(&repo_path, "candidate-1").expect("load updated");
        assert_eq!(updated.consolidation_report.as_deref(), Some("## Decision\nKeep v1 base."));
        assert_eq!(updated.consolidation_base_session_id.as_deref(), Some("feature_v1"));
    }

    #[tokio::test]
    async fn promote_session_logic_promotes_version_group_and_cancels_siblings() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        manager
            .create_session_with_auto_flag("feature_v1", None, None, false, Some("group-1"), Some(1))
            .expect("create v1");
        manager
            .create_session_with_auto_flag("feature_v2", None, None, false, Some("group-1"), Some(2))
            .expect("create v2");
        manager
            .create_session_with_auto_flag("feature_v3", None, None, false, Some("group-1"), Some(3))
            .expect("create v3");

        let cancelled = Arc::new(Mutex::new(Vec::new()));
        let cancelled_clone = cancelled.clone();

        let outcome = execute_session_promotion(
            &manager,
            "feature_v3",
            "Best test coverage. Cherry-picked caching from v2.",
            None,
            || Ok(()),
            move |name| {
                cancelled_clone.lock().unwrap().push(name.to_string());
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("promotion should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(outcome.response.session_name, "feature_v3");
        assert_eq!(
            outcome.response.siblings_cancelled,
            vec!["feature_v1".to_string(), "feature_v2".to_string()]
        );
        assert!(outcome.response.failures.is_empty());

        let promoted = db
            .get_session_by_name(Path::new(&repo_path), "feature_v3")
            .expect("load promoted session");
        assert_eq!(
            promoted.promotion_reason.as_deref(),
            Some("Best test coverage. Cherry-picked caching from v2.")
        );
        assert_eq!(
            cancelled.lock().unwrap().clone(),
            vec!["feature_v1".to_string(), "feature_v2".to_string()]
        );
    }

    #[tokio::test]
    async fn promote_session_logic_skips_inactive_siblings() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, Some("group-9"), Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, Some("group-9"), Some(2))
            .expect("create v2");
        manager
            .create_session_with_auto_flag("feature_v3", None, None, false, Some("group-9"), Some(3))
            .expect("create v3");

        db.update_session_status(&v2.id, SessionStatus::Cancelled)
            .expect("cancel v2");

        let outcome = execute_session_promotion(
            &manager,
            "feature_v3",
            "Keep only active siblings",
            None,
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect("promotion should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(outcome.response.siblings_cancelled, vec![v1.name]);
    }

    #[tokio::test]
    async fn promote_session_logic_uses_consolidation_sources_without_version_group_id() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");
        manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        let outcome = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "Merged the best ideas from both source sessions",
            None,
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect("promotion should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(outcome.response.siblings_cancelled, vec![v1.name, v2.name]);
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_session_without_siblings() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db, repo_path);
        manager
            .create_session_with_auto_flag("feature", None, None, false, None, None)
            .expect("create session");

        let err = execute_session_promotion(
            &manager,
            "feature",
            "Best version",
            None,
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(err.1.contains("has no siblings"));
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_spec_sessions() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        let session = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, None)
            .expect("create session");
        db.update_session_state(&session.id, SessionState::Spec)
            .expect("mark as spec");

        let err = execute_session_promotion(
            &manager,
            "feature_v1",
            "Keep this one",
            None,
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(err.1.contains("is a spec"));
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_judge_consolidation_sessions() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, Some("group-1"), Some(1))
            .expect("create v1");
        let _v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, Some("group-1"), Some(2))
            .expect("create v2");

        let judge = manager
            .create_session_with_agent(SessionCreationParams {
                name: "judge-session",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: Some("group-1"),
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.name.clone()]),
                consolidation_round_id: Some("round-1"),
                consolidation_role: Some("judge"),
                consolidation_confirmation_mode: Some("confirm"),
            })
            .expect("create judge");

        let err = execute_session_promotion(
            &manager,
            &judge.name,
            "Pick this one",
            None,
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail for judge sessions");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(err.1.contains("Judge consolidation session"));
    }

    fn commit_in_worktree(worktree_path: &Path, file: &str, contents: &str, message: &str) {
        std::fs::write(worktree_path.join(file), contents).expect("write file");
        let repo = Repository::open(worktree_path).expect("open worktree");
        let mut idx = repo.index().expect("index");
        idx.add_path(Path::new(file)).expect("add path");
        idx.write().expect("index write");
        let tree_id = idx.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = repo
            .signature()
            .unwrap_or_else(|_| git2::Signature::now("Test", "test@example.com").unwrap());
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .expect("commit");
    }

    fn branch_head_commit(repo_path: &Path, branch: &str) -> git2::Oid {
        let repo = Repository::open(repo_path).expect("open repo");
        let b = repo
            .find_branch(branch, git2::BranchType::Local)
            .expect("find branch");
        b.get().peel_to_commit().expect("peel commit").id()
    }

    #[tokio::test]
    async fn promote_session_logic_transplants_winner_branch_without_cancelling_consolidation() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");

        let consolidation = manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        commit_in_worktree(
            &consolidation.worktree_path,
            "merged.txt",
            "merged result",
            "consolidated change",
        );

        let consolidated_oid = branch_head_commit(&repo_path, &consolidation.branch);
        let v1_initial_oid = branch_head_commit(&repo_path, &v1.branch);
        assert_ne!(consolidated_oid, v1_initial_oid);

        let cancelled = Arc::new(Mutex::new(Vec::new()));
        let cancelled_clone = cancelled.clone();

        let outcome = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "v1 had the cleanest base; absorbed v2's tests",
            Some(v1.id.as_str()),
            || Ok(()),
            move |name| {
                cancelled_clone.lock().unwrap().push(name.to_string());
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("promotion should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(
            outcome.response.session_name,
            v1.name,
            "surviving session should be the winner, not the consolidation session"
        );

        // Winner branch now points at the consolidation's HEAD
        let v1_after_oid = branch_head_commit(&repo_path, &v1.branch);
        assert_eq!(
            v1_after_oid, consolidated_oid,
            "winner branch should be transplanted to consolidation HEAD"
        );

        // Winner worktree reflects the consolidated files
        assert!(
            v1.worktree_path.join("merged.txt").exists(),
            "winner worktree should contain the consolidated file after reset"
        );

        assert_eq!(outcome.response.siblings_cancelled, vec![v2.name.clone()]);

        // Only the losing source session was cancelled; winner and consolidation were not
        let cancelled_names = cancelled.lock().unwrap().clone();
        assert!(cancelled_names.contains(&v2.name));
        assert!(!cancelled_names.contains(&v1.name));
        assert!(!cancelled_names.contains(&consolidation.name));

        // promotion_reason stored on the winner, not the consolidation
        let winner_after = db
            .get_session_by_name(Path::new(&repo_path), &v1.name)
            .expect("load winner");
        assert_eq!(
            winner_after.promotion_reason.as_deref(),
            Some("v1 had the cleanest base; absorbed v2's tests")
        );
    }

    #[tokio::test]
    async fn promote_session_logic_accepts_winner_session_name_for_production_flow() {
        // Mirrors the production path where `consolidation_source_ids` are the
        // human-friendly session names (not DB UUIDs) because the frontend's
        // SessionInfo.session_id field exposes the session name.
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");

        let consolidation = manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.name.clone(), v2.name.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        commit_in_worktree(
            &consolidation.worktree_path,
            "merged.txt",
            "name based",
            "consolidated change",
        );

        let consolidated_oid = branch_head_commit(&repo_path, &consolidation.branch);

        let cancelled = Arc::new(Mutex::new(Vec::new()));
        let cancelled_clone = cancelled.clone();

        let outcome = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "v2 was the cleanest",
            Some(v2.name.as_str()),
            || Ok(()),
            move |name| {
                cancelled_clone.lock().unwrap().push(name.to_string());
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("promotion by name should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(outcome.response.session_name, v2.name);

        let v2_after_oid = branch_head_commit(&repo_path, &v2.branch);
        assert_eq!(v2_after_oid, consolidated_oid);

        let cancelled_names = cancelled.lock().unwrap().clone();
        assert!(cancelled_names.contains(&v1.name));
        assert!(!cancelled_names.contains(&v2.name));
        assert!(!cancelled_names.contains(&consolidation.name));
        assert_eq!(outcome.response.siblings_cancelled, vec![v1.name.clone()]);
    }

    #[tokio::test]
    async fn promote_consolidation_winner_leaves_consolidation_session_alive() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");

        let consolidation = manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        commit_in_worktree(
            &consolidation.worktree_path,
            "merged.txt",
            "merged result",
            "consolidated change",
        );

        let db_for_cancel = db.clone();
        let repo_for_cancel = repo_path.clone();

        let outcome = execute_session_promotion(
            &manager,
            &consolidation.name,
            "v1 had the cleanest base; absorbed v2's tests",
            Some(v1.id.as_str()),
            || Ok(()),
            |name| {
                let name = name.to_string();
                let db = db_for_cancel.clone();
                let repo_path = repo_for_cancel.clone();
                async move {
                    let cancel_manager = SessionManager::new(db, repo_path);
                    cancel_manager.fast_cancel_session(&name).await
                }
            },
        )
        .await
        .expect("promotion should succeed");

        assert_eq!(outcome.status, StatusCode::OK);
        assert_eq!(outcome.response.session_name, v1.name);
        assert_eq!(outcome.response.siblings_cancelled, vec![v2.name.clone()]);

        let winner_after = db
            .get_session_by_name(Path::new(&repo_path), &v1.name)
            .expect("load winner after promote");
        assert_eq!(winner_after.status, SessionStatus::Active);

        let loser_after = db
            .get_session_by_name(Path::new(&repo_path), &v2.name)
            .expect("load loser after promote");
        assert_eq!(loser_after.status, SessionStatus::Cancelled);

        let consolidation_after = db
            .get_session_by_name(Path::new(&repo_path), &consolidation.name)
            .expect("load consolidation after promote");
        assert_eq!(consolidation_after.status, SessionStatus::Active);
        assert!(
            consolidation_after.worktree_path.exists(),
            "consolidation worktree should remain on disk after promote"
        );
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_winner_not_in_consolidation_sources() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");
        let unrelated = manager
            .create_session_with_auto_flag("stranger", None, None, false, None, None)
            .expect("create stranger");

        manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        let err = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "picking an unrelated session",
            Some(unrelated.id.as_str()),
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail when winner is not a source");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(
            err.1.to_lowercase().contains("winner"),
            "error should mention winner: {}",
            err.1
        );
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_unknown_winner_id() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");

        manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        let err = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "winner id that doesn't exist",
            Some("not-a-real-session-id"),
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail for unknown winner");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_winner_session_id_on_non_consolidation() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db, repo_path);
        let _v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, Some("grp"), Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, Some("grp"), Some(2))
            .expect("create v2");

        let err = execute_session_promotion(
            &manager,
            "feature_v2",
            "not a consolidation",
            Some(v2.id.as_str()),
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("should reject winner_session_id on a non-consolidation session");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(
            err.1.contains("consolidation"),
            "error should mention consolidation: {}",
            err.1
        );
    }

    #[tokio::test]
    async fn promote_session_logic_rejects_cancelled_winner() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());

        let v1 = manager
            .create_session_with_auto_flag("feature_v1", None, None, false, None, Some(1))
            .expect("create v1");
        let v2 = manager
            .create_session_with_auto_flag("feature_v2", None, None, false, None, Some(2))
            .expect("create v2");

        manager
            .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
                name: "feature-consolidation",
                prompt: None,
                base_branch: None,
                custom_branch: None,
                use_existing_branch: false,
                sync_with_origin: false,
                was_auto_generated: false,
                version_group_id: None,
                version_number: None,
                epic_id: None,
                agent_type: None,
                pr_number: None,
                is_consolidation: true,
                consolidation_source_ids: Some(vec![v1.id.clone(), v2.id.clone()]),
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_confirmation_mode: None,
            })
            .expect("create consolidation session");

        db.update_session_status(&v1.id, SessionStatus::Cancelled)
            .expect("cancel v1");

        let err = execute_session_promotion(
            &manager,
            "feature-consolidation",
            "winner was cancelled",
            Some(v1.id.as_str()),
            || Ok(()),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect_err("promotion should fail if winner not active");

        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn promote_session_logic_reports_partial_cleanup_failure() {
        let (_tmp, repo_path) = init_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).expect("db");
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        manager
            .create_session_with_auto_flag("feature_v1", None, None, false, Some("group-2"), Some(1))
            .expect("create v1");
        manager
            .create_session_with_auto_flag("feature_v2", None, None, false, Some("group-2"), Some(2))
            .expect("create v2");
        manager
            .create_session_with_auto_flag("feature_v3", None, None, false, Some("group-2"), Some(3))
            .expect("create v3");

        let outcome = execute_session_promotion(
            &manager,
            "feature_v3",
            "Most stable branch",
            None,
            || Ok(()),
            |name| {
                if name == "feature_v2" {
                    std::future::ready(Err(anyhow::anyhow!("forced cleanup failure")))
                } else {
                    std::future::ready(Ok(()))
                }
            },
        )
        .await
        .expect("promotion should return structured outcome");

        assert_eq!(outcome.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(outcome.response.siblings_cancelled, vec!["feature_v1".to_string()]);
        assert_eq!(outcome.response.failures.len(), 1);
        assert!(outcome.response.failures[0].contains("feature_v2"));

        let promoted = db
            .get_session_by_name(Path::new(&repo_path), "feature_v3")
            .expect("load promoted session");
        assert_eq!(promoted.promotion_reason.as_deref(), Some("Most stable branch"));
    }

    #[test]
    fn parse_reset_selection_request_rejects_invalid_json() {
        let err = parse_reset_selection_request(b"{invalid}").unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn parse_reset_selection_request_with_session_selection() {
        let payload = parse_reset_selection_request(
            br#"{ "selection": "session", "session_name": "my-session", "skip_prompt": true }"#,
        )
        .unwrap();
        assert_eq!(payload.selection.as_deref(), Some("session"));
        assert_eq!(payload.session_name.as_deref(), Some("my-session"));
        assert_eq!(payload.skip_prompt, Some(true));
    }

    #[test]
    fn spec_summary_from_spec_with_unicode_content() {
        let content = "# \u{1F680} Unicode spec\n\nDetails with \u{00E9}";
        let session = make_spec_session("unicode", Some(content));
        let summary = SpecSummary::from_spec(&session);
        assert_eq!(summary.content_length, content.chars().count());
    }

    #[test]
    fn spec_content_response_preserves_full_content() {
        let content = "line1\nline2\nline3";
        let session = make_spec_session("multi", Some(content));
        let response = SpecContentResponse::from_spec(&session);
        assert_eq!(response.content, content);
        assert_eq!(response.content_length, content.chars().count());
    }

    #[test]
    fn project_override_header_with_non_utf8_value() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Project-Path", "/valid/path".parse().unwrap());
        assert_eq!(
            project_override_from_headers(&headers),
            Some(PathBuf::from("/valid/path"))
        );
    }

    #[test]
    fn setup_script_request_payload_serialization() {
        let payload = SetupScriptRequestPayload {
            setup_script: "#!/bin/bash".to_string(),
            has_setup_script: true,
            pending_confirmation: false,
            project_path: "/tmp/project".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["setup_script"], "#!/bin/bash");
        assert_eq!(json["has_setup_script"], true);
        assert_eq!(json["pending_confirmation"], false);
        assert_eq!(json["project_path"], "/tmp/project");
    }

    #[test]
    fn parse_pr_number_from_url_handles_standard_url() {
        assert_eq!(
            parse_pr_number_from_url("https://github.com/owner/repo/pull/123"),
            Some(123)
        );
    }

    #[test]
    fn parse_pr_number_from_url_handles_query_string() {
        assert_eq!(
            parse_pr_number_from_url("https://github.com/owner/repo/pull/45?diff=unified"),
            Some(45)
        );
    }

    #[test]
    fn parse_pr_number_from_url_handles_fragment() {
        assert_eq!(
            parse_pr_number_from_url("https://github.com/owner/repo/pull/7#discussion"),
            Some(7)
        );
    }

    #[test]
    fn parse_pr_number_from_url_handles_trailing_slash() {
        assert_eq!(
            parse_pr_number_from_url("https://github.com/owner/repo/pull/10/"),
            Some(10)
        );
    }

    #[test]
    fn parse_pr_number_from_url_returns_none_for_invalid() {
        assert_eq!(parse_pr_number_from_url("not-a-url"), None);
        assert_eq!(parse_pr_number_from_url("https://github.com/owner/repo/issues/5"), None);
    }

    #[test]
    fn pr_feedback_response_success_path_returns_structured_json() {
        let payload = crate::commands::github::GitHubPrFeedbackPayload {
            state: "OPEN".to_string(),
            is_draft: false,
            review_decision: Some("APPROVED".to_string()),
            latest_reviews: vec![crate::commands::github::GitHubPrReviewPayload {
                author: Some("reviewer".to_string()),
                state: "APPROVED".to_string(),
                submitted_at: "2026-03-30T10:00:00Z".to_string(),
            }],
            status_checks: vec![
                crate::commands::github::GitHubPrFeedbackStatusCheckPayload {
                    name: "ci / unit".to_string(),
                    status: "COMPLETED".to_string(),
                    conclusion: Some("SUCCESS".to_string()),
                    url: Some("https://example.com/check/1".to_string()),
                },
            ],
            unresolved_threads: vec![],
            resolved_thread_count: 2,
        };

        let response = pr_feedback_result_to_response(Ok(payload));
        assert_eq!(response.status(), StatusCode::OK);

        let parsed: serde_json::Value = serde_json::from_str(response.body()).expect("valid JSON");
        assert_eq!(parsed["state"], "OPEN");
        assert_eq!(parsed["isDraft"], false);
        assert_eq!(parsed["resolvedThreadCount"], 2);
    }

    #[test]
    fn pr_feedback_response_error_path_returns_bad_request() {
        let response =
            pr_feedback_result_to_response(Err("GitHub CLI (gh) is not installed".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let parsed: serde_json::Value = serde_json::from_str(response.body()).expect("valid JSON");
        assert_eq!(parsed["error"], "GitHub CLI (gh) is not installed");
    }
}

async fn create_draft(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse spec creation request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    if payload["preset"].as_str().is_some() {
        return Ok(json_error_response(
            StatusCode::BAD_REQUEST,
            "'preset' is not supported when creating specs".to_string(),
        ));
    }

    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'name' field".to_string(),
            ));
        }
    };
    let content = payload["content"].as_str().unwrap_or("");
    let agent_type = payload["agent_type"].as_str();
    let epic_id = payload["epic_id"].as_str();
    let issue_number = payload["issueNumber"]
        .as_i64()
        .or_else(|| payload["issue_number"].as_i64());
    let issue_url = payload["issueUrl"]
        .as_str()
        .or_else(|| payload["issue_url"].as_str());
    let pr_number = payload["prNumber"]
        .as_i64()
        .or_else(|| payload["pr_number"].as_i64());
    let pr_url = payload["prUrl"]
        .as_str()
        .or_else(|| payload["pr_url"].as_str());

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };
    let manager = core.session_manager();
    match create_spec_session_with_notifications(
        &manager,
        CreateSpecParams {
            name,
            content,
            agent_type,
            epic_id,
            issue_number,
            issue_url,
            pr_number,
            pr_url,
            db: Some(&core.db),
        },
        move || {
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            Ok(())
        },
    ) {
        Ok(session) => {
            info!("Created spec session via API: {name}");
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::CREATED, json))
        }
        Err(e) => {
            error!("Failed to create spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create spec: {e}"),
            ))
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct SpecSummaryResponse {
    specs: Vec<SpecSummary>,
}

#[derive(Debug, Serialize, Clone)]
struct SpecSummary {
    session_id: String,
    display_name: Option<String>,
    stage: SpecStage,
    content_length: usize,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct SpecContentResponse {
    session_id: String,
    display_name: Option<String>,
    stage: SpecStage,
    content: String,
    content_length: usize,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct SpecStageResponse {
    session_id: String,
    stage: SpecStage,
    updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct SpecAttentionResponse {
    session_id: String,
    attention_required: bool,
    updated_at: String,
}

impl SpecSummary {
    fn from_spec(spec: &Spec) -> Self {
        let content_length = spec.content.chars().count();
        Self {
            session_id: spec.name.clone(),
            display_name: spec.display_name.clone(),
            stage: spec.stage.clone(),
            content_length,
            updated_at: spec.updated_at.to_rfc3339(),
        }
    }
}

impl SpecContentResponse {
    fn from_spec(spec: &Spec) -> Self {
        let content = spec.content.clone();
        let content_length = content.chars().count();
        Self {
            session_id: spec.name.clone(),
            display_name: spec.display_name.clone(),
            stage: spec.stage.clone(),
            content,
            content_length,
            updated_at: spec.updated_at.to_rfc3339(),
        }
    }
}

impl SpecStageResponse {
    fn from_spec(spec: &Spec) -> Self {
        Self {
            session_id: spec.name.clone(),
            stage: spec.stage.clone(),
            updated_at: spec.updated_at.to_rfc3339(),
        }
    }
}

impl SpecAttentionResponse {
    fn from_spec(spec: &Spec) -> Self {
        Self {
            session_id: spec.name.clone(),
            attention_required: spec.attention_required,
            updated_at: spec.updated_at.to_rfc3339(),
        }
    }
}

async fn list_drafts() -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_specs() {
        Ok(specs) => {
            let json = serde_json::to_string(&specs).unwrap_or_else(|e| {
                error!("Failed to serialize specs: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to list specs: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list specs: {e}"),
            ))
        }
    }
}

async fn list_spec_summaries() -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for spec summaries: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_specs() {
        Ok(mut specs_list) => {
            specs_list.sort_by(|a, b| a.name.cmp(&b.name));
            let specs: Vec<SpecSummary> = specs_list.iter().map(SpecSummary::from_spec).collect();
            let payload = SpecSummaryResponse { specs };
            match serde_json::to_string(&payload) {
                Ok(json) => Ok(json_response(StatusCode::OK, json)),
                Err(e) => {
                    error!("Failed to serialize spec summaries: {e}");
                    Ok(json_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to serialize spec summaries: {e}"),
                    ))
                }
            }
        }
        Err(e) => {
            error!("Failed to list spec summaries: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list specs: {e}"),
            ))
        }
    }
}

async fn get_spec_content(name: &str) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for spec content: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let spec = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(_) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Spec '{name}' not found"),
            ));
        }
    };

    let payload = SpecContentResponse::from_spec(&spec);
    match serde_json::to_string(&payload) {
        Ok(json) => Ok(json_response(StatusCode::OK, json)),
        Err(e) => {
            error!("Failed to serialize spec content response: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize spec content: {e}"),
            ))
        }
    }
}

async fn update_spec_content(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse spec update request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let content = match payload["content"].as_str() {
        Some(c) => c,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'content' field".to_string(),
            ));
        }
    };

    let append = payload["append"].as_bool().unwrap_or(false);

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match if append {
        manager.append_spec_content(name, content)
    } else {
        manager.update_spec_content(name, content)
    } {
        Ok(()) => {
            info!(
                "Updated spec content via API: {name} (append={append}, content_len={})",
                content.len()
            );

            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            info!("MCP API: queued sessions refresh after spec update");

            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to update spec content: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update spec: {e}"),
            ))
        }
    }
}

async fn update_spec_stage(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    #[derive(Debug, Deserialize)]
    struct UpdateSpecStageRequest {
        stage: String,
    }

    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: UpdateSpecStageRequest = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(err) => {
            error!("Failed to parse spec stage update request: {err}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {err}"),
            ));
        }
    };

    let stage: SpecStage = match payload.stage.parse() {
        Ok(stage) => stage,
        Err(err) => {
            return Ok(error_response(StatusCode::BAD_REQUEST, err));
        }
    };

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(err) => {
            error!("Failed to get lucode core for spec stage update: {err}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {err}"),
            ));
        }
    };

    let manager = core.session_manager();
    let spec = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(err) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Spec '{name}' not found: {err}"),
            ));
        }
    };

    if let Err(err) = core.db.update_spec_stage(&spec.id, stage) {
        error!("Failed to persist spec stage for '{name}': {err}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update spec stage: {err}"),
        ));
    }

    let updated = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(err) => {
            error!("Spec stage updated for '{name}' but reload failed: {err}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to reload updated spec: {err}"),
            ));
        }
    };

    request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);

    match serde_json::to_string(&SpecStageResponse::from_spec(&updated)) {
        Ok(json) => Ok(json_response(StatusCode::OK, json)),
        Err(err) => Ok(json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to serialize spec stage response: {err}"),
        )),
    }
}

async fn update_spec_attention(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    #[derive(Debug, Deserialize)]
    struct UpdateSpecAttentionRequest {
        attention_required: bool,
    }

    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: UpdateSpecAttentionRequest = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(err) => {
            error!("Failed to parse spec attention update request: {err}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {err}"),
            ));
        }
    };

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(err) => {
            error!("Failed to get lucode core for spec attention update: {err}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {err}"),
            ));
        }
    };

    let manager = core.session_manager();
    let spec = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(err) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Spec '{name}' not found: {err}"),
            ));
        }
    };

    if let Err(err) = core
        .db
        .update_spec_attention_required(&spec.id, payload.attention_required)
    {
        error!("Failed to persist spec attention for '{name}': {err}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update spec attention: {err}"),
        ));
    }

    if !payload.attention_required {
        clear_session_attention_state(name.to_string());
    }

    let updated = match manager.get_spec(name) {
        Ok(spec) => spec,
        Err(err) => {
            error!("Spec attention updated for '{name}' but reload failed: {err}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to reload updated spec: {err}"),
            ));
        }
    };

    request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);

    match serde_json::to_string(&SpecAttentionResponse::from_spec(&updated)) {
        Ok(json) => Ok(json_response(StatusCode::OK, json)),
        Err(err) => Ok(json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to serialize spec attention response: {err}"),
        )),
    }
}

async fn start_spec_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse start draft session request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let base_branch = payload["base_branch"].as_str().map(|s| s.to_string());
    let agent_type = payload["agent_type"].as_str();
    let version_group_id = payload["version_group_id"].as_str().map(|s| s.to_string());
    let version_number = payload["version_number"].as_i64().map(|n| n as i32);
    let preset = payload["preset"].as_str().map(|s| s.to_string());

    if let Err(message) = validate_preset_request_conflicts(
        preset.as_deref(),
        agent_type,
    ) {
        return Ok(json_error_response(StatusCode::BAD_REQUEST, message));
    }

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get lucode core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };
    let manager = core.session_manager();

    if let Some(preset_selector) = preset.as_deref() {
        let settings = match load_preset_launch_settings(&app).await {
            Ok(settings) => settings,
            Err(err) => {
                error!("Failed to load preset launch settings: {err}");
                return Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal error: {err}"),
                ));
            }
        };
        let resolved_preset = match resolve_preset(preset_selector, &settings.presets) {
            Ok(preset) => preset,
            Err(err) => return Ok(json_error_response(StatusCode::BAD_REQUEST, err)),
        };
        let options = PresetLaunchOptions {
            base_branch: base_branch.as_deref(),
            version_group_id: version_group_id.as_deref(),
            ..PresetLaunchOptions::default()
        };

        return match start_spec_with_preset_launch(
            &manager,
            &core.db,
            name,
            &resolved_preset,
            &options,
            &settings.autonomy_prompt_template,
        )
        .await
        {
            Ok(response) => {
                info!("Started preset-backed spec session via API: {name}");
                request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
                match serde_json::to_string(&response) {
                    Ok(json) => Ok(json_response(StatusCode::OK, json)),
                    Err(err) => Ok(json_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to serialize preset launch response: {err}"),
                    )),
                }
            }
            Err(err) => {
                error!("Failed to start preset-backed spec session: {err}");
                Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to start spec: {err}"),
                ))
            }
        };
    }

    // Use the manager method that encapsulates all configuration and session starting logic
    match manager.start_spec_session_with_config(
        name,
        base_branch.as_deref(),
        version_group_id.as_deref(),
        version_number,
        agent_type,
    ) {
        Ok(_session) => {
            info!("Started spec session via API: {name}");
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to start spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to start spec: {e}"),
            ))
        }
    }
}

async fn delete_draft(name: &str, app: tauri::AppHandle) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.fast_cancel_session(name).await {
        Ok(()) => {
            info!("Deleted spec session via API: {name}");

            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload {
                session_name: String,
            }
            let _ = emit_event(
                &app,
                SchaltEvent::SessionRemoved,
                &SessionRemovedPayload {
                    session_name: name.to_string(),
                },
            );
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to delete spec session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to delete spec: {e}"),
            ))
        }
    }
}

async fn create_session(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse session creation request: {e}");
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let name = match payload["name"].as_str() {
        Some(n) => n,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Missing 'name' field".to_string(),
            ));
        }
    };
    let prompt = payload["prompt"].as_str().map(|s| s.to_string());
    let base_branch = payload["base_branch"].as_str().map(|s| s.to_string());
    let custom_branch = payload["custom_branch"].as_str().map(|s| s.to_string());
    let use_existing_branch = payload["use_existing_branch"].as_bool().unwrap_or(false);
    let user_edited_name = payload["user_edited_name"].as_bool();
    let agent_type = payload["agent_type"].as_str().map(|s| s.to_string());
    let epic_id = payload["epic_id"].as_str().map(|s| s.to_string());
    let version_group_id = payload["versionGroupId"]
        .as_str()
        .or_else(|| payload["version_group_id"].as_str())
        .map(|s| s.to_string());
    let version_number = payload["versionNumber"]
        .as_i64()
        .or_else(|| payload["version_number"].as_i64())
        .map(|n| n as i32);
    let preset = payload["preset"].as_str().map(|s| s.to_string());
    let is_consolidation = payload["isConsolidation"]
        .as_bool()
        .or_else(|| payload["is_consolidation"].as_bool())
        .unwrap_or(false);
    let consolidation_source_ids = payload["consolidationSourceIds"]
        .as_array()
        .or_else(|| payload["consolidation_source_ids"].as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty());
    let consolidation_round_id = payload["consolidationRoundId"]
        .as_str()
        .or_else(|| payload["consolidation_round_id"].as_str())
        .map(|s| s.to_string());
    let consolidation_role = payload["consolidationRole"]
        .as_str()
        .or_else(|| payload["consolidation_role"].as_str())
        .map(|s| s.to_string());
    let consolidation_confirmation_mode = payload["consolidationConfirmationMode"]
        .as_str()
        .or_else(|| payload["consolidation_confirmation_mode"].as_str())
        .map(|s| s.to_string());
    let issue_number = payload["issueNumber"]
        .as_i64()
        .or_else(|| payload["issue_number"].as_i64());
    let issue_url = payload["issueUrl"]
        .as_str()
        .or_else(|| payload["issue_url"].as_str())
        .map(|s| s.to_string());
    let pr_number = payload["prNumber"]
        .as_i64()
        .or_else(|| payload["pr_number"].as_i64());
    let pr_url = payload["prUrl"]
        .as_str()
        .or_else(|| payload["pr_url"].as_str())
        .map(|s| s.to_string());

    if let Err(message) = validate_preset_request_conflicts(
        preset.as_deref(),
        agent_type.as_deref(),
    ) {
        return Ok(json_error_response(StatusCode::BAD_REQUEST, message));
    }

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };
    let manager = core.session_manager();

    if let Some(preset_selector) = preset.as_deref() {
        let settings = match load_preset_launch_settings(&app).await {
            Ok(settings) => settings,
            Err(err) => {
                error!("Failed to load preset launch settings: {err}");
                return Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal error: {err}"),
                ));
            }
        };
        let resolved_preset = match resolve_preset(preset_selector, &settings.presets) {
            Ok(preset) => preset,
            Err(err) => return Ok(json_error_response(StatusCode::BAD_REQUEST, err)),
        };
        let options = PresetLaunchOptions {
            base_branch: base_branch.as_deref(),
            custom_branch: custom_branch.as_deref(),
            use_existing_branch,
            epic_id: epic_id.as_deref(),
            issue_number,
            issue_url: issue_url.as_deref(),
            pr_number,
            pr_url: pr_url.as_deref(),
            version_group_id: version_group_id.as_deref(),
            is_consolidation,
            consolidation_source_ids: consolidation_source_ids.clone(),
            consolidation_round_id: consolidation_round_id.as_deref(),
            consolidation_role: consolidation_role.as_deref(),
            consolidation_confirmation_mode: consolidation_confirmation_mode.as_deref(),
        };

        return match create_sessions_from_preset_launch(
            &manager,
            &core.db,
            name,
            prompt.as_deref(),
            &resolved_preset,
            &options,
            &settings.autonomy_prompt_template,
        )
        .await
        {
            Ok(response) => {
                info!("Created preset-backed session via API: {name}");
                request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
                match serde_json::to_string(&response) {
                    Ok(json) => Ok(json_response(StatusCode::CREATED, json)),
                    Err(err) => Ok(json_error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to serialize preset launch response: {err}"),
                    )),
                }
            }
            Err(err) => {
                error!("Failed to create preset-backed session: {err}");
                Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create session: {err}"),
                ))
            }
        };
    }

    let looks_docker_style = name.contains('_') && name.split('_').count() == 2;
    let was_user_edited = user_edited_name.unwrap_or(false);
    let was_auto_generated = looks_docker_style && !was_user_edited;

    use lucode::domains::sessions::service::SessionCreationParams;

    let params = SessionCreationParams {
        name,
        prompt: prompt.as_deref(),
        base_branch: base_branch.as_deref(),
        custom_branch: custom_branch.as_deref(),
        use_existing_branch,
        sync_with_origin: use_existing_branch,
        was_auto_generated,
        version_group_id: version_group_id.as_deref(),
        version_number,
        epic_id: epic_id.as_deref(),
        agent_type: agent_type.as_deref(),
        pr_number,
        is_consolidation,
        consolidation_source_ids,
        consolidation_round_id: consolidation_round_id.as_deref(),
        consolidation_role: consolidation_role.as_deref(),
        consolidation_confirmation_mode: consolidation_confirmation_mode.as_deref(),
    };

    match manager.create_session_with_agent(params) {
        Ok(session) => {
            if session.is_consolidation
                && let (Some(round_id), Some(group_id), Some(source_ids), Some(mode)) = (
                    session.consolidation_round_id.as_deref(),
                    session.version_group_id.as_deref(),
                    session.consolidation_sources.as_ref(),
                    session.consolidation_confirmation_mode.as_deref(),
                )
                && let Err(err) = upsert_consolidation_round(
                    &core.db,
                    session.repository_path.as_path(),
                    round_id,
                    group_id,
                    source_ids,
                    mode,
                )
            {
                error!("Failed to upsert consolidation round {round_id}: {err}");
                return Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to persist consolidation round: {err}"),
                ));
            }
            if let Err(err) = persist_session_metadata(
                &core.db,
                &session.id,
                issue_number,
                issue_url.as_deref(),
                pr_number,
                pr_url.as_deref(),
            ) {
                error!("{err}");
                return Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    err,
                ));
            }
            info!("Created session via API: {name}");
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);

            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });

            Ok(json_response(StatusCode::CREATED, json))
        }
        Err(e) => {
            error!("Failed to create session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create session: {e}"),
            ))
        }
    }
}

async fn list_sessions(req: Request<Incoming>) -> Result<Response<String>, hyper::Error> {
    // Parse query parameters
    let query = req.uri().query().unwrap_or("");
    let mut filter_state: Option<SessionState> = None;

    // Simple query parameter parsing for state filter
    if query.contains("state=processing") {
        filter_state = Some(SessionState::Processing);
    } else if query.contains("state=running") {
        filter_state = Some(SessionState::Running);
    } else if query.contains("state=spec") {
        filter_state = Some(SessionState::Spec);
    }

    let (base_sessions, git_tasks, db) = match get_core_read().await {
        Ok(core) => match core.session_manager().list_enriched_sessions_base() {
            Ok((sessions, git_tasks)) => (sessions, git_tasks, core.db.clone()),
            Err(e) => {
                error!("Failed to list sessions: {e}");
                return Ok(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to list sessions: {e}"),
                ));
            }
        },
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    {
        let mut sessions = base_sessions;

        if !git_tasks.is_empty() {
            let results = compute_git_enrichment_parallel(git_tasks).await;
            apply_git_enrichment(&mut sessions, results);
        }

        if let Some(state) = filter_state {
            sessions.retain(|s| match state {
                SessionState::Running => s.info.session_state == SessionState::Running,
                SessionState::Processing => s.info.session_state == SessionState::Processing,
                SessionState::Spec => s.info.session_state == SessionState::Spec,
            });
        }

        if let Some(registry) = get_session_attention_state() {
            match registry.try_lock() {
                Ok(guard) => {
                    let mut spec_attention_updates = Vec::new();
                    for session in &mut sessions {
                        let previous_attention = session.attention_required;
                        let Some(attention) = guard.get(&session.info.session_id) else {
                            continue;
                        };
                        session.attention_required = Some(attention.needs_attention);
                        session.attention_kind = attention.kind.map(|kind| match kind {
                            lucode::domains::attention::SessionAttentionKind::Idle => {
                                "idle".to_string()
                            }
                            lucode::domains::attention::SessionAttentionKind::WaitingForInput => {
                                "waiting_for_input".to_string()
                            }
                        });
                        if session.info.session_state == SessionState::Spec
                            && let Some(stable_id) = session.info.stable_id.as_deref()
                        {
                            let persisted_attention = match attention.kind {
                                Some(lucode::domains::attention::SessionAttentionKind::WaitingForInput) => {
                                    Some(true)
                                }
                                Some(lucode::domains::attention::SessionAttentionKind::Idle) => Some(false),
                                None if !attention.needs_attention => Some(false),
                                None => Some(attention.needs_attention),
                            };

                            if let Some(persisted_attention) = persisted_attention
                                && previous_attention != Some(persisted_attention)
                            {
                                spec_attention_updates.push((stable_id.to_string(), persisted_attention));
                            }
                        }
                    }
                    drop(guard);

                    for (stable_id, attention_required) in spec_attention_updates {
                        if let Err(err) =
                            db.update_spec_attention_required(&stable_id, attention_required)
                        {
                            warn!(
                                "Failed to persist spec attention for stable_id={stable_id}: {err}"
                            );
                        }
                    }
                }
                Err(_) => {
                    debug!("Attention registry lock contention, skipping attention state");
                }
            }
        }

        let json = serde_json::to_string(&sessions).unwrap_or_else(|e| {
            error!("Failed to serialize sessions: {e}");
            "[]".to_string()
        });
        Ok(json_response(StatusCode::OK, json))
    }
}

async fn get_session(name: &str) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.get_session(name) {
        Ok(session) => {
            let json = serde_json::to_string(&session).unwrap_or_else(|e| {
                error!("Failed to serialize session: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to get session: {e}");
            Ok(error_response(
                StatusCode::NOT_FOUND,
                format!("Session not found: {e}"),
            ))
        }
    }
}

fn linked_pr_number(session: &Session) -> Option<u64> {
    session
        .pr_number
        .and_then(|n| u64::try_from(n).ok())
        .or_else(|| session.pr_url.as_deref().and_then(parse_pr_number_from_url))
}

fn parse_pr_number_from_url(url: &str) -> Option<u64> {
    let trimmed = url.trim_end_matches('/');
    let (_, tail) = trimmed.rsplit_once("/pull/")?;
    let number_str = tail.split(['?', '#']).next()?.trim();
    number_str.parse().ok()
}

fn pr_feedback_result_to_response(
    result: Result<GitHubPrFeedbackPayload, String>,
) -> Response<String> {
    match result {
        Ok(payload) => match serde_json::to_string(&payload) {
            Ok(json) => json_response(StatusCode::OK, json),
            Err(e) => json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize PR feedback response: {e}"),
            ),
        },
        Err(message) => json_error_response(StatusCode::BAD_REQUEST, message),
    }
}

async fn get_session_pr_feedback(name: &str) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for PR feedback: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let session = match core.session_manager().get_session(name) {
        Ok(session) => session,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Session not found: {e}"),
            ));
        }
    };

    let pr_number = match linked_pr_number(&session) {
        Some(n) => n,
        None => {
            return Ok(json_error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!(
                    "Session '{}' has no linked pull request. Link or create a PR first, then retry.",
                    session.name
                ),
            ));
        }
    };
    drop(core);

    let project_manager = get_project_manager().await;
    let cli = lucode::services::GitHubCli::new();

    let result = github_get_pr_feedback_impl(project_manager, cli, pr_number).await;
    Ok(pr_feedback_result_to_response(result))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct MergeSessionRequest {
    #[serde(default)]
    mode: Option<MergeMode>,
    #[serde(default)]
    commit_message: Option<String>,
    #[serde(default)]
    cancel_after_merge: bool,
}

#[derive(Debug, serde::Serialize)]
struct MergeSessionResponse {
    session_name: String,
    parent_branch: String,
    session_branch: String,
    mode: MergeMode,
    commit: String,
    cancel_requested: bool,
    cancel_queued: bool,
    cancel_error: Option<String>,
}

async fn merge_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    // Validate session state up front to produce actionable errors
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before attempting a merge."
                            ),
                        ));
                    }
                    // Allow merge to proceed
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for merge: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Consume request body
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: MergeSessionRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let mode = payload.mode.unwrap_or(MergeMode::Squash);
    let outcome =
        match merge_session_with_events(&app, name, mode, payload.commit_message.clone()).await {
            Ok(outcome) => outcome,
            Err(MergeCommandError {
                message,
                conflict,
                ..
            }) => {
                let status = if conflict {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::BAD_REQUEST
                };
                return Ok(error_response(status, message));
            }
        };

    let mut cancel_error = None;
    let mut cancel_queued = false;

    if payload.cancel_after_merge {
        match schaltwerk_core_cancel_session(app.clone(), name.to_string()).await {
            Ok(()) => {
                cancel_queued = true;
            }
            Err(e) => {
                cancel_error = Some(e.to_string());
            }
        }
    }

    let response = MergeSessionResponse {
        session_name: name.to_string(),
        parent_branch: outcome.parent_branch,
        session_branch: outcome.session_branch,
        mode: outcome.mode,
        commit: outcome.new_commit,
        cancel_requested: payload.cancel_after_merge,
        cancel_queued,
        cancel_error,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize merge response for '{name}': {e}");
        "{}".to_string()
    });

    // Use 200 status for successful merge, even if cancellation follow-up failed
    Ok(json_response(StatusCode::OK, json))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct PullRequestRequest {
    pr_title: String,
    #[serde(default)]
    pr_body: Option<String>,
    #[serde(default)]
    base_branch: Option<String>,
    #[serde(default)]
    pr_branch_name: Option<String>,
    #[serde(default)]
    commit_message: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    mode: Option<MergeMode>,
    #[serde(default)]
    cancel_after_pr: bool,
}

#[derive(Debug, serde::Serialize)]
struct PullRequestResponse {
    session_name: String,
    branch: String,
    url: String,
    cancel_requested: bool,
    cancel_queued: bool,
    cancel_error: Option<String>,
}

async fn create_pull_request(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PullRequestRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let project_manager = get_project_manager().await;
    let project = match project_manager.current_project().await {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("No active project: {e}"),
            ));
        }
    };
    let forge = detect_forge(&project.path);

    if forge == ForgeType::GitLab {
        let gitlab_source = {
            let core = project.schaltwerk_core.read().await;
            let db = core.database();
            db.get_project_gitlab_config(&project.path)
                .ok()
                .flatten()
                .and_then(|c| c.sources.into_iter().next())
        };

        let Some(source) = gitlab_source else {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "GitLab project detected but no GitLab sources configured. Configure GitLab sources first.".to_string(),
            ));
        };

        let args = CreateGitlabSessionMrArgs {
            session_name: name.to_string(),
            mr_title: payload.pr_title,
            mr_body: payload.pr_body,
            base_branch: payload.base_branch,
            mr_branch_name: payload.pr_branch_name,
            commit_message: payload.commit_message,
            source_project: source.project_path,
            source_hostname: Some(source.hostname),
            squash: false,
            mode: payload.mode.unwrap_or(MergeMode::Reapply),
            cancel_after_mr: payload.cancel_after_pr,
        };

        return match gitlab_create_session_mr(app, args).await {
            Ok(mr_result) => {
                let response = PullRequestResponse {
                    session_name: name.to_string(),
                    branch: mr_result.source_branch,
                    url: mr_result.url,
                    cancel_requested: payload.cancel_after_pr,
                    cancel_queued: payload.cancel_after_pr,
                    cancel_error: None,
                };

                let json = serde_json::to_string(&response).unwrap_or_else(|e| {
                    error!("Failed to serialize MR response for '{name}': {e}");
                    "{}".to_string()
                });

                Ok(json_response(StatusCode::OK, json))
            }
            Err(e) => Ok(error_response(StatusCode::BAD_REQUEST, e)),
        };
    }

    let args = CreateSessionPrArgs {
        session_name: name.to_string(),
        pr_title: payload.pr_title,
        pr_body: payload.pr_body,
        base_branch: payload.base_branch,
        pr_branch_name: payload.pr_branch_name,
        commit_message: payload.commit_message,
        repository: payload.repository,
        mode: payload.mode.unwrap_or(MergeMode::Reapply),
        cancel_after_pr: payload.cancel_after_pr,
    };

    match github_create_session_pr_impl(app, args).await {
        Ok(pr_result) => {
            let response = PullRequestResponse {
                session_name: name.to_string(),
                branch: pr_result.branch,
                url: pr_result.url,
                cancel_requested: payload.cancel_after_pr,
                cancel_queued: payload.cancel_after_pr,
                cancel_error: None,
            };

            let json = serde_json::to_string(&response).unwrap_or_else(|e| {
                error!("Failed to serialize PR response for '{name}': {e}");
                "{}".to_string()
            });

            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => Ok(error_response(StatusCode::BAD_REQUEST, e)),
    }
}

#[derive(Debug, serde::Deserialize)]
struct PreparePrRequest {
    pr_title: Option<String>,
    pr_body: Option<String>,
    base_branch: Option<String>,
    pr_branch_name: Option<String>,
    #[serde(default)]
    mode: Option<MergeMode>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPrModalPayload {
    session_name: String,
    pr_title: Option<String>,
    pr_body: Option<String>,
    base_branch: Option<String>,
    pr_branch_name: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct PreparePrResponse {
    session_name: String,
    modal_triggered: bool,
}

#[derive(Debug, serde::Deserialize)]
struct PrepareGitlabMrRequest {
    mr_title: Option<String>,
    mr_body: Option<String>,
    base_branch: Option<String>,
    source_project: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenGitlabMrModalPayload {
    session_name: String,
    suggested_title: Option<String>,
    suggested_body: Option<String>,
    suggested_base_branch: Option<String>,
    suggested_source_project: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct PrepareGitlabMrResponse {
    session_name: String,
    modal_triggered: bool,
}

async fn prepare_pull_request(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before creating a PR."
                            ),
                        ));
                    }
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for prepare PR: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PreparePrRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let mode_str = payload.mode.map(|m| match m {
        MergeMode::Squash => "squash".to_string(),
        MergeMode::Reapply => "reapply".to_string(),
    });

    let event_payload = OpenPrModalPayload {
        session_name: name.to_string(),
        pr_title: payload.pr_title,
        pr_body: payload.pr_body,
        base_branch: payload.base_branch,
        pr_branch_name: payload.pr_branch_name,
        mode: mode_str,
    };

    if let Err(e) = emit_event(&app, SchaltEvent::OpenPrModal, &event_payload) {
        error!("Failed to emit OpenPrModal event: {e}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to trigger PR modal: {e}"),
        ));
    }

    info!("Triggered PR modal for session '{name}'");

    let response = PreparePrResponse {
        session_name: name.to_string(),
        modal_triggered: true,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize prepare PR response for '{name}': {e}");
        "{}".to_string()
    });

    Ok(json_response(StatusCode::OK, json))
}

async fn prepare_gitlab_merge_request(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!(
                                "Session '{name}' is a spec. Start the spec before creating a merge request."
                            ),
                        ));
                    }
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for prepare GitLab MR: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PrepareGitlabMrRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let event_payload = OpenGitlabMrModalPayload {
        session_name: name.to_string(),
        suggested_title: payload.mr_title,
        suggested_body: payload.mr_body,
        suggested_base_branch: payload.base_branch,
        suggested_source_project: payload.source_project,
    };

    if let Err(e) = emit_event(&app, SchaltEvent::OpenGitlabMrModal, &event_payload) {
        error!("Failed to emit OpenGitlabMrModal event: {e}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to trigger GitLab MR modal: {e}"),
        ));
    }

    info!("Triggered GitLab MR modal for session '{name}'");

    let response = PrepareGitlabMrResponse {
        session_name: name.to_string(),
        modal_triggered: true,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize prepare GitLab MR response for '{name}': {e}");
        "{}".to_string()
    });

    Ok(json_response(StatusCode::OK, json))
}

#[derive(Debug, serde::Deserialize)]
struct PrepareMergeRequest {
    #[serde(default)]
    mode: Option<MergeMode>,
    commit_message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenMergeModalPayload {
    session_name: String,
    mode: Option<String>,
    commit_message: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct PrepareMergeResponse {
    session_name: String,
    modal_triggered: bool,
}

async fn prepare_merge(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    match get_core_read().await {
        Ok(core) => {
            let manager = core.session_manager();
            match manager.get_session(name) {
                Ok(session) => {
                    if session.session_state == SessionState::Spec {
                        return Ok(error_response(
                            StatusCode::BAD_REQUEST,
                            format!("Session '{name}' is a spec. Start the spec before merging."),
                        ));
                    }
                }
                Err(e) => {
                    return Ok(error_response(
                        StatusCode::NOT_FOUND,
                        format!("Session '{name}' not found: {e}"),
                    ));
                }
            }
        }
        Err(e) => {
            error!("Failed to acquire session manager for prepare merge: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PrepareMergeRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let mode_str = payload.mode.map(|m| match m {
        MergeMode::Squash => "squash".to_string(),
        MergeMode::Reapply => "reapply".to_string(),
    });

    let event_payload = OpenMergeModalPayload {
        session_name: name.to_string(),
        mode: mode_str,
        commit_message: payload.commit_message,
    };

    if let Err(e) = emit_event(&app, SchaltEvent::OpenMergeModal, &event_payload) {
        error!("Failed to emit OpenMergeModal event: {e}");
        return Ok(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to trigger merge modal: {e}"),
        ));
    }

    info!("Triggered merge modal for session '{name}'");

    let response = PrepareMergeResponse {
        session_name: name.to_string(),
        modal_triggered: true,
    };

    let json = serde_json::to_string(&response).unwrap_or_else(|e| {
        error!("Failed to serialize prepare merge response for '{name}': {e}");
        "{}".to_string()
    });

    Ok(json_response(StatusCode::OK, json))
}

async fn delete_session(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get para core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.fast_cancel_session(name).await {
        Ok(()) => {
            info!("Deleted session via API: {name}");

            #[derive(serde::Serialize, Clone)]
            struct SessionRemovedPayload {
                session_name: String,
            }
            let _ = emit_event(
                &app,
                SchaltEvent::SessionRemoved,
                &SessionRemovedPayload {
                    session_name: name.to_string(),
                },
            );
            Ok(Response::new("OK".to_string()))
        }
        Err(e) => {
            error!("Failed to cancel session: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to cancel session: {e}"),
            ))
        }
    }
}

async fn promote_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: PromoteSessionRequest = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(error) => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {error}"),
            ));
        }
    };

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(error) => {
            error!("Failed to get lucode core for promotion: {error}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {error}"),
            ));
        }
    };
    let manager_ref = &manager;

    match execute_session_promotion(
        &manager,
        name,
        &payload.reason,
        payload.winner_session_id.as_deref(),
        || {
            request_sessions_refresh(&app, SessionsRefreshReason::MergeWorkflow);
            Ok(())
        },
        move |sibling_name| {
            let sibling_name = sibling_name.to_string();
            async move { manager_ref.fast_cancel_session(&sibling_name).await }
        },
    )
    .await
    {
        Ok(outcome) => Ok(promote_outcome_response(name, outcome)),
        Err((status, message)) => Ok(json_error_response(status, message)),
    }
}

fn candidate_sessions_for_round(round_sessions: &[Session]) -> Vec<Session> {
    round_sessions
        .iter()
        .filter(|session| session.consolidation_role.as_deref() == Some("candidate"))
        .cloned()
        .collect()
}

fn judge_sessions_for_round(round_sessions: &[Session]) -> Vec<Session> {
    round_sessions
        .iter()
        .filter(|session| session.consolidation_role.as_deref() == Some("judge"))
        .cloned()
        .collect()
}

fn all_candidates_reported(candidate_sessions: &[Session]) -> bool {
    !candidate_sessions.is_empty()
        && candidate_sessions.iter().all(|session| {
            session
                .consolidation_report
                .as_deref()
                .map(str::trim)
                .is_some_and(|report| !report.is_empty())
                && session
                    .consolidation_base_session_id
                    .as_deref()
                    .map(str::trim)
                    .is_some_and(|base| !base.is_empty())
        })
}

fn confirmation_reason(
    round_sessions: &[Session],
    winner: &Session,
    override_reason: Option<&str>,
) -> String {
    if let Some(reason) = override_reason.map(str::trim).filter(|reason| !reason.is_empty()) {
        return reason.to_string();
    }

    if let Some(judge_report) = judge_sessions_for_round(round_sessions)
        .into_iter()
        .rev()
        .find_map(|session| session.consolidation_report)
        .and_then(|report| report.lines().find(|line| !line.trim().is_empty()).map(str::trim).map(str::to_string))
    {
        return judge_report;
    }

    format!("Confirmed consolidation winner {}", winner.name)
}

async fn create_and_start_judge_session(
    app: &tauri::AppHandle,
    manager: &SessionManager,
    round: &ConsolidationRoundRecord,
) -> Result<Session, String> {
    let round_sessions = list_round_sessions(manager, &round.id).map_err(|err| err.to_string())?;
    let candidate_sessions = candidate_sessions_for_round(&round_sessions);
    if candidate_sessions.is_empty() {
        return Err("No consolidation candidates found for this round".to_string());
    }

    let judge_name = format!(
        "{}-judge-{}",
        candidate_sessions[0].name,
        chrono::Utc::now().timestamp_millis()
    );
    let candidate_names = candidate_sessions
        .iter()
        .map(|session| session.name.clone())
        .collect::<Vec<_>>();
    let prompt = build_judge_prompt(&candidate_sessions, &round.source_session_ids);
    let agent_type = candidate_sessions
        .iter()
        .find_map(|session| session.original_agent_type.clone());

    let session = manager
        .create_session_with_agent(lucode::domains::sessions::service::SessionCreationParams {
            name: &judge_name,
            prompt: Some(&prompt),
            base_branch: Some(candidate_sessions[0].parent_branch.as_str()),
            custom_branch: None,
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: Some(&round.version_group_id),
            version_number: None,
            epic_id: None,
            agent_type: agent_type.as_deref(),
            pr_number: None,
            is_consolidation: true,
            consolidation_source_ids: Some(candidate_names),
            consolidation_round_id: Some(&round.id),
            consolidation_role: Some("judge"),
            consolidation_confirmation_mode: Some(&round.confirmation_mode),
        })
        .map_err(|err| err.to_string())?;

    request_sessions_refresh(app, SessionsRefreshReason::SessionLifecycle);

    schaltwerk_core_start_session_agent_with_restart(
        app.clone(),
        StartAgentParams {
            session_name: session.name.clone(),
            force_restart: false,
            cols: None,
            rows: None,
            terminal_id: None,
            agent_type: session.original_agent_type.clone(),
            prompt: None,
            skip_prompt: Some(false),
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    Ok(session)
}

pub(crate) async fn confirm_consolidation_winner_inner(
    app: &tauri::AppHandle,
    round_id: &str,
    winner_session_id: &str,
    override_reason: Option<&str>,
    confirmed_by: &str,
) -> Result<ConfirmConsolidationWinnerResponse, (StatusCode, String)> {
    let core = get_core_write().await.map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Internal error: {err}"),
        )
    })?;
    let manager = core.session_manager();
    let round = get_consolidation_round(&core.db, manager.repo_path(), round_id).map_err(|err| {
        (
            StatusCode::NOT_FOUND,
            format!("Consolidation round '{round_id}' not found: {err}"),
        )
    })?;
    let round_sessions = list_round_sessions(&manager, round_id).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to list round sessions: {err}"),
        )
    })?;

    let candidate_sessions = candidate_sessions_for_round(&round_sessions);
    let winner = candidate_sessions
        .iter()
        .find(|session| session.id == winner_session_id || session.name == winner_session_id)
        .cloned()
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("Winner session '{winner_session_id}' is not a candidate in round '{round_id}'"),
            )
        })?;

    let base_session_id = winner
        .consolidation_base_session_id
        .as_deref()
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("Candidate '{}' has not recorded consolidation_base_session_id", winner.name),
            )
        })?;

    if round.status != "awaiting_confirmation" || round.recommended_session_id.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Consolidation round '{round_id}' has no judge recommendation to confirm yet"),
        ));
    }

    let reason = confirmation_reason(&round_sessions, &winner, override_reason);
    let manager_ref = &manager;
    let outcome = execute_session_promotion(
        &manager,
        &winner.name,
        &reason,
        Some(base_session_id),
        || {
            request_sessions_refresh(app, SessionsRefreshReason::MergeWorkflow);
            Ok(())
        },
        move |sibling_name| {
            let sibling_name = sibling_name.to_string();
            async move { manager_ref.fast_cancel_session(&sibling_name).await }
        },
    )
    .await?;

    let mut candidate_sessions_cancelled = Vec::new();
    for candidate in candidate_sessions {
        if candidate.id == winner.id || candidate.status != SessionStatus::Active {
            continue;
        }
        manager.fast_cancel_session(&candidate.name).await.map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to cancel losing consolidation candidate '{}': {err}", candidate.name),
            )
        })?;
        candidate_sessions_cancelled.push(candidate.name);
    }

    update_consolidation_round_confirmation(&core.db, round_id, &winner.id, confirmed_by).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update consolidation round confirmation: {err}"),
        )
    })?;

    request_sessions_refresh(app, SessionsRefreshReason::SessionLifecycle);

    Ok(ConfirmConsolidationWinnerResponse {
        round_id: round.id,
        winner_session_name: winner.name,
        promoted_session_name: outcome.response.session_name,
        candidate_sessions_cancelled,
        source_sessions_cancelled: outcome.response.siblings_cancelled,
    })
}

pub(crate) async fn trigger_consolidation_judge_inner(
    app: &tauri::AppHandle,
    round_id: &str,
    early: bool,
) -> Result<TriggerConsolidationJudgeResponse, (StatusCode, String)> {
    let core = get_core_write().await.map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Internal error: {error}"),
        )
    })?;
    let manager = core.session_manager();
    let round = get_consolidation_round(&core.db, manager.repo_path(), round_id).map_err(|err| {
        (
            StatusCode::NOT_FOUND,
            format!("Consolidation round '{round_id}' not found: {err}"),
        )
    })?;
    let candidate_sessions = list_round_sessions(&manager, round_id)
        .map(|sessions| candidate_sessions_for_round(&sessions))
        .map_err(|err| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list round sessions: {err}"),
            )
        })?;

    if round.status == "promoted" {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Consolidation round '{round_id}' is already confirmed and cannot be judged again"),
        ));
    }

    if !early && !all_candidates_reported(&candidate_sessions) {
        return Err((
            StatusCode::BAD_REQUEST,
            "Not all consolidation candidates have filed reports yet".to_string(),
        ));
    }

    let session = create_and_start_judge_session(app, &manager, &round)
        .await
        .map_err(|message| (StatusCode::INTERNAL_SERVER_ERROR, message))?;

    Ok(TriggerConsolidationJudgeResponse {
        round_id: round.id,
        judge_session_name: session.name,
    })
}

async fn update_consolidation_report(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: UpdateConsolidationReportRequest = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(error) => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {error}"),
            ));
        }
    };

    let trimmed_report = payload.report.trim();
    if trimmed_report.is_empty() {
        return Ok(json_error_response(
            StatusCode::BAD_REQUEST,
            "report is required".to_string(),
        ));
    }

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(error) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {error}"),
            ));
        }
    };
    let manager = core.session_manager();
    let session = match manager.get_session(name) {
        Ok(session) => session,
        Err(error) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Session '{name}' not found: {error}"),
            ));
        }
    };
    let round_id = match session.consolidation_round_id.as_deref() {
        Some(round_id) => round_id,
        None => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Session '{name}' is not attached to a consolidation round"),
            ));
        }
    };

    if let Err(err) = update_session_consolidation_report(
        &core.db,
        manager.repo_path(),
        name,
        trimmed_report,
        payload.base_session_id.as_deref(),
        payload.recommended_session_id.as_deref(),
    ) {
        return Ok(json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update consolidation report: {err}"),
        ));
    }

    let round = match get_consolidation_round(&core.db, manager.repo_path(), round_id) {
        Ok(round) => round,
        Err(err) => {
            return Ok(json_error_response(
                StatusCode::NOT_FOUND,
                format!("Consolidation round '{round_id}' not found: {err}"),
            ));
        }
    };
    let round_sessions = match list_round_sessions(&manager, round_id) {
        Ok(sessions) => sessions,
        Err(err) => {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list round sessions: {err}"),
            ));
        }
    };
    let role = session
        .consolidation_role
        .clone()
        .unwrap_or_else(|| "candidate".to_string());
    let mut auto_judge_triggered = false;
    let mut auto_promoted = false;

    if round.status == "promoted" {
        return Ok(json_error_response(
            StatusCode::BAD_REQUEST,
            format!("Consolidation round '{round_id}' is already confirmed"),
        ));
    }

    if role == "judge" {
        if payload.recommended_session_id.is_none() {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                "Judge reports must include recommended_session_id".to_string(),
            ));
        }

        if let Err(err) = update_consolidation_round_recommendation(
            &core.db,
            round_id,
            payload.recommended_session_id.as_deref(),
            Some(&session.id),
            "awaiting_confirmation",
        ) {
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update consolidation recommendation: {err}"),
            ));
        }

        if round.confirmation_mode == "auto-promote" {
            match confirm_consolidation_winner_inner(
                &app,
                round_id,
                payload.recommended_session_id.as_deref().unwrap_or_default(),
                None,
                "judge",
            )
            .await
            {
                Ok(_) => auto_promoted = true,
                Err((status, message)) => return Ok(json_error_response(status, message)),
            }
        }
    } else {
        if payload.base_session_id.is_none() {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                "Candidate reports must include base_session_id".to_string(),
            ));
        }
        let candidate_sessions = candidate_sessions_for_round(&round_sessions);
        let judge_sessions = judge_sessions_for_round(&round_sessions);
        if round.status == "running" && judge_sessions.is_empty() && all_candidates_reported(&candidate_sessions) {
            if let Err(message) = create_and_start_judge_session(&app, &manager, &round).await {
                return Ok(json_error_response(StatusCode::INTERNAL_SERVER_ERROR, message));
            }
            auto_judge_triggered = true;
        }
    }

    request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
    let response = UpdateConsolidationReportResponse {
        session_name: name.to_string(),
        round_id: round_id.to_string(),
        role,
        auto_judge_triggered,
        auto_promoted,
    };

    Ok(json_response(
        StatusCode::OK,
        serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string()),
    ))
}

async fn trigger_consolidation_judge(
    req: Request<Incoming>,
    round_id: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: TriggerConsolidationJudgeRequest = if body_bytes.is_empty() {
        TriggerConsolidationJudgeRequest { early: false }
    } else {
        match serde_json::from_slice(&body_bytes) {
            Ok(payload) => payload,
            Err(error) => {
                return Ok(json_error_response(
                    StatusCode::BAD_REQUEST,
                    format!("Invalid JSON payload: {error}"),
                ));
            }
        }
    };

    match trigger_consolidation_judge_inner(&app, round_id, payload.early).await {
        Ok(response) => Ok(json_response(
            StatusCode::CREATED,
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string()),
        )),
        Err((status, message)) => Ok(json_error_response(status, message)),
    }
}

async fn confirm_consolidation_winner(
    req: Request<Incoming>,
    round_id: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: ConfirmConsolidationWinnerRequest = match serde_json::from_slice(&body_bytes) {
        Ok(payload) => payload,
        Err(error) => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {error}"),
            ));
        }
    };

    match confirm_consolidation_winner_inner(
        &app,
        round_id,
        &payload.winner_session_id,
        payload.override_reason.as_deref(),
        "user",
    )
    .await
    {
        Ok(response) => Ok(json_response(
            StatusCode::OK,
            serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string()),
        )),
        Err((status, message)) => Ok(json_error_response(status, message)),
    }
}

async fn link_session_pr(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: LinkPrRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON payload: {e}"),
            ));
        }
    };

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for PR link: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.link_session_to_pr(name, payload.pr_number, &payload.pr_url) {
        Ok(()) => {
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            let json = serde_json::to_string(&LinkPrResponse::linked(
                name,
                payload.pr_number,
                payload.pr_url,
            ))
            .unwrap_or_else(|e| {
                error!("Failed to serialize PR link response for '{name}': {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => Ok(error_response(
            StatusCode::NOT_FOUND,
            format!("Failed to link PR for session '{name}': {e}"),
        )),
    }
}

async fn unlink_session_pr(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for PR unlink: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.unlink_session_from_pr(name) {
        Ok(()) => {
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            let json = serde_json::to_string(&LinkPrResponse::unlinked(name)).unwrap_or_else(
                |e| {
                    error!("Failed to serialize PR unlink response for '{name}': {e}");
                    "{}".to_string()
                },
            );
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => Ok(error_response(
            StatusCode::NOT_FOUND,
            format!("Failed to unlink PR for session '{name}': {e}"),
        )),
    }
}

async fn convert_session_to_spec(
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get lucode core: {e}");
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    // Use the manager method that encapsulates all validation and business logic
    match manager.convert_session_to_spec(name) {
        Ok(new_spec_name) => {
            info!("Converted session '{name}' to spec via API");
            request_sessions_refresh(&app, SessionsRefreshReason::SpecSync);

            Ok(Response::new(new_spec_name))
        }
        Err(e) => {
            error!("Failed to convert session '{name}' to spec: {e}");
            Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to convert session '{name}' to spec: {e}"),
            ))
        }
    }
}

async fn get_project_setup_script(
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for setup script: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();
    let setup_scripts = SetupScriptService::new(db, repo_path);

    match setup_scripts.get() {
        Ok(script) => {
            let payload = setup_script_payload(script.as_deref().unwrap_or_default());
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Err(e) => {
            error!("Failed to get project setup script: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project setup script: {e}"),
            ))
        }
    }
}

async fn set_project_setup_script(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();

    let setup_script = match parse_setup_script_request(&body_bytes) {
        Ok(script) => script,
        Err((status, message)) => return Ok(json_error_response(status, message)),
    };

    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for setup script update: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let repo_path = core.repo_path.clone();
    let payload = SetupScriptRequestPayload {
        setup_script: setup_script.clone(),
        has_setup_script: !setup_script.trim().is_empty(),
        pending_confirmation: true,
        project_path: repo_path.to_string_lossy().to_string(),
    };

    if let Err(e) = emit_event(&app, SchaltEvent::SetupScriptRequested, &payload) {
        error!("Failed to emit setup script request event: {e}");
        return Ok(json_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to notify UI for setup script confirmation".to_string(),
        ));
    }

    let response_payload = setup_script_payload(&setup_script);
    Ok(json_response(
        StatusCode::ACCEPTED,
        response_payload.to_string(),
    ))
}

async fn get_project_worktree_base_directory(
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for worktree base directory: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();

    match db.get_project_worktree_base_directory(&repo_path) {
        Ok(dir) => {
            let payload = worktree_base_directory_payload(dir.as_deref());
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Err(e) => {
            error!("Failed to get worktree base directory: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get worktree base directory: {e}"),
            ))
        }
    }
}

async fn set_project_worktree_base_directory(
    req: Request<Incoming>,
    _app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();

    let base_directory = match parse_worktree_base_directory_request(&body_bytes) {
        Ok(dir) => dir,
        Err((status, message)) => return Ok(json_error_response(status, message)),
    };

    let core = match get_core_write().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for worktree base directory update: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();

    match db.set_project_worktree_base_directory(&repo_path, base_directory.as_deref()) {
        Ok(()) => {
            let payload = worktree_base_directory_payload(base_directory.as_deref());
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Err(e) => {
            error!("Failed to set worktree base directory: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to set worktree base directory: {e}"),
            ))
        }
    }
}

async fn get_project_run_script_api() -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for run script: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();

    match db.get_project_run_script(&repo_path) {
        Ok(Some(run_script)) => {
            let payload = serde_json::json!({
                "has_run_script": true,
                "command": run_script.command,
                "working_directory": run_script.working_directory,
            });
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Ok(None) => {
            let payload = serde_json::json!({ "has_run_script": false });
            Ok(json_response(StatusCode::OK, payload.to_string()))
        }
        Err(e) => {
            error!("Failed to get project run script: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project run script: {e}"),
            ))
        }
    }
}

async fn execute_project_run_script() -> Result<Response<String>, hyper::Error> {
    let core = match get_core_read().await {
        Ok(core) => core,
        Err(e) => {
            error!("Failed to get core for run script execution: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    let db = core.database().clone();
    let repo_path = core.repo_path.clone();

    let run_script = match db.get_project_run_script(&repo_path) {
        Ok(Some(rs)) => rs,
        Ok(None) => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                "No run script configured for this project".to_string(),
            ));
        }
        Err(e) => {
            error!("Failed to get project run script: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get project run script: {e}"),
            ));
        }
    };

    let cwd = run_script
        .working_directory
        .as_deref()
        .map(std::path::Path::new)
        .unwrap_or(repo_path.as_path());

    let invocation = lucode::domains::terminal::build_login_shell_invocation(&run_script.command);

    let mut cmd = tokio::process::Command::new(&invocation.program);
    cmd.args(&invocation.args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    for (key, value) in &run_script.environment_variables {
        cmd.env(key, value);
    }

    let output = match cmd.output().await {
        Ok(output) => output,
        Err(e) => {
            error!("Failed to execute run script: {e}");
            let payload = serde_json::json!({
                "success": false,
                "command": run_script.command,
                "exit_code": -1,
                "stdout": "",
                "stderr": format!("Failed to execute: {e}"),
            });
            return Ok(json_response(StatusCode::OK, payload.to_string()));
        }
    };

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    info!(
        "Run script executed: command={}, exit_code={exit_code}",
        run_script.command
    );

    let payload = serde_json::json!({
        "success": output.status.success(),
        "command": run_script.command,
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": stderr,
    });

    Ok(json_response(StatusCode::OK, payload.to_string()))
}

async fn list_epics() -> Result<Response<String>, hyper::Error> {
    let manager = match get_core_read().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for listing epics: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.list_epics() {
        Ok(epics) => {
            let json = serde_json::to_string(&epics).unwrap_or_else(|e| {
                error!("Failed to serialize epics: {e}");
                "[]".to_string()
            });
            Ok(json_response(StatusCode::OK, json))
        }
        Err(e) => {
            error!("Failed to list epics: {e}");
            Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list epics: {e}"),
            ))
        }
    }
}

async fn create_epic(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body = req.into_body();
    let body_bytes = body.collect().await?.to_bytes();
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse epic creation request: {e}");
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Invalid JSON: {e}"),
            ));
        }
    };

    let name = match payload["name"].as_str() {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            return Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                "Missing or empty 'name' field".to_string(),
            ));
        }
    };
    let color = payload["color"].as_str();

    let manager = match get_core_write().await {
        Ok(core) => core.session_manager(),
        Err(e) => {
            error!("Failed to get core for creating epic: {e}");
            return Ok(json_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };

    match manager.create_epic(name, color) {
        Ok(epic) => {
            info!("Created epic via API: {name}");
            request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            let json = serde_json::to_string(&epic).unwrap_or_else(|e| {
                error!("Failed to serialize epic: {e}");
                "{}".to_string()
            });
            Ok(json_response(StatusCode::CREATED, json))
        }
        Err(e) => {
            error!("Failed to create epic: {e}");
            Ok(json_error_response(
                StatusCode::BAD_REQUEST,
                format!("Failed to create epic: {e}"),
            ))
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct ResetSessionRequest {
    #[serde(default)]
    agent_type: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    skip_prompt: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct ResetSelectionRequest {
    #[serde(default)]
    selection: Option<String>,
    #[serde(default)]
    session_name: Option<String>,
    #[serde(default)]
    agent_type: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    skip_prompt: Option<bool>,
}

fn parse_reset_selection_request(
    body_bytes: &[u8],
) -> Result<ResetSelectionRequest, (StatusCode, String)> {
    if body_bytes.is_empty() {
        return Ok(ResetSelectionRequest {
            selection: None,
            session_name: None,
            agent_type: None,
            prompt: None,
            skip_prompt: None,
        });
    }
    serde_json::from_slice::<ResetSelectionRequest>(body_bytes).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid JSON payload: {e}"),
        )
    })
}

async fn reset_selection(
    req: Request<Incoming>,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload = match parse_reset_selection_request(&body_bytes) {
        Ok(p) => p,
        Err((status, message)) => return Ok(error_response(status, message)),
    };

    match payload.selection.as_deref() {
        Some("orchestrator") => reset_orchestrator(payload, app).await,
        Some("session") => {
            let name = match payload.session_name.as_deref() {
                Some(v) if !v.trim().is_empty() => v,
                _ => {
                    return Ok(error_response(
                        StatusCode::BAD_REQUEST,
                        "Missing 'session_name' field for selection='session'".to_string(),
                    ));
                }
            };

            reset_session_with_payload(
                name,
                ResetSessionRequest {
                    agent_type: payload.agent_type,
                    prompt: payload.prompt,
                    skip_prompt: payload.skip_prompt,
                },
                app,
            )
            .await
        }
        Some(other) => Ok(error_response(
            StatusCode::BAD_REQUEST,
            format!("Invalid selection '{other}'. Expected 'orchestrator' or 'session'."),
        )),
        None => Ok(error_response(
            StatusCode::BAD_REQUEST,
            "Missing 'selection' field (expected 'orchestrator' or 'session')".to_string(),
        )),
    }
}

async fn reset_orchestrator(
    payload: ResetSelectionRequest,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let core = match get_core_write().await {
        Ok(core) => core,
        Err(e) => {
            return Ok(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Internal error: {e}"),
            ));
        }
    };
    let manager = core.session_manager();
    if let Some(agent_type) = payload.agent_type.as_deref()
        && let Err(e) = manager.set_orchestrator_agent_type(agent_type)
    {
        warn!("Failed to set orchestrator agent type: {e}");
    }

    let effective_agent_type = payload.agent_type.clone().unwrap_or_else(|| {
        core.db
            .get_orchestrator_agent_type()
            .unwrap_or_else(|_| "claude".to_string())
    });

    let terminal_id = terminal_id_for_orchestrator_top(core.repo_path.as_path());
    drop(core);

    let start_result = start_orchestrator_with_prompt(
        app.clone(),
        terminal_id.clone(),
        Some(effective_agent_type.clone()),
        payload.prompt.as_deref(),
        payload.skip_prompt.unwrap_or(false),
    )
    .await;

    match start_result {
        Ok(msg) => Ok(Response::new(msg)),
        Err(err) => Ok(error_response(StatusCode::BAD_REQUEST, err)),
    }
}

async fn start_orchestrator_with_prompt(
    app: tauri::AppHandle,
    terminal_id: String,
    agent_type: Option<String>,
    prompt: Option<&str>,
    skip_prompt: bool,
) -> Result<String, String> {
    let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) else {
        return schaltwerk_core_start_claude_orchestrator(app, terminal_id, None, None, agent_type, None)
            .await;
    };
    if skip_prompt {
        return schaltwerk_core_start_claude_orchestrator(app, terminal_id, None, None, agent_type, None)
            .await;
    }

    let core = get_core_read().await?;
    let manager = core.session_manager();
    let db = core.db.clone();
    let repo_path = core.repo_path.clone();
    let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let settings = settings_manager.lock().await;
        let mut paths = std::collections::HashMap::new();
        for agent in [
            "claude", "copilot", "codex", "opencode", "gemini", "droid", "qwen", "amp", "kilocode",
        ] {
            if let Ok(path) = settings.get_effective_binary_path(agent) {
                paths.insert(agent.to_string(), path);
            }
        }
        paths
    } else {
        std::collections::HashMap::new()
    };

    let command_spec = manager
        .start_agent_in_orchestrator(&binary_paths, agent_type.as_deref(), Some(prompt))
        .map_err(|e| e.to_string())?;
    drop(core);

    let launch_result = agent_launcher::launch_in_terminal(
        terminal_id,
        command_spec,
        &db,
        repo_path.as_path(),
        None,
        None,
        true,
    )
    .await;

    launch_result.map(|_| "orchestrator-started".to_string())
}

async fn reset_session_with_payload(
    name: &str,
    payload: ResetSessionRequest,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    if let Ok(core) = get_core_write().await {
        let manager = core.session_manager();
        if let Some(agent_type) = payload.agent_type.as_deref() {
            if let Err(e) = manager.set_session_original_settings(name, agent_type) {
                warn!("Failed to update session agent settings for '{name}': {e}");
            } else {
                request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
            }
        }
    }

    if payload.agent_type.is_some() {
        request_sessions_refresh(&app, SessionsRefreshReason::SessionLifecycle);
    }

    let result = schaltwerk_core_start_session_agent_with_restart(
        app.clone(),
        StartAgentParams {
            session_name: name.to_string(),
            force_restart: true,
            cols: None,
            rows: None,
            terminal_id: None,
            agent_type: payload.agent_type,
            prompt: payload.prompt,
            skip_prompt: payload.skip_prompt,
        },
    )
    .await;

    match result {
        Ok(command) => Ok(Response::new(command)),
        Err(err) => Ok(error_response(StatusCode::BAD_REQUEST, err)),
    }
}

async fn reset_session(
    req: Request<Incoming>,
    name: &str,
    app: tauri::AppHandle,
) -> Result<Response<String>, hyper::Error> {
    let body_bytes = req.into_body().collect().await?.to_bytes();
    let payload: ResetSessionRequest = if body_bytes.is_empty() {
        ResetSessionRequest {
            agent_type: None,
            prompt: None,
            skip_prompt: None,
        }
    } else {
        match serde_json::from_slice(&body_bytes) {
            Ok(p) => p,
            Err(e) => {
                return Ok(error_response(
                    StatusCode::BAD_REQUEST,
                    format!("Invalid JSON payload: {e}"),
                ));
            }
        }
    };

    reset_session_with_payload(name, payload, app).await
}
