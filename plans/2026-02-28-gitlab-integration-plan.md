# GitLab Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add self-hosted GitLab integration to Schaltwerk, mirroring the GitHub pattern but with multi-source project support, right-panel tabs for Issues/MRs, and full MR lifecycle management via the `glab` CLI.

**Architecture:** A new `gitlab_cli.rs` domain module wraps the `glab` binary using the same `CommandRunner` trait as `github_cli.rs`. Multi-source GitLab project configuration is stored as JSON in the `project_config` table. Frontend uses parallel hooks/context/components mirroring the GitHub integration, with two new right-panel tabs (Issues, Merge Requests) for persistent browsing.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), SQLite (project config), `glab` CLI (GitLab operations), Jotai (state), Vitest (tests).

---

## Terminology & Conventions

| GitLab concept | GitHub equivalent | Notes |
|---|---|---|
| Merge Request (MR) | Pull Request (PR) | `iid` = project-scoped ID (like GitHub `number`) |
| Pipeline | Status Checks | More prominent in GitLab; dedicated endpoint |
| Project | Repository | `group/project` path format |
| `glab` | `gh` | CLI tool; uses `--output json` (not `--json field,field`) |
| Source | — | New concept: 1-N GitLab projects per Schaltwerk project |

## Multi-Source Design

Unlike GitHub (single repo per project), GitLab supports **1-N "sources"** — each a GitLab project with independent feature flags:

```rust
pub struct GitlabSource {
    pub id: String,                // UUID v4
    pub label: String,             // User-friendly name, e.g. "Backend API"
    pub project_path: String,      // "group/project" or "group/sub/project"
    pub hostname: String,          // "gitlab.com" or "gitlab.example.com"
    pub issues_enabled: bool,
    pub mrs_enabled: bool,
    pub pipelines_enabled: bool,
}
```

Stored as JSON in `project_config.gitlab_sources TEXT`.

## `glab` CLI JSON Support Matrix

| Command | `--output json` | Notes |
|---|---|---|
| `glab auth status` | No | Text parsing required |
| `glab issue list` | Yes | `-F json` flag |
| `glab issue view <iid>` | Yes | `-F json` flag |
| `glab mr list` | Yes | `-F json` flag |
| `glab mr view <iid>` | Yes | `-F json` flag |
| `glab mr create` | No | Parse URL from stdout |
| `glab mr approve` | No | Success = exit 0 |
| `glab mr merge` | No | Parse output text |
| `glab mr note` | No | Success = exit 0 |
| `glab ci get` | Yes | `-F json` flag |
| `glab api` | Yes | Raw REST/GraphQL access |

---

## Phase 1: Backend Foundation (CLI Wrapper + Commands + DB Schema)

### Task 1.1: Create `gitlab_cli.rs` — Types and Error Handling

**Files:**
- Create: `src-tauri/src/domains/git/gitlab_cli.rs`
- Modify: `src-tauri/src/domains/git/mod.rs`
- Test: `src-tauri/src/domains/git/gitlab_cli.rs` (inline `#[cfg(test)]` module)

**Step 1: Write failing tests for GitlabCli construction and error types**

```rust
// At bottom of gitlab_cli.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::git::github_cli::{CommandOutput, CommandRunner, MockRunner};

    #[test]
    fn ensure_installed_succeeds_when_glab_found() {
        let mut runner = MockRunner::new();
        runner.queue_success("glab version 1.46.0 (2026-01-15)");
        let cli = GitlabCli::with_runner(runner);
        assert!(cli.ensure_installed().is_ok());
    }

    #[test]
    fn ensure_installed_fails_when_not_found() {
        let mut runner = MockRunner::new();
        runner.queue_io_error(std::io::ErrorKind::NotFound);
        let cli = GitlabCli::with_runner(runner);
        let err = cli.ensure_installed().unwrap_err();
        assert!(matches!(err, GitlabCliError::NotInstalled));
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test --package schaltwerk --lib domains::git::gitlab_cli::tests -v`
Expected: FAIL — module doesn't exist

**Step 3: Implement types and construction**

```rust
// src-tauri/src/domains/git/gitlab_cli.rs

use crate::domains::git::github_cli::{CommandOutput, CommandRunner, SystemCommandRunner};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;
use std::sync::OnceLock;

// ── Error types ──

#[derive(Debug)]
pub enum GitlabCliError {
    NotInstalled,
    NoGitRemote,
    CommandFailed {
        program: String,
        args: Vec<String>,
        status: Option<i32>,
        stdout: String,
        stderr: String,
    },
    Io(io::Error),
    Json(serde_json::Error),
    Git(anyhow::Error),
    InvalidInput(String),
    InvalidOutput(String),
}

impl std::fmt::Display for GitlabCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInstalled => write!(f, "glab CLI is not installed"),
            Self::NoGitRemote => write!(f, "No git remote configured"),
            Self::CommandFailed { stderr, .. } => write!(f, "Command failed: {stderr}"),
            Self::Io(e) => write!(f, "IO error: {e}"),
            Self::Json(e) => write!(f, "JSON parse error: {e}"),
            Self::Git(e) => write!(f, "Git error: {e}"),
            Self::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            Self::InvalidOutput(msg) => write!(f, "Invalid output: {msg}"),
        }
    }
}

// ── Auth types ──

#[derive(Debug, Clone, Serialize)]
pub struct GitlabAuthStatus {
    pub authenticated: bool,
    pub hostname: Option<String>,
    pub user_login: Option<String>,
}

// ── Issue types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabIssueLabel {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabIssueSummary {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<GitlabUser>,
    pub labels: Vec<String>,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabIssueDetails {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub description: Option<String>,
    pub labels: Vec<String>,
    pub state: String,
    pub author: Option<GitlabUser>,
    pub notes: Vec<GitlabNote>,
}

// ── MR types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabMrSummary {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub author: Option<GitlabUser>,
    pub labels: Vec<String>,
    pub web_url: String,
    pub source_branch: String,
    pub target_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabMrDetails {
    pub iid: u64,
    pub title: String,
    pub web_url: String,
    pub description: Option<String>,
    pub labels: Vec<String>,
    pub state: String,
    pub source_branch: String,
    pub target_branch: String,
    pub author: Option<GitlabUser>,
    pub merge_status: Option<String>,
    pub pipeline: Option<GitlabPipelineSummary>,
    pub notes: Vec<GitlabNote>,
    pub reviewers: Vec<GitlabUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabMrResult {
    pub source_branch: String,
    pub url: String,
}

// ── Pipeline types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabPipelineSummary {
    pub id: u64,
    pub status: String,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabPipelineDetails {
    pub id: u64,
    pub status: String,
    pub web_url: Option<String>,
    pub source: Option<String>,
    pub duration: Option<f64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ── Shared types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabUser {
    pub username: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitlabNote {
    pub author: Option<GitlabUser>,
    pub created_at: String,
    pub body: String,
    pub system: bool,
}

// ── CLI struct ──

pub struct GitlabCli<R: CommandRunner = SystemCommandRunner> {
    runner: R,
    program: String,
}

impl GitlabCli<SystemCommandRunner> {
    pub fn new() -> Self {
        Self {
            runner: SystemCommandRunner,
            program: resolve_gitlab_cli_program(),
        }
    }
}

impl<R: CommandRunner> GitlabCli<R> {
    pub fn with_runner(runner: R) -> Self {
        Self {
            runner,
            program: "glab".to_string(),
        }
    }

    pub fn ensure_installed(&self) -> Result<(), GitlabCliError> {
        static LOGGED: OnceLock<()> = OnceLock::new();
        let output = self
            .runner
            .run(&self.program, &["--version"], None, &[])
            .map_err(map_runner_error)?;
        if output.status != Some(0) {
            return Err(GitlabCliError::NotInstalled);
        }
        LOGGED.get_or_init(|| {
            info!("[GitlabCli] {}", output.stdout.trim());
        });
        Ok(())
    }
}

// ── Helpers ──

fn map_runner_error(err: io::Error) -> GitlabCliError {
    if err.kind() == io::ErrorKind::NotFound {
        GitlabCliError::NotInstalled
    } else {
        GitlabCliError::Io(err)
    }
}

fn command_failure(program: &str, args: &[String], output: CommandOutput) -> GitlabCliError {
    GitlabCliError::CommandFailed {
        program: program.to_string(),
        args: args.to_vec(),
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    }
}

fn resolve_gitlab_cli_program() -> String {
    static RESOLVED: OnceLock<String> = OnceLock::new();
    RESOLVED
        .get_or_init(|| {
            if let Ok(path) = std::env::var("GITLAB_CLI_PATH") {
                return path;
            }
            if let Ok(path) = std::env::var("GLAB_BINARY_PATH") {
                return path;
            }
            let candidate_dirs = [
                dirs::home_dir().map(|h| h.join(".local/bin")),
                dirs::home_dir().map(|h| h.join(".cargo/bin")),
                dirs::home_dir().map(|h| h.join("bin")),
                Some("/opt/homebrew/bin".into()),
                Some("/usr/local/bin".into()),
                Some("/usr/bin".into()),
                Some("/bin".into()),
            ];
            for dir in candidate_dirs.iter().flatten() {
                let candidate = dir.join("glab");
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
            }
            if let Ok(path) = which::which("glab") {
                return path.to_string_lossy().to_string();
            }
            "glab".to_string()
        })
        .clone()
}

pub fn format_cli_error(err: GitlabCliError) -> String {
    match &err {
        GitlabCliError::NotInstalled => {
            "glab CLI is not installed. Install it from https://gitlab.com/gitlab-org/cli".into()
        }
        GitlabCliError::NoGitRemote => "No git remote configured for this repository.".into(),
        GitlabCliError::CommandFailed { stderr, stdout, .. } => {
            let msg = if !stderr.is_empty() { stderr } else { stdout };
            format!("GitLab CLI error: {}", msg.trim())
        }
        GitlabCliError::InvalidInput(msg) => format!("Invalid input: {msg}"),
        GitlabCliError::InvalidOutput(msg) => format!("Unexpected output: {msg}"),
        other => format!("{other}"),
    }
}
```

