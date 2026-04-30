//! Phase 3 Wave E.3: backfill `tasks.cancelled_at` from legacy
//! `stage = 'cancelled'` rows.
//!
//! v1 modeled cancellation as `task.stage = TaskStage::Cancelled` (a
//! terminal stage variant). v2 collapses this to an orthogonal
//! `task.cancelled_at: Option<DateTime<Utc>>` timestamp — see Phase 3
//! plan §10. Cancellation is no longer a stage transition; a cancelled
//! task retains whatever stage it had at cancel time, so reopen is
//! just a `cancelled_at = NULL` write without an awkward backwards
//! transition.
//!
//! Migration steps (idempotent; v2-native DBs see no-op):
//!   1. Detect: are there any rows with `stage = 'cancelled'`? If not,
//!      this DB has already been migrated (or never had cancelled
//!      tasks).
//!   2. Archive `tasks` to `tasks_v1_cancelled_archive` (id, stage,
//!      updated_at) for forensics so the precise pre-rewrite state
//!      survives.
//!   3. Backfill `tasks.cancelled_at = updated_at WHERE stage =
//!      'cancelled' AND cancelled_at IS NULL`.
//!   4. Rewrite `stage = 'draft'` for those rows. **Deliberate semantic
//!      loss:** `'draft'` is the safest fallback because most
//!      cancellations happen early (a task never made it past
//!      brainstorm/plan); `'pushed'` would falsely imply "this almost
//!      shipped." `'draft'` honestly says "we don't know how far this
//!      got" without overclaiming. The archive table preserves the
//!      precise pre-rewrite state.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Run the migration if any task row carries the legacy
/// `stage = 'cancelled'` marker. No-op on v2-native DBs (no such
/// rows). Safe to call multiple times.
pub fn run(conn: &Connection) -> Result<()> {
    if !has_legacy_cancelled_tasks(conn)? {
        return Ok(());
    }

    archive_cancelled_tasks(conn).context("archive cancelled tasks to tasks_v1_cancelled_archive")?;
    backfill_cancelled_at(conn).context("backfill tasks.cancelled_at from stage='cancelled'")?;
    rewrite_stage_to_draft(conn).context("rewrite legacy cancelled stage to draft")?;

    Ok(())
}

fn has_legacy_cancelled_tasks(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE stage = 'cancelled'",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Phase 0 backup pattern. Captures (id, stage, updated_at) for every
/// row about to be rewritten. The archive is keep-forever forensics —
/// `_v1_cancelled_archive` suffix marks intent.
fn archive_cancelled_tasks(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks_v1_cancelled_archive AS
            SELECT id, stage, updated_at
            FROM tasks
            WHERE stage = 'cancelled'",
        [],
    )?;
    Ok(())
}

/// Map legacy stage='cancelled' → cancelled_at = updated_at. Defensive
/// `IS NULL` guard so a re-run after a partial migration doesn't stamp
/// a fresh timestamp over a previously-correct one. (Wave C added the
/// `cancelled_at` column idempotently before this migration fires.)
fn backfill_cancelled_at(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE tasks
            SET cancelled_at = updated_at
            WHERE stage = 'cancelled' AND cancelled_at IS NULL",
        [],
    )?;
    Ok(())
}

/// Deliberate semantic loss: legacy stage='cancelled' rewrites to
/// 'draft'. The archive table preserves the original. Documented in
/// the plan §10 and the module-level doc above.
fn rewrite_stage_to_draft(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET stage = 'draft' WHERE stage = 'cancelled'",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_conn_with_v1_tasks() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                stage TEXT NOT NULL,
                cancelled_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
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
    fn noop_on_v2_native_db_with_no_cancelled_rows() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'implemented', 100, 200)",
            [],
        )
        .unwrap();

        run(&conn).expect("first call");
        run(&conn).expect("second call must be no-op");

        assert!(!table_exists(&conn, "tasks_v1_cancelled_archive"));
        let stage: String = conn
            .query_row("SELECT stage FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stage, "implemented", "non-cancelled rows must not change");
    }

    #[test]
    fn backfills_cancelled_at_from_updated_at() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'cancelled', 100, 1234)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let cancelled_at: Option<i64> = conn
            .query_row(
                "SELECT cancelled_at FROM tasks WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cancelled_at, Some(1234));
    }

    #[test]
    fn rewrites_legacy_cancelled_stage_to_draft() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'cancelled', 100, 200)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let stage: String = conn
            .query_row("SELECT stage FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            stage, "draft",
            "legacy cancelled stage must rewrite to draft (the safe fallback per plan §10)"
        );
    }

    #[test]
    fn archive_table_preserves_pre_rewrite_state() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'cancelled', 100, 200), ('t2', 'cancelled', 100, 300)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        assert!(table_exists(&conn, "tasks_v1_cancelled_archive"));
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks_v1_cancelled_archive",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "every cancelled row must be archived for forensics");

        let archived_stage: String = conn
            .query_row(
                "SELECT stage FROM tasks_v1_cancelled_archive WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            archived_stage, "cancelled",
            "archive must keep the legacy 'cancelled' string for forensics"
        );
    }

    #[test]
    fn idempotent_on_repeat_call_does_not_clobber_backfill() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'cancelled', 100, 1234)",
            [],
        )
        .unwrap();

        run(&conn).expect("first migration");
        // Second call: stage is now 'draft', cancelled_at is 1234.
        // The has_legacy_cancelled_tasks gate must short-circuit so
        // the second call is a clean no-op and cancelled_at is not
        // re-stamped with the (now bumped) updated_at.
        run(&conn).expect("second call must be no-op");

        let (stage, cancelled_at): (String, Option<i64>) = conn
            .query_row(
                "SELECT stage, cancelled_at FROM tasks WHERE id = 't1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(stage, "draft", "stage must stay 'draft' after idempotent rerun");
        assert_eq!(
            cancelled_at,
            Some(1234),
            "cancelled_at must not be re-stamped on idempotent rerun"
        );
    }

    #[test]
    fn non_cancelled_rows_are_untouched() {
        let conn = make_conn_with_v1_tasks();
        conn.execute(
            "INSERT INTO tasks (id, stage, created_at, updated_at)
             VALUES ('t1', 'cancelled', 100, 200), ('t2', 'pushed', 100, 250), ('t3', 'done', 100, 300)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let cases = [("t2", "pushed"), ("t3", "done")];
        for (id, expected_stage) in cases {
            let (stage, cancelled_at): (String, Option<i64>) = conn
                .query_row(
                    "SELECT stage, cancelled_at FROM tasks WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                stage, expected_stage,
                "row {id} stage must not change (only stage='cancelled' rows are rewritten)"
            );
            assert!(
                cancelled_at.is_none(),
                "row {id} cancelled_at must stay NULL (only stage='cancelled' rows get backfilled)"
            );
        }
    }
}
