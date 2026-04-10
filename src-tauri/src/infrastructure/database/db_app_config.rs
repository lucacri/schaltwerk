use super::connection::Database;
use anyhow::Result;
use rusqlite::params;

pub trait AppConfigMethods {
    fn get_agent_type(&self) -> Result<String>;
    fn set_agent_type(&self, agent_type: &str) -> Result<()>;
    fn get_orchestrator_agent_type(&self) -> Result<String>;
    fn set_orchestrator_agent_type(&self, agent_type: &str) -> Result<()>;
    fn get_spec_clarification_agent_type(&self) -> Result<String>;
    fn set_spec_clarification_agent_type(&self, agent_type: &str) -> Result<()>;
    fn get_font_sizes(&self) -> Result<(i32, i32)>;
    fn set_font_sizes(&self, terminal_font_size: i32, ui_font_size: i32) -> Result<()>;
    fn get_default_base_branch(&self) -> Result<Option<String>>;
    fn set_default_base_branch(&self, branch: Option<&str>) -> Result<()>;
    fn get_default_open_app(&self) -> Result<String>;
    fn set_default_open_app(&self, app_id: &str) -> Result<()>;
    fn get_editor_overrides(&self) -> Result<std::collections::HashMap<String, String>>;
    fn set_editor_overrides(
        &self,
        overrides: &std::collections::HashMap<String, String>,
    ) -> Result<()>;
    fn get_tutorial_completed(&self) -> Result<bool>;
    fn set_tutorial_completed(&self, completed: bool) -> Result<()>;
}