**Step 4: Register the module**

In `src-tauri/src/domains/git/mod.rs`, add:
```rust
pub mod gitlab_cli;
```

**Step 5: Run tests to verify they pass**

Run: `cargo test --package schaltwerk --lib domains::git::gitlab_cli::tests -v`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs src-tauri/src/domains/git/mod.rs
git commit -m "feat(gitlab): add gitlab_cli module with types and error handling"
```

---

### Task 1.2: Implement `check_auth()` for GitlabCli

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write failing test**

```rust
#[test]
fn check_auth_returns_authenticated_when_logged_in() {
    let mut runner = MockRunner::new();
    // glab auth status outputs text like:
    // gitlab.com
    //   ✓ Logged in to gitlab.com as username (keyring)
    //   ✓ Git operations for gitlab.com configured to use https protocol.
    //   ✓ API calls for gitlab.com are made over https protocol.
    //   ✓ REST API Endpoint: https://gitlab.com/api/v4/
    //   ✓ Token: ********************
    //   ✓ Token Scopes: api, read_repository, write_repository
    runner.queue_success(
        "gitlab.com\n  \u{2713} Logged in to gitlab.com as testuser (keyring)\n  \u{2713} Git operations configured\n"
    );
    let cli = GitlabCli::with_runner(runner);
    let status = cli.check_auth(None).unwrap();
    assert!(status.authenticated);
    assert_eq!(status.user_login.as_deref(), Some("testuser"));
    assert_eq!(status.hostname.as_deref(), Some("gitlab.com"));
}

#[test]
fn check_auth_returns_unauthenticated_when_not_logged_in() {
    let mut runner = MockRunner::new();
    runner.queue_failure(1, "", "No authenticated hosts configured.");
    let cli = GitlabCli::with_runner(runner);
    let status = cli.check_auth(None).unwrap();
    assert!(!status.authenticated);
    assert!(status.user_login.is_none());
}
```

**Step 2: Run test — fails (method doesn't exist)**

**Step 3: Implement `check_auth`**

```rust
impl<R: CommandRunner> GitlabCli<R> {
    pub fn check_auth(
        &self,
        hostname: Option<&str>,
    ) -> Result<GitlabAuthStatus, GitlabCliError> {
        let mut args = vec!["auth", "status"];
        if let Some(host) = hostname {
            args.push("--hostname");
            args.push(host);
        }

        let env = [
            ("GLAB_NO_PROMPT", "1"),
            ("NO_COLOR", "1"),
        ];

        let output = self
            .runner
            .run(&self.program, &args, None, &env)
            .map_err(map_runner_error)?;

        let combined = format!("{}\n{}", output.stdout, output.stderr);

        if output.status != Some(0) {
            return Ok(GitlabAuthStatus {
                authenticated: false,
                hostname: hostname.map(String::from),
                user_login: None,
            });
        }

        let (parsed_host, parsed_user) = parse_auth_status_output(&combined);

        Ok(GitlabAuthStatus {
            authenticated: true,
            hostname: parsed_host.or_else(|| hostname.map(String::from)),
            user_login: parsed_user,
        })
    }
}

fn parse_auth_status_output(text: &str) -> (Option<String>, Option<String>) {
    let stripped = strip_ansi_codes(text);
    let mut hostname = None;
    let mut username = None;

    for line in stripped.lines() {
        let trimmed = line.trim();
        // First non-indented non-empty line is the hostname
        if hostname.is_none() && !trimmed.is_empty() && !trimmed.starts_with('\u{2713}')
            && !trimmed.starts_with('X') && !trimmed.starts_with('-')
        {
            hostname = Some(trimmed.to_string());
        }
        // "Logged in to <host> as <username>"
        if let Some(pos) = trimmed.find("Logged in to") {
            let after = &trimmed[pos + "Logged in to".len()..];
            if let Some(as_pos) = after.find(" as ") {
                let user_part = &after[as_pos + " as ".len()..];
                let user = user_part
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
                if !user.is_empty() {
                    username = Some(user.to_string());
                }
            }
        }
    }

    (hostname, username)
}

fn strip_ansi_codes(text: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    re.replace_all(text, "").to_string()
}
```

**Step 4: Run tests — pass**

**Step 5: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat(gitlab): implement check_auth with text parsing"
```

---

### Task 1.3: Implement Issue Search & Detail Methods

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write failing tests**

