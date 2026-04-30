//! Phase 3 Wave D.4: drop the legacy `sessions.task_role` column.
//!
//! Phase 1 Wave I.8 backfilled `sessions.run_role` from `task_role`
//! (`db_schema.rs:951`), so by the time this migration runs every
//! interesting role string already lives in `run_role`. Phase 3 deletes
//! the `Session.task_role: Option<String>` field; this migration removes
//! the matching SQL column.
//!
//! `Session.run_role` (the persisted role string) is intentionally kept
//! — orchestration's `SessionTaskLineage` and `find_session_for_task_run`
//! still read it. A future phase may consolidate it further; Phase 3 only
//! retires the duplicate.
//!
//! Idempotent: if `sessions.task_role` no longer exists, the migration
//! returns immediately. Re-runs against an already-migrated DB are
//! cheap no-ops.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Run the migration if the legacy `sessions.task_role` column is
/// present. No-op on v2-native DBs (column already gone).
pub fn run(conn: &Connection) -> Result<()> {
    if !has_task_role_column(conn)? {
        return Ok(());
    }

    archive_sessions(conn).context("archive sessions to sessions_v1_role_archive")?;
    drop_task_role_via_rebuild(conn).context("drop task_role column via table rebuild")?;
    recreate_indexes_after_rebuild(conn).context("recreate indexes after table rebuild")?;

    Ok(())
}

fn has_task_role_column(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'task_role'",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Phase 0 backup pattern. The `_v1_role_archive` suffix marks this
/// table as keep-forever forensics — the archive captures the legacy
/// `task_role` values per session id so a future scout-rule cleanup
/// (or a panic recovery) can replay them.
fn archive_sessions(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions_v1_role_archive AS
            SELECT id, name, repository_path, task_role, run_role, slot_key
            FROM sessions",
        [],
    )?;
    Ok(())
}

