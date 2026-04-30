//! Phase 5.5 Wave E: hydrator-completeness arch test.
//!
//! Catches the wiring-gap class documented in
//! `feedback_compile_pins_dont_catch_wiring.md`: a column added to the
//! schema (via `ALTER TABLE … ADD COLUMN`) without a corresponding update
//! to the read-path hydrator. The Phase 5.5 audit closed three instances
//! of this in `db_sessions.rs`; this test guards against future regressions.
//!
//! **What this catches:** new column added to `CREATE TABLE` or
//! `alter_add_column_idempotent` without bumping the expected count below.
//! Developer must update both the schema AND the hydrator AND this test
//! (forcing a deliberate round-trip-test update along the way).
//!
//! **What this does NOT catch:** content drift inside the hydrator (e.g.
//! reading column 5 when the SELECT puts the field at column 7). Use DB
//! round-trip tests (Wave B/C/D pattern) for that.

use lucode::infrastructure::database::Database;
use tempfile::TempDir;

/// Get the column count for `table_name` from a freshly-initialized DB.
fn column_count(db: &Database, table_name: &str) -> i64 {
    let conn = db.get_conn().expect("conn");
    conn.query_row(
        &format!("SELECT COUNT(*) FROM pragma_table_info('{table_name}')"),
        [],
        |row| row.get::<_, i64>(0),
    )
    .expect("pragma_table_info")
}

/// Phase 5.5 Wave E: pinned column counts for entity tables that have
/// dedicated hydrators. If a count changes, the developer adding the
/// column must:
///   1. Update the expected count below.
///   2. Update the corresponding hydrator (e.g. `row_to_session_with_facts`,
///      `row_to_session_summary`, `row_to_task`, etc.) to read the new column.
///   3. Update the SELECT lists that feed the hydrator.
///   4. Add a DB round-trip test that goes through the production write
///      path and reads the new column back.
#[test]
fn entity_tables_match_expected_column_counts() {
    let tmp = TempDir::new().expect("tempdir");
    let db = Database::new(Some(tmp.path().join("schema.db"))).expect("fresh db");

    // Each entry is `(table_name, expected_column_count, why)`. Bumping
    // a count without updating the hydrator + adding a round-trip test
    // is exactly the wiring-gap pattern Phase 5.5 closed; the test
    // failure when this drifts is the load-bearing protection.
    let expectations: &[(&str, i64, &str)] = &[
        // sessions has 52 columns: 43 base (incl. one legacy `stage` column
        // that is not read by any hydrator — it's vestigial and should be
        // dropped in a future cleanup) + 6 Phase 1 facts (task_run_id,
        // run_role, slot_key, exited_at, exit_code, first_idle_at) +
        // 2 Phase 3 axes (is_spec, cancelled_at). The hydrators
        // (`row_to_session_with_facts` + `row_to_session_summary`) read
        // 51 of those — the unread column is `stage`.
        ("sessions", 52, "row_to_session_with_facts + row_to_session_summary (51 cols read; legacy `stage` column unread)"),
        // tasks: see `row_to_task`. Includes Phase 3 cancelled_at.
        // Phase 4 dropped current_spec / current_plan / current_summary,
        // bringing the count to 24.
        ("tasks", 24, "row_to_task"),
        // task_runs: see `row_to_task_run`. v2 dropped status; carries
        // failed_at + failure_reason.
        ("task_runs", 17, "row_to_task_run"),
        // task_artifacts: see `row_to_task_artifact`.
        ("task_artifacts", 12, "row_to_task_artifact"),
        // specs: see `row_to_spec`.
        ("specs", 22, "row_to_spec"),
        // epics: schema has 6 columns; entity intentionally subsets to
        // (id, name, color). The hydrator's column count is by design
        // less than the table count.
        ("epics", 6, "row_to_epic (intentional subset: 3-of-6)"),
    ];

    let mut violations: Vec<String> = Vec::new();
    for (table, expected, why) in expectations {
        let actual = column_count(&db, table);
        if actual != *expected {
            violations.push(format!(
                "  `{table}`: schema has {actual} columns, expected {expected} ({why})"
            ));
        }
    }

    assert!(
        violations.is_empty(),
        "Hydrator-completeness violations:\n{}\n\nIf a column was added, update the hydrator(s) AND this test AND add a DB round-trip test per feedback_compile_pins_dont_catch_wiring.md.",
        violations.join("\n"),
    );
}
