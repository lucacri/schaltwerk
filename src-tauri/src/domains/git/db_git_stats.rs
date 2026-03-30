use crate::domains::sessions::entity::GitStats;
use crate::infrastructure::database::timestamps::utc_from_epoch_seconds_lossy;
use crate::infrastructure::database::Database;
use anyhow::Result;
use chrono::Utc;
use rusqlite::params;

pub trait GitStatsMethods {
    fn save_git_stats(&self, stats: &GitStats) -> Result<()>;
    fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>>;
    fn get_all_git_stats(&self) -> Result<Vec<GitStats>>;
    fn get_git_stats_bulk(&self, session_ids: &[String]) -> Result<Vec<GitStats>>;
    fn should_update_stats(&self, session_id: &str) -> Result<bool>;
}

impl GitStatsMethods for Database {
    fn save_git_stats(&self, stats: &GitStats) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "INSERT OR REPLACE INTO git_stats
             (session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at, has_conflicts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                stats.session_id,
                stats.files_changed,
                stats.lines_added,
                stats.lines_removed,
                stats.has_uncommitted,
                stats.calculated_at.timestamp(),
                stats.has_conflicts,
            ],
        )?;

        Ok(())
    }

    fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at, has_conflicts
             FROM git_stats WHERE session_id = ?1",
        )?;
        let result: rusqlite::Result<GitStats> = stmt.query_row(params![session_id], |row| {
            Ok(GitStats {
                session_id: row.get(0)?,
                files_changed: row.get(1)?,
                lines_added: row.get(2)?,
                lines_removed: row.get(3)?,
                has_uncommitted: row.get(4)?,
                calculated_at: utc_from_epoch_seconds_lossy(row.get(5)?),
                last_diff_change_ts: None,
                has_conflicts: row.get(6)?,
            })
        });
        match result {
            Ok(stats) => Ok(Some(stats)),
            Err(_) => Ok(None),
        }
    }

    fn get_all_git_stats(&self) -> Result<Vec<GitStats>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at, has_conflicts
             FROM git_stats",
        )?;
        let stats_iter = stmt.query_map([], |row| {
            Ok(GitStats {
                session_id: row.get(0)?,
                files_changed: row.get(1)?,
                lines_added: row.get(2)?,
                lines_removed: row.get(3)?,
                has_uncommitted: row.get(4)?,
                calculated_at: utc_from_epoch_seconds_lossy(row.get(5)?),
                last_diff_change_ts: None,
                has_conflicts: row.get(6)?,
            })
        })?;

        let mut results = Vec::new();
        for stat in stats_iter {
            results.push(stat?);
        }
        Ok(results)
    }

    fn get_git_stats_bulk(&self, session_ids: &[String]) -> Result<Vec<GitStats>> {
        if session_ids.is_empty() {
            return Ok(Vec::new());
        }

        log::debug!(
            "db_git_stats::get_git_stats_bulk start count={}",
            session_ids.len()
        );

        let conn = self.get_conn()?;
        let placeholders = session_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "SELECT session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at, has_conflicts
             FROM git_stats WHERE session_id IN ({placeholders})"
        );

        let mut stmt = conn.prepare(&query)?;
        let params: Vec<&dyn rusqlite::ToSql> = session_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();

        let stats_iter = stmt.query_map(params.as_slice(), |row| {
            Ok(GitStats {
                session_id: row.get(0)?,
                files_changed: row.get(1)?,
                lines_added: row.get(2)?,
                lines_removed: row.get(3)?,
                has_uncommitted: row.get(4)?,
                calculated_at: utc_from_epoch_seconds_lossy(row.get(5)?),
                last_diff_change_ts: None,
                has_conflicts: row.get(6)?,
            })
        })?;

        let mut results = Vec::new();
        for stat in stats_iter {
            results.push(stat?);
        }

        log::debug!(
            "db_git_stats::get_git_stats_bulk done count={}",
            results.len()
        );
        Ok(results)
    }

    fn should_update_stats(&self, session_id: &str) -> Result<bool> {
        let conn = self.get_conn()?;

        let result: rusqlite::Result<i64> = conn.query_row(
            "SELECT calculated_at FROM git_stats WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        );

        match result {
            Ok(last_calculated) => {
                let now = Utc::now().timestamp();
                Ok(now - last_calculated > 60)
            }
            Err(_) => Ok(true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn test_db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn insert_session(db: &Database, session_id: &str) {
        let conn = db.get_conn().unwrap();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at)
             VALUES (?1, ?1, '/tmp', 'test', 'main', 'main', '/tmp/wt', 'active', 'running', ?2, ?2)",
            params![session_id, now],
        ).unwrap();
    }

    fn make_stats(session_id: &str) -> GitStats {
        GitStats {
            session_id: session_id.to_string(),
            files_changed: 5,
            lines_added: 100,
            lines_removed: 20,
            has_uncommitted: true,
            has_conflicts: false,
            calculated_at: Utc::now(),
            last_diff_change_ts: None,
        }
    }

    #[test]
    fn save_and_get_git_stats() {
        let db = test_db();
        insert_session(&db, "session-1");
        let stats = make_stats("session-1");

        db.save_git_stats(&stats).unwrap();
        let loaded = db.get_git_stats("session-1").unwrap();

        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.files_changed, 5);
        assert_eq!(loaded.lines_added, 100);
        assert_eq!(loaded.lines_removed, 20);
        assert!(loaded.has_uncommitted);
    }

    #[test]
    fn get_git_stats_returns_none_for_missing() {
        let db = test_db();
        let loaded = db.get_git_stats("nonexistent").unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn save_git_stats_upserts() {
        let db = test_db();
        insert_session(&db, "session-up");
        let mut stats = make_stats("session-up");
        db.save_git_stats(&stats).unwrap();

        stats.files_changed = 10;
        stats.lines_added = 200;
        db.save_git_stats(&stats).unwrap();

        let loaded = db.get_git_stats("session-up").unwrap().unwrap();
        assert_eq!(loaded.files_changed, 10);
        assert_eq!(loaded.lines_added, 200);
    }

    #[test]
    fn get_all_git_stats_returns_all_entries() {
        let db = test_db();
        for id in &["s1", "s2", "s3"] {
            insert_session(&db, id);
        }
        db.save_git_stats(&make_stats("s1")).unwrap();
        db.save_git_stats(&make_stats("s2")).unwrap();
        db.save_git_stats(&make_stats("s3")).unwrap();

        let all = db.get_all_git_stats().unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn get_git_stats_bulk_filters_by_ids() {
        let db = test_db();
        for id in &["a", "b", "c"] {
            insert_session(&db, id);
        }
        db.save_git_stats(&make_stats("a")).unwrap();
        db.save_git_stats(&make_stats("b")).unwrap();
        db.save_git_stats(&make_stats("c")).unwrap();

        let ids = vec!["a".to_string(), "c".to_string()];
        let bulk = db.get_git_stats_bulk(&ids).unwrap();
        assert_eq!(bulk.len(), 2);

        let session_ids: Vec<&str> = bulk.iter().map(|s| s.session_id.as_str()).collect();
        assert!(session_ids.contains(&"a"));
        assert!(session_ids.contains(&"c"));
    }

    #[test]
    fn get_git_stats_bulk_empty_input() {
        let db = test_db();
        let bulk = db.get_git_stats_bulk(&[]).unwrap();
        assert!(bulk.is_empty());
    }

    #[test]
    fn should_update_stats_true_for_missing() {
        let db = test_db();
        assert!(db.should_update_stats("new-session").unwrap());
    }

    #[test]
    fn should_update_stats_false_for_recent() {
        let db = test_db();
        insert_session(&db, "fresh");
        let stats = make_stats("fresh");
        db.save_git_stats(&stats).unwrap();

        assert!(!db.should_update_stats("fresh").unwrap());
    }

    #[test]
    fn should_update_stats_true_for_stale() {
        let db = test_db();
        insert_session(&db, "stale");
        let stats = GitStats {
            session_id: "stale".to_string(),
            files_changed: 1,
            lines_added: 1,
            lines_removed: 0,
            has_uncommitted: false,
            has_conflicts: false,
            calculated_at: Utc.timestamp_opt(Utc::now().timestamp() - 120, 0).unwrap(),
            last_diff_change_ts: None,
        };
        db.save_git_stats(&stats).unwrap();

        assert!(db.should_update_stats("stale").unwrap());
    }
}
