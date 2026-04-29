use super::connection::Database;

fn is_duplicate_column_error(err: &rusqlite::Error) -> bool {
    matches!(err, rusqlite::Error::SqliteFailure(_, Some(msg)) if msg.contains("duplicate column name"))
}

fn alter_add_column_idempotent(conn: &rusqlite::Connection, sql: &str) -> anyhow::Result<()> {
    match conn.execute(sql, []) {
        Ok(_) => Ok(()),
        Err(err) if is_duplicate_column_error(&err) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub fn initialize_schema(db: &Database) -> anyhow::Result<()> {
    let conn = db.get_conn()?;

    // Main sessions table - consolidated schema
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
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
                worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,  -- 'active', 'cancelled', or 'spec'
            session_state TEXT DEFAULT 'running',  -- 'spec', 'processing', or 'running'
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
            consolidation_round_id TEXT DEFAULT NULL,
            consolidation_role TEXT DEFAULT NULL,
            consolidation_report TEXT DEFAULT NULL,
            consolidation_report_source TEXT DEFAULT NULL,
            consolidation_base_session_id TEXT DEFAULT NULL,
            consolidation_recommended_session_id TEXT DEFAULT NULL,
            consolidation_confirmation_mode TEXT DEFAULT NULL,
            promotion_reason TEXT DEFAULT NULL,
            task_id TEXT DEFAULT NULL,
            task_stage TEXT DEFAULT NULL,
            task_role TEXT DEFAULT NULL,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repository_path)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_order ON sessions(repository_path, ready_to_merge, last_activity DESC)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_status_order ON sessions(status, ready_to_merge, last_activity DESC)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_status ON sessions(repository_path, status)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            agent_type TEXT DEFAULT 'claude',
            orchestrator_agent_type TEXT DEFAULT 'claude',
            spec_clarification_agent_type TEXT DEFAULT 'claude',
            default_open_app TEXT DEFAULT NULL,
            enabled_open_apps TEXT DEFAULT NULL,
            default_base_branch TEXT,
            terminal_font_size INTEGER DEFAULT 13,
            ui_font_size INTEGER DEFAULT 12,
            dev_error_toasts_enabled BOOLEAN DEFAULT FALSE,
            consolidation_default_agent_type TEXT DEFAULT 'claude',
            consolidation_default_preset_id TEXT DEFAULT NULL
        )",
        [],
    )?;

    // Apply migrations for app_config
    apply_app_config_migrations(&conn)?;

    conn.execute(
        "INSERT OR IGNORE INTO app_config (
            id,
            agent_type,
            orchestrator_agent_type,
            spec_clarification_agent_type,
            default_open_app,
            terminal_font_size,
            ui_font_size,
            tutorial_completed,
            dev_error_toasts_enabled,
            consolidation_default_agent_type,
            consolidation_default_preset_id
        ) VALUES (1, 'claude', 'claude', 'claude', NULL, 13, 12, FALSE, FALSE, 'claude', NULL)",
        [],
    )?;

    // Apply migrations for sessions table
    apply_sessions_migrations(&conn)?;

    // Apply migrations for the task aggregate (tasks/task_runs/task_artifacts + session linkage).
    apply_tasks_migrations(&conn)?;

    // Optional columns added by migrations need their indexes created after the migration runs.
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_epic ON sessions(repository_path, epic_id)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_consolidation_round ON sessions(repository_path, consolidation_round_id)",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS consolidation_rounds (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            version_group_id TEXT NOT NULL,
            round_type TEXT NOT NULL DEFAULT 'implementation',
            confirmation_mode TEXT NOT NULL,
            status TEXT NOT NULL,
            source_session_ids TEXT NOT NULL,
            recommended_session_id TEXT,
            recommended_by_session_id TEXT,
            confirmed_session_id TEXT,
            confirmed_by TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;
    let _ = conn.execute(
        "ALTER TABLE consolidation_rounds ADD COLUMN round_type TEXT NOT NULL DEFAULT 'implementation'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE consolidation_rounds ADD COLUMN vertical TEXT NOT NULL DEFAULT 'other'",
        [],
    );
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_consolidation_rounds_repo_group ON consolidation_rounds(repository_path, version_group_id)",
        [],
    )?;

    let has_candidate_round_id: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('consolidation_outcome_candidates') WHERE name = 'round_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let candidates_table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='consolidation_outcome_candidates'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if candidates_table_exists > 0 && has_candidate_round_id == 0 {
        let _ = conn.execute("DROP TABLE IF EXISTS consolidation_outcome_candidates", []);
        let _ = conn.execute("DROP TABLE IF EXISTS consolidation_outcomes", []);
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS consolidation_outcomes (
            round_id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            version_group_id TEXT NOT NULL,
            round_type TEXT NOT NULL,
            vertical TEXT NOT NULL,
            confirmed_session_id TEXT NOT NULL,
            confirmed_session_name TEXT NOT NULL,
            confirmed_by TEXT NOT NULL,
            confirmed_at INTEGER NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS consolidation_outcome_candidates (
            round_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            session_name TEXT NOT NULL,
            agent_type TEXT,
            model TEXT,
            outcome TEXT NOT NULL CHECK (outcome IN ('winner', 'loser')),
            PRIMARY KEY (round_id, session_id),
            FOREIGN KEY(round_id) REFERENCES consolidation_outcomes(round_id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_consolidation_outcomes_repo_vertical_time
            ON consolidation_outcomes(repository_path, vertical, confirmed_at)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_consolidation_outcome_candidates_round
            ON consolidation_outcome_candidates(round_id, outcome)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS epics (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_epics_repo ON epics(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_epics_name_repo ON epics(repository_path, name)",
        [],
    )?;

    // Specs table (decoupled from sessions)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS specs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            epic_id TEXT,
            issue_number INTEGER,
            issue_url TEXT,
            pr_number INTEGER,
            pr_url TEXT,
            improve_plan_round_id TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            content TEXT NOT NULL,
            implementation_plan TEXT,
            stage TEXT NOT NULL DEFAULT 'draft',
            variant TEXT NOT NULL DEFAULT 'regular',
            ready_session_id TEXT,
            ready_branch TEXT,
            base_branch TEXT,
            attention_required BOOLEAN NOT NULL DEFAULT FALSE,
            clarification_started BOOLEAN NOT NULL DEFAULT FALSE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_stage_workflows (
            task_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            preset_id TEXT,
            judge_preset_id TEXT,
            auto_chain BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (task_id, stage),
            FOREIGN KEY(task_id) REFERENCES specs(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_stage_workflows_task
            ON task_stage_workflows(task_id, stage)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_repo ON specs(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_name_repo ON specs(repository_path, name)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_updated_at ON specs(updated_at)",
        [],
    )?;

    // Apply migrations for specs table (including legacy spec rows)
    apply_specs_migrations(&conn)?;

    // Create project_config table for project-specific settings
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_config (
            repository_path TEXT PRIMARY KEY,
            setup_script TEXT,
            branch_prefix TEXT DEFAULT 'lucode',
            github_repository TEXT,
            github_default_branch TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Apply migrations for project_config
    apply_project_config_migrations(&conn)?;

    // Create agent_binaries table for storing agent binary configurations
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_binaries (
            agent_name TEXT PRIMARY KEY,
            custom_path TEXT,
            auto_detect BOOLEAN NOT NULL DEFAULT TRUE,
            detected_binaries_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Archived specs for prompt history/recovery
    conn.execute(
        "CREATE TABLE IF NOT EXISTS archived_specs (
            id TEXT PRIMARY KEY,
            session_name TEXT NOT NULL,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            content TEXT NOT NULL,
            archived_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_archived_specs_repo ON archived_specs(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_archived_specs_archived_at ON archived_specs(archived_at)",
        [],
    )?;

    let spec_review_table_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
                WHERE type='table' AND name='spec_review_comments'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if spec_review_table_exists > 0 {
        let has_created_at: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('spec_review_comments')
                    WHERE name = 'created_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if has_created_at == 0 {
            let _ = conn.execute("DROP TABLE IF EXISTS spec_review_comments", []);
        }
    }
    conn.execute(
        "CREATE TABLE IF NOT EXISTS spec_review_comments (
            id TEXT PRIMARY KEY,
            spec_id TEXT NOT NULL,
            line_start INTEGER NOT NULL,
            line_end INTEGER NOT NULL,
            selected_text TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(spec_id) REFERENCES specs(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_spec_review_comments_spec
            ON spec_review_comments(spec_id, created_at)",
        [],
    )?;

    Ok(())
}

/// Apply migrations for the app_config table
fn apply_app_config_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN default_open_app TEXT DEFAULT 'finder'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN enabled_open_apps TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN orchestrator_agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN spec_clarification_agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN default_base_branch TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER DEFAULT 13",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER DEFAULT 12",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN tutorial_completed BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN archive_max_entries INTEGER DEFAULT 50",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN dev_error_toasts_enabled BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN editor_overrides TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN consolidation_default_agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN consolidation_default_preset_id TEXT DEFAULT NULL",
        [],
    );
    Ok(())
}

/// Apply migrations for the sessions table
fn apply_sessions_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_agent_type TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_agent_model TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN display_name TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_group_id TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_number INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN pending_name_generation BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN was_auto_generated BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN spec_content TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'running'",
        [],
    );
    let _ = conn.execute(
        "UPDATE sessions SET session_state = 'running' WHERE session_state = 'reviewed'",
        [],
    );
    // New: gate agent resume after Spec/Cancel until first fresh start
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN resume_allowed BOOLEAN DEFAULT TRUE",
        [],
    );
    // Store Amp thread ID for resuming threads across sessions
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN amp_thread_id TEXT", []);
    // Store original parent branch (set once at creation, never changes)
    // This allows resetting the compare branch back to the original
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_parent_branch TEXT",
        [],
    );
    // Backfill original_parent_branch from parent_branch for existing sessions
    let _ = conn.execute(
        "UPDATE sessions SET original_parent_branch = parent_branch WHERE original_parent_branch IS NULL",
        [],
    );
    // GitHub issue/PR integration fields
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN issue_number INTEGER", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN issue_url TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pr_number INTEGER", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pr_url TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pr_state TEXT", []);
    // Epic grouping (optional)
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN epic_id TEXT", []);
    // Consolidation session flag
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN is_consolidation INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // Consolidation source session IDs
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_sources TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_round_id TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_role TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_report TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_report_source TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_base_session_id TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_recommended_session_id TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN consolidation_confirmation_mode TEXT DEFAULT NULL",
        [],
    );
    // Promotion reason — non-null means this session was promoted (winner of consolidation)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN promotion_reason TEXT DEFAULT NULL",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN task_id TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN task_stage TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN task_role TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN ci_autofix_enabled BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN merged_at INTEGER", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN stage TEXT", []);
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS autofix_attempts (
            session_name TEXT NOT NULL,
            commit_sha TEXT NOT NULL,
            repository_path TEXT NOT NULL,
            attempted_at INTEGER NOT NULL,
            PRIMARY KEY (session_name, commit_sha, repository_path)
        )",
    )?;
    Ok(())
}

