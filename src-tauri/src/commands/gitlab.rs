use crate::get_project_manager;
use log::error;
use schaltwerk::domains::git::gitlab_cli::{
    format_cli_error, GitlabCli, GitlabCliError, GitlabIssueDetails, GitlabIssueSummary,
    GitlabMrDetails, GitlabMrSummary, GitlabNote, GitlabPipelineDetails,
};
use schaltwerk::schaltwerk_core::db_project_config::{
    GitlabSource, ProjectConfigMethods, ProjectGitlabConfig,
};
use serde::Serialize;
use tauri::AppHandle;

const SEARCH_DEFAULT_LIMIT: usize = 50;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabStatusPayload {
    pub installed: bool,
    pub authenticated: bool,
    pub user_login: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabIssueSummaryPayload {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub url: String,
    pub source_label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabIssueDetailsPayload {
    pub iid: u64,
    pub title: String,
    pub url: String,
    pub description: String,
    pub labels: Vec<String>,
    pub state: String,
    pub notes: Vec<GitlabNotePayload>,
    pub source_label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabNotePayload {
    pub author: Option<String>,
    pub created_at: String,
    pub body: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabMrSummaryPayload {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub url: String,
    pub source_branch: String,
    pub target_branch: String,
    pub source_label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabMrDetailsPayload {
    pub iid: u64,
    pub title: String,
    pub url: String,
    pub description: String,
    pub labels: Vec<String>,
    pub state: String,
    pub source_branch: String,
    pub target_branch: String,
    pub merge_status: Option<String>,
    pub pipeline_status: Option<String>,
    pub pipeline_url: Option<String>,
    pub notes: Vec<GitlabNotePayload>,
    pub reviewers: Vec<String>,
    pub source_label: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitlabPipelinePayload {
    pub id: u64,
    pub status: String,
    pub url: Option<String>,
    pub duration: Option<f64>,
}

#[tauri::command]
pub async fn gitlab_get_status() -> Result<GitlabStatusPayload, String> {
    let cli = GitlabCli::new();

    let installed = match cli.ensure_installed() {
        Ok(()) => true,
        Err(GitlabCliError::NotInstalled) => false,
        Err(err) => return Err(format_cli_error(err)),
    };

    let (authenticated, user_login, hostname) = if installed {
        match cli.check_auth(None) {
            Ok(status) => (status.authenticated, status.user_login, status.hostname),
            Err(GitlabCliError::NotInstalled) => (false, None, None),
            Err(err) => return Err(format_cli_error(err)),
        }
    } else {
        (false, None, None)
    };

    Ok(GitlabStatusPayload {
        installed,
        authenticated,
        user_login,
        hostname,
    })
}

#[tauri::command]
pub async fn gitlab_search_issues(
    _app: AppHandle,
    query: Option<String>,
    source_project: String,
    source_hostname: Option<String>,
    source_label: String,
) -> Result<Vec<GitlabIssueSummaryPayload>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let cli = GitlabCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let search_query = query.unwrap_or_default();
    let issues = cli
        .search_issues(
            &project.path,
            search_query.trim(),
            SEARCH_DEFAULT_LIMIT,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(|err| {
            error!("GitLab issue search failed: {err}");
            format_cli_error(err)
        })?;

    Ok(issues
        .into_iter()
        .map(|issue| map_issue_summary_payload(issue, &source_label))
        .collect())
}

#[tauri::command]
pub async fn gitlab_get_issue_details(
    _app: AppHandle,
    iid: u64,
    source_project: String,
    source_hostname: Option<String>,
    source_label: String,
) -> Result<GitlabIssueDetailsPayload, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let cli = GitlabCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let details = cli
        .get_issue_details(
            &project.path,
            iid,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(|err| {
            error!("GitLab issue detail fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(map_issue_details_payload(details, &source_label))
}

#[tauri::command]
pub async fn gitlab_search_mrs(
    _app: AppHandle,
    query: Option<String>,
    source_project: String,
    source_hostname: Option<String>,
    source_label: String,
) -> Result<Vec<GitlabMrSummaryPayload>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let cli = GitlabCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let search_query = query.unwrap_or_default();
    let mrs = cli
        .search_mrs(
            &project.path,
            search_query.trim(),
            SEARCH_DEFAULT_LIMIT,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(|err| {
            error!("GitLab MR search failed: {err}");
            format_cli_error(err)
        })?;

    Ok(mrs
        .into_iter()
        .map(|mr| map_mr_summary_payload(mr, &source_label))
        .collect())
}

#[tauri::command]
pub async fn gitlab_get_mr_details(
    _app: AppHandle,
    iid: u64,
    source_project: String,
    source_hostname: Option<String>,
    source_label: String,
) -> Result<GitlabMrDetailsPayload, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let cli = GitlabCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let details = cli
        .get_mr_details(
            &project.path,
            iid,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(|err| {
            error!("GitLab MR detail fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(map_mr_details_payload(details, &source_label))
}

#[tauri::command]
pub async fn gitlab_get_mr_pipeline(
    _app: AppHandle,
    source_branch: String,
    source_project: String,
    source_hostname: Option<String>,
) -> Result<Option<GitlabPipelinePayload>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let cli = GitlabCli::new();
    if let Err(err) = cli.ensure_installed() {
        return Err(format_cli_error(err));
    }

    let pipeline = cli
        .get_mr_pipeline_status(
            &project.path,
            &source_branch,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(|err| {
            error!("GitLab pipeline status fetch failed: {err}");
            format_cli_error(err)
        })?;

    Ok(pipeline.map(map_pipeline_payload))
}

#[tauri::command]
pub async fn gitlab_get_sources(_app: AppHandle) -> Result<Vec<GitlabSource>, String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let core = project.schaltwerk_core.read().await;
    let db = core.database();
    let config = db
        .get_project_gitlab_config(&project.path)
        .map_err(|e| format!("Failed to load GitLab config: {e}"))?;

    Ok(config.map(|c| c.sources).unwrap_or_default())
}

#[tauri::command]
pub async fn gitlab_set_sources(
    _app: AppHandle,
    sources: Vec<GitlabSource>,
) -> Result<(), String> {
    let manager = get_project_manager().await;
    let project = manager
        .current_project()
        .await
        .map_err(|e| format!("No active project: {e}"))?;

    let core = project.schaltwerk_core.read().await;
    let db = core.database();

    if sources.is_empty() {
        db.clear_project_gitlab_config(&project.path)
            .map_err(|e| format!("Failed to clear GitLab config: {e}"))?;
    } else {
        let config = ProjectGitlabConfig { sources };
        db.set_project_gitlab_config(&project.path, &config)
            .map_err(|e| format!("Failed to save GitLab config: {e}"))?;
    }

    Ok(())
}

fn map_issue_summary_payload(
    issue: GitlabIssueSummary,
    source_label: &str,
) -> GitlabIssueSummaryPayload {
    GitlabIssueSummaryPayload {
        iid: issue.iid,
        title: issue.title,
        state: issue.state,
        updated_at: issue.updated_at,
        author: issue.author.map(|u| u.username),
        labels: issue.labels,
        url: issue.web_url,
        source_label: source_label.to_string(),
    }
}

fn map_issue_details_payload(
    details: GitlabIssueDetails,
    source_label: &str,
) -> GitlabIssueDetailsPayload {
    GitlabIssueDetailsPayload {
        iid: details.iid,
        title: details.title,
        url: details.web_url,
        description: details.description.unwrap_or_default(),
        labels: details.labels,
        state: details.state,
        notes: details
            .notes
            .into_iter()
            .filter(|n| !n.system)
            .map(map_note_payload)
            .collect(),
        source_label: source_label.to_string(),
    }
}

fn map_note_payload(note: GitlabNote) -> GitlabNotePayload {
    GitlabNotePayload {
        author: note.author.map(|u| u.username),
        created_at: note.created_at,
        body: note.body,
    }
}

fn map_mr_summary_payload(
    mr: GitlabMrSummary,
    source_label: &str,
) -> GitlabMrSummaryPayload {
    GitlabMrSummaryPayload {
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        updated_at: mr.updated_at,
        author: mr.author.map(|u| u.username),
        labels: mr.labels,
        url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        source_label: source_label.to_string(),
    }
}

fn map_mr_details_payload(
    details: GitlabMrDetails,
    source_label: &str,
) -> GitlabMrDetailsPayload {
    GitlabMrDetailsPayload {
        iid: details.iid,
        title: details.title,
        url: details.web_url,
        description: details.description.unwrap_or_default(),
        labels: details.labels,
        state: details.state,
        source_branch: details.source_branch,
        target_branch: details.target_branch,
        merge_status: details.merge_status,
        pipeline_status: details.pipeline.as_ref().map(|p| p.status.clone()),
        pipeline_url: details.pipeline.and_then(|p| p.web_url),
        notes: details
            .notes
            .into_iter()
            .filter(|n| !n.system)
            .map(map_note_payload)
            .collect(),
        reviewers: details
            .reviewers
            .into_iter()
            .map(|u| u.username)
            .collect(),
        source_label: source_label.to_string(),
    }
}

fn map_pipeline_payload(pipeline: GitlabPipelineDetails) -> GitlabPipelinePayload {
    GitlabPipelinePayload {
        id: pipeline.id,
        status: pipeline.status,
        url: pipeline.web_url,
        duration: pipeline.duration,
    }
}
