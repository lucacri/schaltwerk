use super::connection::Database;
use crate::domains::sessions::entity::{Spec, SpecStage, TaskStageWorkflow, TaskVariant};
use crate::infrastructure::database::timestamps::utc_from_epoch_seconds_lossy;
use anyhow::{Result, anyhow};
use chrono::Utc;
use rusqlite::{Row, params};
use std::path::{Path, PathBuf};

pub trait SpecMethods {
    fn create_spec(&self, spec: &Spec) -> Result<()>;
    fn get_spec_by_name(&self, repo_path: &Path, name: &str) -> Result<Spec>;
    fn get_spec_by_id(&self, id: &str) -> Result<Spec>;
    fn list_specs(&self, repo_path: &Path) -> Result<Vec<Spec>>;
    fn update_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn update_spec_implementation_plan(&self, id: &str, plan: Option<&str>) -> Result<()>;
    fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()>;
    fn update_spec_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()>;
    fn update_spec_stage(&self, id: &str, stage: SpecStage) -> Result<()>;
    fn update_spec_attention_required(&self, id: &str, attention_required: bool) -> Result<()>;
    fn update_spec_clarification_started(
        &self,
        id: &str,
        clarification_started: bool,
    ) -> Result<()>;
    fn update_spec_issue_info(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()>;
    fn update_spec_pr_info(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()>;
    fn update_spec_improve_plan_round_id(&self, id: &str, round_id: Option<&str>) -> Result<()>;
    fn get_spec_by_improve_plan_round_id(&self, repo_path: &Path, round_id: &str) -> Result<Spec>;
    fn update_spec_variant(&self, id: &str, variant: TaskVariant) -> Result<()>;
    fn update_spec_ready_session(
        &self,
        id: &str,
        ready_session_id: Option<&str>,
        ready_branch: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<()>;
    fn list_task_stage_workflows(&self, task_id: &str) -> Result<Vec<TaskStageWorkflow>>;
    fn upsert_task_stage_workflow(&self, workflow: &TaskStageWorkflow) -> Result<()>;
    fn delete_spec(&self, id: &str) -> Result<()>;
}

impl SpecMethods for Database {
    fn create_spec(&self, spec: &Spec) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO specs (
                id, name, display_name,
                epic_id, issue_number, issue_url, pr_number, pr_url,
                improve_plan_round_id, repository_path, repository_name, content,
                implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                attention_required, clarification_started, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                spec.id,
                spec.name,
                spec.display_name,
                spec.epic_id,
                spec.issue_number,
                spec.issue_url,
                spec.pr_number,
                spec.pr_url,
                spec.improve_plan_round_id,
                spec.repository_path.to_string_lossy(),
                spec.repository_name,
                spec.content,
                spec.implementation_plan,
                spec.stage.as_str(),
                spec.variant.as_str(),
                spec.ready_session_id,
                spec.ready_branch,
                spec.base_branch,
                spec.attention_required,
                spec.clarification_started,
                spec.created_at.timestamp(),
                spec.updated_at.timestamp(),
            ],
        )?;
        Ok(())
    }

    fn get_spec_by_name(&self, repo_path: &Path, name: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let repo_str = repo_path.to_string_lossy().into_owned();
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                    attention_required, clarification_started, created_at, updated_at
             FROM specs
             WHERE repository_path = ?1 AND name = ?2",
        )?;

        match stmt.query_row(params![repo_str.as_str(), name], row_to_spec) {
            Ok(spec) => Ok(spec),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // External callers (MCP bridge, clarifier wrapper, agent prompts) often
                // hand us a display_name where the canonical key is `name`. Fall back to
                // display_name but only when unambiguous; display_name has no UNIQUE
                // constraint so multiple matches must surface as not-found rather than
                // silently binding to an arbitrary row.
                let mut fallback_stmt = conn.prepare(
                    "SELECT id, name, display_name,
                            epic_id, issue_number, issue_url, pr_number, pr_url,
                            improve_plan_round_id, repository_path, repository_name, content,
                            implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                            attention_required, clarification_started, created_at, updated_at
                     FROM specs
                     WHERE repository_path = ?1 AND display_name = ?2
                     LIMIT 2",
                )?;
                let mut rows = fallback_stmt.query_map(params![repo_str.as_str(), name], row_to_spec)?;
                let mut matches = Vec::new();
                for row in &mut rows {
                    matches.push(row?);
                    if matches.len() > 1 {
                        break;
                    }
                }

                match matches.len() {
                    0 => Err(rusqlite::Error::QueryReturnedNoRows.into()),
                    1 => Ok(matches.pop().expect("single match must exist")),
                    _ => Err(anyhow!(
                        "Ambiguous spec identifier '{name}' matched multiple display names"
                    )),
                }
            }
            Err(e) => Err(e.into()),
        }
    }

    fn get_spec_by_id(&self, id: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                    attention_required, clarification_started, created_at, updated_at
             FROM specs
             WHERE id = ?1",
        )?;
        let spec = stmt.query_row(params![id], row_to_spec)?;
        Ok(spec)
    }

    fn list_specs(&self, repo_path: &Path) -> Result<Vec<Spec>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                    attention_required, clarification_started, created_at, updated_at
             FROM specs
             WHERE repository_path = ?1
             ORDER BY updated_at DESC, created_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map(params![repo_path.to_string_lossy()], row_to_spec)?;
        let mut specs = Vec::new();
        for row in rows {
            specs.push(row?);
        }
        Ok(specs)
    }

    fn update_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_implementation_plan(&self, id: &str, plan: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET implementation_plan = ?1, updated_at = ?2
             WHERE id = ?3",
            params![plan, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET display_name = ?1, updated_at = ?2
             WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_epic_id(&self, id: &str, epic_id: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET epic_id = ?1, updated_at = ?2
             WHERE id = ?3",
            params![epic_id, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_stage(&self, id: &str, stage: SpecStage) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET stage = ?1, updated_at = ?2
             WHERE id = ?3",
            params![stage.as_str(), Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_attention_required(&self, id: &str, attention_required: bool) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET attention_required = ?1, updated_at = ?2
             WHERE id = ?3",
            params![attention_required, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_clarification_started(
        &self,
        id: &str,
        clarification_started: bool,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET clarification_started = ?1, updated_at = ?2
             WHERE id = ?3",
            params![clarification_started, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_issue_info(
        &self,
        id: &str,
        issue_number: Option<i64>,
        issue_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET issue_number = ?1, issue_url = ?2, updated_at = ?3
             WHERE id = ?4",
            params![issue_number, issue_url, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_pr_info(
        &self,
        id: &str,
        pr_number: Option<i64>,
        pr_url: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET pr_number = ?1, pr_url = ?2, updated_at = ?3
             WHERE id = ?4",
            params![pr_number, pr_url, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_improve_plan_round_id(&self, id: &str, round_id: Option<&str>) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET improve_plan_round_id = ?1, updated_at = ?2
             WHERE id = ?3",
            params![round_id, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn get_spec_by_improve_plan_round_id(&self, repo_path: &Path, round_id: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                    attention_required, clarification_started, created_at, updated_at
             FROM specs
             WHERE repository_path = ?1 AND improve_plan_round_id = ?2",
        )?;
        let spec = stmt.query_row(params![repo_path.to_string_lossy(), round_id], row_to_spec)?;
        Ok(spec)
    }

    fn update_spec_variant(&self, id: &str, variant: TaskVariant) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET variant = ?1, updated_at = ?2
             WHERE id = ?3",
            params![variant.as_str(), Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_spec_ready_session(
        &self,
        id: &str,
        ready_session_id: Option<&str>,
        ready_branch: Option<&str>,
        base_branch: Option<&str>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE specs
             SET ready_session_id = ?1,
                 ready_branch = ?2,
                 base_branch = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            params![
                ready_session_id,
                ready_branch,
                base_branch,
                Utc::now().timestamp(),
                id,
            ],
        )?;
        Ok(())
    }

    fn list_task_stage_workflows(&self, task_id: &str) -> Result<Vec<TaskStageWorkflow>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT task_id, stage, preset_id, judge_preset_id, auto_chain
             FROM task_stage_workflows
             WHERE task_id = ?1
             ORDER BY stage ASC",
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            let stage_text: String = row.get(1)?;
            let stage = stage_text.parse().map_err(|err: String| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
                )
            })?;
            Ok(TaskStageWorkflow {
                task_id: row.get(0)?,
                stage,
                preset_id: row.get(2)?,
                judge_preset_id: row.get(3)?,
                auto_chain: row.get::<_, bool>(4).unwrap_or(false),
            })
        })?;
        let mut workflows = Vec::new();
        for row in rows {
            workflows.push(row?);
        }
        Ok(workflows)
    }

    fn upsert_task_stage_workflow(&self, workflow: &TaskStageWorkflow) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "INSERT INTO task_stage_workflows (task_id, stage, preset_id, judge_preset_id, auto_chain)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(task_id, stage) DO UPDATE SET
                 preset_id = excluded.preset_id,
                 judge_preset_id = excluded.judge_preset_id,
                 auto_chain = excluded.auto_chain",
            params![
                workflow.task_id,
                workflow.stage.as_str(),
                workflow.preset_id,
                workflow.judge_preset_id,
                workflow.auto_chain,
            ],
        )?;
        Ok(())
    }

    fn delete_spec(&self, id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute("DELETE FROM specs WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn row_to_spec(row: &Row<'_>) -> rusqlite::Result<Spec> {
    Ok(Spec {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        epic_id: row.get(3)?,
        issue_number: row.get(4)?,
        issue_url: row.get(5)?,
        pr_number: row.get(6)?,
        pr_url: row.get(7)?,
        improve_plan_round_id: row.get(8)?,
        repository_path: PathBuf::from(row.get::<_, String>(9)?),
        repository_name: row.get(10)?,
        content: row.get(11)?,
        implementation_plan: row.get(12)?,
        stage: row.get::<_, String>(13)?.parse().map_err(|err: String| {
            rusqlite::Error::FromSqlConversionFailure(
                13,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
            )
        })?,
        variant: row
            .get::<_, String>(14)?
            .parse()
            .unwrap_or(TaskVariant::Regular),
        ready_session_id: row.get(15)?,
        ready_branch: row.get(16)?,
        base_branch: row.get(17)?,
        attention_required: row.get(18)?,
        clarification_started: row.get(19)?,
        created_at: {
            let ts: i64 = row.get(20)?;
            utc_from_epoch_seconds_lossy(ts)
        },
        updated_at: {
            let ts: i64 = row.get(21)?;
            utc_from_epoch_seconds_lossy(ts)
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;
    use chrono::Utc;
    use std::path::PathBuf;

    fn create_test_database() -> Database {
        Database::new_in_memory().expect("Failed to create in-memory database")
    }

    fn make_spec(id: &str, name: &str, repo_path: &str) -> Spec {
        let now = Utc::now();
        Spec {
            id: id.to_string(),
            name: name.to_string(),
            display_name: None,
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from(repo_path),
            repository_name: "test-repo".to_string(),
            content: "spec content".to_string(),
            implementation_plan: None,
            stage: SpecStage::Draft,
            variant: TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: false,
            clarification_started: false,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn create_and_get_spec_by_id() {
        let db = create_test_database();
        let spec = make_spec("s1", "my-spec", "/repo");
        db.create_spec(&spec).unwrap();

        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.id, "s1");
        assert_eq!(fetched.name, "my-spec");
        assert_eq!(fetched.content, "spec content");
        assert_eq!(fetched.repository_path, PathBuf::from("/repo"));
    }

    #[test]
    fn get_spec_by_name() {
        let db = create_test_database();
        let spec = make_spec("s2", "named-spec", "/repo");
        db.create_spec(&spec).unwrap();

        let fetched = db
            .get_spec_by_name(Path::new("/repo"), "named-spec")
            .unwrap();
        assert_eq!(fetched.id, "s2");
    }

    #[test]
    fn updates_stage_attention_and_clarification_flags() {
        let db = create_test_database();
        let spec = make_spec("s3", "clarify-me", "/repo");
        db.create_spec(&spec).unwrap();

        db.update_spec_stage("s3", SpecStage::Ready).unwrap();
        db.update_spec_attention_required("s3", true).unwrap();
        db.update_spec_clarification_started("s3", true).unwrap();

        let fetched = db.get_spec_by_id("s3").unwrap();
        assert_eq!(fetched.stage, SpecStage::Ready);
        assert!(fetched.attention_required);
        assert!(fetched.clarification_started);
    }

    #[test]
    fn clarified_spec_stage_rows_reload_as_ready() {
        let db = create_test_database();
        let now = Utc::now().timestamp();
        let conn = db.get_conn().expect("db conn");
        conn.execute(
            "INSERT INTO specs (
                id, name, display_name, epic_id, issue_number, issue_url, pr_number, pr_url,
                improve_plan_round_id, repository_path, repository_name, content,
                implementation_plan, stage, variant, ready_session_id, ready_branch, base_branch,
                attention_required, clarification_started, created_at, updated_at
            ) VALUES (?1, ?2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?3, ?4, ?5, NULL, 'clarified', 'regular', NULL, NULL, NULL, FALSE, FALSE, ?6, ?6)",
            params![
                "legacy-clarified",
                "legacy-clarified",
                "/repo",
                "test-repo",
                "legacy content",
                now,
            ],
        )
        .expect("insert legacy clarified spec");

        let fetched = db
            .get_spec_by_id("legacy-clarified")
            .expect("legacy clarified spec should load");

        assert_eq!(fetched.stage, SpecStage::Ready);
    }

    #[test]
    fn get_spec_by_name_not_found() {
        let db = create_test_database();
        let result = db.get_spec_by_name(Path::new("/repo"), "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn get_spec_by_id_not_found() {
        let db = create_test_database();
        let result = db.get_spec_by_id("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn list_specs_empty() {
        let db = create_test_database();
        let specs = db.list_specs(Path::new("/repo")).unwrap();
        assert!(specs.is_empty());
    }

    #[test]
    fn list_specs_returns_only_matching_repo() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "spec-a", "/repo-a"))
            .unwrap();
        db.create_spec(&make_spec("s2", "spec-b", "/repo-b"))
            .unwrap();

        let specs = db.list_specs(Path::new("/repo-a")).unwrap();
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].id, "s1");
    }

    #[test]
    fn update_spec_implementation_plan_roundtrip() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "plan-spec", "/repo"))
            .unwrap();
        assert!(
            db.get_spec_by_id("s1")
                .unwrap()
                .implementation_plan
                .is_none()
        );

        db.update_spec_implementation_plan("s1", Some("My plan body"))
            .unwrap();
        assert_eq!(
            db.get_spec_by_id("s1")
                .unwrap()
                .implementation_plan
                .as_deref(),
            Some("My plan body"),
        );

        db.update_spec_implementation_plan("s1", None).unwrap();
        assert!(
            db.get_spec_by_id("s1")
                .unwrap()
                .implementation_plan
                .is_none()
        );
    }

    #[test]
    fn update_spec_content() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "my-spec", "/repo"))
            .unwrap();

        db.update_spec_content("s1", "updated content").unwrap();

        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.content, "updated content");
        assert!(fetched.updated_at >= fetched.created_at);
    }

    #[test]
    fn update_spec_display_name() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "my-spec", "/repo"))
            .unwrap();

        db.update_spec_display_name("s1", "Pretty Name").unwrap();

        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.display_name, Some("Pretty Name".to_string()));
    }

    #[test]
    fn update_spec_epic_id() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "my-spec", "/repo"))
            .unwrap();

        db.update_spec_epic_id("s1", Some("epic-1")).unwrap();
        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.epic_id, Some("epic-1".to_string()));

        db.update_spec_epic_id("s1", None).unwrap();
        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.epic_id, None);
    }

    #[test]
    fn delete_spec() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "my-spec", "/repo"))
            .unwrap();

        db.delete_spec("s1").unwrap();

        let result = db.get_spec_by_id("s1");
        assert!(result.is_err());
    }

    #[test]
    fn create_duplicate_name_same_repo_fails() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "dup-name", "/repo"))
            .unwrap();

        let mut dup = make_spec("s2", "dup-name", "/repo");
        dup.id = "s2".to_string();
        let result = db.create_spec(&dup);
        assert!(result.is_err());
    }

    #[test]
    fn create_same_name_different_repo_ok() {
        let db = create_test_database();
        db.create_spec(&make_spec("s1", "shared-name", "/repo-a"))
            .unwrap();
        db.create_spec(&make_spec("s2", "shared-name", "/repo-b"))
            .unwrap();

        let a = db
            .get_spec_by_name(Path::new("/repo-a"), "shared-name")
            .unwrap();
        let b = db
            .get_spec_by_name(Path::new("/repo-b"), "shared-name")
            .unwrap();
        assert_eq!(a.id, "s1");
        assert_eq!(b.id, "s2");
    }

    fn make_spec_with_display(
        id: &str,
        name: &str,
        display_name: Option<&str>,
        repo_path: &str,
    ) -> Spec {
        let mut spec = make_spec(id, name, repo_path);
        spec.display_name = display_name.map(|s| s.to_string());
        spec
    }

    #[test]
    fn get_spec_by_name_falls_back_to_display_name() {
        let db = create_test_database();
        db.create_spec(&make_spec_with_display(
            "s1",
            "the_agent_terminal_now",
            Some("fix-tmux-scrollback"),
            "/repo",
        ))
        .unwrap();

        let fetched = db
            .get_spec_by_name(Path::new("/repo"), "fix-tmux-scrollback")
            .expect("display_name lookup should fall back");
        assert_eq!(fetched.id, "s1");
        assert_eq!(fetched.name, "the_agent_terminal_now");
        assert_eq!(fetched.display_name.as_deref(), Some("fix-tmux-scrollback"));
    }

    #[test]
    fn get_spec_by_name_prefers_name_over_display_name() {
        let db = create_test_database();
        db.create_spec(&make_spec_with_display(
            "owner",
            "shared-slug",
            Some("shared-slug-display"),
            "/repo",
        ))
        .unwrap();
        db.create_spec(&make_spec_with_display(
            "aliased",
            "other-slug",
            Some("shared-slug"),
            "/repo",
        ))
        .unwrap();

        let fetched = db
            .get_spec_by_name(Path::new("/repo"), "shared-slug")
            .expect("name lookup should win");
        assert_eq!(fetched.id, "owner");
    }

    #[test]
    fn get_spec_by_name_returns_clear_error_when_display_name_is_ambiguous() {
        let db = create_test_database();
        db.create_spec(&make_spec_with_display(
            "s1",
            "slug-one",
            Some("duplicate-display"),
            "/repo",
        ))
        .unwrap();
        db.create_spec(&make_spec_with_display(
            "s2",
            "slug-two",
            Some("duplicate-display"),
            "/repo",
        ))
        .unwrap();

        let error = db
            .get_spec_by_name(Path::new("/repo"), "duplicate-display")
            .expect_err("ambiguous display_name must not silently pick a winner")
            .to_string();
        assert!(error.contains("Ambiguous spec identifier"));
        assert!(error.contains("duplicate-display"));
    }

    #[test]
    fn get_spec_by_name_ignores_display_name_in_other_repo() {
        let db = create_test_database();
        db.create_spec(&make_spec_with_display(
            "s1",
            "real-name",
            Some("shared-display"),
            "/repo-a",
        ))
        .unwrap();

        let result = db.get_spec_by_name(Path::new("/repo-b"), "shared-display");
        assert!(
            result.is_err(),
            "display_name fallback must stay scoped to repository_path"
        );
    }

    #[test]
    fn spec_with_display_name_and_epic() {
        let db = create_test_database();
        let now = Utc::now();
        let spec = Spec {
            id: "s1".to_string(),
            name: "my-spec".to_string(),
            display_name: Some("My Spec".to_string()),
            epic_id: Some("epic-42".to_string()),
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "test-repo".to_string(),
            content: "content".to_string(),
            implementation_plan: None,
            stage: SpecStage::Draft,
            variant: TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: false,
            clarification_started: false,
            created_at: now,
            updated_at: now,
        };
        db.create_spec(&spec).unwrap();

        let fetched = db.get_spec_by_id("s1").unwrap();
        assert_eq!(fetched.display_name, Some("My Spec".to_string()));
        assert_eq!(fetched.epic_id, Some("epic-42".to_string()));
    }
}