/// Apply migrations for the specs table and migrate legacy spec-state sessions.
fn apply_specs_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // Idempotent - silently fails if column already exists
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN epic_id TEXT", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN issue_number INTEGER", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN issue_url TEXT", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN pr_number INTEGER", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN pr_url TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN improve_plan_round_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN stage TEXT NOT NULL DEFAULT 'draft'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN variant TEXT NOT NULL DEFAULT 'regular'",
        [],
    );
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN ready_session_id TEXT", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN ready_branch TEXT", []);
    let _ = conn.execute("ALTER TABLE specs ADD COLUMN base_branch TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN attention_required BOOLEAN NOT NULL DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN clarification_started BOOLEAN NOT NULL DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE specs ADD COLUMN implementation_plan TEXT",
        [],
    );
    let _ = conn.execute(
        "UPDATE specs SET stage = 'draft' WHERE stage IS NULL OR stage = ''",
        [],
    );
    let _ = conn.execute(
        "UPDATE specs SET stage = 'ready' WHERE stage = 'clarified'",
        [],
    );
    let _ = conn.execute(
        "UPDATE specs SET variant = 'regular' WHERE variant IS NULL OR variant = ''",
        [],
    );
    let _ = conn.execute(
        "UPDATE specs SET attention_required = FALSE WHERE attention_required IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE specs SET clarification_started = FALSE WHERE clarification_started IS NULL",
        [],
    );

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO specs (id, name, display_name, epic_id, issue_number, issue_url, pr_number, pr_url, improve_plan_round_id, repository_path, repository_name, content, stage, attention_required, clarification_started, created_at, updated_at)
         SELECT s.id, s.name, s.display_name, s.epic_id, s.issue_number, s.issue_url, s.pr_number, s.pr_url, NULL,
                s.repository_path, s.repository_name,
                COALESCE(s.spec_content, s.initial_prompt, ''),
                'draft',
                FALSE,
                FALSE,
                s.created_at, s.updated_at
         FROM sessions s
         WHERE s.session_state = 'spec'
           AND NOT EXISTS (SELECT 1 FROM specs sp WHERE sp.id = s.id)",
        [],
    )?;

    tx.execute("DELETE FROM sessions WHERE session_state = 'spec'", [])?;

    tx.commit()?;
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS task_stage_workflows (
            task_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            preset_id TEXT,
            judge_preset_id TEXT,
            auto_chain BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (task_id, stage),
            FOREIGN KEY(task_id) REFERENCES specs(id) ON DELETE CASCADE
        )",
        [],
    );
    Ok(())
}

