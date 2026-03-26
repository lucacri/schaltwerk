use anyhow::Result;
use rusqlite::params;
use std::path::{Path, PathBuf};

use crate::domains::sessions::entity::ArchivedSpec;
use crate::infrastructure::database::timestamps::utc_from_epoch_millis_lossy;
use crate::schaltwerk_core::database::Database;

pub trait ArchivedSpecMethods {
    fn insert_archived_spec(&self, spec: &ArchivedSpec) -> Result<()>;
    fn list_archived_specs(&self, repo_path: &Path) -> Result<Vec<ArchivedSpec>>;
    fn delete_archived_spec(&self, id: &str) -> Result<()>;
    fn get_archive_max_entries(&self) -> Result<i32>;
    fn set_archive_max_entries(&self, limit: i32) -> Result<()>;
    fn enforce_archive_limit(&self, repo_path: &Path) -> Result<()>;
}

impl ArchivedSpecMethods for Database {
    fn insert_archived_spec(&self, spec: &ArchivedSpec) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO archived_specs (id, session_name, repository_path, repository_name, content, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                spec.id,
                spec.session_name,
                spec.repository_path.to_string_lossy(),
                spec.repository_name,
                spec.content,
                spec.archived_at.timestamp_millis(),
            ],
        )?;
        Ok(())
    }

    fn list_archived_specs(&self, repo_path: &Path) -> Result<Vec<ArchivedSpec>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_name, repository_path, repository_name, content, archived_at \
             FROM archived_specs \
             WHERE repository_path = ?1 \
             ORDER BY archived_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], |row| {
            Ok(ArchivedSpec {
                id: row.get(0)?,
                session_name: row.get(1)?,
                repository_path: PathBuf::from(row.get::<_, String>(2)?),
                repository_name: row.get(3)?,
                content: row.get(4)?,
                archived_at: {
                    let ms: i64 = row.get(5)?;
                    utc_from_epoch_millis_lossy(ms)
                },
            })
        })?;
        let mut specs = Vec::new();
        for s in rows {
            specs.push(s?);
        }
        Ok(specs)
    }

    fn delete_archived_spec(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM archived_specs WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn get_archive_max_entries(&self) -> Result<i32> {
        let conn = self.get_conn()?;
        let result: rusqlite::Result<i32> = conn.query_row(
            "SELECT archive_max_entries FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        Ok(result.unwrap_or(50))
    }

    fn set_archive_max_entries(&self, limit: i32) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE app_config SET archive_max_entries = ?1 WHERE id = 1",
            params![limit],
        )?;
        Ok(())
    }

    fn enforce_archive_limit(&self, repo_path: &Path) -> Result<()> {
        let conn = self.get_conn()?;

        // Read configured max entries (fallback to 50 if missing)
        let max_entries: i64 = conn
            .query_row(
                "SELECT archive_max_entries FROM app_config WHERE id = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(50);

        // Count current entries for this repository
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM archived_specs WHERE repository_path = ?1",
            params![repo_path.to_string_lossy()],
            |row| row.get(0),
        )?;

        if count > max_entries {
            // Delete oldest entries beyond the limit
            let to_delete = count - max_entries;
            conn.execute(
                "DELETE FROM archived_specs \
                 WHERE rowid IN (
                   SELECT rowid FROM archived_specs \
                   WHERE repository_path = ?1 \
                   ORDER BY archived_at ASC, rowid ASC \
                   LIMIT ?2
                 )",
                params![repo_path.to_string_lossy(), to_delete],
            )?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;
    use chrono::{Duration, Utc};

    fn create_test_database() -> Database {
        let db = Database::new_in_memory().expect("Failed to create in-memory database");
        let conn = db.get_conn().expect("Failed to borrow connection");
        conn.execute(
            "INSERT OR REPLACE INTO app_config (
                id, skip_permissions, agent_type,
                orchestrator_skip_permissions, orchestrator_agent_type,
                default_open_app, terminal_font_size, ui_font_size,
                tutorial_completed, archive_max_entries
            ) VALUES (1, FALSE, 'claude', FALSE, 'claude', 'finder', 13, 12, FALSE, 50)",
            [],
        )
        .expect("Failed to initialize app_config");
        drop(conn);
        db
    }

    fn make_archived_spec(
        id: &str,
        session_name: &str,
        repo_path: &str,
        archived_at: chrono::DateTime<Utc>,
    ) -> ArchivedSpec {
        ArchivedSpec {
            id: id.to_string(),
            session_name: session_name.to_string(),
            repository_path: PathBuf::from(repo_path),
            repository_name: "test-repo".to_string(),
            content: format!("content for {id}"),
            archived_at,
        }
    }

    #[test]
    fn insert_and_list_archived_spec() {
        let db = create_test_database();
        let now = Utc::now();
        let spec = make_archived_spec("a1", "session-1", "/repo", now);

        db.insert_archived_spec(&spec).unwrap();

        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].id, "a1");
        assert_eq!(specs[0].session_name, "session-1");
        assert_eq!(specs[0].content, "content for a1");
    }

    #[test]
    fn list_archived_specs_empty() {
        let db = create_test_database();
        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert!(specs.is_empty());
    }

    #[test]
    fn list_archived_specs_filters_by_repo() {
        let db = create_test_database();
        let now = Utc::now();
        db.insert_archived_spec(&make_archived_spec("a1", "s1", "/repo-a", now))
            .unwrap();
        db.insert_archived_spec(&make_archived_spec("a2", "s2", "/repo-b", now))
            .unwrap();

        let specs = db.list_archived_specs(Path::new("/repo-a")).unwrap();
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].id, "a1");
    }

    #[test]
    fn list_archived_specs_ordered_by_archived_at_desc() {
        let db = create_test_database();
        let now = Utc::now();
        let older = now - Duration::hours(1);

        db.insert_archived_spec(&make_archived_spec("a1", "s1", "/repo", older))
            .unwrap();
        db.insert_archived_spec(&make_archived_spec("a2", "s2", "/repo", now))
            .unwrap();

        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert_eq!(specs[0].id, "a2");
        assert_eq!(specs[1].id, "a1");
    }

    #[test]
    fn delete_archived_spec() {
        let db = create_test_database();
        let now = Utc::now();
        db.insert_archived_spec(&make_archived_spec("a1", "s1", "/repo", now))
            .unwrap();

        db.delete_archived_spec("a1").unwrap();

        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert!(specs.is_empty());
    }

    #[test]
    fn get_archive_max_entries_default() {
        let db = create_test_database();
        let max = db.get_archive_max_entries().unwrap();
        assert_eq!(max, 50);
    }

    #[test]
    fn set_and_get_archive_max_entries() {
        let db = create_test_database();
        db.set_archive_max_entries(10).unwrap();
        assert_eq!(db.get_archive_max_entries().unwrap(), 10);
    }

    #[test]
    fn enforce_archive_limit_removes_oldest() {
        let db = create_test_database();
        db.set_archive_max_entries(2).unwrap();

        let now = Utc::now();
        for i in 0..5 {
            let ts = now - Duration::hours(5 - i);
            db.insert_archived_spec(&make_archived_spec(
                &format!("a{i}"),
                &format!("s{i}"),
                "/repo",
                ts,
            ))
            .unwrap();
        }

        db.enforce_archive_limit(Path::new("/repo")).unwrap();

        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].id, "a4");
        assert_eq!(specs[1].id, "a3");
    }

    #[test]
    fn enforce_archive_limit_no_op_when_under_limit() {
        let db = create_test_database();
        db.set_archive_max_entries(10).unwrap();

        let now = Utc::now();
        db.insert_archived_spec(&make_archived_spec("a1", "s1", "/repo", now))
            .unwrap();

        db.enforce_archive_limit(Path::new("/repo")).unwrap();

        let specs = db.list_archived_specs(Path::new("/repo")).unwrap();
        assert_eq!(specs.len(), 1);
    }

    #[test]
    fn enforce_archive_limit_only_affects_target_repo() {
        let db = create_test_database();
        db.set_archive_max_entries(1).unwrap();

        let now = Utc::now();
        db.insert_archived_spec(&make_archived_spec(
            "a1",
            "s1",
            "/repo-a",
            now - Duration::hours(2),
        ))
        .unwrap();
        db.insert_archived_spec(&make_archived_spec("a2", "s2", "/repo-a", now))
            .unwrap();
        db.insert_archived_spec(&make_archived_spec("a3", "s3", "/repo-b", now))
            .unwrap();

        db.enforce_archive_limit(Path::new("/repo-a")).unwrap();

        let a_specs = db.list_archived_specs(Path::new("/repo-a")).unwrap();
        assert_eq!(a_specs.len(), 1);
        assert_eq!(a_specs[0].id, "a2");

        let b_specs = db.list_archived_specs(Path::new("/repo-b")).unwrap();
        assert_eq!(b_specs.len(), 1);
    }
}