```rust
#[test]
fn search_issues_parses_json_response() {
    let mut runner = MockRunner::new();
    runner.queue_success(r#"[
        {
            "iid": 42,
            "title": "Fix login bug",
            "state": "opened",
            "updated_at": "2026-02-28T10:00:00Z",
            "author": {"username": "dev1", "name": "Dev One"},
            "labels": ["bug", "priority::high"],
            "web_url": "https://gitlab.com/group/project/-/issues/42"
        }
    ]"#);
    let cli = GitlabCli::with_runner(runner);
    let issues = cli
        .search_issues(Path::new("/repo"), "", 30, "group/project", None)
        .unwrap();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].iid, 42);
    assert_eq!(issues[0].title, "Fix login bug");
    assert_eq!(issues[0].state, "opened");
}

#[test]
fn get_issue_details_parses_json_with_notes() {
    let mut runner = MockRunner::new();
    runner.queue_success(r#"{
        "iid": 42,
        "title": "Fix login bug",
        "web_url": "https://gitlab.com/group/project/-/issues/42",
        "description": "The login page crashes.",
        "labels": ["bug"],
        "state": "opened",
        "author": {"username": "dev1"},
        "notes": [
            {
                "author": {"username": "reviewer"},
                "created_at": "2026-02-28T12:00:00Z",
                "body": "Can reproduce this.",
                "system": false
            }
        ]
    }"#);
    let cli = GitlabCli::with_runner(runner);
    let details = cli
        .get_issue_details(Path::new("/repo"), 42, "group/project", None)
        .unwrap();
    assert_eq!(details.iid, 42);
    assert_eq!(details.notes.len(), 1);
    assert!(!details.notes[0].system);
}
```

**Step 2: Run tests — fail**

**Step 3: Implement**

```rust
impl<R: CommandRunner> GitlabCli<R> {
    pub fn search_issues(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Vec<GitlabIssueSummary>, GitlabCliError> {
        let limit_str = limit.to_string();
        let mut args = vec![
            "issue", "list",
            "--output", "json",
            "--per-page", &limit_str,
            "-R", gitlab_project,
        ];
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            args.push("--search");
            args.push(trimmed);
        }

        let mut env: Vec<(&str, &str)> = vec![("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if output.status != Some(0) {
            return Err(command_failure(
                &self.program,
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                output,
            ));
        }

        let stdout = output.stdout.trim();
        if stdout.is_empty() || stdout == "null" {
            return Ok(vec![]);
        }

        let issues: Vec<GitlabIssueSummary> =
            serde_json::from_str(stdout).map_err(GitlabCliError::Json)?;
        Ok(issues)
    }

    pub fn get_issue_details(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<GitlabIssueDetails, GitlabCliError> {
        let iid_str = iid.to_string();
        let args = vec![
            "issue", "view", &iid_str,
            "--output", "json",
            "--comments",
            "-R", gitlab_project,
        ];

        let mut env: Vec<(&str, &str)> = vec![("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if output.status != Some(0) {
            return Err(command_failure(
                &self.program,
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                output,
            ));
        }

        let details: GitlabIssueDetails =
            serde_json::from_str(output.stdout.trim()).map_err(GitlabCliError::Json)?;
        Ok(details)
    }
}
```

**Step 4: Run tests — pass**

**Step 5: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat(gitlab): implement issue search and detail methods"
```

---

### Task 1.4: Implement MR Search & Detail Methods

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write failing tests**

```rust
#[test]
fn search_mrs_parses_json_response() {
    let mut runner = MockRunner::new();
    runner.queue_success(r#"[
        {
            "iid": 99,
            "title": "Add feature X",
            "state": "opened",
            "updated_at": "2026-02-28T10:00:00Z",
            "author": {"username": "dev1"},
            "labels": ["feature"],
            "web_url": "https://gitlab.com/group/project/-/merge_requests/99",
            "source_branch": "feature-x",
            "target_branch": "main"
        }
    ]"#);
    let cli = GitlabCli::with_runner(runner);
    let mrs = cli
        .search_mrs(Path::new("/repo"), "", 30, "group/project", None)
        .unwrap();
    assert_eq!(mrs.len(), 1);
    assert_eq!(mrs[0].iid, 99);
    assert_eq!(mrs[0].source_branch, "feature-x");
}

