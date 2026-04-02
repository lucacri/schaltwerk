use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use git2::{Oid, Repository};
use hyper::StatusCode;
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::json;

use lucode::binary_detection::{get_unsupported_reason, is_binary_file_by_extension};
use lucode::domains::git;
use lucode::domains::sessions::entity::{ChangedFile, Session, SessionStatus};
use lucode::domains::workspace::diff_engine::{
    DiffLine, LineType, add_collapsible_sections, calculate_diff_stats, compute_unified_diff,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffScopeKind {
    Session,
    Orchestrator,
}

#[derive(Debug, Clone)]
pub struct DiffScope {
    pub kind: DiffScopeKind,
    pub worktree_path: PathBuf,
    pub current_branch: String,
    pub parent_branch: String,
    pub session_id: Option<String>,
    pub has_spec: bool,
}

impl DiffScope {
    pub fn for_session(session: &Session) -> Result<Self, DiffApiError> {
        let worktree_path = session.worktree_path.clone();
        if !worktree_path.exists() {
            return Err(DiffApiError::new(
                StatusCode::CONFLICT,
                format!(
                    "Session '{}' worktree is missing. Cancellation may be in progress.",
                    session.name
                ),
            ));
        }

        if session.status == SessionStatus::Cancelled {
            return Err(DiffApiError::new(
                StatusCode::CONFLICT,
                format!("Session '{}' cancellation is in progress.", session.name),
            ));
        }

        Ok(Self {
            kind: DiffScopeKind::Session,
            worktree_path,
            current_branch: session.branch.clone(),
            parent_branch: session.parent_branch.clone(),
            session_id: Some(session.id.clone()),
            has_spec: session.spec_content.is_some(),
        })
    }

    pub fn for_orchestrator(repo_path: impl AsRef<Path>) -> Result<Self, DiffApiError> {
        let repo_path_buf = repo_path.as_ref().to_path_buf();
        let repo = Repository::open(&repo_path_buf).map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open repository for orchestrator diff: {e}"),
            )
        })?;

        let current_branch = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "HEAD".to_string());

        let parent_branch = git::get_default_branch(&repo_path_buf).map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to resolve default branch for orchestrator diff: {e}"),
            )
        })?;

        Ok(Self {
            kind: DiffScopeKind::Orchestrator,
            worktree_path: repo_path_buf,
            current_branch,
            parent_branch,
            session_id: None,
            has_spec: false,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryQuery {
    pub cursor: Option<String>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffSummaryResponse {
    pub scope: DiffScopeKind,
    pub session_id: Option<String>,
    pub branch_info: BranchInfo,
    pub has_spec: bool,
    pub files: Vec<ChangedFile>,
    pub paging: PagingInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub current_branch: String,
    pub parent_branch: String,
    pub merge_base_short: String,
    pub head_short: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PagingInfo {
    pub next_cursor: Option<String>,
    pub total_files: usize,
    pub returned: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffChunkRequest {
    pub cursor: Option<String>,
    pub line_limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffLineEntry {
    pub content: String,
    pub line_type: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
    pub is_collapsible: Option<bool>,
    pub collapsed_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffChunkResponse {
    pub file: ChangedFile,
    pub branch_info: BranchInfo,
    pub stats: DiffStatsSummary,
    pub is_binary: bool,
    pub lines: Vec<DiffLineEntry>,
    pub paging: DiffChunkPaging,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffStatsSummary {
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffChunkPaging {
    pub cursor: Option<String>,
    pub next_cursor: Option<String>,
    pub returned: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSpecResponse {
    pub session_id: String,
    pub content: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct DiffApiError {
    pub status: StatusCode,
    pub message: String,
}

impl DiffApiError {
    pub fn new(status: StatusCode, message: String) -> Self {
        Self { status, message }
    }
}

pub fn compute_diff_summary(
    scope: &DiffScope,
    query: SummaryQuery,
) -> Result<DiffSummaryResponse, DiffApiError> {
    let started = Instant::now();
    let files = load_summary_files(scope)?;
    let total_files = files.len();

    let page_size = query.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
    if page_size == 0 {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "page_size must be greater than 0".into(),
        ));
    }

    let start_index = match query.cursor.as_deref() {
        Some(cursor) => decode_cursor(cursor)?,
        None => 0,
    };
    if start_index > total_files {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cursor is out of range".into(),
        ));
    }

    let end_index = (start_index + page_size).min(total_files);
    let returned = end_index.saturating_sub(start_index);
    let next_cursor = if end_index < total_files {
        Some(encode_cursor(end_index))
    } else {
        None
    };

    let branch_info = compute_branch_info(scope)?;
    let response = DiffSummaryResponse {
        scope: scope.kind.clone(),
        session_id: scope.session_id.clone(),
        branch_info,
        has_spec: scope.has_spec,
        files: files[start_index..end_index].to_vec(),
        paging: PagingInfo {
            next_cursor: next_cursor.clone(),
            total_files,
            returned,
        },
    };

    info!(
        "{}",
        json!({
            "event": "diff_summary",
            "scope": scope_kind_label(scope),
            "session_id": scope.session_id.clone(),
            "returned": returned,
            "next_cursor": next_cursor,
            "duration_ms": started.elapsed().as_millis()
        })
    );

    Ok(response)
}

pub fn compute_diff_chunk(
    scope: &DiffScope,
    file_path: &str,
    query: DiffChunkRequest,
) -> Result<DiffChunkResponse, DiffApiError> {
    let started = Instant::now();
    let rel_path = validate_rel_path(file_path)?;

    let line_limit = query.line_limit.unwrap_or(DEFAULT_LINE_LIMIT);
    if line_limit == 0 {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "line_limit must be greater than 0".into(),
        ));
    }
    if line_limit > MAX_LINE_LIMIT {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("line_limit must be <= {MAX_LINE_LIMIT}"),
        ));
    }

    let start_index = match query.cursor.as_deref() {
        Some(cursor) => decode_cursor(cursor)?,
        None => 0,
    };

    let (base_bytes, new_bytes) = load_diff_bytes(scope, &rel_path)?;
    let path_str = rel_path.to_string_lossy().to_string();
    let change_type = detect_change_type(&base_bytes, &new_bytes);

    let mut is_binary = is_binary_file_by_extension(&path_str);
    if !is_binary {
        is_binary = get_unsupported_reason(&path_str, Some(&new_bytes)).is_some()
            || get_unsupported_reason(&path_str, Some(&base_bytes)).is_some();
    }

    let branch_info = compute_branch_info(scope)?;

    if is_binary {
        info!(
            "{}",
            json!({
            "event": "diff_chunk",
            "scope": scope_kind_label(scope),
            "session_id": scope.session_id.clone(),
            "path": path_str,
            "binary": true,
            "returned": 0,
            "next_cursor": serde_json::Value::Null,
            "duration_ms": started.elapsed().as_millis()
            })
        );

        let mut file = ChangedFile::new(path_str, change_type);
        file.is_binary = Some(true);

        return Ok(DiffChunkResponse {
            file,
            branch_info,
            stats: DiffStatsSummary {
                additions: 0,
                deletions: 0,
            },
            is_binary: true,
            lines: Vec::new(),
            paging: DiffChunkPaging {
                cursor: query.cursor.clone(),
                next_cursor: None,
                returned: 0,
            },
        });
    }

    let old_content = String::from_utf8_lossy(&base_bytes).into_owned();
    let new_content = String::from_utf8_lossy(&new_bytes).into_owned();

    let diff_lines = add_collapsible_sections(compute_unified_diff(&old_content, &new_content));
    let stats_raw = calculate_diff_stats(&diff_lines);
    let line_entries: Vec<DiffLineEntry> = diff_lines.iter().map(map_diff_line).collect();
    let total_lines = line_entries.len();

    if start_index > total_lines {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cursor is out of range".into(),
        ));
    }

    let end_index = (start_index + line_limit).min(total_lines);
    let returned = end_index.saturating_sub(start_index);
    let next_cursor = if end_index < total_lines {
        Some(encode_cursor(end_index))
    } else {
        None
    };
    let paged_lines = line_entries[start_index..end_index].to_vec();

    let mut file = ChangedFile::new(path_str.clone(), change_type);
    file.additions = stats_raw.additions as u32;
    file.deletions = stats_raw.deletions as u32;
    file.changes = file.additions + file.deletions;

    let response = DiffChunkResponse {
        file,
        branch_info,
        stats: DiffStatsSummary {
            additions: stats_raw.additions as u32,
            deletions: stats_raw.deletions as u32,
        },
        is_binary: false,
        lines: paged_lines,
        paging: DiffChunkPaging {
            cursor: query.cursor.clone(),
            next_cursor: next_cursor.clone(),
            returned,
        },
    };

    info!(
        "{}",
        json!({
            "event": "diff_chunk",
            "scope": scope_kind_label(scope),
            "session_id": scope.session_id.clone(),
            "path": path_str,
            "returned": returned,
            "next_cursor": next_cursor,
            "duration_ms": started.elapsed().as_millis()
        })
    );

    Ok(response)
}

fn scope_kind_label(scope: &DiffScope) -> &'static str {
    match scope.kind {
        DiffScopeKind::Session => "session",
        DiffScopeKind::Orchestrator => "orchestrator",
    }
}

