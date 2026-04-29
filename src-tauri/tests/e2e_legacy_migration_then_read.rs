//! End-to-end test for Stream B: a v1 SQLite database migrates cleanly on
//! first v2 launch and the v2 read path returns derived statuses that match
//! the legacy intent.
//!
//! This test cannot use `Database::new` directly because that runs the v2
//! schema initialization which would create a fresh v2-shaped task_runs.
//! Instead it builds a raw SQLite file with v1 schema + seed rows, then runs
//! `apply_tasks_migrations` (which calls `migrations::v1_to_v2_task_runs::run`
//! at the end) and finally constructs the higher-level surface to read back
//! the migrated rows.

use lucode::domains::tasks::entity::TaskRunStatus;
use lucode::domains::tasks::run_status::compute_run_status;
use lucode::infrastructure::database::Database;
use lucode::infrastructure::database::TaskRunMethods;
use rusqlite::{Connection, params};
use tempfile::TempDir;

/// Create a v1-shaped on-disk SQLite file at `path` with the seed rows we want
/// to migrate. Mirrors what a real v1 install would have on disk.
fn seed_v1_db(path: &std::path::Path) {
    let conn = Connection::open(path).unwrap();

    // We deliberately do NOT pre-create a v1 sessions table. v2's
    // initialize_schema runs CREATE TABLE IF NOT EXISTS on sessions, so the
    // table is created with v2 shape on first open. The legacy migration we
    // care about is task_runs, which we DO pre-create with v1 shape below.
    // (A real v1 user would have a v1-shape sessions table; v2's session
    // migrations are idempotent ALTERs that bring it up to v2 shape. Testing
    // that pathway is the responsibility of the existing
    // apply_sessions_migrations tests, not this end-to-end test.)

    // v1 tasks (FK target).
    conn.execute(
        "CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
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
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tasks (id, name, repository_path, repository_name, created_at, updated_at)
         VALUES ('t1', 'first', '/tmp/repo', 'repo', 1000, 1000)",
        [],
    )
    .unwrap();

    // v1 task_runs WITH the legacy status column.
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

    // Mixed v1 rows. The migration backfills cancelled_at/confirmed_at/
    // failed_at; v2-derived status reads back the timestamps and produces
    // the matching TaskRunStatus.
    let inserts: &[(&str, &str, Option<i64>, i64)] = &[
        ("r-completed", "completed", Some(900), 1000),
        ("r-cancelled", "cancelled", None, 1100),
        ("r-failed", "failed", None, 1200),
        ("r-running", "running", None, 1300),
    ];
    for (id, status, completed_at, updated_at) in inserts {
        conn.execute(
            "INSERT INTO task_runs (id, task_id, stage, status, completed_at, created_at, updated_at)
             VALUES (?1, 't1', 'implemented', ?2, ?3, 800, ?4)",
            params![id, status, completed_at, updated_at],
        )
        .unwrap();
    }
}

#[test]
fn v1_db_migrates_then_yields_correct_derived_status_through_the_v2_read_path() {
    // Build a fresh on-disk DB with v1 shape and seed data.
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("legacy.db");
    seed_v1_db(&path);

    // Now open it through the v2 Database API. `Database::new` calls
    // `initialize_schema`, which calls `apply_tasks_migrations`, which calls
    // `migrations::v1_to_v2_task_runs::run`. This is the exact path a v1
    // user takes on first launch of v2.
    let db = Database::new(Some(path.clone())).expect("v2 open over v1 db");

    // The status column must be gone after the migration.
    {
        let conn = db.get_conn().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('task_runs') WHERE name = 'status'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "status column must be dropped");
    }

    // Read each migrated row through the v2 surface and assert derived status.
    let cases = [
        ("r-completed", TaskRunStatus::Completed),
        ("r-cancelled", TaskRunStatus::Cancelled),
        ("r-failed", TaskRunStatus::Failed),
        // r-running had a non-terminal v1 status. The migration set no terminal
        // timestamp; with no bound sessions either, the v2 derived getter
        // resolves it to Running per the §3 default-fallback predicate.
        ("r-running", TaskRunStatus::Running),
    ];
    for (id, expected) in cases {
        let run = db.get_task_run(id).expect("load run");
        let status = compute_run_status(&run, &[]);
        assert_eq!(
            status, expected,
            "run {id} derived status mismatch — migrated state must match legacy intent"
        );
    }

    // The archive table preserves the original legacy data including the status
    // column. Forensics path stays usable.
    {
        let conn = db.get_conn().unwrap();
        let archived: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_runs_v1_archive", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(archived, 4, "archive must contain all 4 legacy rows");
    }

    // Closing and reopening the same file is the second-launch path. The
    // migration must skip cleanly because the status column is gone.
    drop(db);
    let db2 = Database::new(Some(path)).expect("v2 reopen");
    let still_completed = db2.get_task_run("r-completed").unwrap();
    assert_eq!(
        compute_run_status(&still_completed, &[]),
        TaskRunStatus::Completed,
        "second-launch read path must still resolve correctly"
    );
}

// Idempotency on a raw v1 connection is already exercised by the unit tests
// inside `infrastructure/database/migrations/v1_to_v2_task_runs.rs::tests`.
// The single end-to-end test above proves that the full v2 read path agrees
// with those unit tests on a real on-disk DB.