/// SQLite has no native `ALTER TABLE DROP COLUMN` on the version we
/// ship. Standard rebuild dance: build a new table without `task_role`,
/// copy every other column 1:1, drop old, rename new. Inside one
/// transaction so a partial failure leaves `sessions` intact.
///
/// This rebuild copies the v2 column set as it exists post-Phase-2:
/// the original v1 columns plus Phase-1's task-lineage columns
/// (task_run_id, run_role, slot_key, exited_at, exit_code,
/// first_idle_at) and Phase-3's identity-axis additions
/// (is_spec, cancelled_at).
fn drop_task_role_via_rebuild(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "BEGIN;
         CREATE TABLE sessions_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            version_group_id TEXT,
            version_number INTEGER,
            epic_id TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            branch TEXT NOT NULL,
            parent_branch TEXT NOT NULL,
            original_parent_branch TEXT,
            worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,
            session_state TEXT DEFAULT 'running',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_activity INTEGER,
            initial_prompt TEXT,
            ready_to_merge BOOLEAN DEFAULT FALSE,
            original_agent_type TEXT,
            original_agent_model TEXT,
            pending_name_generation BOOLEAN DEFAULT FALSE,
            was_auto_generated BOOLEAN DEFAULT FALSE,
            spec_content TEXT,
            resume_allowed BOOLEAN DEFAULT TRUE,
            amp_thread_id TEXT,
            issue_number INTEGER,
            issue_url TEXT,
            pr_number INTEGER,
            pr_url TEXT,
            pr_state TEXT,
            is_consolidation INTEGER NOT NULL DEFAULT 0,
            consolidation_sources TEXT,
            consolidation_round_id TEXT,
            consolidation_role TEXT,
            consolidation_report TEXT,
            consolidation_report_source TEXT,
            consolidation_base_session_id TEXT,
            consolidation_recommended_session_id TEXT,
            consolidation_confirmation_mode TEXT,
            promotion_reason TEXT,
            ci_autofix_enabled BOOLEAN DEFAULT FALSE,
            merged_at INTEGER,
            stage TEXT,
            task_id TEXT,
            task_stage TEXT,
            task_run_id TEXT,
            run_role TEXT,
            slot_key TEXT,
            exited_at INTEGER,
            exit_code INTEGER,
            first_idle_at INTEGER,
            is_spec INTEGER NOT NULL DEFAULT 0,
            cancelled_at INTEGER,
            UNIQUE(repository_path, name)
         );
         INSERT INTO sessions_new (
            id, name, display_name, version_group_id, version_number, epic_id,
            repository_path, repository_name, branch, parent_branch,
            original_parent_branch, worktree_path,
            status, session_state, created_at, updated_at, last_activity,
            initial_prompt, ready_to_merge,
            original_agent_type, original_agent_model,
            pending_name_generation, was_auto_generated, spec_content,
            resume_allowed, amp_thread_id,
            issue_number, issue_url, pr_number, pr_url, pr_state,
            is_consolidation, consolidation_sources,
            consolidation_round_id, consolidation_role,
            consolidation_report, consolidation_report_source,
            consolidation_base_session_id,
            consolidation_recommended_session_id,
            consolidation_confirmation_mode, promotion_reason,
            ci_autofix_enabled, merged_at, stage,
            task_id, task_stage,
            task_run_id, run_role, slot_key,
            exited_at, exit_code, first_idle_at,
            is_spec, cancelled_at
         )
         SELECT
            id, name, display_name, version_group_id, version_number, epic_id,
            repository_path, repository_name, branch, parent_branch,
            original_parent_branch, worktree_path,
            status, session_state, created_at, updated_at, last_activity,
            initial_prompt, ready_to_merge,
            original_agent_type, original_agent_model,
            pending_name_generation, was_auto_generated, spec_content,
            resume_allowed, amp_thread_id,
            issue_number, issue_url, pr_number, pr_url, pr_state,
            is_consolidation, consolidation_sources,
            consolidation_round_id, consolidation_role,
            consolidation_report, consolidation_report_source,
            consolidation_base_session_id,
            consolidation_recommended_session_id,
            consolidation_confirmation_mode, promotion_reason,
            ci_autofix_enabled, merged_at, stage,
            task_id, task_stage,
            task_run_id, run_role, slot_key,
            exited_at, exit_code, first_idle_at,
            is_spec, cancelled_at
         FROM sessions;
         DROP TABLE sessions;
         ALTER TABLE sessions_new RENAME TO sessions;
         COMMIT;",
    )?;
    Ok(())
}

