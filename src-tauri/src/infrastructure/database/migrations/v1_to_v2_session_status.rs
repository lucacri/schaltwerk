//! Phase 3 Wave F.7: backfill `sessions.is_spec` and `sessions.cancelled_at`
//! from the legacy `status` and `session_state` columns.
//!
//! v1 modeled session lifecycle as two correlated enum columns:
//! `status` (`'active' | 'cancelled' | 'spec'`) and `session_state`
//! (`'spec' | 'processing' | 'running'`). v2 collapses them to two
//! orthogonal axes:
//! - `is_spec: bool` (identity — does this session have a real
//!   worktree, or is it a draft?)
//! - `cancelled_at: Option<DateTime<Utc>>` (lifecycle — has this
//!   session been cancelled?)
//!
//! See Phase 3 plan §1 for the rationale and design doc §5 for the
//! charter.
//!
//! Migration steps (idempotent; v2-native DBs see no-op):
//!   1. Detect: are there any rows where `is_spec = 0` and
//!      `(status = 'spec' OR session_state = 'spec')`? If not, the
//!      backfill has already run.
//!   2. Backfill `is_spec = 1` for spec rows (defensive — both legacy
//!      columns are checked because they could drift, as the v1
//!      reconciler proved with its `status==Spec && session_state!=Spec`
//!      resync at `domains/sessions/repository.rs:148`).
//!   3. Backfill `cancelled_at = updated_at WHERE status = 'cancelled'
//!      AND cancelled_at IS NULL`.
//!
//! **What this migration does NOT do** (deferred to a follow-up phase):
//! - It does not drop the legacy `status` / `session_state` columns.
//!   The Phase 3 plan envisioned a table-rebuild dance to drop them,
//!   but that requires every production consumer to migrate to the new
//!   `is_spec` / `cancelled_at` fields first (the ~173-site sweep). In
//!   the additive landing of Phase 3, both old and new columns coexist:
//!   the new fields are populated by this migration and by future
//!   writes; the old enum columns continue to be the source of truth
//!   for existing call sites until Phase 4+ retires them.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Run the migration if any session row carries spec-identity in the
/// legacy columns but not in `is_spec`, OR carries
/// `status = 'cancelled'` without a populated `cancelled_at`. No-op
/// once both backfills have applied.
pub fn run(conn: &Connection) -> Result<()> {
    // Phase 4 Wave D.3: this migration backfills from legacy columns
    // that no longer exist on v2-native DBs (Phase 4 Wave D dropped
    // them from the CREATE schema). Guard against running on a DB
    // that already lacks the legacy columns.
    if !has_legacy_columns(conn)? {
        return Ok(());
    }

    if !needs_backfill(conn)? {
        return Ok(());
    }

    backfill_is_spec(conn).context("backfill sessions.is_spec from legacy columns")?;
    backfill_cancelled_at(conn).context("backfill sessions.cancelled_at from status='cancelled'")?;

    Ok(())
}

fn has_legacy_columns(conn: &Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions')
            WHERE name IN ('status', 'session_state')",
        [],
        |row| row.get(0),
    )?;
    Ok(count >= 2)
}

fn needs_backfill(conn: &Connection) -> Result<bool> {
    // Any row where the legacy columns indicate spec/cancelled but the
    // new columns don't reflect it yet. Defensive against drift between
    // status and session_state — either column being 'spec' qualifies.
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sessions
            WHERE (is_spec = 0 AND (status = 'spec' OR session_state = 'spec'))
               OR (cancelled_at IS NULL AND status = 'cancelled')",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// `is_spec = 1` for any row whose legacy columns indicate spec
/// identity. `OR` rather than `AND` because the two legacy columns
/// could drift (v1 reconciler's resync proves this); we treat either
/// being `'spec'` as sufficient evidence.
fn backfill_is_spec(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE sessions
            SET is_spec = 1
            WHERE is_spec = 0
              AND (status = 'spec' OR session_state = 'spec')",
        [],
    )?;
    Ok(())
}

