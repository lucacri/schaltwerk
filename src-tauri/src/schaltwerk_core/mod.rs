pub mod database;
pub mod db_app_config;
pub mod db_archived_specs;
pub mod db_project_config;
pub mod db_schema;
// Re-export agent modules from domains for backward compatibility
pub mod agents {
    pub use crate::domains::agents::*;
}

// Agent modules are now re-exported from domains/agents
#[cfg(test)]
mod tests;

#[cfg(test)]
mod launch_script_cleanup_tests {
    use std::time::{Duration, SystemTime};

    use filetime::FileTime;

    use super::*;

    #[test]
    fn cleanup_stale_launch_scripts_removes_only_old_lucode_scripts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let old_launch = dir.path().join("lucode-launch-old.sh");
        let fresh_launch = dir.path().join("lucode-launch-fresh.sh");
        let old_other = dir.path().join("other-launch-old.sh");

        std::fs::write(&old_launch, "old").expect("old launch");
        std::fs::write(&fresh_launch, "fresh").expect("fresh launch");
        std::fs::write(&old_other, "other").expect("other launch");

        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10_000);
        let old_time = FileTime::from_system_time(now - Duration::from_secs(7_200));
        let fresh_time = FileTime::from_system_time(now - Duration::from_secs(60));
        filetime::set_file_mtime(&old_launch, old_time).expect("old launch mtime");
        filetime::set_file_mtime(&fresh_launch, fresh_time).expect("fresh launch mtime");
        filetime::set_file_mtime(&old_other, old_time).expect("old other mtime");

        let removed = cleanup_stale_launch_scripts_in_dir(dir.path(), now).expect("cleanup");

        assert_eq!(removed, 1);
        assert!(!old_launch.exists());
        assert!(fresh_launch.exists());
        assert!(old_other.exists());
    }

    #[test]
    fn cleanup_stale_launch_scripts_tolerates_missing_directory() {
        let missing = std::env::temp_dir().join("lucode-nonexistent-cleanup-dir-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        let removed = cleanup_stale_launch_scripts_in_dir(&missing, SystemTime::now())
            .expect("missing dir must be tolerated");
        assert_eq!(removed, 0);
    }
}

pub use crate::domains::sessions::entity::{EnrichedSession, SessionState};
pub use crate::domains::sessions::lifecycle::cancellation::{
    CancellationConfig, CancellationResult, StandaloneCancellationCoordinator,
};
pub use crate::domains::sessions::service::{
    AgentLaunchParams, SessionCancellationInfo, SessionManager,
};
pub use database::Database;

use crate::domains::git;
use anyhow::Result;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const LAUNCH_SCRIPT_PREFIX: &str = "lucode-launch-";
const LAUNCH_SCRIPT_SUFFIX: &str = ".sh";
const STALE_LAUNCH_SCRIPT_AGE: Duration = Duration::from_secs(60 * 60);

pub fn cleanup_stale_launch_scripts() -> Result<usize> {
    cleanup_stale_launch_scripts_in_dir(&std::env::temp_dir(), SystemTime::now())
}

pub fn cleanup_stale_launch_scripts_in_dir(dir: &Path, now: SystemTime) -> Result<usize> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err.into()),
    };

    let mut removed = 0;
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.starts_with(LAUNCH_SCRIPT_PREFIX)
            || !file_name.ends_with(LAUNCH_SCRIPT_SUFFIX)
        {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).unwrap_or(Duration::ZERO) <= STALE_LAUNCH_SCRIPT_AGE {
            continue;
        }

        match std::fs::remove_file(entry.path()) {
            Ok(()) => removed += 1,
            Err(err) => log::warn!("Failed to remove stale launch script: {err}"),
        }
    }

    Ok(removed)
}

pub struct SchaltwerkCore {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl SchaltwerkCore {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let repo_path = git::discover_repository()?;
        let db = Database::new(db_path)?;
        log::warn!("Using SchaltwerkCore::new() - should use new_with_repo_path() instead");

        Ok(Self { db, repo_path })
    }

    pub fn new_with_repo_path(db_path: Option<PathBuf>, repo_path: PathBuf) -> Result<Self> {
        log::info!(
            "Creating SchaltwerkCore with explicit repo path: {}",
            repo_path.display()
        );
        let db = Database::new(db_path)?;

        Ok(Self { db, repo_path })
    }

    pub fn session_manager(&self) -> SessionManager {
        SessionManager::new(self.db.clone(), self.repo_path.clone())
    }

    pub fn database(&self) -> &Database {
        &self.db
    }

    #[cfg(test)]
    pub fn new_in_memory_with_repo_path(repo_path: PathBuf) -> Result<Self> {
        let db = Database::new_in_memory()?;

        Ok(Self { db, repo_path })
    }
}
