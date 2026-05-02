//! Phase 7 Wave D.2: convert v1 spec sessions into v2 draft tasks.
//!
//! On first v2 launch against a v1-shape DB, every spec session that
//! isn't already linked to a task is promoted to a Draft `Task`:
//! - `tasks` row inserted with `stage = 'draft'`, `request_body` from
//!   the spec content (or empty if the spec was empty).
//! - When the spec content is non-empty, a `task_artifacts` row is
//!   inserted with `kind = 'spec'`, `is_current = true`, and the
//!   spec content as the body.
//! - The spec session's `task_id` is updated to point at the new
//!   task. Sessions that already have `task_id` set (MCP-created
//!   tasks) are not touched.
//!
//! Archive table `sessions_v1_specs_to_tasks_archive` captures the
//! original spec→session linkage forever for forensics.
//!
//! Idempotent: a re-run finds zero spec sessions with `task_id IS NULL`
//! and exits cleanly. Pinned by `idempotent_repeat_run` test.

use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn run(conn: &Connection) -> Result<()> {
    if !has_required_columns(conn)? {
        // Schema isn't far enough along (e.g. early-startup DB before
        // sessions table exists). Skip silently.
        return Ok(());
    }

    let candidates = collect_candidate_specs(conn)
        .context("collect spec sessions eligible for v1→v2 task migration")?;
    if candidates.is_empty() {
        return Ok(());
    }

    archive_pre_migration_state(conn, &candidates)
        .context("archive spec→session linkage before promotion")?;

    for candidate in &candidates {
        migrate_spec_to_task(conn, candidate)
            .with_context(|| format!("migrate spec {} to draft task", candidate.session_id))?;
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct CandidateSpec {
    session_id: String,
    name: String,
    display_name: Option<String>,
    repository_path: String,
    repository_name: String,
    spec_content: Option<String>,
    epic_id: Option<String>,
    created_at: i64,
}

fn has_required_columns(conn: &Connection) -> Result<bool> {
    let sessions_ok: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'is_spec'",
        [],
        |row| row.get(0),
    )?;
    let tasks_ok: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'request_body'",
        [],
        |row| row.get(0),
    )?;
    Ok(sessions_ok > 0 && tasks_ok > 0)
}

fn collect_candidate_specs(conn: &Connection) -> Result<Vec<CandidateSpec>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, display_name, repository_path, repository_name,
                spec_content, epic_id, created_at
            FROM sessions
            WHERE is_spec = 1
              AND (task_id IS NULL OR task_id = '')
              AND cancelled_at IS NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CandidateSpec {
            session_id: row.get::<_, String>(0)?,
            name: row.get::<_, String>(1)?,
            display_name: row.get::<_, Option<String>>(2)?,
            repository_path: row.get::<_, String>(3)?,
            repository_name: row.get::<_, String>(4)?,
            spec_content: row.get::<_, Option<String>>(5)?,
            epic_id: row.get::<_, Option<String>>(6)?,
            created_at: row.get::<_, i64>(7)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Forensics: a permanent table that records every spec session id
/// promoted to a task and the task id it became. Read-only after the
/// migration runs; exists so a future cleanup or panic recovery can
/// trace the linkage.
fn archive_pre_migration_state(conn: &Connection, _candidates: &[CandidateSpec]) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions_v1_specs_to_tasks_archive (
            session_id TEXT NOT NULL,
            session_name TEXT NOT NULL,
            repository_path TEXT NOT NULL,
            promoted_task_id TEXT NOT NULL,
            spec_content_was_empty BOOLEAN NOT NULL,
            archived_at INTEGER NOT NULL,
            PRIMARY KEY(session_id, promoted_task_id)
        )",
        [],
    )?;
    Ok(())
}