/// `cancelled_at = updated_at` for legacy `status = 'cancelled'` rows
/// without a populated timestamp. Defensive `IS NULL` guard so a
/// re-run after a partial backfill doesn't stamp a fresh `now()` over
/// a previously-correct value.
fn backfill_cancelled_at(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE sessions
            SET cancelled_at = updated_at
            WHERE status = 'cancelled' AND cancelled_at IS NULL",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory");
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                session_state TEXT,
                is_spec INTEGER NOT NULL DEFAULT 0,
                cancelled_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn noop_on_v2_native_db_with_no_legacy_rows() {
        let conn = make_conn();
        // Active worktree session, no legacy spec/cancelled markers.
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, cancelled_at, created_at, updated_at)
             VALUES ('s1', 'active', 'running', 0, NULL, 100, 200)",
            [],
        )
        .unwrap();

        run(&conn).expect("first call");
        run(&conn).expect("second call must be no-op");

        let (is_spec, cancelled_at): (i64, Option<i64>) = conn
            .query_row(
                "SELECT is_spec, cancelled_at FROM sessions WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(is_spec, 0, "non-spec row stays is_spec=0");
        assert_eq!(cancelled_at, None, "non-cancelled row stays NULL");
    }

    #[test]
    fn backfills_is_spec_when_status_is_spec() {
        let conn = make_conn();
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, created_at, updated_at)
             VALUES ('s1', 'spec', 'spec', 0, 100, 200)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let is_spec: i64 = conn
            .query_row(
                "SELECT is_spec FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(is_spec, 1, "status='spec' must backfill is_spec=1");
    }

    #[test]
    fn backfills_is_spec_defensively_when_only_session_state_is_spec() {
        // Drift defense: v1 reconciler had a defensive resync at
        // domains/sessions/repository.rs:148 because status and
        // session_state could disagree. Either being 'spec' qualifies.
        let conn = make_conn();
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, created_at, updated_at)
             VALUES ('s1', 'active', 'spec', 0, 100, 200)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let is_spec: i64 = conn
            .query_row(
                "SELECT is_spec FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            is_spec, 1,
            "session_state='spec' alone must backfill is_spec=1 (drift defense)"
        );
    }

    #[test]
    fn backfills_cancelled_at_from_legacy_status() {
        let conn = make_conn();
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, cancelled_at, created_at, updated_at)
             VALUES ('s1', 'cancelled', 'running', 0, NULL, 100, 1234)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let cancelled_at: Option<i64> = conn
            .query_row(
                "SELECT cancelled_at FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cancelled_at, Some(1234));
    }

    #[test]
    fn idempotent_does_not_clobber_existing_cancelled_at() {
        let conn = make_conn();
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, cancelled_at, created_at, updated_at)
             VALUES ('s1', 'cancelled', 'running', 0, 999, 100, 1234)",
            [],
        )
        .unwrap();

        run(&conn).expect("migration");

        let cancelled_at: Option<i64> = conn
            .query_row(
                "SELECT cancelled_at FROM sessions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            cancelled_at,
            Some(999),
            "pre-existing cancelled_at must not be overwritten on rerun"
        );
    }

    #[test]
    fn idempotent_repeat_run_is_clean_noop() {
        let conn = make_conn();
        conn.execute(
            "INSERT INTO sessions (id, status, session_state, is_spec, created_at, updated_at)
             VALUES ('spec1', 'spec', 'spec', 0, 100, 200), ('cancel1', 'cancelled', 'running', 0, 100, 1234)",
            [],
        )
        .unwrap();

        run(&conn).expect("first run");
        // After the first run, both backfills have applied. The second
        // call's needs_backfill check returns false → clean no-op.
        run(&conn).expect("second call must be no-op");

        let (spec_is_spec, cancel_cancelled_at): (i64, Option<i64>) = conn
            .query_row(
                "SELECT (SELECT is_spec FROM sessions WHERE id = 'spec1'),
                        (SELECT cancelled_at FROM sessions WHERE id = 'cancel1')",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(spec_is_spec, 1);
        assert_eq!(cancel_cancelled_at, Some(1234));
    }
}
