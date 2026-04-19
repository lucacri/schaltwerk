use super::connection::Database;
use crate::domains::sessions::entity::Epic;
use anyhow::Result;
use chrono::Utc;
use rusqlite::{Row, params};
use std::path::Path;

pub trait EpicMethods {
    fn create_epic(&self, repo_path: &Path, epic: &Epic) -> Result<()>;
    fn list_epics(&self, repo_path: &Path) -> Result<Vec<Epic>>;
    fn get_epic_by_id(&self, repo_path: &Path, id: &str) -> Result<Epic>;
    fn get_epic_by_name(&self, repo_path: &Path, name: &str) -> Result<Epic>;
    fn update_epic(
        &self,
        repo_path: &Path,
        id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<()>;
    fn clear_epic_assignments(&self, repo_path: &Path, id: &str) -> Result<()>;
    fn delete_epic(&self, repo_path: &Path, id: &str) -> Result<()>;
}

impl EpicMethods for Database {
    fn create_epic(&self, repo_path: &Path, epic: &Epic) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO epics (id, repository_path, name, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                epic.id,
                repo_path.to_string_lossy(),
                epic.name,
                epic.color,
                now,
                now,
            ],
        )?;
        Ok(())
    }

    fn list_epics(&self, repo_path: &Path) -> Result<Vec<Epic>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1
             ORDER BY name ASC, updated_at DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], row_to_epic)?;
        let mut epics = Vec::new();
        for row in rows {
            epics.push(row?);
        }
        Ok(epics)
    }

    fn get_epic_by_id(&self, repo_path: &Path, id: &str) -> Result<Epic> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1 AND id = ?2",
        )?;
        Ok(stmt.query_row(params![repo_path.to_string_lossy(), id], row_to_epic)?)
    }

    fn get_epic_by_name(&self, repo_path: &Path, name: &str) -> Result<Epic> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, updated_at
             FROM epics
             WHERE repository_path = ?1 AND name = ?2",
        )?;
        Ok(stmt.query_row(params![repo_path.to_string_lossy(), name], row_to_epic)?)
    }

    fn update_epic(
        &self,
        repo_path: &Path,
        id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE epics
             SET name = ?1, color = ?2, updated_at = ?3
             WHERE repository_path = ?4 AND id = ?5",
            params![
                name,
                color,
                Utc::now().timestamp(),
                repo_path.to_string_lossy(),
                id
            ],
        )?;
        Ok(())
    }

    fn clear_epic_assignments(&self, repo_path: &Path, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET epic_id = NULL, updated_at = ?1 WHERE repository_path = ?2 AND epic_id = ?3",
            params![Utc::now().timestamp(), repo_path.to_string_lossy(), id],
        )?;
        conn.execute(
            "UPDATE specs SET epic_id = NULL, updated_at = ?1 WHERE repository_path = ?2 AND epic_id = ?3",
            params![Utc::now().timestamp(), repo_path.to_string_lossy(), id],
        )?;
        Ok(())
    }

    fn delete_epic(&self, repo_path: &Path, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM epics WHERE repository_path = ?1 AND id = ?2",
            params![repo_path.to_string_lossy(), id],
        )?;
        Ok(())
    }
}

