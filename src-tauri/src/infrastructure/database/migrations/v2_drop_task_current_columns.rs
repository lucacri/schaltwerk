//! Phase 4 Wave F.6: drop the legacy `tasks.current_spec`,
//! `tasks.current_plan`, and `tasks.current_summary` denormalized
//! columns.
//!
//! v1/v2-pre-Wave-F mirrored each artifact body into a column on the
//! `tasks` table for read convenience. v2-post-Wave-F derives the
//! "current" body at read time from `task_artifacts` (where
//! `is_current = true` and `artifact_kind` matches), so the
//! denormalized columns are pure noise — and a possible drift surface
//! if the mirror writer and the artifact writer ever disagree.
//!
//! Strategy: SQLite table-rebuild dance, same as the Wave D session
//! migration. Archive table `tasks_v2_drop_current_archive` preserves
//! the pre-rewrite denormalized values per task id for forensics.
//!
//! Idempotent: if the columns no longer exist, the migration is a
//! no-op. v2-native fresh DBs see this immediately.
//!
//! **Defensive drift check (per
//! `feedback_compile_pins_dont_catch_wiring.md`):** the test
//! `archive_preserves_pre_rewrite_values` confirms the archive table
//! captures the denormalized values before the columns are dropped, so
//! a future maintainer can compare archive against artifact history if
//! they suspect drift.

use anyhow::{Context, Result};
use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<()> {
    if !has_legacy_columns(conn)? {
        return Ok(());
    }

    archive_tasks(conn).context("archive tasks to tasks_v2_drop_current_archive")?;
    drop_legacy_columns_via_rebuild(conn)
        .context("drop current_spec/plan/summary columns via table rebuild")?;
    recreate_indexes_after_rebuild(conn).context("recreate v2 indexes after rebuild")?;

    Ok(())
}

fn has_legacy_columns(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tasks')
            WHERE name IN ('current_spec', 'current_plan', 'current_summary')",
        [],
        |row| row.get(0),
    )?;
    Ok(count >= 1)
}

fn archive_tasks(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks_v2_drop_current_archive AS
            SELECT id, name, repository_path,
                   current_spec, current_plan, current_summary
            FROM tasks",
        [],
    )?;
    Ok(())
}

fn drop_legacy_columns_via_rebuild(conn: &Connection) -> Result<()> {
    // Disable foreign keys for the rebuild dance: dropping `tasks`
    // would otherwise cascade-delete `task_runs` rows that reference
    // it (the FK is `ON DELETE CASCADE`). Re-enable after RENAME so
    // future writes still respect referential integrity.
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         BEGIN;
         CREATE TABLE tasks_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            variant TEXT NOT NULL,
            stage TEXT NOT NULL DEFAULT 'draft',
            request_body TEXT NOT NULL DEFAULT '',
            source_kind TEXT,
            source_url TEXT,
            task_host_session_id TEXT,
            task_branch TEXT,
            base_branch TEXT,
            issue_number INTEGER,
            issue_url TEXT,
            pr_number INTEGER,
            pr_url TEXT,
            pr_state TEXT,
            failure_flag BOOLEAN NOT NULL DEFAULT FALSE,
            epic_id TEXT,
            attention_required BOOLEAN NOT NULL DEFAULT FALSE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            cancelled_at INTEGER,
            UNIQUE(repository_path, name)
         );
         INSERT INTO tasks_new (
            id, name, display_name, repository_path, repository_name,
            variant, stage, request_body,
            source_kind, source_url,
            task_host_session_id, task_branch, base_branch,
            issue_number, issue_url, pr_number, pr_url, pr_state,
            failure_flag, epic_id, attention_required,
            created_at, updated_at, cancelled_at
         )
         SELECT
            id, name, display_name, repository_path, repository_name,
            variant, stage, request_body,
            source_kind, source_url,
            task_host_session_id, task_branch, base_branch,
            issue_number, issue_url, pr_number, pr_url, pr_state,
            failure_flag, epic_id, attention_required,
            created_at, updated_at, cancelled_at
         FROM tasks;
         DROP TABLE tasks;
         ALTER TABLE tasks_new RENAME TO tasks;
         COMMIT;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}