const DEFAULT_PAGE_SIZE: usize = 100;
const DEFAULT_LINE_LIMIT: usize = 400;
const MAX_LINE_LIMIT: usize = 1000;

#[derive(Debug, Serialize, Deserialize)]
struct CursorToken {
    start: usize,
}

fn encode_cursor(start: usize) -> String {
    let token = CursorToken { start };
    let encoded = serde_json::to_vec(&token).unwrap_or_default();
    URL_SAFE_NO_PAD.encode(encoded)
}

fn decode_cursor(cursor: &str) -> Result<usize, DiffApiError> {
    let raw = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| {
        DiffApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "Invalid cursor".into())
    })?;
    let token: CursorToken = serde_json::from_slice(&raw).map_err(|_| {
        DiffApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "Invalid cursor".into())
    })?;
    Ok(token.start)
}

fn load_summary_files(scope: &DiffScope) -> Result<Vec<ChangedFile>, DiffApiError> {
    git::get_changed_files(Path::new(&scope.worktree_path), &scope.parent_branch).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to compute changed files: {e}"),
        )
    })
}

fn compute_branch_info(scope: &DiffScope) -> Result<BranchInfo, DiffApiError> {
    let repo = Repository::open(&scope.worktree_path).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to open repository: {e}"),
        )
    })?;

    let head = repo.head().map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read HEAD: {e}"),
        )
    })?;
    let head_oid = head.target().ok_or_else(|| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Repository HEAD is unborn".into(),
        )
    })?;

    let parent_commit = repo
        .revparse_single(&scope.parent_branch)
        .map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Failed to resolve parent branch '{}': {e}",
                    scope.parent_branch
                ),
            )
        })?
        .peel_to_commit()
        .map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to peel parent commit: {e}"),
            )
        })?;

    let merge_base_oid = repo
        .merge_base(head_oid, parent_commit.id())
        .unwrap_or(parent_commit.id());

    let merge_base_short = short_id(&repo, merge_base_oid)?;
    let head_short = short_id(&repo, head_oid)?;

    Ok(BranchInfo {
        current_branch: scope.current_branch.clone(),
        parent_branch: scope.parent_branch.clone(),
        merge_base_short,
        head_short,
    })
}

