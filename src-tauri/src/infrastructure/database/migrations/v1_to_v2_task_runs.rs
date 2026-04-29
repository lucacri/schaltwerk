//! One-shot migration: drop the v1 `task_runs.status` column on first v2 launch.
//!
//! See `plans/2026-04-29-task-flow-v2-phase-1-plan.md` §4 for the full design.
//! Summary:
//!
//!   1. Detect: does `task_runs.status` exist? If not, this is a v2-native DB —
//!      do nothing.
//!   2. Archive `task_runs` to `task_runs_v1_archive` (`CREATE TABLE … AS
//!      SELECT *`). Permanent table, kept for forensics — Phase 0 backup model.
//!   3. Backfill `cancelled_at` / `confirmed_at` / `failed_at` from the legacy
//!      `status` column. Rows where status was `running`, `queued`, or
//!      `awaiting_selection` get no terminal timestamp; the v2 derived getter
//!      will recompute their state from sessions on first read.
//!   4. SQLite table-rebuild dance: CREATE `task_runs_new` with the v2 schema,
//!      INSERT SELECT (excluding `status`), DROP old, RENAME new. Done in one
//!      transaction so a partial failure leaves the original intact.
//!   5. Recreate indexes that the rebuild dance dropped.
//!
//! Idempotent: a second invocation against a v2-native DB sees no `status`
//! column and returns immediately.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Run the v1→v2 task_runs migration if the legacy `status` column is present.
/// No-op on v2-native DBs. Safe to call multiple times.
pub fn run(conn: &Connection) -> Result<()> {
    if !has_legacy_status_column(conn)? {
        return Ok(());
    }

    archive_task_runs(conn).context("archive task_runs to task_runs_v1_archive")?;
    backfill_terminal_timestamps(conn).context("backfill cancelled/confirmed/failed timestamps")?;
    drop_status_column_via_rebuild(conn).context("drop status column via table rebuild")?;
    recreate_indexes_after_rebuild(conn).context("recreate indexes after table rebuild")?;

    Ok(())
}

fn has_legacy_status_column(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('task_runs') WHERE name = 'status'",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Phase 0 backup pattern. The archive table is permanent — `_v1_archive`
/// suffix marks it as keep-forever forensics, not a transient working copy.
/// A second migration run sees `task_runs.status` is gone and skips, so this
/// statement only ever fires once per DB.
fn archive_task_runs(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_runs_v1_archive AS SELECT * FROM task_runs",
        [],
    )?;
    Ok(())
}

/// Map each legacy `status` value to the corresponding v2 terminal timestamp.
/// Each UPDATE has a defensive `IS NULL` guard so a re-run after a partial
/// migration does not stamp a fresh `now()` over a previously-correct value.
/// (`apply_tasks_migrations` already added the three new columns idempotently
/// before this function fires.)
fn backfill_terminal_timestamps(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE task_runs
            SET cancelled_at = updated_at
            WHERE status = 'cancelled' AND cancelled_at IS NULL",
        [],
    )?;
    // Prefer `completed_at` because v1's confirm path stamped it; only fall
    // back to `updated_at` for rows where v1 forgot to set completed_at.
    conn.execute(
        "UPDATE task_runs
            SET confirmed_at = COALESCE(completed_at, updated_at)
            WHERE status = 'completed' AND confirmed_at IS NULL",
        [],
    )?;
    conn.execute(
        "UPDATE task_runs
            SET failed_at = updated_at
            WHERE status = 'failed' AND failed_at IS NULL",
        [],
    )?;
    // Rows with status ∈ {'running','queued','awaiting_selection'} get no
    // terminal timestamp — the v2 derived getter recomputes their status
    // from sessions on first read. Those non-terminal v1 states were
    // observed only rarely in production per the baseline doc.
    Ok(())
}

/// SQLite has no native `ALTER TABLE DROP COLUMN` on the version we ship.
/// This is the standard rebuild dance, wrapped in a transaction so a failure
/// halfway leaves `task_runs` intact.
fn drop_status_column_via_rebuild(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "BEGIN;
         CREATE TABLE task_runs_new (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            preset_id TEXT,
            base_branch TEXT,
            target_branch TEXT,
            selected_session_id TEXT,
            selected_artifact_id TEXT,
            selection_mode TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            cancelled_at INTEGER,
            confirmed_at INTEGER,
            failed_at INTEGER,
            failure_reason TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
         );
         INSERT INTO task_runs_new (
            id, task_id, stage, preset_id,
            base_branch, target_branch,
            selected_session_id, selected_artifact_id, selection_mode,
            started_at, completed_at,
            cancelled_at, confirmed_at, failed_at,
            failure_reason,
            created_at, updated_at
         )
         SELECT
            id, task_id, stage, preset_id,
            base_branch, target_branch,
            selected_session_id, selected_artifact_id, selection_mode,
            started_at, completed_at,
            cancelled_at, confirmed_at, failed_at,
            failure_reason,
            created_at, updated_at
         FROM task_runs;
         DROP TABLE task_runs;
         ALTER TABLE task_runs_new RENAME TO task_runs;
         COMMIT;",
    )?;
    Ok(())
}

