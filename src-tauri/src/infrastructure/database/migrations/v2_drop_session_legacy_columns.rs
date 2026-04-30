//! Phase 4 Wave D.4: drop the legacy `sessions.status` and
//! `sessions.session_state` enum columns.
//!
//! v1 modeled session lifecycle as two correlated enum columns. v2's
//! Phase 3 introduced the orthogonal axes (`is_spec`, `cancelled_at`)
//! and Phase 4 Wave D.0–D.3 swept all production code to read them
//! directly. This migration finishes the migration: the legacy enum
//! columns are physically removed via the SQLite table-rebuild dance,
//! preserving original values in `sessions_v2_status_archive` for
//! forensics.
//!
//! Prerequisite: the Phase 3 `v1_to_v2_session_status` backfill
//! migration must run first so `is_spec` and `cancelled_at` are
//! populated from the legacy columns. The `apply_sessions_migrations`
//! ordering in `db_schema.rs` guarantees this.
//!
//! Idempotent: if `sessions.status` no longer exists, the migration
//! returns immediately. v2-native fresh DBs see this as a no-op.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Run the migration if the legacy columns are still present.
pub fn run(conn: &Connection) -> Result<()> {
    if !has_legacy_columns(conn)? {
        return Ok(());
    }

    archive_sessions(conn).context("archive sessions to sessions_v2_status_archive")?;
    drop_legacy_columns_via_rebuild(conn)
        .context("drop status/session_state columns via table rebuild")?;
    recreate_indexes_after_rebuild(conn)
        .context("recreate v2 indexes after rebuild")?;

    Ok(())
}

fn has_legacy_columns(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions')
            WHERE name IN ('status', 'session_state')",
        [],
        |row| row.get(0),
    )?;
    Ok(count >= 1)
}

/// Phase 0 backup pattern. The `_v2_status_archive` suffix marks this
/// table as keep-forever forensics — captures the legacy enum strings
/// per session id alongside the new orthogonal-axis values so a future
/// scout-rule cleanup (or panic recovery) can replay them.
fn archive_sessions(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions_v2_status_archive AS
            SELECT id, name, repository_path, status, session_state,
                   is_spec, cancelled_at
            FROM sessions",
        [],
    )?;
    Ok(())
}