fn short_id(repo: &Repository, oid: Oid) -> Result<String, DiffApiError> {
    let object = repo.find_object(oid, None).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to find object for short id: {e}"),
        )
    })?;
    let short = object.short_id().map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to derive short id: {e}"),
        )
    })?;
    let short_str = std::str::from_utf8(&short).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Short id is not valid UTF-8: {e}"),
        )
    })?;
    Ok(short_str.to_string())
}

fn validate_rel_path(path: &str) -> Result<PathBuf, DiffApiError> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "path must be relative".into(),
        ));
    }
    if candidate
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(DiffApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "path must not contain '..' segments".into(),
        ));
    }
    Ok(candidate.to_path_buf())
}

fn load_diff_bytes(
    scope: &DiffScope,
    file_path: &Path,
) -> Result<(Vec<u8>, Vec<u8>), DiffApiError> {
    let repo = Repository::open(&scope.worktree_path).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to open repository: {e}"),
        )
    })?;
    let base_bytes = read_blob_from_merge_base(&repo, &scope.parent_branch, file_path)?;
    let new_bytes = read_worktree_bytes(&scope.worktree_path, file_path)?;
    Ok((base_bytes, new_bytes))
}

fn read_blob_from_merge_base(
    repo: &Repository,
    parent_branch: &str,
    file_path: &Path,
) -> Result<Vec<u8>, DiffApiError> {
    let head_oid = repo
        .head()
        .map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read HEAD: {e}"),
            )
        })?
        .target()
        .ok_or_else(|| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Repository HEAD is unborn".into(),
            )
        })?;

    let parent_commit = repo
        .revparse_single(parent_branch)
        .map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to resolve parent branch '{parent_branch}': {e}"),
            )
        })?
        .peel_to_commit()
        .map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to peel parent commit: {e}"),
            )
        })?;

    let merge_base_oid = repo
        .merge_base(head_oid, parent_commit.id())
        .unwrap_or(parent_commit.id());
    let merge_base_commit = repo.find_commit(merge_base_oid).map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load merge base commit: {e}"),
        )
    })?;
    let tree = merge_base_commit.tree().map_err(|e| {
        DiffApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load merge base tree: {e}"),
        )
    })?;

    match tree.get_path(file_path) {
        Ok(entry) => {
            let object = repo.find_object(entry.id(), None).map_err(|e| {
                DiffApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to read merge base blob: {e}"),
                )
            })?;
            let blob = object.peel_to_blob().map_err(|e| {
                DiffApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to peel merge base blob: {e}"),
                )
            })?;
            Ok(blob.content().to_vec())
        }
        Err(_) => Ok(Vec::new()),
    }
}

