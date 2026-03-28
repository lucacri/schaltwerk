use std::path::Path;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::repository::ForgeType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeSourceConfig {
    pub project_identifier: String,
    pub hostname: Option<String>,
    pub label: String,
    pub forge_type: ForgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeAuthStatus {
    pub authenticated: bool,
    pub user_login: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepositoryInfo {
    pub name: String,
    pub default_branch: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeIssueSummary {
    pub id: String,
    pub title: String,
    pub state: String,
    pub updated_at: Option<String>,
    pub author: Option<String>,
    pub labels: Vec<ForgeLabel>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeIssueDetails {
    pub summary: ForgeIssueSummary,
    pub body: Option<String>,
    pub comments: Vec<ForgeComment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgePrSummary {
    pub id: String,
    pub title: String,
    pub state: String,
    pub updated_at: Option<String>,
    pub author: Option<String>,
    pub labels: Vec<ForgeLabel>,
    pub source_branch: String,
    pub target_branch: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgePrDetails {
    pub summary: ForgePrSummary,
    pub body: Option<String>,
    pub ci_status: Option<ForgeCiStatus>,
    pub reviews: Vec<ForgeReview>,
    pub review_comments: Vec<ForgeReviewComment>,
    pub provider_data: ForgeProviderData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgePrResult {
    pub branch: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ForgeProviderData {
    #[serde(rename_all = "camelCase")]
    GitHub {
        review_decision: Option<String>,
        status_checks: Vec<ForgeStatusCheck>,
        is_fork: bool,
    },
    #[serde(rename_all = "camelCase")]
    GitLab {
        merge_status: Option<String>,
        pipeline_status: Option<String>,
        pipeline_url: Option<String>,
        reviewers: Vec<String>,
    },
    None,
}

pub struct ForgeCreatePrParams<'a> {
    pub repo_path: &'a Path,
    pub source_branch: &'a str,
    pub target_branch: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    pub source: &'a ForgeSourceConfig,
}

pub struct ForgeCreateSessionPrParams<'a> {
    pub repo_path: &'a Path,
    pub session_worktree_path: &'a Path,
    pub session_slug: &'a str,
    pub session_branch: &'a str,
    pub base_branch: &'a str,
    pub pr_branch_name: &'a str,
    pub title: &'a str,
    pub body: Option<&'a str>,
    pub commit_message: Option<&'a str>,
    pub mode: ForgeCommitMode,
    pub source: &'a ForgeSourceConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForgeCommitMode {
    Squash,
    Reapply,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeLabel {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeComment {
    pub author: Option<String>,
    pub body: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeReview {
    pub author: Option<String>,
    pub state: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeReviewComment {
    pub author: Option<String>,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeCiStatus {
    pub state: String,
    pub checks: Vec<ForgeStatusCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatusCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug)]
pub enum ForgeError {
    NotInstalled,
    NoGitRemote,
    NotAGitHubRepository,
    CommandFailed {
        program: String,
        args: Vec<String>,
        status: Option<i32>,
        stdout: String,
        stderr: String,
    },
    Io(std::io::Error),
    Json(serde_json::Error),
    Git(anyhow::Error),
    InvalidInput(String),
    InvalidOutput(String),
    ConnectionFailed {
        hostname: String,
        stderr: String,
    },
}

impl ForgeError {
    pub fn classify_connection_error(self) -> Self {
        use crate::shared::network::{extract_hostname_from_stderr, is_connection_error};
        match &self {
            ForgeError::CommandFailed { stderr, .. } if is_connection_error(stderr) => {
                let hostname =
                    extract_hostname_from_stderr(stderr).unwrap_or_else(|| "unknown".into());
                ForgeError::ConnectionFailed {
                    hostname,
                    stderr: stderr.clone(),
                }
            }
            _ => self,
        }
    }
}

impl std::fmt::Display for ForgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ForgeError::NotInstalled => write!(f, "Forge CLI tool is not installed."),
            ForgeError::NoGitRemote => {
                write!(f, "No Git remotes configured for this repository.")
            }
            ForgeError::NotAGitHubRepository => {
                write!(f, "No GitHub remotes configured for this repository.")
            }
            ForgeError::CommandFailed {
                program,
                status,
                stderr,
                ..
            } => write!(
                f,
                "Command `{program}` failed with status {status:?}: {stderr}"
            ),
            ForgeError::Io(err) => write!(f, "IO error: {err}"),
            ForgeError::Json(err) => write!(f, "JSON error: {err}"),
            ForgeError::Git(err) => write!(f, "Git error: {err}"),
            ForgeError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            ForgeError::InvalidOutput(msg) => write!(f, "Invalid CLI output: {msg}"),
            ForgeError::ConnectionFailed { hostname, .. } => {
                write!(f, "Connection to {hostname} failed")
            }
        }
    }
}

impl std::error::Error for ForgeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ForgeError::Io(err) => Some(err),
            ForgeError::Json(err) => Some(err),
            ForgeError::Git(err) => Some(err.as_ref()),
            _ => None,
        }
    }
}

impl From<super::github_cli::GitHubCliError> for ForgeError {
    fn from(err: super::github_cli::GitHubCliError) -> Self {
        use super::github_cli::GitHubCliError;
        match err {
            GitHubCliError::NotInstalled => ForgeError::NotInstalled,
            GitHubCliError::NoGitRemote => ForgeError::NoGitRemote,
            GitHubCliError::NotAGitHubRepository => ForgeError::NotAGitHubRepository,
            GitHubCliError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            } => ForgeError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            },
            GitHubCliError::Io(err) => ForgeError::Io(err),
            GitHubCliError::Json(err) => ForgeError::Json(err),
            GitHubCliError::Git(err) => ForgeError::Git(err),
            GitHubCliError::InvalidInput(msg) => ForgeError::InvalidInput(msg),
            GitHubCliError::InvalidOutput(msg) => ForgeError::InvalidOutput(msg),
        }
    }
}

impl From<super::gitlab_cli::GitlabCliError> for ForgeError {
    fn from(err: super::gitlab_cli::GitlabCliError) -> Self {
        use super::gitlab_cli::GitlabCliError;
        match err {
            GitlabCliError::NotInstalled => ForgeError::NotInstalled,
            GitlabCliError::NoGitRemote => ForgeError::NoGitRemote,
            GitlabCliError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            } => ForgeError::CommandFailed {
                program,
                args,
                status,
                stdout,
                stderr,
            },
            GitlabCliError::Io(err) => ForgeError::Io(err),
            GitlabCliError::Json(err) => ForgeError::Json(err),
            GitlabCliError::Git(err) => ForgeError::Git(err),
            GitlabCliError::InvalidInput(msg) => ForgeError::InvalidInput(msg),
            GitlabCliError::InvalidOutput(msg) => ForgeError::InvalidOutput(msg),
        }
    }
}

#[async_trait]
pub trait ForgeProvider: Send + Sync {
    fn forge_type(&self) -> ForgeType;

    async fn ensure_installed(&self) -> Result<(), ForgeError>;

    async fn check_auth(
        &self,
        hostname: Option<&str>,
    ) -> Result<ForgeAuthStatus, ForgeError>;

    async fn view_repository(
        &self,
        repo_path: &Path,
    ) -> Result<ForgeRepositoryInfo, ForgeError>;

    async fn search_issues(
        &self,
        repo_path: &Path,
        query: Option<&str>,
        limit: Option<u32>,
        source: &ForgeSourceConfig,
    ) -> Result<Vec<ForgeIssueSummary>, ForgeError>;

    async fn get_issue_details(
        &self,
        repo_path: &Path,
        id: &str,
        source: &ForgeSourceConfig,
    ) -> Result<ForgeIssueDetails, ForgeError>;

    async fn search_prs(
        &self,
        repo_path: &Path,
        query: Option<&str>,
        limit: Option<u32>,
        source: &ForgeSourceConfig,
    ) -> Result<Vec<ForgePrSummary>, ForgeError>;

    async fn get_pr_details(
        &self,
        repo_path: &Path,
        id: &str,
        source: &ForgeSourceConfig,
    ) -> Result<ForgePrDetails, ForgeError>;

    async fn create_pr(
        &self,
        params: ForgeCreatePrParams<'_>,
    ) -> Result<ForgePrResult, ForgeError>;

    async fn create_session_pr(
        &self,
        params: ForgeCreateSessionPrParams<'_>,
    ) -> Result<ForgePrResult, ForgeError>;

    async fn get_pr_ci_status(
        &self,
        repo_path: &Path,
        id: &str,
        source: &ForgeSourceConfig,
    ) -> Result<Option<ForgeCiStatus>, ForgeError>;

    async fn get_review_comments(
        &self,
        repo_path: &Path,
        id: &str,
        source: &ForgeSourceConfig,
    ) -> Result<Vec<ForgeReviewComment>, ForgeError>;

    async fn approve_pr(
        &self,
        repo_path: &Path,
        id: &str,
        source: &ForgeSourceConfig,
    ) -> Result<(), ForgeError>;

    async fn merge_pr(
        &self,
        repo_path: &Path,
        id: &str,
        squash: bool,
        delete_branch: bool,
        source: &ForgeSourceConfig,
    ) -> Result<(), ForgeError>;

    async fn comment_on_pr(
        &self,
        repo_path: &Path,
        id: &str,
        message: &str,
        source: &ForgeSourceConfig,
    ) -> Result<(), ForgeError>;
}

pub fn create_provider(forge_type: ForgeType) -> Result<Box<dyn ForgeProvider>, ForgeError> {
    match forge_type {
        ForgeType::GitHub => Ok(Box::new(
            super::github_cli::GitHubCli::new(),
        )),
        ForgeType::GitLab => Ok(Box::new(
            super::gitlab_cli::GitlabCli::new(),
        )),
        ForgeType::Unknown => Err(ForgeError::InvalidInput(
            "No forge detected. Configure a GitHub or GitLab remote.".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_provider_returns_github_for_github_type() {
        let provider = create_provider(ForgeType::GitHub).unwrap();
        assert_eq!(provider.forge_type(), ForgeType::GitHub);
    }

    #[test]
    fn create_provider_returns_gitlab_for_gitlab_type() {
        let provider = create_provider(ForgeType::GitLab).unwrap();
        assert_eq!(provider.forge_type(), ForgeType::GitLab);
    }

    #[test]
    fn create_provider_returns_error_for_unknown() {
        let result = create_provider(ForgeType::Unknown);
        assert!(result.is_err());
        match result {
            Err(err) => assert!(
                err.to_string().contains("No forge detected"),
                "Expected user-friendly error, got: {err}"
            ),
            Ok(_) => panic!("Expected error for Unknown forge type"),
        }
    }

    #[test]
    fn forge_error_display_messages_are_user_friendly() {
        assert_eq!(
            ForgeError::NotInstalled.to_string(),
            "Forge CLI tool is not installed."
        );
        assert_eq!(
            ForgeError::NoGitRemote.to_string(),
            "No Git remotes configured for this repository."
        );
        assert_eq!(
            ForgeError::NotAGitHubRepository.to_string(),
            "No GitHub remotes configured for this repository."
        );
        assert!(ForgeError::InvalidInput("bad".into())
            .to_string()
            .contains("bad"));
    }

    #[test]
    fn github_error_converts_to_forge_error() {
        use super::super::github_cli::GitHubCliError;

        let err: ForgeError = GitHubCliError::NotInstalled.into();
        assert!(matches!(err, ForgeError::NotInstalled));

        let err: ForgeError = GitHubCliError::NoGitRemote.into();
        assert!(matches!(err, ForgeError::NoGitRemote));

        let err: ForgeError = GitHubCliError::NotAGitHubRepository.into();
        assert!(matches!(err, ForgeError::NotAGitHubRepository));

        let err: ForgeError = GitHubCliError::InvalidInput("test".into()).into();
        assert!(matches!(err, ForgeError::InvalidInput(msg) if msg == "test"));
    }

    #[test]
    fn gitlab_error_converts_to_forge_error() {
        use super::super::gitlab_cli::GitlabCliError;

        let err: ForgeError = GitlabCliError::NotInstalled.into();
        assert!(matches!(err, ForgeError::NotInstalled));

        let err: ForgeError = GitlabCliError::NoGitRemote.into();
        assert!(matches!(err, ForgeError::NoGitRemote));

        let err: ForgeError = GitlabCliError::InvalidOutput("bad output".into()).into();
        assert!(matches!(err, ForgeError::InvalidOutput(msg) if msg == "bad output"));
    }

    #[test]
    fn forge_commit_mode_serializes_correctly() {
        assert_eq!(
            serde_json::to_string(&ForgeCommitMode::Squash).unwrap(),
            "\"squash\""
        );
        assert_eq!(
            serde_json::to_string(&ForgeCommitMode::Reapply).unwrap(),
            "\"reapply\""
        );
    }

    #[test]
    fn command_failed_with_connection_error_converts_to_connection_failed() {
        let err = ForgeError::CommandFailed {
            program: "glab".into(),
            args: vec!["api".into()],
            status: Some(1),
            stdout: String::new(),
            stderr: "Get \"https://gitlab.critel.li/api/v4/projects\": dial tcp 10.17.0.127:443: connect: no route to host".into(),
        };
        assert!(matches!(
            err.classify_connection_error(),
            ForgeError::ConnectionFailed { .. }
        ));
    }

    #[test]
    fn command_failed_without_connection_error_stays_unchanged() {
        let err = ForgeError::CommandFailed {
            program: "glab".into(),
            args: vec!["api".into()],
            status: Some(1),
            stdout: String::new(),
            stderr: "401 Unauthorized".into(),
        };
        assert!(matches!(
            err.classify_connection_error(),
            ForgeError::CommandFailed { .. }
        ));
    }

    #[test]
    fn forge_pr_summary_serializes_updated_at() {
        let summary = ForgePrSummary {
            id: "42".into(),
            title: "Test PR".into(),
            state: "open".into(),
            updated_at: Some("2026-03-28T10:00:00Z".into()),
            author: Some("alice".into()),
            labels: vec![],
            source_branch: "feature/test".into(),
            target_branch: "main".into(),
            url: Some("https://example.com/pr/42".into()),
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["updatedAt"], "2026-03-28T10:00:00Z");
    }

    #[test]
    fn forge_pr_summary_updated_at_none_serializes_as_null() {
        let summary = ForgePrSummary {
            id: "1".into(),
            title: "No date".into(),
            state: "open".into(),
            updated_at: None,
            author: None,
            labels: vec![],
            source_branch: "fix/x".into(),
            target_branch: "main".into(),
            url: None,
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert!(json["updatedAt"].is_null());
    }

    #[test]
    fn connection_failed_display_includes_hostname() {
        let err = ForgeError::ConnectionFailed {
            hostname: "gitlab.critel.li".into(),
            stderr: "no route to host".into(),
        };
        let msg = err.to_string();
        assert!(msg.contains("gitlab.critel.li"));
    }
}