fn row_to_epic(row: &Row<'_>) -> rusqlite::Result<Epic> {
    Ok(Epic {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;
    use crate::infrastructure::database::db_specs::SpecMethods;
    use std::path::{Path, PathBuf};

    fn create_test_database() -> Database {
        Database::new_in_memory().expect("Failed to create in-memory database")
    }

    fn make_epic(id: &str, name: &str, color: Option<&str>) -> Epic {
        Epic {
            id: id.to_string(),
            name: name.to_string(),
            color: color.map(|c| c.to_string()),
        }
    }

    #[test]
    fn create_and_list_epic() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        let epic = make_epic("e1", "Feature Work", Some("#ff0000"));

        db.create_epic(repo, &epic).unwrap();

        let epics = db.list_epics(repo).unwrap();
        assert_eq!(epics.len(), 1);
        assert_eq!(epics[0].id, "e1");
        assert_eq!(epics[0].name, "Feature Work");
        assert_eq!(epics[0].color, Some("#ff0000".to_string()));
    }

    #[test]
    fn list_epics_empty() {
        let db = create_test_database();
        let epics = db.list_epics(Path::new("/repo")).unwrap();
        assert!(epics.is_empty());
    }

    #[test]
    fn list_epics_filters_by_repo() {
        let db = create_test_database();
        db.create_epic(Path::new("/repo-a"), &make_epic("e1", "Epic A", None))
            .unwrap();
        db.create_epic(Path::new("/repo-b"), &make_epic("e2", "Epic B", None))
            .unwrap();

        let epics = db.list_epics(Path::new("/repo-a")).unwrap();
        assert_eq!(epics.len(), 1);
        assert_eq!(epics[0].id, "e1");
    }

    #[test]
    fn get_epic_by_id() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "My Epic", Some("#00ff00")))
            .unwrap();

        let epic = db.get_epic_by_id(repo, "e1").unwrap();
        assert_eq!(epic.name, "My Epic");
        assert_eq!(epic.color, Some("#00ff00".to_string()));
    }

    #[test]
    fn get_epic_by_id_not_found() {
        let db = create_test_database();
        let result = db.get_epic_by_id(Path::new("/repo"), "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn get_epic_by_name() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "Named Epic", None))
            .unwrap();

        let epic = db.get_epic_by_name(repo, "Named Epic").unwrap();
        assert_eq!(epic.id, "e1");
    }

    #[test]
    fn get_epic_by_name_not_found() {
        let db = create_test_database();
        let result = db.get_epic_by_name(Path::new("/repo"), "missing");
        assert!(result.is_err());
    }

    #[test]
    fn update_epic() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "Old Name", None))
            .unwrap();

        db.update_epic(repo, "e1", "New Name", Some("#0000ff"))
            .unwrap();

        let epic = db.get_epic_by_id(repo, "e1").unwrap();
        assert_eq!(epic.name, "New Name");
        assert_eq!(epic.color, Some("#0000ff".to_string()));
    }

    #[test]
    fn update_epic_remove_color() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "Colored", Some("#ff0000")))
            .unwrap();

        db.update_epic(repo, "e1", "Colored", None).unwrap();

        let epic = db.get_epic_by_id(repo, "e1").unwrap();
        assert_eq!(epic.color, None);
    }

    #[test]
    fn delete_epic() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "To Delete", None))
            .unwrap();

        db.delete_epic(repo, "e1").unwrap();

        let epics = db.list_epics(repo).unwrap();
        assert!(epics.is_empty());
    }

    #[test]
    fn clear_epic_assignments_clears_specs() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "Epic", None))
            .unwrap();

        let now = chrono::Utc::now();
        let spec = crate::domains::sessions::entity::Spec {
            id: "s1".to_string(),
            name: "spec-1".to_string(),
            display_name: None,
            epic_id: Some("e1".to_string()),
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".to_string(),
            content: "content".to_string(),
            implementation_plan: None,
            stage: crate::domains::sessions::entity::SpecStage::Draft,
            attention_required: false,
            clarification_started: false,
            created_at: now,
            updated_at: now,
        };
        db.create_spec(&spec).unwrap();

        db.clear_epic_assignments(repo, "e1").unwrap();

        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.epic_id, None);
    }

    #[test]
    fn duplicate_name_same_repo_fails() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e1", "Dup", None)).unwrap();
        let result = db.create_epic(repo, &make_epic("e2", "Dup", None));
        assert!(result.is_err());
    }

    #[test]
    fn same_name_different_repo_ok() {
        let db = create_test_database();
        db.create_epic(Path::new("/repo-a"), &make_epic("e1", "Same", None))
            .unwrap();
        db.create_epic(Path::new("/repo-b"), &make_epic("e2", "Same", None))
            .unwrap();

        let a = db.get_epic_by_name(Path::new("/repo-a"), "Same").unwrap();
        let b = db.get_epic_by_name(Path::new("/repo-b"), "Same").unwrap();
        assert_eq!(a.id, "e1");
        assert_eq!(b.id, "e2");
    }

    #[test]
    fn list_epics_ordered_by_name() {
        let db = create_test_database();
        let repo = Path::new("/repo");
        db.create_epic(repo, &make_epic("e2", "Zeta", None))
            .unwrap();
        db.create_epic(repo, &make_epic("e1", "Alpha", None))
            .unwrap();

        let epics = db.list_epics(repo).unwrap();
        assert_eq!(epics[0].name, "Alpha");
        assert_eq!(epics[1].name, "Zeta");
    }
}
