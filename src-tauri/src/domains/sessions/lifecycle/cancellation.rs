use crate::domains::git::service as git;
use crate::domains::sessions::entity::Session;
use crate::domains::sessions::process_cleanup::terminate_processes_with_cwd;
use crate::domains::sessions::repository::SessionDbManager;
use anyhow::{Context, Result, anyhow};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};
use tokio::runtime::Handle;

pub struct CancellationCoordinator<'a> {
    repo_path: &'a Path,
    db_manager: &'a SessionDbManager,
}

/// Standalone coordinator for filesystem operations only (no DB reference)
pub struct StandaloneCancellationCoordinator {
    repo_path: PathBuf,
    session: Session,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationConfig {
    pub force: bool,
    pub skip_process_cleanup: bool,
    pub skip_branch_deletion: bool,
}

#[derive(Debug, Clone)]
pub struct CancellationResult {
    pub terminated_processes: Vec<i32>,
    pub worktree_removed: bool,
    pub branch_deleted: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
struct CancellationArtifacts {
    worktree_exists: bool,
    worktree_registered: bool,
    branch_exists: bool,
}

impl CancellationArtifacts {
    fn fully_absent(self) -> bool {
        !self.worktree_exists && !self.worktree_registered && !self.branch_exists
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum CancelBlocker {
    UncommittedChanges { files: Vec<String> },
    OrphanedWorktree { expected_path: PathBuf },
    WorktreeLocked { reason: String },
    GitError { operation: String, message: String },
}

#[derive(Debug, Clone)]
pub struct CancelBlockedError {
    pub blocker: CancelBlocker,
}

impl CancelBlockedError {
    pub fn new(blocker: CancelBlocker) -> Self {
        Self { blocker }
    }
}

impl fmt::Display for CancelBlockedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Session cancel blocked: {:?}", self.blocker)
    }
}

impl std::error::Error for CancelBlockedError {}

fn detect_cancel_blocker_for(
    repo_path: &Path,
    session: &Session,
    config: &CancellationConfig,
) -> Result<Option<CancelBlocker>> {
    if config.force {
        return Ok(None);
    }

    let artifacts = read_cancellation_artifacts(repo_path, session)?;
    if !artifacts.worktree_exists || !artifacts.branch_exists {
        warn!(
            "Cancel {}: missing artifacts (worktree_exists={}, worktree_registered={}, branch_exists={}), treating cancel as idempotent",
            session.name,
            artifacts.worktree_exists,
            artifacts.worktree_registered,
            artifacts.branch_exists
        );
        return Ok(None);
    }

    match git::worktree_lock_reason(repo_path, &session.worktree_path) {
        Ok(Some(reason)) => return Ok(Some(CancelBlocker::WorktreeLocked { reason })),
        Ok(None) => {}
        Err(error) => {
            return Ok(Some(CancelBlocker::GitError {
                operation: "inspect_worktree_lock".to_string(),
                message: error.to_string(),
            }));
        }
    }

    match git::uncommitted_sample_paths(&session.worktree_path, 50) {
        Ok(files) if !files.is_empty() => Ok(Some(CancelBlocker::UncommittedChanges { files })),
        Ok(_) => Ok(None),
        Err(error) => Ok(Some(CancelBlocker::GitError {
            operation: "inspect_uncommitted_changes".to_string(),
            message: error.to_string(),
        })),
    }
}

fn read_cancellation_artifacts(
    repo_path: &Path,
    session: &Session,
) -> Result<CancellationArtifacts> {
    Ok(CancellationArtifacts {
        worktree_exists: session.worktree_path.exists(),
        worktree_registered: is_worktree_registered(repo_path, &session.worktree_path)?,
        branch_exists: git::branch_exists(repo_path, &session.branch)?,
    })
}

fn is_worktree_registered(repo_path: &Path, worktree_path: &Path) -> Result<bool> {
    let repo = git2::Repository::open(repo_path)?;
    let worktrees = repo.worktrees()?;
    let canonical_worktree_path = worktree_path
        .canonicalize()
        .unwrap_or_else(|_| worktree_path.to_path_buf());

    for wt_name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(wt_name) {
            let wt_path = wt.path();
            let canonical_wt_path = wt_path
                .canonicalize()
                .unwrap_or_else(|_| wt_path.to_path_buf());
            if canonical_wt_path == canonical_worktree_path {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

impl StandaloneCancellationCoordinator {
    pub fn new(repo_path: PathBuf, session: Session) -> Self {
        Self { repo_path, session }
    }

    /// Perform filesystem-only cancellation operations (no DB writes)
    /// This can run WITHOUT holding the core write lock
    pub async fn cancel_filesystem_only(
        &self,
        config: CancellationConfig,
    ) -> Result<CancellationResult> {
        info!(
            "Canceling session '{}' (filesystem-only)",
            self.session.name
        );

        if self.session.is_spec {
            return Err(anyhow!(
                "Cannot cancel spec session '{}'. Use archive or delete spec operations instead.",
                self.session.name
            ));
        }

        if let Some(blocker) = detect_cancel_blocker_for(&self.repo_path, &self.session, &config)? {
            warn!(
                "Cancel {} blocked during filesystem preflight: {:?}",
                self.session.name, blocker
            );
            return Err(CancelBlockedError::new(blocker).into());
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        let artifacts = read_cancellation_artifacts(&self.repo_path, &self.session)?;
        if artifacts.fully_absent() {
            warn!(
                "Cancel {}: worktree and branch already gone; finalizing cancel",
                self.session.name
            );
        }

        Self::check_uncommitted_changes(&self.session);

        if !config.skip_process_cleanup {
            result.terminated_processes =
                Self::terminate_processes_async(&self.session, &mut result.errors).await;
        }

        match Self::remove_worktree_async(
            &self.repo_path,
            &self.session.worktree_path,
            &self.session.name,
        )
        .await
        {
            Ok(removed) => result.worktree_removed = removed,
            Err(e) => result.errors.push(format!("Worktree removal failed: {e}")),
        }

        if !config.skip_branch_deletion {
            match Self::delete_branch_async(
                &self.repo_path,
                &self.session.branch,
                &self.session.name,
            )
            .await
            {
                Ok(deleted) => result.branch_deleted = deleted,
                Err(e) => result.errors.push(format!("Branch deletion failed: {e}")),
            }
        }

        if !result.errors.is_empty() {
            warn!(
                "Filesystem cancel {}: Completed with {} error(s)",
                self.session.name,
                result.errors.len()
            );
        } else {
            info!(
                "Filesystem cancel {}: Successfully completed",
                self.session.name
            );
        }

        Ok(result)
    }

    fn check_uncommitted_changes(session: &Session) {
        if !session.worktree_path.exists() {
            return;
        }

        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false);
        if has_uncommitted {
            warn!(
                "Canceling session '{}' with uncommitted changes",
                session.name
            );
        }
    }

    async fn terminate_processes_async(session: &Session, errors: &mut Vec<String>) -> Vec<i32> {
        if !session.worktree_path.exists() {
            return Vec::new();
        }

        match terminate_processes_with_cwd(&session.worktree_path).await {
            Ok(pids) => {
                if !pids.is_empty() {
                    info!(
                        "Cancel {}: terminated {} lingering process(es): {:?}",
                        session.name,
                        pids.len(),
                        pids
                    );
                }
                pids
            }
            Err(e) => {
                let msg = format!("Failed to terminate lingering processes: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                Vec::new()
            }
        }
    }

    async fn remove_worktree_async(
        repo_path: &Path,
        worktree_path: &Path,
        session_name: &str,
    ) -> Result<bool> {
        let worktree_exists = worktree_path.exists();
        let worktree_registered = is_worktree_registered(repo_path, worktree_path)?;
        if !worktree_exists && !worktree_registered {
            warn!(
                "Cancel {}: Worktree path missing, skipping removal: {}",
                session_name,
                worktree_path.display()
            );
            return Ok(false);
        }

        let repo_path = repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            git::remove_worktree(&repo_path, &worktree_path)?;
            info!("Cancel {session_name}: Removed worktree");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }

    async fn delete_branch_async(
        repo_path: &Path,
        branch: &str,
        session_name: &str,
    ) -> Result<bool> {
        let repo_path = repo_path.to_path_buf();
        let branch = branch.to_string();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            if !git::branch_exists(&repo_path, &branch)? {
                info!("Cancel {session_name}: Branch doesn't exist, skipping deletion");
                return Ok(false);
            }

            git::delete_branch(&repo_path, &branch)?;
            info!("Deleted branch '{branch}'");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }
}

impl<'a> CancellationCoordinator<'a> {
    pub fn new(repo_path: &'a Path, db_manager: &'a SessionDbManager) -> Self {
        Self {
            repo_path,
            db_manager,
        }
    }

    /// Create a standalone coordinator for filesystem-only operations
    pub fn new_standalone(
        repo_path: &Path,
        session: &Session,
    ) -> StandaloneCancellationCoordinator {
        StandaloneCancellationCoordinator::new(repo_path.to_path_buf(), session.clone())
    }

    pub fn cancel_session(
        &self,
        session: &Session,
        config: CancellationConfig,
    ) -> Result<CancellationResult> {
        info!("Canceling session '{}' (sync)", session.name);

        if session.is_spec {
            return Err(anyhow!(
                "Cannot cancel spec session '{}'. Use archive or delete spec operations instead.",
                session.name
            ));
        }

        if let Some(blocker) = self.detect_cancel_blocker(session, &config)? {
            warn!(
                "Cancel {} blocked during sync preflight: {:?}",
                session.name, blocker
            );
            return Err(CancelBlockedError::new(blocker).into());
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        let artifacts = read_cancellation_artifacts(self.repo_path, session)?;
        if artifacts.fully_absent() {
            warn!(
                "Cancel {}: worktree and branch already gone; finalizing cancel",
                session.name
            );
        }

        self.check_uncommitted_changes(session);

        if !config.skip_process_cleanup {
            result.terminated_processes =
                self.terminate_session_processes_sync(session, &mut result.errors);
        }

        result.worktree_removed = self.remove_session_worktree(session, &mut result.errors);

        if !config.skip_branch_deletion {
            result.branch_deleted = self.delete_session_branch(session, &mut result.errors);
        }

        self.finalize_cancellation(&session.id, &mut result.errors)?;

        if !result.errors.is_empty() {
            warn!(
                "Cancel {}: Completed with {} error(s)",
                session.name,
                result.errors.len()
            );
        } else {
            info!("Cancel {}: Successfully completed", session.name);
        }

        Ok(result)
    }

    pub async fn cancel_session_async(
        &self,
        session: &Session,
        config: CancellationConfig,
    ) -> Result<CancellationResult> {
        info!("Canceling session '{}' (async)", session.name);

        if session.is_spec {
            return Err(anyhow!(
                "Cannot cancel spec session '{}'. Use archive or delete spec operations instead.",
                session.name
            ));
        }

        if let Some(blocker) = self.detect_cancel_blocker(session, &config)? {
            warn!(
                "Cancel {} blocked during async preflight: {:?}",
                session.name, blocker
            );
            return Err(CancelBlockedError::new(blocker).into());
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        let artifacts = read_cancellation_artifacts(self.repo_path, session)?;
        if artifacts.fully_absent() {
            warn!(
                "Fast cancel {}: worktree and branch already gone; finalizing cancel",
                session.name
            );
        }

        self.check_uncommitted_changes(session);

        if !config.skip_process_cleanup {
            result.terminated_processes = self
                .terminate_session_processes_async(session, &mut result.errors)
                .await;
        }

        match Self::remove_worktree_async(self.repo_path, &session.worktree_path, &session.name)
            .await
        {
            Ok(removed) => result.worktree_removed = removed,
            Err(e) => result.errors.push(format!("Worktree removal failed: {e}")),
        }

        if !config.skip_branch_deletion {
            // The branch remains "checked out" while the worktree exists, so delete it only after pruning succeeds.
            match Self::delete_branch_async(self.repo_path, &session.branch, &session.name).await {
                Ok(deleted) => result.branch_deleted = deleted,
                Err(e) => result.errors.push(format!("Branch deletion failed: {e}")),
            }
        }

        self.finalize_cancellation(&session.id, &mut result.errors)?;

        if !result.errors.is_empty() {
            warn!(
                "Fast cancel {}: Completed with {} error(s)",
                session.name,
                result.errors.len()
            );
        } else {
            info!("Fast cancel {}: Successfully completed", session.name);
        }

        Ok(result)
    }

    pub fn detect_cancel_blocker(
        &self,
        session: &Session,
        config: &CancellationConfig,
    ) -> Result<Option<CancelBlocker>> {
        detect_cancel_blocker_for(self.repo_path, session, config)
    }

    pub async fn force_cancel_session_async(
        &self,
        session: &Session,
    ) -> Result<CancellationResult> {
        info!("Force canceling session '{}'", session.name);

        if session.is_spec {
            return Err(anyhow!(
                "Cannot force cancel spec session '{}'. Use archive or delete spec operations instead.",
                session.name
            ));
        }

        let mut result = CancellationResult {
            terminated_processes: Vec::new(),
            worktree_removed: false,
            branch_deleted: false,
            errors: Vec::new(),
        };

        result.terminated_processes = self
            .terminate_session_processes_async(session, &mut result.errors)
            .await;

        match Self::force_remove_worktree_async(
            self.repo_path,
            &session.worktree_path,
            &session.name,
        )
        .await
        {
            Ok(removed) => result.worktree_removed = removed,
            Err(error) => {
                let message = format!("Force worktree removal failed: {error}");
                warn!("Force cancel {}: {}", session.name, message);
                result.errors.push(message);
            }
        }

        match Self::force_delete_branch_async(self.repo_path, &session.branch, &session.name).await
        {
            Ok(deleted) => result.branch_deleted = deleted,
            Err(error) => {
                let message = format!("Force branch deletion failed: {error}");
                warn!("Force cancel {}: {}", session.name, message);
                result.errors.push(message);
            }
        }

        self.delete_session_row(&session.id)?;

        if !result.errors.is_empty() {
            warn!(
                "Force cancel {}: Completed with {} cleanup error(s): {:?}",
                session.name,
                result.errors.len(),
                result.errors
            );
        } else {
            info!("Force cancel {}: Successfully completed", session.name);
        }

        Ok(result)
    }

    fn check_uncommitted_changes(&self, session: &Session) {
        if !session.worktree_path.exists() {
            return;
        }

        let has_uncommitted = git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false);
        if has_uncommitted {
            warn!(
                "Canceling session '{}' with uncommitted changes",
                session.name
            );
        }
    }

    fn terminate_session_processes_sync(
        &self,
        session: &Session,
        errors: &mut Vec<String>,
    ) -> Vec<i32> {
        if !session.worktree_path.exists() {
            return Vec::new();
        }

        let worktree_path = session.worktree_path.clone();

        // If we're already running inside a Tokio runtime, spawn a scoped thread to run the
        // async termination without blocking the Tokio worker. Otherwise, block on the runtime.
        let result = match Handle::try_current() {
            Ok(handle) => std::thread::scope(|s| {
                s.spawn(move || handle.block_on(terminate_processes_with_cwd(&worktree_path)))
                    .join()
                    .expect("terminate thread panicked")
            }),
            Err(_) => tauri::async_runtime::block_on(terminate_processes_with_cwd(&worktree_path)),
        };

        match result {
            Ok(pids) => {
                if !pids.is_empty() {
                    info!(
                        "Cancel {}: terminated {} lingering process(es): {:?}",
                        session.name,
                        pids.len(),
                        pids
                    );
                }
                pids
            }
            Err(e) => {
                let msg = format!("Failed to terminate lingering processes: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                Vec::new()
            }
        }
    }

    async fn terminate_session_processes_async(
        &self,
        session: &Session,
        errors: &mut Vec<String>,
    ) -> Vec<i32> {
        if !session.worktree_path.exists() {
            return Vec::new();
        }

        match terminate_processes_with_cwd(&session.worktree_path).await {
            Ok(pids) => {
                if !pids.is_empty() {
                    info!(
                        "Fast cancel {}: terminated {} lingering process(es): {:?}",
                        session.name,
                        pids.len(),
                        pids
                    );
                }
                pids
            }
            Err(e) => {
                let msg = format!("Failed to terminate lingering processes: {e}");
                warn!("Fast cancel {}: {}", session.name, msg);
                errors.push(msg);
                Vec::new()
            }
        }
    }

    fn remove_session_worktree(&self, session: &Session, errors: &mut Vec<String>) -> bool {
        let worktree_registered =
            match is_worktree_registered(self.repo_path, &session.worktree_path) {
                Ok(registered) => registered,
                Err(e) => {
                    let msg = format!("Failed to check worktree registration: {e}");
                    warn!("Cancel {}: {}", session.name, msg);
                    errors.push(msg);
                    return false;
                }
            };

        if !session.worktree_path.exists() && !worktree_registered {
            warn!(
                "Worktree path missing, skipping removal: {}",
                session.worktree_path.display()
            );
            return false;
        }

        match git::remove_worktree(self.repo_path, &session.worktree_path) {
            Ok(()) => {
                info!("Cancel {}: Removed worktree", session.name);
                true
            }
            Err(e) => {
                let msg = format!("Failed to remove worktree: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                false
            }
        }
    }

    fn delete_session_branch(&self, session: &Session, errors: &mut Vec<String>) -> bool {
        let branch_exists = match git::branch_exists(self.repo_path, &session.branch) {
            Ok(exists) => exists,
            Err(e) => {
                let msg = format!("Failed to check if branch exists: {e}");
                warn!("Cancel {}: {}", session.name, msg);
                errors.push(msg);
                return false;
            }
        };

        if !branch_exists {
            info!(
                "Cancel {}: Branch doesn't exist, skipping deletion",
                session.name
            );
            return false;
        }

        match git::delete_branch(self.repo_path, &session.branch) {
            Ok(()) => {
                info!("Deleted branch '{}'", session.branch);
                true
            }
            Err(e) => {
                let msg = format!("Failed to delete branch '{}': {}", session.branch, e);
                warn!("{msg}");
                errors.push(msg);
                false
            }
        }
    }

    /// Phase 4 Wave B.2: stamps `cancelled_at` directly on the orthogonal
    /// axis instead of writing the legacy `status='cancelled'` column. The
    /// caller chain (`cancel_session_internal` → `finalize_cancellation`)
    /// runs synchronously under a brief lock, so no fire-and-forget shape
    /// can let a reader observe the row post-cancel but pre-stamp.
    fn finalize_cancellation(&self, session_id: &str, errors: &mut Vec<String>) -> Result<()> {
        self.db_manager
            .set_session_cancelled_at(session_id, chrono::Utc::now())
            .with_context(|| format!("Failed to stamp cancelled_at for '{session_id}'"))?;

        if let Err(e) = self
            .db_manager
            .set_session_resume_allowed(session_id, false)
        {
            let msg = format!("Failed to gate resume: {e}");
            warn!("{msg}");
            errors.push(msg);
        }

        Ok(())
    }

    fn delete_session_row(&self, session_id: &str) -> Result<()> {
        self.db_manager
            .delete_session(session_id)
            .with_context(|| format!("Failed to delete session row for '{session_id}'"))
    }

    async fn remove_worktree_async(
        repo_path: &Path,
        worktree_path: &Path,
        session_name: &str,
    ) -> Result<bool> {
        let worktree_exists = worktree_path.exists();
        let worktree_registered = is_worktree_registered(repo_path, worktree_path)?;
        if !worktree_exists && !worktree_registered {
            warn!(
                "Fast cancel {}: Worktree path missing, skipping removal: {}",
                session_name,
                worktree_path.display()
            );
            return Ok(false);
        }

        let repo_path = repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            git::remove_worktree(&repo_path, &worktree_path)?;
            info!("Fast cancel {session_name}: Removed worktree");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }

    async fn force_remove_worktree_async(
        repo_path: &Path,
        worktree_path: &Path,
        session_name: &str,
    ) -> Result<bool> {
        let worktree_exists = worktree_path.exists();
        let worktree_registered = is_worktree_registered(repo_path, worktree_path)?;
        if !worktree_exists && !worktree_registered {
            warn!(
                "Force cancel {}: Worktree path missing, skipping removal: {}",
                session_name,
                worktree_path.display()
            );
            return Ok(false);
        }

        let repo_path = repo_path.to_path_buf();
        let worktree_path = worktree_path.to_path_buf();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            git::force_remove_worktree(&repo_path, &worktree_path)?;
            info!("Force cancel {session_name}: Removed or pruned worktree");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }

    async fn delete_branch_async(
        repo_path: &Path,
        branch: &str,
        session_name: &str,
    ) -> Result<bool> {
        use git2::{BranchType, Repository};

        let branch_exists = git::branch_exists(repo_path, branch)?;
        if !branch_exists {
            info!("Fast cancel {session_name}: Branch doesn't exist, skipping deletion");
            return Ok(false);
        }

        let repo_path = repo_path.to_path_buf();
        let branch = branch.to_string();

        tokio::task::spawn_blocking(move || {
            let repo = Repository::open(&repo_path)?;
            let mut br = repo
                .find_branch(&branch, BranchType::Local)
                .with_context(|| format!("Failed to find branch '{branch}' for deletion"))?;
            br.delete()?;
            info!("Deleted branch '{branch}'");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }

    async fn force_delete_branch_async(
        repo_path: &Path,
        branch: &str,
        session_name: &str,
    ) -> Result<bool> {
        let branch_exists = git::branch_exists(repo_path, branch)?;
        if !branch_exists {
            info!("Force cancel {session_name}: Branch doesn't exist, skipping deletion");
            return Ok(false);
        }

        let repo_path = repo_path.to_path_buf();
        let branch = branch.to_string();
        let session_name = session_name.to_string();

        tokio::task::spawn_blocking(move || {
            git::force_delete_branch(&repo_path, &branch)?;
            info!("Force cancel {session_name}: Deleted branch '{branch}'");
            Ok::<bool, anyhow::Error>(true)
        })
        .await
        .map_err(|e| anyhow!("Task join error: {e}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::entity::Session;
    use crate::infrastructure::database::Database;
    use chrono::Utc;
    use serial_test::serial;
    use std::path::PathBuf;
    use std::process::Command;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn setup_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();

        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        std::fs::write(repo_path.join("README.md"), "Initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        (temp_dir, repo_path)
    }

    fn create_test_session(repo_path: &Path, worktree_path: PathBuf) -> Session {
        Session {
            id: Uuid::new_v4().to_string(),
            name: "test-session".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo_path.to_path_buf(),
            repository_name: "test-repo".to_string(),
            branch: "lucode/test-session".to_string(),
            parent_branch: "master".to_string(),
            original_parent_branch: Some("master".to_string()),
            worktree_path,
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
            task_id: None,
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
    #[serial]
    fn test_cancel_spec_session_returns_error() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);

        let mut session = create_test_session(&repo_path, repo_path.join(".lucode/worktrees/test"));
        session.is_spec = true;

        let result = coordinator.cancel_session(&session, CancellationConfig::default());
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Cannot cancel spec session")
        );
    }

    #[test]
    #[serial]
    fn test_cancel_session_with_missing_worktree_is_idempotent() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let session =
            create_test_session(&repo_path, repo_path.join(".lucode/worktrees/nonexistent"));
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let result = coordinator
            .cancel_session(&session, CancellationConfig::default())
            .expect("missing worktree should be treated as idempotent cancel");

        assert!(!result.worktree_removed);
        assert!(!result.branch_deleted);
        assert!(result.errors.is_empty());

        let updated = db_manager.get_session_by_id(&session.id).unwrap();
        // Phase 4 Wave B.2: cancellation stamps cancelled_at on the
        // orthogonal axis. The legacy `status` column stays Active and
        // is no longer authoritative for "is this session cancelled?".
        assert!(updated.cancelled_at.is_some());
        assert!(!updated.resume_allowed);
    }

    #[test]
    #[serial]
    fn cancel_blocker_detects_uncommitted_changes() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();
        std::fs::write(worktree_path.join("dirty.txt"), "dirty").unwrap();

        let session = create_test_session(&repo_path, worktree_path);
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let blocker = coordinator
            .detect_cancel_blocker(&session, &CancellationConfig::default())
            .unwrap()
            .expect("dirty worktree should block normal cancellation");

        assert!(matches!(
            blocker,
            CancelBlocker::UncommittedChanges { ref files } if files == &vec!["dirty.txt".to_string()]
        ));
    }

    #[tokio::test]
    #[serial]
    async fn standalone_cancel_filesystem_only_blocks_uncommitted_changes() {
        let (_temp_dir, repo_path) = setup_test_repo();

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();
        std::fs::write(worktree_path.join("dirty.txt"), "dirty").unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        let coordinator = StandaloneCancellationCoordinator::new(repo_path, session);
        let error = coordinator
            .cancel_filesystem_only(CancellationConfig::default())
            .await
            .expect_err("dirty standalone cancel should return typed blocker");

        let blocked = error
            .downcast::<CancelBlockedError>()
            .expect("dirty standalone cancel should be typed");
        assert!(matches!(
            blocked.blocker,
            CancelBlocker::UncommittedChanges { ref files } if files == &vec!["dirty.txt".to_string()]
        ));
        assert!(worktree_path.exists());
    }

    #[test]
    #[serial]
    fn cancel_blocker_skips_missing_worktree() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let session = create_test_session(&repo_path, repo_path.join(".lucode/worktrees/missing"));
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let blocker = coordinator
            .detect_cancel_blocker(&session, &CancellationConfig::default())
            .unwrap();

        assert!(
            blocker.is_none(),
            "missing worktree must no longer block cancel so ghosts self-heal"
        );
    }

    #[test]
    #[serial]
    fn cancel_blocker_detects_locked_worktree() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();
        std::fs::write(repo_path.join(".git/worktrees/test/locked"), "maintenance").unwrap();

        let session = create_test_session(&repo_path, worktree_path);
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let blocker = coordinator
            .detect_cancel_blocker(&session, &CancellationConfig::default())
            .unwrap()
            .expect("locked worktree should block normal cancellation");

        assert!(matches!(
            blocker,
            CancelBlocker::WorktreeLocked { ref reason } if reason == "maintenance"
        ));
    }

    #[test]
    #[serial]
    fn cancel_blocker_detects_git_error() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        git::ensure_branch_at_head(&repo_path, "lucode/test-session").unwrap();
        let worktree_path = repo_path.join(".lucode/worktrees/not-a-git-worktree");
        std::fs::create_dir_all(&worktree_path).unwrap();

        let session = create_test_session(&repo_path, worktree_path);
        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let blocker = coordinator
            .detect_cancel_blocker(&session, &CancellationConfig::default())
            .unwrap()
            .expect("invalid worktree should block normal cancellation");

        assert!(matches!(
            blocker,
            CancelBlocker::GitError { ref operation, ref message }
                if operation == "inspect_uncommitted_changes" && message.contains("could not find repository")
        ));
    }

    #[tokio::test]
    #[serial]
    async fn force_cancel_removes_dirty_worktree_and_session_row() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();
        std::fs::write(worktree_path.join("dirty.txt"), "dirty").unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        coordinator
            .force_cancel_session_async(&session)
            .await
            .unwrap();

        assert!(!worktree_path.exists());
        assert!(db_manager.get_session_by_id(&session.id).is_err());
    }

    #[tokio::test]
    #[serial]
    async fn force_cancel_removes_orphaned_session_row_and_git_metadata() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();
        std::fs::remove_dir_all(&worktree_path).unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        coordinator
            .force_cancel_session_async(&session)
            .await
            .unwrap();

        assert!(db_manager.get_session_by_id(&session.id).is_err());
        assert!(!git::is_worktree_registered(&repo_path, &worktree_path).unwrap());
    }

    // Regression: calling the SYNC helpers from inside a Tokio runtime must not panic
    // with "Cannot start a runtime from within a runtime".
    #[tokio::test(flavor = "multi_thread")]
    async fn terminate_processes_sync_is_safe_inside_runtime() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();
        std::fs::create_dir_all(&repo_path).unwrap();

        // Minimal SessionDbManager; we don't need real git metadata for this test.
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        // Create an existing worktree dir so the code path runs terminate_processes_with_cwd.
        let worktree_path = repo_path.join("worktree");
        std::fs::create_dir_all(&worktree_path).unwrap();

        let session = Session {
            id: Uuid::new_v4().to_string(),
            name: "panic-guard".to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repo_path.clone(),
            repository_name: "test-repo".to_string(),
            branch: "lucode/panic-guard".to_string(),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: worktree_path.clone(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
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
            task_id: None,
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

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let mut errors = Vec::new();
        let pids = coordinator.terminate_session_processes_sync(&session, &mut errors);

        assert!(pids.is_empty());
        assert!(errors.is_empty());
    }

    #[test]
    #[serial]
    fn test_cancel_session_skip_branch_deletion() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let config = CancellationConfig {
            skip_branch_deletion: true,
            ..Default::default()
        };

        let result = coordinator.cancel_session(&session, config).unwrap();
        assert!(!result.branch_deleted);
        assert!(git::branch_exists(&repo_path, "lucode/test-session").unwrap());
    }

    /// **Phase 4 Wave B.2 — load-bearing two-way-binding test.**
    /// `finalize_cancellation` (the lifecycle module's variant) must stamp
    /// `cancelled_at` directly and leave the legacy `status` column
    /// unchanged. v1 wrote `status='cancelled'`; v2 stamps the timestamp
    /// synchronously so the orthogonal axis (`cancelled_at`) becomes
    /// authoritative immediately. Reverting the rewire to
    /// `update_session_status(_, Cancelled)` makes this test fail because
    /// `cancelled_at` would stay None.
    #[test]
    #[serial]
    fn test_finalize_cancellation_stamps_cancelled_at_synchronously() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let session = create_test_session(&repo_path, repo_path.join(".lucode/worktrees/test"));
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let mut errors = Vec::new();
        coordinator
            .finalize_cancellation(&session.id, &mut errors)
            .unwrap();

        let updated = db_manager.get_session_by_id(&session.id).unwrap();
        assert!(
            updated.cancelled_at.is_some(),
            "finalize_cancellation must stamp cancelled_at synchronously (Phase 4 Wave B.2)"
        );
        assert!(!updated.resume_allowed);
    }

    #[tokio::test]
    #[serial]
    async fn test_async_cancel_session() {
        let (_temp_dir, repo_path) = setup_test_repo();
        let db = Database::new(Some(repo_path.join("test.db"))).unwrap();
        let db_manager = SessionDbManager::new(db, repo_path.clone());

        let worktree_path = repo_path.join(".lucode/worktrees/test");
        git::create_worktree_from_base(&repo_path, "lucode/test-session", &worktree_path, "master")
            .unwrap();

        let session = create_test_session(&repo_path, worktree_path.clone());
        db_manager.create_session(&session).unwrap();

        let coordinator = CancellationCoordinator::new(&repo_path, &db_manager);
        let result = coordinator
            .cancel_session_async(&session, CancellationConfig::default())
            .await
            .unwrap();

        assert!(result.worktree_removed);
        assert!(result.branch_deleted);
        assert!(!worktree_path.exists());
    }
}
