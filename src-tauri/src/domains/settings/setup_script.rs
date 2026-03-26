use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

use crate::infrastructure::database::{Database, ProjectConfigMethods};

/// Thin domain service that owns persistence for project setup scripts.
/// Keeps mcp_api free of database plumbing so the logic is reusable elsewhere.
pub struct SetupScriptService {
    db: Database,
    repo_path: PathBuf,
}

impl SetupScriptService {
    pub fn new(db: Database, repo_path: impl AsRef<Path>) -> Self {
        Self {
            db,
            repo_path: repo_path.as_ref().to_path_buf(),
        }
    }

    pub fn get(&self) -> Result<Option<String>> {
        self.db
            .get_project_setup_script(&self.repo_path)
            .map_err(|e| anyhow!("Failed to get project setup script: {e}"))
    }

    pub fn set(&self, setup_script: &str) -> Result<()> {
        self.db
            .set_project_setup_script(&self.repo_path, setup_script)
            .map_err(|e| anyhow!("Failed to set project setup script: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_service() -> (SetupScriptService, TempDir) {
        let db = Database::new_in_memory().expect("in-memory db");
        let tmp = TempDir::new().unwrap();
        let svc = SetupScriptService::new(db, tmp.path());
        (svc, tmp)
    }

    #[test]
    fn get_returns_none_when_not_set() {
        let (svc, _tmp) = test_service();
        let result = svc.get().unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn set_and_get_roundtrips() {
        let (svc, _tmp) = test_service();
        svc.set("echo hello").unwrap();

        let result = svc.get().unwrap();
        assert_eq!(result, Some("echo hello".to_string()));
    }

    #[test]
    fn set_overwrites_previous_value() {
        let (svc, _tmp) = test_service();
        svc.set("first").unwrap();
        svc.set("second").unwrap();

        let result = svc.get().unwrap();
        assert_eq!(result, Some("second".to_string()));
    }

    #[test]
    fn set_empty_string_is_retrievable() {
        let (svc, _tmp) = test_service();
        svc.set("").unwrap();

        let result = svc.get().unwrap();
        assert_eq!(result, Some("".to_string()));
    }
}