#[test]
fn get_mr_details_parses_pipeline_and_reviewers() {
    let mut runner = MockRunner::new();
    runner.queue_success(r#"{
        "iid": 99,
        "title": "Add feature X",
        "web_url": "https://gitlab.com/group/project/-/merge_requests/99",
        "description": "Adds feature X to the app.",
        "labels": ["feature"],
        "state": "opened",
        "source_branch": "feature-x",
        "target_branch": "main",
        "author": {"username": "dev1"},
        "merge_status": "can_be_merged",
        "pipeline": {
            "id": 12345,
            "status": "success",
            "web_url": "https://gitlab.com/group/project/-/pipelines/12345"
        },
        "notes": [],
        "reviewers": [{"username": "reviewer1", "name": "Reviewer One"}]
    }"#);
    let cli = GitlabCli::with_runner(runner);
    let details = cli
        .get_mr_details(Path::new("/repo"), 99, "group/project", None)
        .unwrap();
    assert_eq!(details.pipeline.as_ref().unwrap().status, "success");
    assert_eq!(details.reviewers.len(), 1);
}
```

**Step 2: Run tests — fail**

**Step 3: Implement `search_mrs` and `get_mr_details`**

```rust
impl<R: CommandRunner> GitlabCli<R> {
    pub fn search_mrs(
        &self,
        project_path: &Path,
        query: &str,
        limit: usize,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Vec<GitlabMrSummary>, GitlabCliError> {
        let limit_str = limit.to_string();
        let mut args = vec![
            "mr", "list",
            "--output", "json",
            "--per-page", &limit_str,
            "-R", gitlab_project,
        ];
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            args.push("--search");
            args.push(trimmed);
        }

        let mut env: Vec<(&str, &str)> = vec![("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if output.status != Some(0) {
            return Err(command_failure(
                &self.program,
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                output,
            ));
        }

        let stdout = output.stdout.trim();
        if stdout.is_empty() || stdout == "null" {
            return Ok(vec![]);
        }

        let mrs: Vec<GitlabMrSummary> =
            serde_json::from_str(stdout).map_err(GitlabCliError::Json)?;
        Ok(mrs)
    }

    pub fn get_mr_details(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<GitlabMrDetails, GitlabCliError> {
        let iid_str = iid.to_string();
        let args = vec![
            "mr", "view", &iid_str,
            "--output", "json",
            "--comments",
            "-R", gitlab_project,
        ];

        let mut env: Vec<(&str, &str)> = vec![("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if output.status != Some(0) {
            return Err(command_failure(
                &self.program,
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                output,
            ));
        }

        let details: GitlabMrDetails =
            serde_json::from_str(output.stdout.trim()).map_err(GitlabCliError::Json)?;
        Ok(details)
    }
}
```

**Step 4: Run tests — pass**

**Step 5: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat(gitlab): implement MR search and detail methods"
```

---

### Task 1.5: Implement Pipeline Status Method

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write failing test**

```rust
#[test]
fn get_mr_pipeline_status_returns_pipeline_details() {
    let mut runner = MockRunner::new();
    // glab ci get --output json returns pipeline info
    runner.queue_success(r#"{
        "id": 12345,
        "status": "running",
        "web_url": "https://gitlab.com/group/project/-/pipelines/12345",
        "source": "merge_request_event",
        "duration": 120.5,
        "created_at": "2026-02-28T10:00:00Z",
        "updated_at": "2026-02-28T10:02:00Z"
    }"#);
    let cli = GitlabCli::with_runner(runner);
    let pipeline = cli
        .get_mr_pipeline_status(Path::new("/repo"), "feature-x", "group/project", None)
        .unwrap();
    assert!(pipeline.is_some());
    let p = pipeline.unwrap();
    assert_eq!(p.status, "running");
    assert_eq!(p.id, 12345);
}
```

**Step 2: Run test — fails**

**Step 3: Implement**

```rust
impl<R: CommandRunner> GitlabCli<R> {
    pub fn get_mr_pipeline_status(
        &self,
        project_path: &Path,
        branch: &str,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<Option<GitlabPipelineDetails>, GitlabCliError> {
        let args = vec![
            "ci", "get",
            "--branch", branch,
            "--output", "json",
            "-R", gitlab_project,
        ];

        let mut env: Vec<(&str, &str)> = vec![("NO_COLOR", "1")];
        if let Some(host) = hostname {
            env.push(("GITLAB_HOST", host));
        }

        let output = self
            .runner
            .run(&self.program, &args, Some(project_path), &env)
            .map_err(map_runner_error)?;

        if output.status != Some(0) {
            return Ok(None);
        }

        let stdout = output.stdout.trim();
        if stdout.is_empty() || stdout == "null" {
            return Ok(None);
        }

        let pipeline: GitlabPipelineDetails =
            serde_json::from_str(stdout).map_err(GitlabCliError::Json)?;
        Ok(Some(pipeline))
    }
}
```

**Step 4: Run tests — pass**

**Step 5: Commit**

```bash
git add src-tauri/src/domains/git/gitlab_cli.rs
git commit -m "feat(gitlab): implement pipeline status method"
```

---

### Task 1.6: Add DB Schema for GitLab Config (Multi-Source)

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/infrastructure/database/db_project_config.rs`
- Modify: `src-tauri/src/infrastructure/database/mod.rs`
- Test: `src-tauri/src/infrastructure/database/db_project_config.rs` (or existing test module)

**Step 1: Write failing test**

```rust
// In db_project_config.rs tests or a new test file
#[test]
fn test_gitlab_sources_roundtrip() {
    let db = Database::open_in_memory().unwrap();
    let repo_path = Path::new("/test/repo");

    let sources = vec![GitlabSource {
        id: "src-1".to_string(),
        label: "Backend".to_string(),
        project_path: "team/backend".to_string(),
        hostname: "gitlab.com".to_string(),
        issues_enabled: true,
        mrs_enabled: true,
        pipelines_enabled: false,
    }];

    let config = ProjectGitlabConfig {
        sources: sources.clone(),
    };

    db.set_project_gitlab_config(repo_path, &config).unwrap();
    let loaded = db.get_project_gitlab_config(repo_path).unwrap();
    assert!(loaded.is_some());
    let loaded = loaded.unwrap();
    assert_eq!(loaded.sources.len(), 1);
    assert_eq!(loaded.sources[0].label, "Backend");
    assert_eq!(loaded.sources[0].project_path, "team/backend");
}
```

**Step 2: Run test — fails**

**Step 3: Add migration in `db_schema.rs`**

In `apply_project_config_migrations`, add:
```rust
let _ = conn.execute(
    "ALTER TABLE project_config ADD COLUMN gitlab_sources TEXT",
    [],
);
```

**Step 4: Add types and trait methods in `db_project_config.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitlabSource {
    pub id: String,
    pub label: String,
    pub project_path: String,
    pub hostname: String,
    pub issues_enabled: bool,
    pub mrs_enabled: bool,
    pub pipelines_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitlabConfig {
    pub sources: Vec<GitlabSource>,
}
```

Add to `ProjectConfigMethods` trait:
```rust
fn get_project_gitlab_config(&self, repo_path: &Path) -> Result<Option<ProjectGitlabConfig>>;
fn set_project_gitlab_config(&self, repo_path: &Path, config: &ProjectGitlabConfig) -> Result<()>;
fn clear_project_gitlab_config(&self, repo_path: &Path) -> Result<()>;
```

Implement following the GitHub pattern but storing `sources` as JSON:
```rust
fn get_project_gitlab_config(&self, repo_path: &Path) -> Result<Option<ProjectGitlabConfig>> {
    let conn = self.get_conn()?;
    let canonical_path = std::fs::canonicalize(repo_path)
        .unwrap_or_else(|_| repo_path.to_path_buf());

    let query_res: rusqlite::Result<Option<String>> = conn.query_row(
        "SELECT gitlab_sources FROM project_config WHERE repository_path = ?1",
        params![canonical_path.to_string_lossy()],
        |row| row.get(0),
    );

    match query_res {
        Ok(Some(json_str)) => {
            let sources: Vec<GitlabSource> = serde_json::from_str(&json_str)?;
            if sources.is_empty() {
                Ok(None)
            } else {
                Ok(Some(ProjectGitlabConfig { sources }))
            }
        }
        Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn set_project_gitlab_config(
    &self,
    repo_path: &Path,
    config: &ProjectGitlabConfig,
) -> Result<()> {
    let conn = self.get_conn()?;
    let now = Utc::now().timestamp();
    let canonical_path = std::fs::canonicalize(repo_path)
        .unwrap_or_else(|_| repo_path.to_path_buf());
    let json_str = serde_json::to_string(&config.sources)?;

    conn.execute(
        "INSERT INTO project_config (
                repository_path,
                auto_cancel_after_merge,
                gitlab_sources,
                created_at,
                updated_at
            )
            VALUES (
                ?1,
                COALESCE(
                    (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                    1
                ),
                ?2,
                ?3,
                ?3
            )
            ON CONFLICT(repository_path) DO UPDATE SET
                gitlab_sources = excluded.gitlab_sources,
                updated_at = excluded.updated_at",
        params![canonical_path.to_string_lossy(), json_str, now],
    )?;

    Ok(())
}

fn clear_project_gitlab_config(&self, repo_path: &Path) -> Result<()> {
    let conn = self.get_conn()?;
    let now = Utc::now().timestamp();
    let canonical_path = std::fs::canonicalize(repo_path)
        .unwrap_or_else(|_| repo_path.to_path_buf());

    conn.execute(
        "UPDATE project_config SET gitlab_sources = NULL, updated_at = ?2
         WHERE repository_path = ?1",
        params![canonical_path.to_string_lossy(), now],
    )?;

    Ok(())
}
```

**Step 5: Export from `mod.rs`**

Add to `pub use db_project_config::{...}`:
```rust
GitlabSource, ProjectGitlabConfig,
```

**Step 6: Run tests — pass**

**Step 7: Commit**

```bash
git add src-tauri/src/infrastructure/database/
git commit -m "feat(gitlab): add DB schema for multi-source GitLab config"
```

---

### Task 1.7: Create Tauri Commands for GitLab

**Files:**
- Create: `src-tauri/src/commands/gitlab.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs` (invoke_handler registration)

**Step 1: Define payload types and commands**

```rust
// src-tauri/src/commands/gitlab.rs

use crate::commands::get_project_manager;
use crate::domains::git::gitlab_cli::{self, format_cli_error, GitlabCli};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ── Payload types ──

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

// ── Commands ──

#[tauri::command]
pub async fn gitlab_get_status() -> Result<GitlabStatusPayload, String> {
    let cli = GitlabCli::new();
    match cli.ensure_installed() {
        Ok(_) => {}
        Err(_) => {
            return Ok(GitlabStatusPayload {
                installed: false,
                authenticated: false,
                user_login: None,
                hostname: None,
            });
        }
    }

    let auth = cli.check_auth(None).map_err(format_cli_error)?;
    Ok(GitlabStatusPayload {
        installed: true,
        authenticated: auth.authenticated,
        user_login: auth.user_login,
        hostname: auth.hostname,
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
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    let cli = GitlabCli::new();
    cli.ensure_installed().map_err(format_cli_error)?;

    let issues = cli
        .search_issues(
            &project.repo_path,
            query.as_deref().unwrap_or(""),
            30,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(format_cli_error)?;

    Ok(issues
        .into_iter()
        .map(|i| GitlabIssueSummaryPayload {
            iid: i.iid,
            title: i.title,
            state: i.state,
            updated_at: i.updated_at,
            author: i.author.map(|a| a.username),
            labels: i.labels,
            url: i.web_url,
            source_label: source_label.clone(),
        })
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
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    let cli = GitlabCli::new();
    cli.ensure_installed().map_err(format_cli_error)?;

    let details = cli
        .get_issue_details(
            &project.repo_path,
            iid,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(format_cli_error)?;

    let notes: Vec<GitlabNotePayload> = details
        .notes
        .into_iter()
        .filter(|n| !n.system)
        .map(|n| GitlabNotePayload {
            author: n.author.map(|a| a.username),
            created_at: n.created_at,
            body: n.body,
        })
        .collect();

    Ok(GitlabIssueDetailsPayload {
        iid: details.iid,
        title: details.title,
        url: details.web_url,
        description: details.description.unwrap_or_default(),
        labels: details.labels,
        state: details.state,
        notes,
        source_label,
    })
}

#[tauri::command]
pub async fn gitlab_search_mrs(
    _app: AppHandle,
    query: Option<String>,
    source_project: String,
    source_hostname: Option<String>,
    source_label: String,
) -> Result<Vec<GitlabMrSummaryPayload>, String> {
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    let cli = GitlabCli::new();
    cli.ensure_installed().map_err(format_cli_error)?;

    let mrs = cli
        .search_mrs(
            &project.repo_path,
            query.as_deref().unwrap_or(""),
            30,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(format_cli_error)?;

    Ok(mrs
        .into_iter()
        .map(|m| GitlabMrSummaryPayload {
            iid: m.iid,
            title: m.title,
            state: m.state,
            updated_at: m.updated_at,
            author: m.author.map(|a| a.username),
            labels: m.labels,
            url: m.web_url,
            source_branch: m.source_branch,
            target_branch: m.target_branch,
            source_label: source_label.clone(),
        })
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
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    let cli = GitlabCli::new();
    cli.ensure_installed().map_err(format_cli_error)?;

    let details = cli
        .get_mr_details(
            &project.repo_path,
            iid,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(format_cli_error)?;

    let notes: Vec<GitlabNotePayload> = details
        .notes
        .into_iter()
        .filter(|n| !n.system)
        .map(|n| GitlabNotePayload {
            author: n.author.map(|a| a.username),
            created_at: n.created_at,
            body: n.body,
        })
        .collect();

    Ok(GitlabMrDetailsPayload {
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
        notes,
        reviewers: details.reviewers.into_iter().map(|r| r.username).collect(),
        source_label,
    })
}

#[tauri::command]
pub async fn gitlab_get_mr_pipeline(
    _app: AppHandle,
    source_branch: String,
    source_project: String,
    source_hostname: Option<String>,
) -> Result<Option<GitlabPipelinePayload>, String> {
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    let cli = GitlabCli::new();
    cli.ensure_installed().map_err(format_cli_error)?;

    let pipeline = cli
        .get_mr_pipeline_status(
            &project.repo_path,
            &source_branch,
            &source_project,
            source_hostname.as_deref(),
        )
        .map_err(format_cli_error)?;

    Ok(pipeline.map(|p| GitlabPipelinePayload {
        id: p.id,
        status: p.status,
        url: p.web_url,
        duration: p.duration,
    }))
}

// ── Source Config Commands ──

#[tauri::command]
pub async fn gitlab_get_sources(
    _app: AppHandle,
) -> Result<Vec<crate::infrastructure::database::GitlabSource>, String> {
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    use crate::infrastructure::database::ProjectConfigMethods;
    let config = project
        .db
        .get_project_gitlab_config(&project.repo_path)
        .map_err(|e| e.to_string())?;

    Ok(config.map(|c| c.sources).unwrap_or_default())
}

#[tauri::command]
pub async fn gitlab_set_sources(
    _app: AppHandle,
    sources: Vec<crate::infrastructure::database::GitlabSource>,
) -> Result<(), String> {
    let project_manager = get_project_manager().await;
    let project = project_manager
        .current_project()
        .await
        .map_err(|e| e.to_string())?;

    use crate::infrastructure::database::ProjectConfigMethods;
    let config = crate::infrastructure::database::ProjectGitlabConfig { sources };
    project
        .db
        .set_project_gitlab_config(&project.repo_path, &config)
        .map_err(|e| e.to_string())
}
```

**Step 2: Register in `commands/mod.rs`**

Add:
```rust
pub mod gitlab;
pub use gitlab::*;
```

**Step 3: Register in `main.rs` invoke_handler**

Add to the `tauri::generate_handler![]` macro:
```rust
gitlab_get_status,
gitlab_search_issues,
gitlab_get_issue_details,
gitlab_search_mrs,
gitlab_get_mr_details,
gitlab_get_mr_pipeline,
gitlab_get_sources,
gitlab_set_sources,
```

**Step 4: Run `cargo build` to verify compilation**

Run: `cargo build --package schaltwerk`
Expected: Compiles cleanly

**Step 5: Commit**

```bash
git add src-tauri/src/commands/gitlab.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat(gitlab): add Tauri commands for GitLab integration"
```

---

### Task 1.8: Add Frontend Type Definitions and Tauri Command Entries

**Files:**
- Create: `src/types/gitlabTypes.ts`
- Modify: `src/common/tauriCommands.ts`
- Modify: `src/common/events.ts`

**Step 1: Create TypeScript types**

```typescript
// src/types/gitlabTypes.ts

export interface GitlabSource {
  id: string
  label: string
  projectPath: string
  hostname: string
  issuesEnabled: boolean
  mrsEnabled: boolean
  pipelinesEnabled: boolean
}

export interface GitlabStatusPayload {
  installed: boolean
  authenticated: boolean
  userLogin?: string | null
  hostname?: string | null
}

export interface GitlabIssueSummary {
  iid: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: string[]
  url: string
  sourceLabel: string
}

export interface GitlabIssueDetails {
  iid: number
  title: string
  url: string
  description: string
  labels: string[]
  state: string
  notes: GitlabNote[]
  sourceLabel: string
}

export interface GitlabNote {
  author?: string | null
  createdAt: string
  body: string
}

export interface GitlabMrSummary {
  iid: number
  title: string
  state: string
  updatedAt: string
  author?: string | null
  labels: string[]
  url: string
  sourceBranch: string
  targetBranch: string
  sourceLabel: string
}

export interface GitlabMrDetails {
  iid: number
  title: string
  url: string
  description: string
  labels: string[]
  state: string
  sourceBranch: string
  targetBranch: string
  mergeStatus?: string | null
  pipelineStatus?: string | null
  pipelineUrl?: string | null
  notes: GitlabNote[]
  reviewers: string[]
  sourceLabel: string
}

export interface GitlabPipelinePayload {
  id: number
  status: string
  url?: string | null
  duration?: number | null
}
```

**Step 2: Add to `tauriCommands.ts`**

```typescript
// Add these entries to the TauriCommands object:
GitLabGetStatus: 'gitlab_get_status',
GitLabSearchIssues: 'gitlab_search_issues',
GitLabGetIssueDetails: 'gitlab_get_issue_details',
GitLabSearchMrs: 'gitlab_search_mrs',
GitLabGetMrDetails: 'gitlab_get_mr_details',
GitLabGetMrPipeline: 'gitlab_get_mr_pipeline',
GitLabGetSources: 'gitlab_get_sources',
GitLabSetSources: 'gitlab_set_sources',
```

**Step 3: Add events to `events.ts`**

```typescript
// Add to SchaltEvent enum:
GitLabStatusChanged = 'schaltwerk:gitlab-status-changed',

// Add payload type:
export interface GitlabStatusPayload {
  installed: boolean
  authenticated: boolean
  userLogin?: string | null
  hostname?: string | null
}

// Add to EventPayloadMap:
[SchaltEvent.GitLabStatusChanged]: GitlabStatusPayload
```

**Step 4: Add backend event in `events.rs`**

```rust
// Add variant to SchaltEvent enum:
GitLabStatusChanged,

// Add match arm in event name method:
SchaltEvent::GitLabStatusChanged => "schaltwerk:gitlab-status-changed",
```

**Step 5: Commit**

```bash
git add src/types/gitlabTypes.ts src/common/tauriCommands.ts src/common/events.ts src-tauri/src/events.rs
git commit -m "feat(gitlab): add frontend types, commands, and events"
```

**Step 6: Run full validation**

Run: `just test`
Expected: All checks pass

---

## Phase 2: Auth & Config (Status Detection, Source Configuration UI)

### Task 2.1: Create `useGitlabIntegration` Hook

**Files:**
- Create: `src/hooks/useGitlabIntegration.ts`
- Test: `src/hooks/__tests__/useGitlabIntegration.test.ts`

Mirror the `useGithubIntegration` hook pattern. Key differences:
- Manages `GitlabSource[]` instead of single repository
- No `connectProject` — sources are configured manually
- Status check via `TauriCommands.GitLabGetStatus`

**Interface:**

```typescript
export interface GitlabIntegrationValue {
  status: GitlabStatusPayload | null
  sources: GitlabSource[]
  loading: boolean
  isGlabMissing: boolean
  hasSources: boolean
  refreshStatus: () => Promise<void>
  loadSources: () => Promise<void>
  saveSources: (sources: GitlabSource[]) => Promise<void>
}
```

**Implementation steps:**
1. Write test for hook initialization and status fetching
2. Implement hook with `useState` for status/sources, `useEffect` for initial load
3. Listen to `SchaltEvent.GitLabStatusChanged` for reactive updates
4. Test source save/load roundtrip
5. Commit

---

### Task 2.2: Create `GitlabIntegrationContext`

**Files:**
- Create: `src/contexts/GitlabIntegrationContext.tsx`

Mirror `GithubIntegrationContext.tsx` exactly:
```typescript
export const GitlabIntegrationContext = createContext<GitlabIntegrationValue | undefined>(undefined)

export function GitlabIntegrationProvider({ children }: { children: ReactNode }) {
  const value = useGitlabIntegration()
  return (
    <GitlabIntegrationContext.Provider value={value}>
      {children}
    </GitlabIntegrationContext.Provider>
  )
}

export function useGitlabIntegrationContext(): GitlabIntegrationValue {
  const context = useContext(GitlabIntegrationContext)
  if (!context) {
    throw new Error('useGitlabIntegrationContext must be used within GitlabIntegrationProvider')
  }
  return context
}
```

Wire into the provider tree (same level as `GithubIntegrationProvider`).

---

### Task 2.3: Create `GitlabMenuButton` Component

**Files:**
- Create: `src/components/gitlab/GitlabMenuButton.tsx`
- Create: `src/components/gitlab/__tests__/GitlabMenuButton.test.tsx`

Mirror `GithubMenuButton.tsx` structure with these states:
- **missing**: glab CLI not installed → red indicator
- **unauthenticated**: not logged in → amber indicator
- **no-sources**: authenticated but no sources configured → blue indicator
- **connected**: has sources → green indicator

Menu content:
1. **Info section**: Installation status, auth status, configured sources count
2. **Actions**: "Configure Sources" button (opens settings), "Refresh" button

**Test pattern** — mirror `GithubMenuButton.test.tsx`:
```typescript
it('shows CLI install prompt when glab is missing', () => {
  renderWithProviders(<GitlabMenuButton />, {
    gitlabOverrides: {
      status: { installed: false, authenticated: false },
      sources: [],
      loading: false,
    },
  })
  // Assert install hint visible
})
```

---

### Task 2.4: Source Configuration UI

**Files:**
- Create: `src/components/gitlab/GitlabSourcesSettings.tsx`

A settings panel (rendered within SettingsModal or as a dedicated section) for managing GitLab sources:
- List of configured sources with edit/delete
- "Add Source" form: label, project path, hostname, feature checkboxes
- Save persists via `TauriCommands.GitLabSetSources`
- Each source gets a UUID `id` generated client-side

---

### Task 2.5: Update Test Utilities

**Files:**
- Modify: `src/tests/test-utils.tsx`

Add `GitlabOverrides` support following the GitHub pattern:
```typescript
type GitlabOverrides = Partial<GitlabIntegrationValue>

// In createGitlabIntegrationValue():
const base: GitlabIntegrationValue = {
  status: null,
  sources: [],
  loading: false,
  isGlabMissing: false,
  hasSources: false,
  refreshStatus: async () => {},
  loadSources: async () => {},
  saveSources: unimplemented('saveSources'),
}
```

Wire into `renderWithProviders` options and `TestProviders`.

---

## Phase 3: Issues (Read-Only, Right-Panel Tab)

### Task 3.1: Create `useGitlabIssueSearch` Hook

**Files:**
- Create: `src/hooks/useGitlabIssueSearch.ts`
- Test: `src/hooks/__tests__/useGitlabIssueSearch.test.ts`

Mirror `useGithubIssueSearch.ts` but with multi-source aggregation:

```typescript
export interface UseGitlabIssueSearchResult {
  results: GitlabIssueSummary[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => Promise<GitlabIssueDetails>
  clearError: () => void
}

interface UseGitlabIssueSearchOptions {
  debounceMs?: number
  enabled?: boolean
  sources: GitlabSource[]  // Query all sources with issues_enabled
}
```

Key difference: Searches across all `sources` with `issuesEnabled: true`, aggregates results, tags each with `sourceLabel`.

---

### Task 3.2: Add "Issues" Right-Panel Tab

**Files:**
- Modify: `src/components/right-panel/RightPanelTabs.types.ts`
- Modify: `src/components/right-panel/RightPanelTabs.tsx`
- Modify: `src/components/right-panel/RightPanelTabsHeader.tsx`
- Create: `src/components/right-panel/GitlabIssuesTab.tsx`

**Step 1: Add tab key**

In `RightPanelTabs.types.ts`:
```typescript
type TabKey = 'changes' | 'agent' | 'info' | 'history' | 'specs' | 'preview' | 'gitlab-issues' | 'gitlab-mrs'
```

**Step 2: Create `GitlabIssuesTab` component**

A right-panel tab content component that shows:
- Search input at top
- Scrollable list of issues from all configured sources
- Source label badge on each issue
- Click to expand detail view inline (accordion pattern)
- Detail view: title, description (markdown), labels, notes
- "Open in GitLab" link

**Step 3: Wire into tab system**

In `RightPanelTabs.tsx`, add visibility logic:
```typescript
const showGitlabIssuesTab = gitlabSources.some(s => s.issuesEnabled)
```

In `RightPanelTabsHeader.tsx`, add tab button:
```typescript
{ key: 'gitlab-issues', label: 'Issues', icon: VscIssues }
```

---

### Task 3.3: Issue Detail View Component

**Files:**
- Create: `src/components/gitlab/GitlabIssueDetail.tsx`

Renders expanded issue detail within the right panel:
- Title + state badge
- Source label badge
- Labels as chips
- Description rendered as markdown
- Notes (non-system) with author and timestamp
- "Open in GitLab" button

---

## Phase 4: Merge Requests (Read-Only, Right-Panel Tab)

### Task 4.1: Create `useGitlabMrSearch` Hook

**Files:**
- Create: `src/hooks/useGitlabMrSearch.ts`
- Test: `src/hooks/__tests__/useGitlabMrSearch.test.ts`

Mirror `useGitlabIssueSearch` pattern but for MRs. Same multi-source aggregation.

```typescript
export interface UseGitlabMrSearchResult {
  results: GitlabMrSummary[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => Promise<GitlabMrDetails>
  fetchPipeline: (sourceBranch: string, sourceProject: string, sourceHostname?: string) => Promise<GitlabPipelinePayload | null>
  clearError: () => void
}
```

---

### Task 4.2: Add "Merge Requests" Right-Panel Tab

**Files:**
- Modify: `src/components/right-panel/RightPanelTabs.tsx`
- Modify: `src/components/right-panel/RightPanelTabsHeader.tsx`
- Create: `src/components/right-panel/GitlabMrsTab.tsx`

Same pattern as Issues tab but for MRs. MR list items show:
- Title, state badge, source/target branch
- Pipeline status indicator (icon + color)
- Source label badge
- Click to expand detail

---

### Task 4.3: MR Detail View Component

**Files:**
- Create: `src/components/gitlab/GitlabMrDetail.tsx`

Renders expanded MR detail:
- Title + state badge (opened/merged/closed)
- Source → Target branch with monospace pill
- Pipeline status with link
- Merge status indicator
- Reviewers list
- Labels as chips
- Description (markdown)
- Notes
- "Open in GitLab" button
- "Refresh Pipeline" button (calls `TauriCommands.GitLabGetMrPipeline`)

---

## Phase 5: MR Lifecycle (Create, Approve, Merge, Comment)

### Task 5.1: Add MR Lifecycle CLI Methods

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

Add methods (following `gh` PR creation pattern):

```rust
impl<R: CommandRunner> GitlabCli<R> {
    pub fn create_mr(
        &self,
        project_path: &Path,
        gitlab_project: &str,
        title: &str,
        description: Option<&str>,
        source_branch: &str,
        target_branch: &str,
        hostname: Option<&str>,
    ) -> Result<GitlabMrResult, GitlabCliError> {
        // glab mr create -t "title" -d "desc" -s source -b target -R project --yes
        // Parse URL from stdout
    }

    pub fn approve_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        // glab mr approve <iid> -R project
    }

    pub fn merge_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        squash: bool,
        remove_source_branch: bool,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        // glab mr merge <iid> -R project [--squash] [-d] --yes
    }

    pub fn comment_on_mr(
        &self,
        project_path: &Path,
        iid: u64,
        gitlab_project: &str,
        message: &str,
        hostname: Option<&str>,
    ) -> Result<(), GitlabCliError> {
        // glab mr note <iid> -m "message" -R project
    }
}
```

Each method needs tests with `MockRunner`.

---

### Task 5.2: Add Lifecycle Tauri Commands

**Files:**
- Modify: `src-tauri/src/commands/gitlab.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/common/tauriCommands.ts`

New commands:
```rust
#[tauri::command]
pub async fn gitlab_create_mr(...) -> Result<GitlabMrResultPayload, String>

#[tauri::command]
pub async fn gitlab_approve_mr(...) -> Result<(), String>

#[tauri::command]
pub async fn gitlab_merge_mr(...) -> Result<(), String>

#[tauri::command]
pub async fn gitlab_comment_on_mr(...) -> Result<(), String>
```

New `tauriCommands.ts` entries:
```typescript
GitLabCreateMr: 'gitlab_create_mr',
GitLabApproveMr: 'gitlab_approve_mr',
GitLabMergeMr: 'gitlab_merge_mr',
GitLabCommentOnMr: 'gitlab_comment_on_mr',
```

---

### Task 5.3: MR Action Buttons in Detail View

**Files:**
- Modify: `src/components/gitlab/GitlabMrDetail.tsx`

Add action buttons to the MR detail view:
- **Approve** (visible when state is "opened")
- **Merge** (visible when state is "opened" and merge_status is "can_be_merged")
  - Options: squash, remove source branch
- **Comment** (always visible when state is "opened")

Each action shows a toast on success/failure (same pattern as `GithubMenuButton`).

---

## Phase 6: Session Integration (Create MR from Session)

### Task 6.1: Add `create_session_mr` CLI Method

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

```rust
pub struct CreateSessionMrOptions<'a> {
    pub repo_path: &'a Path,
    pub session_worktree_path: &'a Path,
    pub session_slug: &'a str,
    pub session_branch: &'a str,
    pub base_branch: &'a str,
    pub mr_branch_name: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub gitlab_project: &'a str,
    pub hostname: Option<&'a str>,
    pub squash: bool,
}

impl<R: CommandRunner> GitlabCli<R> {
    pub fn create_session_mr(
        &self,
        opts: CreateSessionMrOptions<'_>,
    ) -> Result<GitlabMrResult, GitlabCliError> {
        // 1. Push session branch to remote
        // 2. Create MR via glab mr create
        // Pattern matches github_cli::create_session_pr
    }
}
```

---

### Task 6.2: Add Session MR Tauri Command

**Files:**
- Modify: `src-tauri/src/commands/gitlab.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/common/tauriCommands.ts`

```rust
#[tauri::command]
pub async fn gitlab_create_session_mr(
    app: AppHandle,
    args: CreateGitlabSessionMrArgs,
) -> Result<GitlabMrResultPayload, String>
```

```typescript
// tauriCommands.ts
GitLabCreateSessionMr: 'gitlab_create_session_mr',
```

---

### Task 6.3: MR Creation Modal (Session Context)

**Files:**
- Create: `src/components/modals/GitlabMrSessionModal.tsx`

Mirror `PrSessionModal.tsx` for GitLab:
- Source selection (which GitLab source to create the MR in)
- Title input
- Description textarea
- Target branch input
- Squash option
- "Create MR" button

Wire into session context menu / reviewed session actions alongside the existing GitHub PR button.

---

### Task 6.4: Wire into MCP API

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

Add GitLab MR creation endpoint to the MCP REST API (for `schaltwerk_create_pr` equivalent):
```
POST /gitlab/mr
{
  "session_name": "...",
  "title": "...",
  "description": "...",
  "source_project": "...",
  "target_branch": "...",
  "squash": false
}
```

---

## File Change Summary

### New Files (Create)

| File | Phase | Purpose |
|---|---|---|
| `src-tauri/src/domains/git/gitlab_cli.rs` | 1 | CLI wrapper for glab |
| `src-tauri/src/commands/gitlab.rs` | 1 | Tauri commands |
| `src/types/gitlabTypes.ts` | 1 | TypeScript type definitions |
| `src/hooks/useGitlabIntegration.ts` | 2 | Integration hook |
| `src/contexts/GitlabIntegrationContext.tsx` | 2 | React context provider |
| `src/components/gitlab/GitlabMenuButton.tsx` | 2 | TopBar status button |
| `src/components/gitlab/__tests__/GitlabMenuButton.test.tsx` | 2 | Menu button tests |
| `src/components/gitlab/GitlabSourcesSettings.tsx` | 2 | Source config UI |
| `src/hooks/useGitlabIssueSearch.ts` | 3 | Issue search hook |
| `src/components/right-panel/GitlabIssuesTab.tsx` | 3 | Issues tab |
| `src/components/gitlab/GitlabIssueDetail.tsx` | 3 | Issue detail view |
| `src/hooks/useGitlabMrSearch.ts` | 4 | MR search hook |
| `src/components/right-panel/GitlabMrsTab.tsx` | 4 | MRs tab |
| `src/components/gitlab/GitlabMrDetail.tsx` | 4 | MR detail view |
| `src/components/modals/GitlabMrSessionModal.tsx` | 6 | Session MR creation modal |

### Modified Files

| File | Phase | Change |
|---|---|---|
| `src-tauri/src/domains/git/mod.rs` | 1 | Add `pub mod gitlab_cli` |
| `src-tauri/src/commands/mod.rs` | 1 | Add `pub mod gitlab` |
| `src-tauri/src/main.rs` | 1, 5, 6 | Register GitLab commands |
| `src-tauri/src/infrastructure/database/db_schema.rs` | 1 | Add `gitlab_sources` column migration |
| `src-tauri/src/infrastructure/database/db_project_config.rs` | 1 | Add GitLab config types and trait methods |
| `src-tauri/src/infrastructure/database/mod.rs` | 1 | Export new types |
| `src/common/tauriCommands.ts` | 1, 5, 6 | Add GitLab command entries |
| `src/common/events.ts` | 1 | Add `GitLabStatusChanged` event |
| `src-tauri/src/events.rs` | 1 | Add `GitLabStatusChanged` variant |
| `src/tests/test-utils.tsx` | 2 | Add `GitlabOverrides` support |
| `src/components/right-panel/RightPanelTabs.types.ts` | 3 | Add tab keys |
| `src/components/right-panel/RightPanelTabs.tsx` | 3, 4 | Add tab content rendering |
| `src/components/right-panel/RightPanelTabsHeader.tsx` | 3, 4 | Add tab buttons |
| `src-tauri/src/mcp_api.rs` | 6 | Add GitLab MR endpoint |

### New Tauri Commands (All Phases)

| Command | Phase | Registered in `main.rs` |
|---|---|---|
| `gitlab_get_status` | 1 | Yes |
| `gitlab_search_issues` | 1 | Yes |
| `gitlab_get_issue_details` | 1 | Yes |
| `gitlab_search_mrs` | 1 | Yes |
| `gitlab_get_mr_details` | 1 | Yes |
| `gitlab_get_mr_pipeline` | 1 | Yes |
| `gitlab_get_sources` | 1 | Yes |
| `gitlab_set_sources` | 1 | Yes |
| `gitlab_create_mr` | 5 | Yes |
| `gitlab_approve_mr` | 5 | Yes |
| `gitlab_merge_mr` | 5 | Yes |
| `gitlab_comment_on_mr` | 5 | Yes |
| `gitlab_create_session_mr` | 6 | Yes |

### New Events

| Event | Direction | Payload |
|---|---|---|
| `schaltwerk:gitlab-status-changed` | Backend → Frontend | `GitlabStatusPayload` |

---

## Test Strategy

### Rust (Backend)

- **Unit tests** in `gitlab_cli.rs` using `MockRunner` (same pattern as `github_cli.rs` tests)
  - Auth status parsing (authenticated/unauthenticated/self-hosted)
  - Issue search JSON parsing
  - MR search JSON parsing
  - Pipeline status parsing
  - Error handling for each CLI error variant
  - MR create URL extraction
- **DB tests** in `db_project_config.rs`
  - GitLab config roundtrip (save/load/clear)
  - Multi-source JSON serialization
  - Empty sources handling

### TypeScript (Frontend)

- **Hook tests** using Vitest + `renderHook`:
  - `useGitlabIntegration` — status fetch, source management
  - `useGitlabIssueSearch` — debounced search, detail fetch, multi-source aggregation
  - `useGitlabMrSearch` — same pattern
- **Component tests** using `renderWithProviders` + `gitlabOverrides`:
  - `GitlabMenuButton` — all 4 states (missing/unauthenticated/no-sources/connected)
  - Tab visibility based on source configuration
- **TDD per CLAUDE.md**: Write each test FIRST, verify it fails, then implement.

### Integration

- Run `just test` after each phase to ensure full suite passes
- Verify no dead code via `knip` and `cargo shear`
- Verify no clippy warnings via `cargo clippy`

---

## Dependencies & Prerequisites

- `glab` CLI must be installed on the user's machine (detected at runtime, not build-time)
- `which` crate already used by `github_cli.rs` — reuse for `glab` resolution
- `regex` crate already in dependencies — reuse for ANSI stripping and auth parsing
- `uuid` crate needed for generating source IDs (check if already in deps, otherwise add)
- `dirs` crate already used — reuse for path resolution
- No new npm packages required on the frontend

## Notes

- **MockRunner reuse**: The `MockRunner` and `CommandRunner` trait from `github_cli.rs` should be shared. If they're currently private, they need to be made `pub(crate)` or moved to a shared testing module. Check visibility before implementation.
- **Self-hosted GitLab**: The `hostname` parameter on all methods enables self-hosted instances. The `GITLAB_HOST` env var is set per-command to target the correct instance.
- **Auth flow**: Unlike GitHub where we offer `gh auth login`, for GitLab we just detect auth status and show instructions. Users configure `glab` separately. The design says "assume glab already configured."
- **glab JSON output quirks**: Some `glab` JSON responses may have `notes` as `null` instead of `[]`. Deserialize with `#[serde(default)]` where needed.
- **Multi-source search**: Issue/MR search across multiple sources runs sequentially (not parallel) in the CLI wrapper to avoid overwhelming the terminal. The frontend debounce (300ms) prevents rapid re-queries.