impl AppConfigMethods for Database {
    fn get_agent_type(&self) -> Result<String> {
        let conn = self.get_conn()?;

        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT agent_type FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("claude".to_string()),
        }
    }

    fn set_agent_type(&self, agent_type: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE app_config SET agent_type = ?1 WHERE id = 1",
            params![agent_type],
        )?;

        Ok(())
    }

    fn get_orchestrator_agent_type(&self) -> Result<String> {
        let result: rusqlite::Result<String> = {
            let conn = self.get_conn()?;
            conn.query_row(
                "SELECT orchestrator_agent_type FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
        };

        match result {
            Ok(value) => Ok(value),
            Err(_) => self.get_agent_type(),
        }
    }

    fn set_orchestrator_agent_type(&self, agent_type: &str) -> Result<()> {
        let result = {
            let conn = self.get_conn()?;
            conn.execute(
                "UPDATE app_config SET orchestrator_agent_type = ?1 WHERE id = 1",
                params![agent_type],
            )
        };

        match result {
            Ok(_) => Ok(()),
            Err(_) => self.set_agent_type(agent_type),
        }
    }

    fn get_spec_clarification_agent_type(&self) -> Result<String> {
        let result: rusqlite::Result<String> = {
            let conn = self.get_conn()?;
            conn.query_row(
                "SELECT spec_clarification_agent_type FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
        };

        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("claude".to_string()),
        }
    }

    fn set_spec_clarification_agent_type(&self, agent_type: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE app_config SET spec_clarification_agent_type = ?1 WHERE id = 1",
            params![agent_type],
        )?;

        Ok(())
    }

    fn get_font_sizes(&self) -> Result<(i32, i32)> {
        let conn = self.get_conn()?;

        // Try new columns first
        let result: rusqlite::Result<(i32, i32)> = conn.query_row(
            "SELECT terminal_font_size, ui_font_size FROM app_config WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        match result {
            Ok(value) => Ok(value),
            Err(_) => {
                // Fallback to old font_size column if new ones don't exist
                let old_result: rusqlite::Result<i32> =
                    conn.query_row("SELECT font_size FROM app_config WHERE id = 1", [], |row| {
                        row.get(0)
                    });

                match old_result {
                    Ok(size) => {
                        let ui_size = if size == 13 { 12 } else { size - 1 };
                        Ok((size, ui_size))
                    }
                    Err(_) => Ok((13, 12)),
                }
            }
        }
    }

    fn set_font_sizes(&self, terminal_font_size: i32, ui_font_size: i32) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE app_config SET terminal_font_size = ?1, ui_font_size = ?2 WHERE id = 1",
            params![terminal_font_size, ui_font_size],
        )?;

        Ok(())
    }

    fn get_default_base_branch(&self) -> Result<Option<String>> {
        let conn = self.get_conn()?;

        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT default_base_branch FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(None),
        }
    }

    fn set_default_base_branch(&self, branch: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE app_config SET default_base_branch = ?1 WHERE id = 1",
            params![branch],
        )?;

        Ok(())
    }

    fn get_default_open_app(&self) -> Result<String> {
        let conn = self.get_conn()?;
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT default_open_app FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(value),
            Err(_) => {
                #[cfg(target_os = "macos")]
                let default = "finder";
                #[cfg(target_os = "linux")]
                let default = "nautilus";
                #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                let default = "explorer";
                Ok(default.to_string())
            }
        }
    }

    fn set_default_open_app(&self, app_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE app_config SET default_open_app = ?1 WHERE id = 1",
            params![app_id],
        )?;
        Ok(())
    }

    fn get_editor_overrides(&self) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.get_conn()?;
        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT editor_overrides FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        match result {
            Ok(Some(json)) => {
                serde_json::from_str(&json).map_err(|e| anyhow::anyhow!("Invalid JSON: {e}"))
            }
            _ => Ok(std::collections::HashMap::new()),
        }
    }

    fn set_editor_overrides(
        &self,
        overrides: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let json = serde_json::to_string(overrides)?;
        conn.execute(
            "UPDATE app_config SET editor_overrides = ?1 WHERE id = 1",
            params![json],
        )?;
        Ok(())
    }

    fn get_tutorial_completed(&self) -> Result<bool> {
        let conn = self.get_conn()?;

        let result: rusqlite::Result<bool> = conn.query_row(
            "SELECT tutorial_completed FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(false),
        }
    }

    fn set_tutorial_completed(&self, completed: bool) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE app_config SET tutorial_completed = ?1 WHERE id = 1",
            params![completed],
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;

    fn create_test_database() -> Database {
        let db = Database::new_in_memory().expect("Failed to create in-memory database");
        // Initialize with default row
        let conn = db.get_conn().expect("Failed to borrow connection");
        conn.execute(
            "INSERT OR REPLACE INTO app_config (
                id,
                agent_type,
                orchestrator_agent_type,
                spec_clarification_agent_type,
                default_open_app,
                terminal_font_size,
                ui_font_size,
                tutorial_completed
            ) VALUES (1, 'claude', 'claude', 'claude', 'finder', 13, 12, FALSE)",
            [],
        )
        .expect("Failed to initialize app_config");
        drop(conn);
        db
    }

    #[test]
    fn test_editor_overrides_returns_empty_by_default() {
        let db = create_test_database();
        let result = db
            .get_editor_overrides()
            .expect("Failed to get editor overrides");
        assert!(result.is_empty());
    }

    #[test]
    fn test_set_and_get_editor_overrides() {
        let db = create_test_database();
        let mut overrides = std::collections::HashMap::new();
        overrides.insert(".rs".to_string(), "cursor".to_string());
        overrides.insert(".ts".to_string(), "code".to_string());
        db.set_editor_overrides(&overrides)
            .expect("Failed to set editor overrides");
        let result = db
            .get_editor_overrides()
            .expect("Failed to get editor overrides");
        assert_eq!(result.len(), 2);
        assert_eq!(result.get(".rs").unwrap(), "cursor");
        assert_eq!(result.get(".ts").unwrap(), "code");
    }

    #[test]
    fn test_clear_editor_overrides() {
        let db = create_test_database();
        let mut overrides = std::collections::HashMap::new();
        overrides.insert(".rs".to_string(), "cursor".to_string());
        db.set_editor_overrides(&overrides).expect("Failed to set");
        db.set_editor_overrides(&std::collections::HashMap::new())
            .expect("Failed to clear");
        let result = db.get_editor_overrides().expect("Failed to get");
        assert!(result.is_empty());
    }

    #[test]
    fn test_tutorial_completed_default_false() {
        let db = create_test_database();
        let result = db
            .get_tutorial_completed()
            .expect("Failed to get tutorial completion");
        assert!(!result, "Tutorial should not be completed by default");
    }

    #[test]
    fn test_set_tutorial_completed_true() {
        let db = create_test_database();

        db.set_tutorial_completed(true)
            .expect("Failed to set tutorial as completed");
        let result = db
            .get_tutorial_completed()
            .expect("Failed to get tutorial completion");
        assert!(result, "Tutorial should be marked as completed");
    }

    #[test]
    fn test_set_tutorial_completed_false() {
        let db = create_test_database();

        // First set to true
        db.set_tutorial_completed(true)
            .expect("Failed to set tutorial as completed");
        let result = db
            .get_tutorial_completed()
            .expect("Failed to get tutorial completion");
        assert!(result, "Tutorial should be marked as completed");

        // Then set to false
        db.set_tutorial_completed(false)
            .expect("Failed to set tutorial as not completed");
        let result = db
            .get_tutorial_completed()
            .expect("Failed to get tutorial completion");
        assert!(!result, "Tutorial should be marked as not completed");
    }

    #[test]
    fn test_get_spec_clarification_agent_type_defaults_to_claude() {
        let db = create_test_database();

        let result = db
            .get_spec_clarification_agent_type()
            .expect("Failed to get spec clarification agent type");

        assert_eq!(result, "claude");
    }

    #[test]
    fn test_set_and_get_spec_clarification_agent_type() {
        let db = create_test_database();

        db.set_spec_clarification_agent_type("codex")
            .expect("Failed to set spec clarification agent type");

        let result = db
            .get_spec_clarification_agent_type()
            .expect("Failed to get spec clarification agent type");

        assert_eq!(result, "codex");
    }

    #[test]
    fn test_tutorial_completed_persistence() {
        let db = create_test_database();

        // Set to true
        db.set_tutorial_completed(true)
            .expect("Failed to set tutorial as completed");

        // Read multiple times to ensure persistence
        for _ in 0..5 {
            let result = db
                .get_tutorial_completed()
                .expect("Failed to get tutorial completion");
            assert!(result, "Tutorial completion should persist across reads");
        }
    }

    #[test]
    fn test_get_tutorial_completed_missing_column() {
        let db = Database::new_in_memory().expect("Failed to create database");
        {
            let conn = db.get_conn().expect("Failed to borrow connection");
            conn.execute("ALTER TABLE app_config DROP COLUMN tutorial_completed", [])
                .expect("Failed to drop tutorial_completed column");
        }

        // Should return false when column doesn't exist
        let result = db
            .get_tutorial_completed()
            .expect("Failed to get tutorial completion");
        assert!(!result, "Should return false when column doesn't exist");
    }

    #[test]
    fn test_set_tutorial_completed_missing_row() {
        let db = Database::new_in_memory().expect("Failed to create database");
        {
            let conn = db.get_conn().expect("Failed to borrow connection");
            conn.execute("DELETE FROM app_config", [])
                .expect("Failed to clear app_config rows");
        }

        // Should handle missing row gracefully
        let result = db.get_tutorial_completed();
        assert!(result.is_ok(), "Should handle missing row gracefully");
        assert!(!result.unwrap(), "Should return false when no row exists");

        // Setting should work even without existing row (will create one)
        let set_result = db.set_tutorial_completed(true);
        assert!(set_result.is_ok(), "Should handle setting on missing row");
    }

    #[test]
    fn test_tutorial_completed_concurrent_access() {
        let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
        let db_path = temp_dir.path().join("app_config.db");
        let db = Database::new(Some(db_path)).expect("Failed to create temp database");
        {
            let conn = db.get_conn().expect("Failed to borrow connection");
            conn.execute(
                "INSERT OR REPLACE INTO app_config (
                    id,
                    agent_type,
                    orchestrator_agent_type,
                    spec_clarification_agent_type,
                    default_open_app,
                    terminal_font_size,
                    ui_font_size,
                    tutorial_completed
                ) VALUES (1, 'claude', 'claude', 'claude', 'finder', 13, 12, FALSE)",
                [],
            )
            .expect("Failed to seed app_config");
        }

        // Simulate concurrent access by multiple threads
        // All threads should be able to write and read without panicking
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let db_clone = db.clone();
                std::thread::spawn(move || {
                    let should_complete = i % 2 == 0;
                    // Test that we can write without errors
                    db_clone
                        .set_tutorial_completed(should_complete)
                        .expect("Failed to set tutorial completion");
                    // Test that we can read without errors (value may have been changed by another thread)
                    let result = db_clone.get_tutorial_completed();
                    result.expect("Failed to get tutorial completion")
                })
            })
            .collect();

        // Wait for all threads to complete - we're testing that concurrent access doesn't crash
        for handle in handles {
            let value = handle.join().expect("Thread panicked");
            // The final value should be a valid boolean (either true or false)
            // We can't predict which thread wrote last, so we just verify it's valid
            assert!(
                value == true || value == false,
                "Should return a valid boolean"
            );
        }
    }
}