fn recreate_indexes_after_rebuild(conn: &Connection) -> Result<()> {
    let indexes = [
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repository_path)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_order ON sessions(repository_path, ready_to_merge, last_activity DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_status_order ON sessions(status, ready_to_merge, last_activity DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_status ON sessions(repository_path, status)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_task_run ON sessions(task_run_id)",
    ];
    for sql in indexes {
        conn.execute(sql, [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pragma_columns(conn: &Connection, table: &str) -> Vec<String> {
        let pragma = format!("PRAGMA table_info('{table}')");
        let mut stmt = conn.prepare(&pragma).unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                [name],
                |r| r.get(0),
            )
            .unwrap();
        count == 1
    }

    /// Build a v1-shaped sessions table — task_role column present —
    /// with the post-Phase-2 column set so the rebuild dance has all
    /// the columns it needs to copy. Mimics the real call sequence
    /// where apply_sessions_migrations adds the new columns
    /// idempotently before this migration fires.
    fn make_v1_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                version_group_id TEXT,
                version_number INTEGER,
                epic_id TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                original_parent_branch TEXT,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                session_state TEXT DEFAULT 'running',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_activity INTEGER,
                initial_prompt TEXT,
                ready_to_merge BOOLEAN DEFAULT FALSE,
                original_agent_type TEXT,
                original_agent_model TEXT,
                pending_name_generation BOOLEAN DEFAULT FALSE,
                was_auto_generated BOOLEAN DEFAULT FALSE,
                spec_content TEXT,
                resume_allowed BOOLEAN DEFAULT TRUE,
                amp_thread_id TEXT,
                issue_number INTEGER,
                issue_url TEXT,
                pr_number INTEGER,
                pr_url TEXT,
                pr_state TEXT,
                is_consolidation INTEGER NOT NULL DEFAULT 0,
                consolidation_sources TEXT,
                consolidation_round_id TEXT,
                consolidation_role TEXT,
                consolidation_report TEXT,
                consolidation_report_source TEXT,
                consolidation_base_session_id TEXT,
                consolidation_recommended_session_id TEXT,
                consolidation_confirmation_mode TEXT,
                promotion_reason TEXT,
                ci_autofix_enabled BOOLEAN DEFAULT FALSE,
                merged_at INTEGER,
                stage TEXT,
                task_id TEXT,
                task_stage TEXT,
                task_role TEXT,
                task_run_id TEXT,
                run_role TEXT,
                slot_key TEXT,
                exited_at INTEGER,
                exit_code INTEGER,
                first_idle_at INTEGER,
                is_spec INTEGER NOT NULL DEFAULT 0,
                cancelled_at INTEGER,
                UNIQUE(repository_path, name)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn noop_on_v2_native_db_without_task_role() {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, run_role TEXT)",
            [],
        )
        .unwrap();
        run(&conn).expect("first call");
        run(&conn).expect("second call must be no-op");
        let cols = pragma_columns(&conn, "sessions");
        assert!(cols.contains(&"run_role".to_string()));
        assert!(!cols.contains(&"task_role".to_string()));
        assert!(!table_exists(&conn, "sessions_v1_role_archive"));
    }

    #[test]
    fn task_role_column_is_dropped_after_migration() {
        let conn = make_v1_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, task_role, run_role, slot_key)
             VALUES ('s1', 'session-1', '/repo', 'repo', 'b', 'p', '/wt', 'active', 1, 1, 'candidate', 'candidate', 'claude-0')",
            [],
        ).unwrap();

        run(&conn).expect("migration");

        let cols = pragma_columns(&conn, "sessions");
        assert!(
            !cols.contains(&"task_role".to_string()),
            "task_role must be dropped; cols = {cols:?}"
        );
        assert!(
            cols.contains(&"run_role".to_string()),
            "run_role must survive; cols = {cols:?}"
        );
    }

    #[test]
    fn run_role_value_is_preserved_through_rebuild() {
        let conn = make_v1_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, task_role, run_role, slot_key)
             VALUES ('s1', 'session-1', '/repo', 'repo', 'b', 'p', '/wt', 'active', 1, 1, 'candidate', 'candidate', 'claude-0')",
            [],
        ).unwrap();

        run(&conn).expect("migration");

        let (run_role, slot_key): (String, String) = conn
            .query_row(
                "SELECT run_role, slot_key FROM sessions WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(run_role, "candidate");
        assert_eq!(slot_key, "claude-0");
    }

    #[test]
    fn archive_table_preserves_task_role_for_forensics() {
        let conn = make_v1_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, task_role, run_role)
             VALUES ('s1', 'session-1', '/repo', 'repo', 'b', 'p', '/wt', 'active', 1, 1, 'consolidator', 'consolidator')",
            [],
        ).unwrap();

        run(&conn).expect("migration");

        assert!(table_exists(&conn, "sessions_v1_role_archive"));
        let archived_role: String = conn
            .query_row(
                "SELECT task_role FROM sessions_v1_role_archive WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(archived_role, "consolidator");
    }

    #[test]
    fn migration_is_idempotent_on_already_migrated_db() {
        let conn = make_v1_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, task_role, run_role)
             VALUES ('s1', 'session-1', '/repo', 'repo', 'b', 'p', '/wt', 'active', 1, 1, 'candidate', 'candidate')",
            [],
        ).unwrap();

        run(&conn).expect("first migration");
        run(&conn).expect("second call must be a clean no-op");

        let run_role: String = conn
            .query_row(
                "SELECT run_role FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(run_role, "candidate", "idempotent rerun must not touch data");
    }
}