fn recreate_indexes_after_rebuild(conn: &Connection) -> Result<()> {
    let indexes = [
        "CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repository_path)",
        "CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(repository_path, stage)",
    ];
    for sql in indexes {
        conn.execute(sql, [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_v1_shape_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL DEFAULT 'repo',
                variant TEXT NOT NULL DEFAULT 'regular',
                stage TEXT NOT NULL DEFAULT 'draft',
                request_body TEXT NOT NULL DEFAULT '',
                current_spec TEXT,
                current_plan TEXT,
                current_summary TEXT,
                source_kind TEXT,
                source_url TEXT,
                task_host_session_id TEXT,
                task_branch TEXT,
                base_branch TEXT,
                issue_number INTEGER,
                issue_url TEXT,
                pr_number INTEGER,
                pr_url TEXT,
                pr_state TEXT,
                failure_flag BOOLEAN NOT NULL DEFAULT FALSE,
                epic_id TEXT,
                attention_required BOOLEAN NOT NULL DEFAULT FALSE,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                cancelled_at INTEGER,
                UNIQUE(repository_path, name)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn noop_on_v2_native_db() {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL DEFAULT 'repo',
                variant TEXT NOT NULL DEFAULT 'regular',
                stage TEXT NOT NULL DEFAULT 'draft',
                request_body TEXT NOT NULL DEFAULT '',
                source_kind TEXT,
                source_url TEXT,
                task_host_session_id TEXT,
                task_branch TEXT,
                base_branch TEXT,
                issue_number INTEGER,
                issue_url TEXT,
                pr_number INTEGER,
                pr_url TEXT,
                pr_state TEXT,
                failure_flag BOOLEAN NOT NULL DEFAULT FALSE,
                epic_id TEXT,
                attention_required BOOLEAN NOT NULL DEFAULT FALSE,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                cancelled_at INTEGER
            )",
            [],
        )
        .unwrap();

        run(&conn).expect("first call");
        run(&conn).expect("second call must be no-op");

        let archive_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                   WHERE type='table' AND name='tasks_v2_drop_current_archive'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(archive_count, 0, "no archive on v2-native DB");
    }

    #[test]
    fn drops_legacy_columns_when_present() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO tasks (id, name, repository_path, current_spec, current_plan, current_summary, created_at, updated_at)
             VALUES ('t1', 'task1', '/repo', 'spec body', 'plan body', NULL, 0, 0)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let has_legacy: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks')
                    WHERE name IN ('current_spec', 'current_plan', 'current_summary')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_legacy, 0);
    }

    #[test]
    fn archive_preserves_pre_rewrite_values() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO tasks (id, name, repository_path, current_spec, current_plan, current_summary, created_at, updated_at)
             VALUES ('t1', 'task1', '/repo', 'spec body', 'plan body', 'summary body', 0, 0)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (spec, plan, summary): (Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT current_spec, current_plan, current_summary
                    FROM tasks_v2_drop_current_archive WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(spec.as_deref(), Some("spec body"));
        assert_eq!(plan.as_deref(), Some("plan body"));
        assert_eq!(summary.as_deref(), Some("summary body"));
    }

    #[test]
    fn idempotent_repeat_run_is_noop() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO tasks (id, name, repository_path, current_spec, created_at, updated_at)
             VALUES ('t1', 'task1', '/repo', 'spec', 0, 0)",
            [],
        )
        .unwrap();

        run(&conn).expect("first run");
        run(&conn).expect("second call must be no-op");

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(row_count, 1);
    }

    #[test]
    fn preserves_non_legacy_task_columns() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO tasks (id, name, repository_path, current_spec, stage, created_at, updated_at)
             VALUES ('t1', 'task1', '/repo', 'spec', 'planned', 12345, 67890)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (id, name, stage, created_at): (String, String, String, i64) = conn
            .query_row(
                "SELECT id, name, stage, created_at FROM tasks WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(id, "t1");
        assert_eq!(name, "task1");
        assert_eq!(stage, "planned");
        assert_eq!(created_at, 12345);
    }
}