/// SQLite has no `ALTER TABLE DROP COLUMN` on the version we ship.
/// Standard rebuild dance: build a new table without the legacy
/// columns, copy every other column 1:1, drop old, rename new. Inside
/// one transaction so a partial failure leaves `sessions` intact.
///
/// The post-Phase-3 column set (with Phase 1's task-lineage and
/// Phase 3's identity-axis additions, minus the dropped enum columns)
/// is reproduced here verbatim from the v1_to_v2_run_role.rs rebuild
/// minus `status` and `session_state`.
fn drop_legacy_columns_via_rebuild(conn: &Connection) -> Result<()> {
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
            created_at, updated_at, last_activity,
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
            created_at, updated_at, last_activity,
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
        "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_order ON sessions(repository_path, ready_to_merge, last_activity DESC)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id)",
    ];
    for sql in indexes {
        conn.execute(sql, [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Set up a v1-shape sessions table with `status` and
    /// `session_state` columns plus the v2 axes. Used to simulate
    /// what a real upgraded user DB looks like at the moment Wave D.4
    /// runs (after Phase 3 backfill has populated is_spec/cancelled_at).
    /// Reproduces the column set a real v1 DB has at the moment Wave
    /// D.4 runs — all the Phase 0/1/2/3 ALTERs have already applied, and
    /// the legacy `status` / `session_state` columns are still present.
    /// The migration's rebuild needs every column the SELECT references.
    fn make_v1_shape_conn() -> Connection {
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
                repository_name TEXT NOT NULL DEFAULT 'repo',
                branch TEXT NOT NULL DEFAULT 'b',
                parent_branch TEXT NOT NULL DEFAULT 'main',
                original_parent_branch TEXT,
                worktree_path TEXT NOT NULL DEFAULT '/wt',
                status TEXT NOT NULL,
                session_state TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
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
                cancelled_at INTEGER
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn noop_on_v2_native_db_without_legacy_columns() {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL DEFAULT 'repo',
                branch TEXT NOT NULL DEFAULT 'b',
                parent_branch TEXT NOT NULL DEFAULT 'main',
                worktree_path TEXT NOT NULL DEFAULT '/wt',
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                is_spec INTEGER NOT NULL DEFAULT 0,
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
                   WHERE type='table' AND name='sessions_v2_status_archive'",
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
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at)
             VALUES ('s1', 'alpha', '/repo', 'active', 'running', 0, NULL)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let has_status: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'status'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let has_session_state: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'session_state'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_status, 0, "status column must be dropped");
        assert_eq!(has_session_state, 0, "session_state column must be dropped");
    }

    #[test]
    fn archive_table_preserves_legacy_values() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at)
             VALUES ('s1', 'alpha', '/repo', 'active', 'running', 0, NULL)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (status, session_state): (String, String) = conn
            .query_row(
                "SELECT status, session_state FROM sessions_v2_status_archive WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "active");
        assert_eq!(session_state, "running");
    }

    #[test]
    fn idempotent_repeat_run_is_noop() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at)
             VALUES ('s1', 'alpha', '/repo', 'active', 'running', 0, NULL)",
            [],
        )
        .unwrap();

        run(&conn).expect("first run");
        run(&conn).expect("second call must be no-op");

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(row_count, 1, "row count unchanged across repeated runs");
    }

    #[test]
    fn preserves_non_legacy_columns_and_their_values() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at, created_at)
             VALUES ('s1', 'alpha', '/repo', 'active', 'running', 0, NULL, 12345)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (id, name, created_at): (String, String, i64) = conn
            .query_row(
                "SELECT id, name, created_at FROM sessions WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(id, "s1");
        assert_eq!(name, "alpha");
        assert_eq!(created_at, 12345);
    }

    #[test]
    fn preserves_orthogonal_axes_after_drop() {
        let conn = make_v1_shape_conn();
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at)
             VALUES
                ('alive', 'a', '/repo', 'active', 'running', 0, NULL),
                ('spec1', 's', '/repo', 'spec', 'spec', 1, NULL),
                ('cancelled1', 'c', '/repo', 'cancelled', 'running', 0, 9000)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let live: Vec<(String, i64, Option<i64>)> = {
            let mut stmt = conn
                .prepare("SELECT id, is_spec, cancelled_at FROM sessions ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };

        assert_eq!(
            live,
            vec![
                ("alive".to_string(), 0, None),
                ("cancelled1".to_string(), 0, Some(9000)),
                ("spec1".to_string(), 1, None),
            ]
        );
    }

    /// **End-to-end v1 → v2 migration test (per
    /// feedback_compile_pins_dont_catch_wiring.md).** Sets up a
    /// v1-shape DB with three representative rows (Active, Cancelled,
    /// Spec), runs the full migration chain (the Phase 3 backfill
    /// followed by Wave D.4's column drop), reads back through the v2
    /// read path's column shape, and asserts the orthogonal axes
    /// reflect what the v1 enum projection would have said. Catches
    /// the case where the migration's column-drop SQL succeeds but the
    /// backfill of is_spec/cancelled_at was silently wrong.
    #[test]
    fn end_to_end_v1_shape_db_migrates_and_reads_correctly() {
        let conn = make_v1_shape_conn();
        // Three representative rows from a real v1 DB.
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, status, session_state, is_spec, cancelled_at, updated_at)
             VALUES
                ('row-active', 'alpha', '/repo', 'active', 'running', 0, NULL, 100),
                ('row-cancelled', 'beta', '/repo', 'cancelled', 'running', 0, NULL, 200),
                ('row-spec', 'gamma', '/repo', 'spec', 'spec', 0, NULL, 300)",
            [],
        )
        .unwrap();

        // Step 1: run Phase 3's backfill migration (populates is_spec /
        // cancelled_at from legacy columns).
        super::super::v1_to_v2_session_status::run(&conn).unwrap();

        // Step 2: run Wave D.4's column-drop migration.
        run(&conn).unwrap();

        // Step 3: read back via the v2 read path's column shape.
        // No `status` or `session_state` references; just the orthogonal axes.
        let rows: Vec<(String, i64, Option<i64>)> = {
            let mut stmt = conn
                .prepare("SELECT id, is_spec, cancelled_at FROM sessions ORDER BY id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };

        // Active row: is_spec=0, cancelled_at=None.
        assert_eq!(rows[0].0, "row-active");
        assert_eq!(rows[0].1, 0);
        assert_eq!(rows[0].2, None);

        // Cancelled row: cancelled_at backfilled to updated_at.
        assert_eq!(rows[1].0, "row-cancelled");
        assert_eq!(rows[1].1, 0);
        assert_eq!(rows[1].2, Some(200));

        // Spec row: is_spec=1, cancelled_at=None.
        assert_eq!(rows[2].0, "row-spec");
        assert_eq!(rows[2].1, 1);
        assert_eq!(rows[2].2, None);

        // Verify the legacy columns are physically gone from the
        // sessions table (the column-drop side of the migration).
        let has_legacy: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions')
                    WHERE name IN ('status', 'session_state')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_legacy, 0);
    }
}