/// The rebuild dropped indexes on the old `task_runs`. `apply_tasks_migrations`
/// re-runs every `CREATE INDEX IF NOT EXISTS` on subsequent launches, but the
/// migration runs *inside* the same `initialize_schema` call, so we recreate
/// here so the freshly-named `task_runs` is fully indexed when `run` returns.
fn recreate_indexes_after_rebuild(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, stage)",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_conn_with_v1_task_runs() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (id, created_at, updated_at) VALUES ('t1', 1000, 1000)",
            [],
        )
        .unwrap();

        // v1 task_runs schema verbatim (with the status column).
        conn.execute(
            "CREATE TABLE task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                preset_id TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                base_branch TEXT,
                target_branch TEXT,
                selected_session_id TEXT,
                selected_artifact_id TEXT,
                selection_mode TEXT,
                started_at INTEGER,
                completed_at INTEGER,
                failure_reason TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();

        // The new columns are added idempotently by apply_tasks_migrations
        // before the migration fires. Mimic that pre-state here so the test
        // fixture matches the real call sequence.
        for sql in [
            "ALTER TABLE task_runs ADD COLUMN cancelled_at INTEGER",
            "ALTER TABLE task_runs ADD COLUMN confirmed_at INTEGER",
            "ALTER TABLE task_runs ADD COLUMN failed_at INTEGER",
        ] {
            conn.execute(sql, []).unwrap();
        }
        conn
    }

    fn make_conn_v2_native() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        // v2-native task_runs (no status column).
        conn.execute(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                preset_id TEXT,
                base_branch TEXT,
                target_branch TEXT,
                selected_session_id TEXT,
                selected_artifact_id TEXT,
                selection_mode TEXT,
                started_at INTEGER,
                completed_at INTEGER,
                cancelled_at INTEGER,
                confirmed_at INTEGER,
                failed_at INTEGER,
                failure_reason TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();
        conn
    }

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

    #[test]
    fn noop_on_v2_native_db() {
        let conn = make_conn_v2_native();
        run(&conn).expect("first call");
        run(&conn).expect("second call must be no-op");

        let cols = pragma_columns(&conn, "task_runs");
        assert!(!cols.contains(&"status".to_string()));
        assert!(!table_exists(&conn, "task_runs_v1_archive"));
    }

    #[test]
    fn backfills_cancelled_at_from_legacy_status() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'cancelled', 1234, 1100)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (cancelled_at, confirmed_at, failed_at): (Option<i64>, Option<i64>, Option<i64>) = conn
            .query_row(
                "SELECT cancelled_at, confirmed_at, failed_at FROM task_runs WHERE id = 'r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(cancelled_at, Some(1234));
        assert_eq!(confirmed_at, None);
        assert_eq!(failed_at, None);
    }

    #[test]
    fn backfills_confirmed_at_prefers_completed_at_over_updated_at() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, completed_at, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'completed', 900, 1000, 800)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let confirmed_at: Option<i64> = conn
            .query_row(
                "SELECT confirmed_at FROM task_runs WHERE id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(confirmed_at, Some(900));
    }

    #[test]
    fn backfills_confirmed_at_falls_back_to_updated_at_when_completed_at_null() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, completed_at, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'completed', NULL, 1000, 800)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let confirmed_at: Option<i64> = conn
            .query_row(
                "SELECT confirmed_at FROM task_runs WHERE id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(confirmed_at, Some(1000));
    }

    #[test]
    fn backfills_failed_at_from_legacy_status() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'failed', 1500, 1100)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let (cancelled_at, confirmed_at, failed_at): (Option<i64>, Option<i64>, Option<i64>) = conn
            .query_row(
                "SELECT cancelled_at, confirmed_at, failed_at FROM task_runs WHERE id = 'r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(failed_at, Some(1500));
        assert_eq!(cancelled_at, None);
        assert_eq!(confirmed_at, None);
    }

    #[test]
    fn non_terminal_status_rows_get_no_terminal_timestamps() {
        let conn = make_conn_with_v1_task_runs();
        for (id, status) in [
            ("r-running", "running"),
            ("r-queued", "queued"),
            ("r-awaiting", "awaiting_selection"),
        ] {
            conn.execute(
                "INSERT INTO task_runs (id, task_id, stage, status, updated_at, created_at)
                 VALUES (?1, 't1', 'implemented', ?2, 1000, 1000)",
                [id, status],
            )
            .unwrap();
        }

        run(&conn).expect("migration");

        for id in ["r-running", "r-queued", "r-awaiting"] {
            let (c, conf, f): (Option<i64>, Option<i64>, Option<i64>) = conn
                .query_row(
                    "SELECT cancelled_at, confirmed_at, failed_at FROM task_runs WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(c, None, "row {id} cancelled_at");
            assert_eq!(conf, None, "row {id} confirmed_at");
            assert_eq!(f, None, "row {id} failed_at");
        }
    }

    #[test]
    fn archive_table_preserves_every_v1_row_including_status() {
        let conn = make_conn_with_v1_task_runs();
        for (id, status) in [
            ("r1", "completed"),
            ("r2", "cancelled"),
            ("r3", "failed"),
            ("r4", "running"),
        ] {
            conn.execute(
                "INSERT INTO task_runs (id, task_id, stage, status, updated_at, created_at)
                 VALUES (?1, 't1', 'implemented', ?2, 1000, 1000)",
                [id, status],
            )
            .unwrap();
        }

        run(&conn).expect("migration");

        assert!(table_exists(&conn, "task_runs_v1_archive"));
        let (count, status_present_in_archive): (i64, i64) = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM task_runs_v1_archive),
                    (SELECT COUNT(*) FROM pragma_table_info('task_runs_v1_archive')
                                     WHERE name = 'status')",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 4, "all 4 v1 rows preserved in archive");
        assert_eq!(
            status_present_in_archive, 1,
            "archive must keep the legacy status column for forensics"
        );
    }

    #[test]
    fn status_column_is_dropped_from_task_runs_after_migration() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'completed', 1000, 1000)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let cols = pragma_columns(&conn, "task_runs");
        assert!(
            !cols.contains(&"status".to_string()),
            "task_runs.status must be dropped after migration; cols = {cols:?}"
        );
    }

    #[test]
    fn migration_is_idempotent_on_already_migrated_db() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, completed_at, updated_at, created_at)
             VALUES ('r1', 't1', 'implemented', 'completed', 900, 1000, 800)",
            [],
        )
        .unwrap();

        run(&conn).expect("first migration");
        // After the first migration, status is gone. Second call must be a no-op
        // and must NOT clobber the backfilled timestamps.
        run(&conn).expect("second call must be a clean no-op");

        let confirmed_at: i64 = conn
            .query_row(
                "SELECT confirmed_at FROM task_runs WHERE id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            confirmed_at, 900,
            "idempotent rerun must not touch the backfilled value"
        );
    }

    #[test]
    fn drop_dance_preserves_row_data_and_indexes() {
        let conn = make_conn_with_v1_task_runs();
        conn.execute(
            "INSERT INTO task_runs (
                id, task_id, stage, preset_id, status,
                base_branch, target_branch,
                selected_session_id, selected_artifact_id, selection_mode,
                started_at, completed_at, failure_reason,
                created_at, updated_at
             ) VALUES (
                'r1', 't1', 'implemented', 'codex', 'completed',
                'main', 'feat/x',
                'sess-winner', NULL, 'manual',
                500, 900, NULL,
                400, 1000
             )",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        // Every persisted column carries through the rebuild.
        let row: (
            String, String, String, Option<String>, Option<String>, Option<String>,
            Option<String>, Option<String>, Option<String>,
            Option<i64>, Option<i64>, Option<i64>,
            i64, i64,
        ) = conn
            .query_row(
                "SELECT id, task_id, stage, preset_id, base_branch, target_branch,
                        selected_session_id, selected_artifact_id, selection_mode,
                        started_at, completed_at, confirmed_at,
                        created_at, updated_at
                 FROM task_runs WHERE id = 'r1'",
                [],
                |r| {
                    Ok((
                        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                        r.get(6)?, r.get(7)?, r.get(8)?,
                        r.get(9)?, r.get(10)?, r.get(11)?,
                        r.get(12)?, r.get(13)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(row.0, "r1");
        assert_eq!(row.3.as_deref(), Some("codex"));
        assert_eq!(row.6.as_deref(), Some("sess-winner"));
        assert_eq!(row.10, Some(900), "completed_at survives rebuild");
        assert_eq!(row.11, Some(900), "confirmed_at backfilled from completed_at");

        // The recreated index exists.
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                    WHERE type='index' AND name = 'idx_task_runs_task'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1, "idx_task_runs_task must be recreated after rebuild");
    }
}