fn read_worktree_bytes(worktree_path: &Path, file_path: &Path) -> Result<Vec<u8>, DiffApiError> {
    let resolved = worktree_path.join(file_path);
    if resolved.exists() {
        fs::read(&resolved).map_err(|e| {
            DiffApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Failed to read worktree file '{}': {e}",
                    file_path.display()
                ),
            )
        })
    } else {
        Ok(Vec::new())
    }
}

fn map_diff_line(line: &DiffLine) -> DiffLineEntry {
    let line_type = match line.line_type {
        LineType::Added => "added",
        LineType::Removed => "removed",
        LineType::Unchanged => "unchanged",
    };

    DiffLineEntry {
        content: line.content.clone(),
        line_type: line_type.into(),
        old_line_number: line.old_line_number.map(|v| v as u32),
        new_line_number: line.new_line_number.map(|v| v as u32),
        is_collapsible: line.is_collapsible,
        collapsed_count: line.collapsed_count.map(|v| v as u32),
    }
}

fn detect_change_type(old_bytes: &[u8], new_bytes: &[u8]) -> String {
    match (old_bytes.is_empty(), new_bytes.is_empty()) {
        (true, false) => "added",
        (false, true) => "deleted",
        _ => "modified",
    }
    .to_string()
}

pub fn fetch_session_spec(session: &Session) -> Result<SessionSpecResponse, DiffApiError> {
    if let Some(content) = &session.spec_content {
        let response = SessionSpecResponse {
            session_id: session.id.clone(),
            content: content.clone(),
            updated_at: session.updated_at,
        };
        let _ = &response.updated_at;
        Ok(response)
    } else {
        Err(DiffApiError::new(
            StatusCode::NOT_FOUND,
            format!("Session '{}' does not have spec content.", session.name),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, Repository};
    use lucode::domains::sessions::entity::{SessionState, SessionStatus};
    use lucode::domains::workspace::diff_engine::{
        add_collapsible_sections, compute_unified_diff,
    };
    use std::process::{Command, Stdio};
    use tempfile::TempDir;

    fn init_repo() -> TempDir {
        let tmp = TempDir::new().expect("temp dir");
        let repo = Repository::init(tmp.path()).expect("init repo");
        {
            let mut config = repo.config().expect("config");
            config
                .set_str("user.email", "test@example.com")
                .expect("set email");
            config.set_str("user.name", "Test User").expect("set name");
        }
        std::fs::write(tmp.path().join("README.md"), "# Test\n").expect("write file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("add");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = repo
            .signature()
            .unwrap_or_else(|_| git2::Signature::now("Test", "test@example.com").unwrap());
        repo.commit(Some("HEAD"), &sig, &sig, "Initial", &tree, &[])
            .expect("commit");
        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(tmp.path())
            .status()
            .expect("rename branch");
        tmp
    }

    fn short_id(repo: &Repository, oid: Oid) -> String {
        let obj = repo.find_object(oid, None).expect("find object");
        let buf = obj.short_id().expect("short id");
        std::str::from_utf8(&buf).expect("utf8").to_string()
    }

    fn checkout_branch(repo_path: &Path, branch: &str, base: &str) {
        Command::new("git")
            .args(["checkout", "-B", branch, base])
            .current_dir(repo_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("create branch");
    }

    fn make_session(repo_path: &Path, branch: &str, parent_branch: &str) -> Session {
        let repo_name = repo_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("repo")
            .to_string();
        Session {
            id: format!("session-{}", branch.replace('/', "_")),
            name: branch.to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo_path.to_path_buf(),
            repository_name: repo_name,
            branch: branch.to_string(),
            parent_branch: parent_branch.to_string(),
            original_parent_branch: Some(parent_branch.to_string()),
            worktree_path: repo_path.to_path_buf(),
            status: SessionStatus::Active,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_skip_permissions: None,
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
            is_consolidation: false,
            consolidation_sources: None,
            promotion_reason: None,
        }
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create dirs");
        }
        std::fs::write(path, contents).expect("write file");
    }

    fn commit_file(repo_path: &Path, relative: &str, contents: &str, message: &str) {
        write_file(repo_path.join(relative).as_path(), contents);
        Command::new("git")
            .args(["add", relative])
            .current_dir(repo_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(repo_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git commit");
    }

    #[test]
    fn diff_summary_paginates_session_changes() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        checkout_branch(repo_path, "lucode/diff-summary", "main");

        write_file(repo_path.join("alpha.txt").as_path(), "alpha");
        write_file(repo_path.join("beta.txt").as_path(), "beta");
        write_file(repo_path.join("gamma.txt").as_path(), "gamma");

        let session = make_session(repo_path, "lucode/diff-summary", "main");
        let scope = DiffScope::for_session(&session).expect("scope");

        let first = compute_diff_summary(
            &scope,
            SummaryQuery {
                cursor: None,
                page_size: Some(2),
            },
        )
        .expect("first diff summary");

        assert_eq!(first.scope, DiffScopeKind::Session);
        assert_eq!(first.session_id.as_deref(), Some(session.id.as_str()));
        assert_eq!(first.files.len(), 2);
        assert_eq!(first.files[0].path, "alpha.txt");
        assert_eq!(first.files[1].path, "beta.txt");
        assert_eq!(first.paging.total_files, 3);
        assert_eq!(first.paging.returned, 2);
        assert!(first.paging.next_cursor.is_some());

        assert_eq!(first.branch_info.current_branch, scope.current_branch);
        assert_eq!(first.branch_info.parent_branch, scope.parent_branch);

        let repo = Repository::open(&scope.worktree_path).expect("open session repo");
        let head_oid = repo.head().expect("head").target().expect("head target");
        let expected_head = short_id(&repo, head_oid);
        assert_eq!(first.branch_info.head_short, expected_head);

        let parent_commit = repo
            .revparse_single(&scope.parent_branch)
            .expect("parent ref")
            .peel_to_commit()
            .expect("parent commit");
        let merge_base = repo
            .merge_base(head_oid, parent_commit.id())
            .unwrap_or(parent_commit.id());
        let expected_merge = short_id(&repo, merge_base);
        assert_eq!(first.branch_info.merge_base_short, expected_merge);

        let next_cursor = first.paging.next_cursor.clone();
        let second = compute_diff_summary(
            &scope,
            SummaryQuery {
                cursor: next_cursor,
                page_size: Some(2),
            },
        )
        .expect("second diff summary");

        assert_eq!(second.files.len(), 1);
        assert_eq!(second.files[0].path, "gamma.txt");
        assert_eq!(second.paging.total_files, 3);
        assert_eq!(second.paging.returned, 1);
        assert!(second.paging.next_cursor.is_none());
    }

    #[test]
    fn diff_summary_supports_orchestrator_scope() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        write_file(repo_path.join("orchestrator.txt").as_path(), "orchestrator");

        let repo = Repository::open(repo_path).expect("open repo");
        let current_branch = repo
            .head()
            .expect("head")
            .shorthand()
            .unwrap_or("main")
            .to_string();
        let parent_branch = current_branch.clone();
        let scope = DiffScope::for_orchestrator(repo_path).expect("scope");

        let response = compute_diff_summary(
            &scope,
            SummaryQuery {
                cursor: None,
                page_size: Some(10),
            },
        )
        .expect("orchestrator diff summary");

        assert_eq!(response.scope, DiffScopeKind::Orchestrator);
        assert!(response.session_id.is_none());
        assert!(!response.files.is_empty());
        assert_eq!(response.files[0].path, "orchestrator.txt");
        assert!(!response.has_spec);
        assert_eq!(response.branch_info.current_branch, current_branch);
        assert_eq!(response.branch_info.parent_branch, parent_branch);
    }

    #[test]
    fn diff_chunk_paginates_with_collapsible_sections() {
        let tmp = init_repo();
        let repo_path = tmp.path();

        let base_content: String = (0..120)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        commit_file(
            repo_path,
            "collapsible.txt",
            &(base_content.clone() + "\n"),
            "Add base file",
        );

        checkout_branch(repo_path, "lucode/diff-chunk", "main");
        let session = make_session(repo_path, "lucode/diff-chunk", "main");
        let scope = DiffScope::for_session(&session).expect("scope");

        let new_content: String = (0..120)
            .map(|i| {
                if i == 5 {
                    "changed early".to_string()
                } else if i == 60 {
                    "changed middle".to_string()
                } else if i == 115 {
                    "changed late".to_string()
                } else {
                    format!("line {i}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        write_file(
            scope.worktree_path.join("collapsible.txt").as_path(),
            &new_content,
        );

        let chunk = compute_diff_chunk(
            &scope,
            "collapsible.txt",
            DiffChunkRequest {
                cursor: None,
                line_limit: Some(12),
            },
        )
        .expect("first diff chunk");

        assert_eq!(chunk.file.path, "collapsible.txt");
        assert!(chunk.lines.len() <= 12);
        assert_eq!(chunk.paging.returned, chunk.lines.len());
        assert!(chunk.paging.next_cursor.is_some());

        let all_lines = {
            let repo = Repository::open(&scope.worktree_path).expect("open repo");
            let parent = repo
                .revparse_single(&scope.parent_branch)
                .expect("parent ref")
                .peel_to_commit()
                .expect("parent commit");
            let tree = parent.tree().expect("parent tree");
            let entry = tree
                .get_path(Path::new("collapsible.txt"))
                .expect("tree entry missing");
            let blob = repo.find_blob(entry.id()).expect("find blob");
            let base = String::from_utf8_lossy(blob.content()).into_owned();
            add_collapsible_sections(compute_unified_diff(&base, &new_content))
        };

        for (idx, line) in chunk.lines.iter().enumerate() {
            let expected = &all_lines[idx];
            assert_eq!(line.content, expected.content);
        }
    }

    #[test]
    fn diff_chunk_marks_binary_files() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        checkout_branch(repo_path, "lucode/binary-diff", "main");

        write_file(repo_path.join("binary.bin").as_path(), "\0\0\0");

        let session = make_session(repo_path, "lucode/binary-diff", "main");
        let scope = DiffScope::for_session(&session).expect("scope");

        let response = compute_diff_chunk(
            &scope,
            "binary.bin",
            DiffChunkRequest {
                cursor: None,
                line_limit: Some(200),
            },
        )
        .expect("binary diff response");

        assert!(response.is_binary);
        assert!(response.lines.is_empty());
        assert!(response.paging.next_cursor.is_none());
        assert_eq!(response.paging.returned, 0);
    }

    #[test]
    fn session_spec_response_present() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        let mut session = make_session(repo_path, "lucode/spec-session", "main");
        session.spec_content = Some("# Spec content\nDetails".to_string());

        let response = fetch_session_spec(&session).expect("spec response");
        assert_eq!(response.session_id, session.id);
        assert!(response.content.contains("Spec content"));
    }

    #[test]
    fn session_spec_response_missing() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        let session = make_session(repo_path, "lucode/no-spec", "main");

        let err = fetch_session_spec(&session).expect_err("missing spec should error");
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn struct_field_smoke() {
        let summary = DiffSummaryResponse {
            scope: DiffScopeKind::Session,
            session_id: Some("demo".into()),
            branch_info: BranchInfo {
                current_branch: "feature".into(),
                parent_branch: "main".into(),
                merge_base_short: "abc1234".into(),
                head_short: "def5678".into(),
            },
            has_spec: true,
            files: vec![ChangedFile::new("src/lib.rs".into(), "modified".into())],
            paging: PagingInfo {
                next_cursor: Some("next".into()),
                total_files: 1,
                returned: 1,
            },
        };
        assert!(summary.has_spec);
        assert_eq!(summary.files[0].path, "src/lib.rs");

        let mut file = ChangedFile::new("src/lib.rs".into(), "modified".into());
        file.additions = 5;
        file.deletions = 2;
        file.changes = 7;

        let chunk = DiffChunkResponse {
            file,
            branch_info: summary.branch_info.clone(),
            stats: DiffStatsSummary {
                additions: 5,
                deletions: 2,
            },
            is_binary: false,
            lines: vec![DiffLineEntry {
                content: "fn demo() {}".into(),
                line_type: "added".into(),
                old_line_number: None,
                new_line_number: Some(10),
                is_collapsible: Some(false),
                collapsed_count: None,
            }],
            paging: DiffChunkPaging {
                cursor: Some("cursor".into()),
                next_cursor: None,
                returned: 1,
            },
        };
        assert_eq!(chunk.stats.additions, 5);
        assert!(!chunk.is_binary);

        let spec_response = SessionSpecResponse {
            session_id: "demo".into(),
            content: "# Spec".into(),
            updated_at: Utc::now(),
        };
        assert_eq!(spec_response.session_id, "demo");

        let error = DiffApiError::new(StatusCode::BAD_REQUEST, "failure".into());
        assert_eq!(error.message, "failure");
    }

    #[test]
    fn encode_decode_cursor_roundtrip() {
        let encoded = encode_cursor(42);
        let decoded = decode_cursor(&encoded).expect("valid cursor");
        assert_eq!(decoded, 42);
    }

    #[test]
    fn encode_decode_cursor_zero() {
        let encoded = encode_cursor(0);
        let decoded = decode_cursor(&encoded).expect("valid cursor");
        assert_eq!(decoded, 0);
    }

    #[test]
    fn encode_decode_cursor_large_value() {
        let encoded = encode_cursor(999999);
        let decoded = decode_cursor(&encoded).expect("valid cursor");
        assert_eq!(decoded, 999999);
    }

    #[test]
    fn decode_cursor_rejects_invalid_base64() {
        let err = decode_cursor("!!!not-valid!!!").expect_err("invalid cursor");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("Invalid cursor"));
    }

    #[test]
    fn decode_cursor_rejects_valid_base64_but_invalid_json() {
        let encoded = URL_SAFE_NO_PAD.encode(b"not json");
        let err = decode_cursor(&encoded).expect_err("invalid json");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn validate_rel_path_accepts_simple_path() {
        let result = validate_rel_path("src/lib.rs").expect("valid path");
        assert_eq!(result, PathBuf::from("src/lib.rs"));
    }

    #[test]
    fn validate_rel_path_accepts_single_file() {
        let result = validate_rel_path("file.txt").expect("valid path");
        assert_eq!(result, PathBuf::from("file.txt"));
    }

    #[test]
    fn validate_rel_path_rejects_absolute_path() {
        let err = validate_rel_path("/etc/passwd").expect_err("absolute path should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains("relative"));
    }

    #[test]
    fn validate_rel_path_rejects_parent_traversal() {
        let err = validate_rel_path("../secret/file").expect_err("traversal should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains(".."));
    }

    #[test]
    fn validate_rel_path_rejects_mid_path_traversal() {
        let err = validate_rel_path("src/../etc/passwd").expect_err("traversal should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn detect_change_type_added() {
        assert_eq!(detect_change_type(&[], b"new content"), "added");
    }

    #[test]
    fn detect_change_type_deleted() {
        assert_eq!(detect_change_type(b"old content", &[]), "deleted");
    }

    #[test]
    fn detect_change_type_modified() {
        assert_eq!(detect_change_type(b"old", b"new"), "modified");
    }

    #[test]
    fn detect_change_type_both_empty() {
        assert_eq!(detect_change_type(&[], &[]), "modified");
    }

    #[test]
    fn map_diff_line_added() {
        let line = DiffLine {
            content: "fn hello()".to_string(),
            line_type: LineType::Added,
            old_line_number: None,
            new_line_number: Some(10),
            is_collapsible: None,
            collapsed_count: None,
            collapsed_lines: None,
        };
        let entry = map_diff_line(&line);
        assert_eq!(entry.line_type, "added");
        assert_eq!(entry.content, "fn hello()");
        assert_eq!(entry.old_line_number, None);
        assert_eq!(entry.new_line_number, Some(10));
        assert_eq!(entry.is_collapsible, None);
        assert_eq!(entry.collapsed_count, None);
    }

    #[test]
    fn map_diff_line_removed() {
        let line = DiffLine {
            content: "old code".to_string(),
            line_type: LineType::Removed,
            old_line_number: Some(5),
            new_line_number: None,
            is_collapsible: None,
            collapsed_count: None,
            collapsed_lines: None,
        };
        let entry = map_diff_line(&line);
        assert_eq!(entry.line_type, "removed");
        assert_eq!(entry.old_line_number, Some(5));
        assert_eq!(entry.new_line_number, None);
    }

    #[test]
    fn map_diff_line_unchanged_with_collapsible() {
        let line = DiffLine {
            content: "  context".to_string(),
            line_type: LineType::Unchanged,
            old_line_number: Some(3),
            new_line_number: Some(3),
            is_collapsible: Some(true),
            collapsed_count: Some(15),
            collapsed_lines: None,
        };
        let entry = map_diff_line(&line);
        assert_eq!(entry.line_type, "unchanged");
        assert_eq!(entry.is_collapsible, Some(true));
        assert_eq!(entry.collapsed_count, Some(15));
    }

    #[test]
    fn scope_kind_label_session() {
        let scope = DiffScope {
            kind: DiffScopeKind::Session,
            worktree_path: PathBuf::from("/tmp"),
            current_branch: "feature".to_string(),
            parent_branch: "main".to_string(),
            session_id: Some("s1".to_string()),
            has_spec: false,
        };
        assert_eq!(scope_kind_label(&scope), "session");
    }

    #[test]
    fn scope_kind_label_orchestrator() {
        let scope = DiffScope {
            kind: DiffScopeKind::Orchestrator,
            worktree_path: PathBuf::from("/tmp"),
            current_branch: "main".to_string(),
            parent_branch: "main".to_string(),
            session_id: None,
            has_spec: false,
        };
        assert_eq!(scope_kind_label(&scope), "orchestrator");
    }

    #[test]
    fn diff_scope_for_session_rejects_missing_worktree() {
        let mut session = make_session(Path::new("/nonexistent/worktree"), "branch", "main");
        session.worktree_path = PathBuf::from("/nonexistent/path/that/does/not/exist");
        let err = DiffScope::for_session(&session).expect_err("missing worktree");
        assert_eq!(err.status, StatusCode::CONFLICT);
        assert!(err.message.contains("worktree is missing"));
    }

    #[test]
    fn diff_scope_for_session_rejects_cancelled_session() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        let mut session = make_session(repo_path, "feature", "main");
        session.status = SessionStatus::Cancelled;
        let err = DiffScope::for_session(&session).expect_err("cancelled session");
        assert_eq!(err.status, StatusCode::CONFLICT);
        assert!(err.message.contains("cancellation"));
    }

    #[test]
    fn diff_scope_for_session_sets_correct_fields() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        let mut session = make_session(repo_path, "lucode/test-branch", "main");
        session.spec_content = Some("spec".to_string());
        let scope = DiffScope::for_session(&session).expect("valid scope");
        assert_eq!(scope.kind, DiffScopeKind::Session);
        assert_eq!(scope.current_branch, "lucode/test-branch");
        assert_eq!(scope.parent_branch, "main");
        assert!(scope.session_id.is_some());
        assert!(scope.has_spec);
    }

    #[test]
    fn diff_api_error_preserves_status_and_message() {
        let err = DiffApiError::new(StatusCode::FORBIDDEN, "not allowed".into());
        assert_eq!(err.status, StatusCode::FORBIDDEN);
        assert_eq!(err.message, "not allowed");
    }

    #[test]
    fn diff_scope_kind_serializes_lowercase() {
        let session_json = serde_json::to_string(&DiffScopeKind::Session).unwrap();
        assert_eq!(session_json, r#""session""#);
        let orch_json = serde_json::to_string(&DiffScopeKind::Orchestrator).unwrap();
        assert_eq!(orch_json, r#""orchestrator""#);
    }

    #[test]
    fn diff_scope_kind_deserializes_lowercase() {
        let session: DiffScopeKind = serde_json::from_str(r#""session""#).unwrap();
        assert_eq!(session, DiffScopeKind::Session);
        let orch: DiffScopeKind = serde_json::from_str(r#""orchestrator""#).unwrap();
        assert_eq!(orch, DiffScopeKind::Orchestrator);
    }

    #[test]
    fn diff_line_entry_equality() {
        let a = DiffLineEntry {
            content: "hello".into(),
            line_type: "added".into(),
            old_line_number: None,
            new_line_number: Some(1),
            is_collapsible: None,
            collapsed_count: None,
        };
        let b = a.clone();
        assert_eq!(a, b);
    }

    #[test]
    fn diff_summary_zero_page_size_rejected() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        let session = make_session(repo_path, "main", "main");
        let scope = DiffScope::for_session(&session).expect("scope");
        let err = compute_diff_summary(
            &scope,
            SummaryQuery {
                cursor: None,
                page_size: Some(0),
            },
        )
        .expect_err("zero page_size should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn diff_chunk_zero_line_limit_rejected() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        checkout_branch(repo_path, "lucode/zero-limit", "main");
        write_file(repo_path.join("f.txt").as_path(), "data");
        let session = make_session(repo_path, "lucode/zero-limit", "main");
        let scope = DiffScope::for_session(&session).expect("scope");
        let err = compute_diff_chunk(
            &scope,
            "f.txt",
            DiffChunkRequest {
                cursor: None,
                line_limit: Some(0),
            },
        )
        .expect_err("zero line_limit should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn diff_chunk_exceeds_max_line_limit() {
        let tmp = init_repo();
        let repo_path = tmp.path();
        checkout_branch(repo_path, "lucode/max-limit", "main");
        write_file(repo_path.join("f.txt").as_path(), "data");
        let session = make_session(repo_path, "lucode/max-limit", "main");
        let scope = DiffScope::for_session(&session).expect("scope");
        let err = compute_diff_chunk(
            &scope,
            "f.txt",
            DiffChunkRequest {
                cursor: None,
                line_limit: Some(MAX_LINE_LIMIT + 1),
            },
        )
        .expect_err("exceeding max line_limit should fail");
        assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(err.message.contains(&MAX_LINE_LIMIT.to_string()));
    }

    #[test]
    fn read_worktree_bytes_returns_empty_for_missing_file() {
        let tmp = TempDir::new().expect("temp dir");
        let result =
            read_worktree_bytes(tmp.path(), Path::new("nonexistent.txt")).expect("should succeed");
        assert!(result.is_empty());
    }

    #[test]
    fn read_worktree_bytes_reads_existing_file() {
        let tmp = TempDir::new().expect("temp dir");
        std::fs::write(tmp.path().join("hello.txt"), "hello world").expect("write");
        let result =
            read_worktree_bytes(tmp.path(), Path::new("hello.txt")).expect("should succeed");
        assert_eq!(result, b"hello world");
    }
}