/// Apply migrations for the project_config table
fn apply_project_config_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE project_config DROP COLUMN last_selection_kind",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config DROP COLUMN last_selection_payload",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN sessions_filter_mode TEXT DEFAULT 'all'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN sessions_sort_mode TEXT DEFAULT 'name'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN environment_variables TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN action_buttons TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN run_script TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN branch_prefix TEXT",
        [],
    );
    let _ = conn.execute(
        "UPDATE project_config SET branch_prefix = 'lucode' WHERE branch_prefix IS NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN auto_cancel_after_merge INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN github_repository TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN github_default_branch TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN auto_cancel_after_pr INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN gitlab_sources TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN worktree_base_directory TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN agent_plugins_json TEXT",
        [],
    );
    Ok(())
}

/// Apply migrations for the task aggregate.
///
/// v2 shape: `task_runs` is born without a persisted `status` column. The derived
/// `compute_run_status` getter (`domains/tasks/run_status.rs`) reads
/// `cancelled_at` / `confirmed_at` / `failed_at` plus the bound sessions' fact
/// columns. The `failed_at` column is the legacy carrier for v1→v2 migrated rows;
/// v2-native code never writes it.
///
/// Sessions get the v1 task-linkage columns (`task_run_id`, `run_role`, `slot_key`)
/// plus the new v2 fact columns (`exited_at`, `exit_code`, `first_idle_at`).
/// `first_idle_at` is write-once at the application layer — see
/// `SessionFactsRecorder` (Wave G of the Phase 1 plan) and the design rationale in
/// `plans/2026-04-29-task-flow-v2-phase-1-plan.md` §1.
pub(crate) fn apply_tasks_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
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
            updated_at INTEGER NOT NULL,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_repo_name ON tasks(repository_path, name)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(repository_path, stage)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at)",
        [],
    )?;
    alter_add_column_idempotent(
        conn,
        "ALTER TABLE tasks ADD COLUMN failure_flag BOOLEAN NOT NULL DEFAULT FALSE",
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_stage_configs (
            task_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            preset_id TEXT,
            auto_chain BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (task_id, stage),
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_workflow_defaults (
            repository_path TEXT NOT NULL,
            stage TEXT NOT NULL,
            preset_id TEXT,
            auto_chain INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (repository_path, stage)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_stage_configs_task
            ON task_stage_configs(task_id, stage)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_runs (
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
    )?;
    alter_add_column_idempotent(
        conn,
        "ALTER TABLE task_runs ADD COLUMN cancelled_at INTEGER",
    )?;
    alter_add_column_idempotent(
        conn,
        "ALTER TABLE task_runs ADD COLUMN confirmed_at INTEGER",
    )?;
    alter_add_column_idempotent(conn, "ALTER TABLE task_runs ADD COLUMN failed_at INTEGER")?;
    alter_add_column_idempotent(
        conn,
        "ALTER TABLE task_runs ADD COLUMN failure_reason TEXT",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, stage)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_artifacts (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            artifact_kind TEXT NOT NULL,
            title TEXT,
            content TEXT,
            url TEXT,
            metadata_json TEXT,
            is_current BOOLEAN NOT NULL DEFAULT FALSE,
            produced_by_run_id TEXT,
            produced_by_session_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_artifacts_task
            ON task_artifacts(task_id, artifact_kind, is_current DESC, created_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_artifact_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            artifact_kind TEXT NOT NULL,
            content TEXT NOT NULL,
            produced_by_run_id TEXT,
            produced_by_session_id TEXT,
            superseded_at INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_artifact_versions_task_kind
            ON task_artifact_versions(task_id, artifact_kind, superseded_at DESC)",
        [],
    )?;

    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN task_run_id TEXT")?;
    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN run_role TEXT")?;
    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN slot_key TEXT")?;
    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN exited_at INTEGER")?;
    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN exit_code INTEGER")?;
    alter_add_column_idempotent(conn, "ALTER TABLE sessions ADD COLUMN first_idle_at INTEGER")?;

    // One-shot v1→v2 migration. Runs after the new columns are present so
    // backfill UPDATEs find their target columns. Idempotent — a v2-native DB
    // (no `task_runs.status` column) skips immediately. See
    // `infrastructure/database/migrations/v1_to_v2_task_runs.rs` for details.
    super::migrations::v1_to_v2_task_runs::run(conn)?;
    let _ = conn.execute(
        "UPDATE sessions SET run_role = task_role
            WHERE run_role IS NULL AND task_role IS NOT NULL",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_task_run ON sessions(task_run_id)",
        [],
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apply_specs_migrations, apply_tasks_migrations};
    use rusqlite::Connection;

    fn create_minimal_sessions_table(conn: &Connection) {
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                task_id TEXT,
                task_stage TEXT,
                task_role TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
    }

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let pragma = format!("PRAGMA table_info('{table}')");
        let mut stmt = conn.prepare(&pragma).unwrap();
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    fn index_exists(conn: &Connection, name: &str) -> bool {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name = ?1",
                [name],
                |row| row.get(0),
            )
            .unwrap();
        count == 1
    }

    #[test]
    fn apply_tasks_migrations_creates_v2_task_runs_without_status() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();

        let cols = column_names(&conn, "task_runs");
        assert!(
            !cols.contains(&"status".to_string()),
            "task_runs.status must not exist on a v2-native DB; cols = {cols:?}"
        );
        for required in [
            "id",
            "task_id",
            "stage",
            "preset_id",
            "base_branch",
            "target_branch",
            "selected_session_id",
            "selected_artifact_id",
            "selection_mode",
            "started_at",
            "completed_at",
            "cancelled_at",
            "confirmed_at",
            "failed_at",
            "failure_reason",
            "created_at",
            "updated_at",
        ] {
            assert!(
                cols.contains(&required.to_string()),
                "task_runs missing column {required}; got {cols:?}"
            );
        }
    }

    #[test]
    fn apply_tasks_migrations_creates_tasks_and_artifacts_tables() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();

        for table in [
            "tasks",
            "task_stage_configs",
            "project_workflow_defaults",
            "task_runs",
            "task_artifacts",
            "task_artifact_versions",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "table {table} should exist after migration");
        }
    }

    #[test]
    fn apply_tasks_migrations_adds_session_linkage_and_fact_columns() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();

        let cols = column_names(&conn, "sessions");
        for required in [
            "task_run_id",
            "run_role",
            "slot_key",
            "exited_at",
            "exit_code",
            "first_idle_at",
        ] {
            assert!(
                cols.contains(&required.to_string()),
                "sessions missing column {required}; got {cols:?}"
            );
        }
    }

    #[test]
    fn apply_tasks_migrations_backfills_run_role_from_task_role() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);
        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, task_role, created_at, updated_at)
             VALUES ('s1', 'sess', '/repo', 'consolidator', 1, 1)",
            [],
        )
        .unwrap();

        apply_tasks_migrations(&conn).unwrap();

        let role: Option<String> = conn
            .query_row(
                "SELECT run_role FROM sessions WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(role.as_deref(), Some("consolidator"));
    }

    #[test]
    fn apply_tasks_migrations_creates_expected_indexes() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();

        for idx in [
            "idx_tasks_repo",
            "idx_tasks_repo_name",
            "idx_tasks_stage",
            "idx_tasks_updated_at",
            "idx_task_stage_configs_task",
            "idx_task_runs_task",
            "idx_task_artifacts_task",
            "idx_task_artifact_versions_task_kind",
            "idx_sessions_task",
            "idx_sessions_task_run",
        ] {
            assert!(index_exists(&conn, idx), "missing index {idx}");
        }
    }

    #[test]
    fn apply_tasks_migrations_does_not_create_status_index() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();

        assert!(
            !index_exists(&conn, "idx_task_runs_status"),
            "v2 must not carry the v1 idx_task_runs_status index because there is no status column"
        );
    }

    #[test]
    fn apply_tasks_migrations_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_minimal_sessions_table(&conn);

        apply_tasks_migrations(&conn).unwrap();
        apply_tasks_migrations(&conn).expect("second call must not error");

        let cols = column_names(&conn, "task_runs");
        assert!(cols.contains(&"cancelled_at".to_string()));
        assert!(cols.contains(&"confirmed_at".to_string()));
        assert!(cols.contains(&"failed_at".to_string()));
    }

    #[test]
    fn specs_migration_does_not_delete_on_insert_failure() {
        let conn = Connection::open_in_memory().unwrap();

        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                epic_id TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                session_state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                initial_prompt TEXT,
                spec_content TEXT
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE specs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                epic_id TEXT,
                issue_number INTEGER,
                issue_url TEXT,
                pr_number INTEGER,
                pr_url TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(repository_path, name)
            )",
            [],
        )
        .unwrap();

        // Existing spec causes INSERT conflict on (repository_path, name)
        conn.execute(
            "INSERT INTO specs (id, name, display_name, epic_id, issue_number, issue_url, pr_number, pr_url, repository_path, repository_name, content, created_at, updated_at)
             VALUES ('spec-existing', 'spec-session', NULL, NULL, NULL, NULL, NULL, NULL, '/repo', 'repo', 'existing', 0, 0)",
            [],
        )
        .unwrap();

        // Legacy spec row still in sessions
        conn.execute(
            "INSERT INTO sessions (id, name, display_name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at, initial_prompt)
             VALUES ('spec-legacy', 'spec-session', NULL, '/repo', 'repo', 'refs/heads/x', 'main', '/tmp/wt', 'active', 'spec', 0, 0, '# prompty')",
            [],
        )
        .unwrap();

        let result = apply_specs_migrations(&conn);
        assert!(
            result.is_err(),
            "migration should surface insert failure to avoid silent deletion"
        );

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE session_state = 'spec'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            remaining, 1,
            "spec rows in sessions must not be deleted on failed insert"
        );
    }

    #[test]
    fn initialize_schema_creates_all_tables() {
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        let conn = db.get_conn().unwrap();

        let tables = [
            "sessions",
            "app_config",
            "epics",
            "specs",
            "project_config",
            "agent_binaries",
            "archived_specs",
        ];

        for table in &tables {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "Table '{table}' should exist after schema init");
        }
    }

    #[test]
    fn initialize_schema_is_idempotent() {
        use super::initialize_schema;
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        initialize_schema(&db).unwrap();
        initialize_schema(&db).unwrap();
    }

    #[test]
    fn app_config_default_row_inserted() {
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        let conn = db.get_conn().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_config", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let agent_type: String = conn
            .query_row(
                "SELECT agent_type FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_type, "claude");
    }

    #[test]
    fn app_config_migrations_add_expected_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                agent_type TEXT DEFAULT 'claude'
            )",
            [],
        )
        .unwrap();

        super::apply_app_config_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO app_config (id, agent_type, tutorial_completed, archive_max_entries)
             VALUES (1, 'claude', FALSE, 50)",
            [],
        )
        .unwrap();

        let agent: String = conn
            .query_row(
                "SELECT agent_type FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent, "claude");

        let tutorial: bool = conn
            .query_row(
                "SELECT tutorial_completed FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!tutorial);
    }

    #[test]
    fn app_config_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                agent_type TEXT DEFAULT 'claude'
            )",
            [],
        )
        .unwrap();

        super::apply_app_config_migrations(&conn).unwrap();
        super::apply_app_config_migrations(&conn).unwrap();
    }

    #[test]
    fn sessions_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        super::apply_sessions_migrations(&conn).unwrap();
        super::apply_sessions_migrations(&conn).unwrap();
    }

    #[test]
    fn sessions_migrations_add_expected_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        super::apply_sessions_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, created_at, updated_at, ready_to_merge, epic_id, session_state)
             VALUES ('s1', 'test', '/repo', 'repo', 'b', 'main', '/wt', 'active', 0, 0, FALSE, NULL, 'running')",
            [],
        )
        .unwrap();

        let rtm: bool = conn
            .query_row(
                "SELECT ready_to_merge FROM sessions WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!rtm);
    }

    #[test]
    fn project_config_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE project_config (
                repository_path TEXT PRIMARY KEY,
                setup_script TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        super::apply_project_config_migrations(&conn).unwrap();
        super::apply_project_config_migrations(&conn).unwrap();
    }

    #[test]
    fn sessions_migration_rewrites_reviewed_state_to_running() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                session_state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at)
             VALUES ('s1', 'legacy-reviewed', '/repo', 'repo', 'b', 'main', '/wt', 'active', 'reviewed', 0, 0)",
            [],
        )
        .unwrap();

        super::apply_sessions_migrations(&conn).unwrap();

        let state: String = conn
            .query_row(
                "SELECT session_state FROM sessions WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "running");
    }

    #[test]
    fn specs_migration_moves_spec_sessions_to_specs_table() {
        let conn = Connection::open_in_memory().unwrap();

        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                epic_id TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                session_state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                initial_prompt TEXT,
                spec_content TEXT,
                issue_number INTEGER,
                issue_url TEXT,
                pr_number INTEGER,
                pr_url TEXT
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE specs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(repository_path, name)
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sessions (id, name, display_name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at, spec_content)
             VALUES ('s1', 'spec-sess', 'My Spec', '/repo', 'repo', 'b', 'main', '/wt', 'active', 'spec', 100, 200, 'spec body')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO sessions (id, name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at)
             VALUES ('s2', 'running-sess', '/repo', 'repo', 'b2', 'main', '/wt2', 'active', 'running', 100, 200)",
            [],
        )
        .unwrap();

        apply_specs_migrations(&conn).unwrap();

        let spec_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM specs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(spec_count, 1);

        let content: String = conn
            .query_row("SELECT content FROM specs WHERE id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(content, "spec body");

        let remaining_sessions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE session_state = 'spec'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining_sessions, 0);

        let running: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE session_state = 'running'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(running, 1);
    }

    #[test]
    fn schema_creates_expected_indexes() {
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        let conn = db.get_conn().unwrap();

        let expected_indexes = [
            "idx_sessions_repo",
            "idx_sessions_status",
            "idx_sessions_activity",
            "idx_specs_repo",
            "idx_epics_repo",
            "idx_archived_specs_repo",
        ];

        for idx in &expected_indexes {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name=?1",
                    [idx],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "Index '{idx}' should exist after schema init");
        }
    }

    #[test]
    fn schema_drops_incompatible_spec_review_comments_table() {
        use super::initialize_schema;
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        let conn = db.get_conn().unwrap();

        conn.execute("DROP TABLE IF EXISTS spec_review_comments", [])
            .unwrap();
        conn.execute(
            "CREATE TABLE spec_review_comments (
                comment_id TEXT PRIMARY KEY,
                spec_id TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                selected_text TEXT NOT NULL,
                comment TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        drop(conn);

        initialize_schema(&db).unwrap();

        let conn = db.get_conn().unwrap();
        let has_created_at: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('spec_review_comments')
                    WHERE name = 'created_at'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_created_at, 1);

        let has_old_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('spec_review_comments')
                    WHERE name = 'timestamp'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_old_column, 0);
    }

    #[test]
    fn schema_creates_spec_review_comments_table_and_index() {
        use crate::infrastructure::database::connection::Database;
        let db = Database::new_in_memory().unwrap();
        let conn = db.get_conn().unwrap();

        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='spec_review_comments'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            table_exists,
            "spec_review_comments table should exist after schema init"
        );

        let index_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name='idx_spec_review_comments_spec'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            index_exists,
            "idx_spec_review_comments_spec index should exist after schema init"
        );
    }

    #[test]
    fn specs_migration_remaps_legacy_clarified_stage_to_ready() {
        use super::initialize_schema;
        use crate::infrastructure::database::connection::Database;

        let db = Database::new_in_memory().unwrap();
        initialize_schema(&db).unwrap();

        let conn = db.get_conn().unwrap();
        conn.execute(
            "INSERT INTO specs (
                id, name, repository_path, repository_name, content, stage,
                variant, attention_required, clarification_started, created_at, updated_at
             )
             VALUES (
                'spec-legacy-clarified', 'old-spec', '/repo', 'repo', 'body',
                'clarified', 'regular', 0, 0, 0, 0
             )",
            [],
        )
        .unwrap();
        drop(conn);

        initialize_schema(&db).unwrap();

        let conn = db.get_conn().unwrap();
        let stage: String = conn
            .query_row(
                "SELECT stage FROM specs WHERE id = 'spec-legacy-clarified'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            stage, "ready",
            "Legacy 'clarified' stage must be remapped to 'ready' by migration"
        );
    }
}