fn migrate_spec_to_task(conn: &Connection, candidate: &CandidateSpec) -> Result<()> {
    let task_id = Uuid::new_v4().to_string();
    let request_body = candidate.spec_content.clone().unwrap_or_default();
    let now = candidate.created_at;

    let tx = conn.unchecked_transaction()?;

    // Skip the candidate if the (repo, name) UNIQUE pair would
    // collide with an existing task — that means a parallel migration
    // path already created the task. Defensive against double-runs.
    let collision: i64 = tx.query_row(
        "SELECT COUNT(*) FROM tasks WHERE repository_path = ?1 AND name = ?2",
        params![candidate.repository_path, candidate.name],
        |row| row.get(0),
    )?;
    if collision > 0 {
        tx.commit()?;
        return Ok(());
    }

    tx.execute(
        "INSERT INTO tasks (
            id, name, display_name, repository_path, repository_name,
            variant, stage, request_body,
            failure_flag, attention_required,
            epic_id,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'regular', 'draft', ?6, 0, 0, ?7, ?8, ?8)",
        params![
            task_id,
            candidate.name,
            candidate.display_name,
            candidate.repository_path,
            candidate.repository_name,
            request_body,
            candidate.epic_id,
            now,
        ],
    )?;

    if !request_body.is_empty() {
        let artifact_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO task_artifacts (
                id, task_id, artifact_kind, content,
                is_current, produced_by_session_id,
                created_at, updated_at
            ) VALUES (?1, ?2, 'spec', ?3, 1, ?4, ?5, ?5)",
            params![artifact_id, task_id, request_body, candidate.session_id, now],
        )?;
    }

    tx.execute(
        "UPDATE sessions SET task_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![task_id, now, candidate.session_id],
    )?;

    tx.execute(
        "INSERT OR IGNORE INTO sessions_v1_specs_to_tasks_archive
            (session_id, session_name, repository_path, promoted_task_id,
             spec_content_was_empty, archived_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            candidate.session_id,
            candidate.name,
            candidate.repository_path,
            task_id,
            request_body.is_empty(),
            now,
        ],
    )?;

    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::Database;
    use rusqlite::Connection;

    fn fresh_db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn raw_insert_spec_session(
        conn: &Connection,
        id: &str,
        name: &str,
        repo: &str,
        spec_content: Option<&str>,
        epic_id: Option<&str>,
    ) {
        // V2-native column set (Phase 4 Wave D.4 dropped the legacy
        // `status` column). is_spec=1 marks this as a spec session;
        // cancelled_at NULL keeps it alive.
        conn.execute(
            "INSERT INTO sessions (
                id, name, repository_path, repository_name, branch, parent_branch,
                worktree_path, is_spec, cancelled_at, spec_content,
                resume_allowed, is_consolidation, ci_autofix_enabled,
                pending_name_generation, was_auto_generated, ready_to_merge,
                epic_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'repo', ?4, 'main', ?5, 1, NULL, ?6,
                      1, 0, 0, 0, 0, 0, ?7, 1000, 1000)",
            rusqlite::params![
                id,
                name,
                repo,
                format!("specs/{name}"),
                format!("/tmp/wt-{id}"),
                spec_content,
                epic_id,
            ],
        )
        .expect("insert spec session");
    }

    #[test]
    fn noop_on_v2_native_db_without_specs() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        run(&conn).expect("noop run");
        let task_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .expect("count tasks");
        assert_eq!(task_count, 0);
    }

    #[test]
    fn promotes_spec_session_to_draft_task_with_artifact() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        raw_insert_spec_session(
            &conn,
            "sess-1",
            "add-search",
            "/tmp/proj",
            Some("# Goal\n\nAdd search."),
            None,
        );

        run(&conn).expect("migrate");

        let (task_id, name, stage, request_body): (String, String, String, String) = conn
            .query_row(
                "SELECT id, name, stage, request_body FROM tasks
                    WHERE repository_path = ? AND name = ?",
                rusqlite::params!["/tmp/proj", "add-search"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("task created");
        assert_eq!(name, "add-search");
        assert_eq!(stage, "draft");
        assert_eq!(request_body, "# Goal\n\nAdd search.");

        let (artifact_kind, is_current, content): (String, bool, String) = conn
            .query_row(
                "SELECT artifact_kind, is_current, content FROM task_artifacts
                    WHERE task_id = ?",
                rusqlite::params![task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("artifact created");
        assert_eq!(artifact_kind, "spec");
        assert!(is_current);
        assert_eq!(content, "# Goal\n\nAdd search.");

        let session_task_id: Option<String> = conn
            .query_row(
                "SELECT task_id FROM sessions WHERE id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .expect("session row");
        assert_eq!(session_task_id.as_deref(), Some(task_id.as_str()));
    }

    #[test]
    fn skips_spec_session_with_empty_content_does_not_create_artifact() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        raw_insert_spec_session(&conn, "sess-empty", "blank-spec", "/tmp/proj", None, None);

        run(&conn).expect("migrate");

        let task_id: String = conn
            .query_row(
                "SELECT id FROM tasks WHERE repository_path = ? AND name = ?",
                rusqlite::params!["/tmp/proj", "blank-spec"],
                |row| row.get(0),
            )
            .expect("task created");
        let artifact_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_artifacts WHERE task_id = ?",
                rusqlite::params![task_id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(artifact_count, 0, "empty spec content yields no artifact");
    }

    #[test]
    fn does_not_migrate_session_with_existing_task_id() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        raw_insert_spec_session(
            &conn,
            "sess-bound",
            "already-bound",
            "/tmp/proj",
            Some("body"),
            None,
        );
        conn.execute(
            "UPDATE sessions SET task_id = 'pre-existing-task' WHERE id = 'sess-bound'",
            [],
        )
        .expect("set task_id");

        run(&conn).expect("migrate");

        let task_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE name = 'already-bound'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(
            task_count, 0,
            "session already linked to a task must not produce a duplicate"
        );
    }

    #[test]
    fn idempotent_repeat_run_is_a_clean_noop() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        raw_insert_spec_session(
            &conn,
            "sess-repeat",
            "repeat-spec",
            "/tmp/proj",
            Some("body"),
            None,
        );

        run(&conn).expect("first run");
        let after_first: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .expect("count");

        run(&conn).expect("second run");
        let after_second: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .expect("count");

        assert_eq!(after_first, 1);
        assert_eq!(
            after_second, 1,
            "second run must not produce a duplicate task"
        );

        let archive_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions_v1_specs_to_tasks_archive",
                [],
                |row| row.get(0),
            )
            .expect("archive count");
        assert_eq!(archive_count, 1, "archive table records the migration once");
    }

    #[test]
    fn carries_epic_id_and_display_name_through_to_the_task() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        conn.execute(
            "INSERT INTO sessions (
                id, name, display_name, repository_path, repository_name, branch,
                parent_branch, worktree_path, is_spec, cancelled_at,
                spec_content, resume_allowed, is_consolidation, ci_autofix_enabled,
                pending_name_generation, was_auto_generated, ready_to_merge,
                epic_id, created_at, updated_at
            ) VALUES ('sess-epic', 'epic-spec', 'Epic Spec', '/tmp/proj', 'repo',
                      'specs/epic-spec', 'main', '/tmp/wt-epic', 1, NULL,
                      'body', 1, 0, 0, 0, 0, 0, 'epic-7', 2000, 2000)",
            [],
        )
        .expect("insert");

        run(&conn).expect("migrate");

        let (display_name, epic_id): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT display_name, epic_id FROM tasks
                    WHERE repository_path = ? AND name = ?",
                rusqlite::params!["/tmp/proj", "epic-spec"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("task fields");
        assert_eq!(display_name.as_deref(), Some("Epic Spec"));
        assert_eq!(epic_id.as_deref(), Some("epic-7"));
    }

    #[test]
    fn archive_table_records_session_to_task_linkage() {
        let db = fresh_db();
        let conn = db.get_conn().expect("conn");
        raw_insert_spec_session(
            &conn,
            "sess-archive",
            "archive-spec",
            "/tmp/proj",
            Some("body"),
            None,
        );

        run(&conn).expect("migrate");

        let task_id: String = conn
            .query_row(
                "SELECT id FROM tasks WHERE name = 'archive-spec'",
                [],
                |row| row.get(0),
            )
            .expect("task");
        let (session_id, promoted_task_id, was_empty): (String, String, bool) = conn
            .query_row(
                "SELECT session_id, promoted_task_id, spec_content_was_empty
                    FROM sessions_v1_specs_to_tasks_archive
                    WHERE session_id = 'sess-archive'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("archive row");
        assert_eq!(session_id, "sess-archive");
        assert_eq!(promoted_task_id, task_id);
        assert!(!was_empty);
    }
}
