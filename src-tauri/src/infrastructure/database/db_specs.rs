use super::connection::Database;
use crate::domains::sessions::entity::{Spec, SpecStage};
use crate::infrastructure::database::timestamps::utc_from_epoch_seconds_lossy;
use anyhow::Result;
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
                implementation_plan, stage, attention_required, clarification_started,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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
        let repo_str = repo_path.to_string_lossy();
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, attention_required, clarification_started,
                    created_at, updated_at
             FROM specs
             WHERE repository_path = ?1 AND name = ?2",
        )?;

        let spec = stmt.query_row(params![repo_str, name], row_to_spec)?;
        Ok(spec)
    }

    fn get_spec_by_id(&self, id: &str) -> Result<Spec> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, display_name,
                    epic_id, issue_number, issue_url, pr_number, pr_url,
                    improve_plan_round_id, repository_path, repository_name, content,
                    implementation_plan, stage, attention_required, clarification_started,
                    created_at, updated_at
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
                    implementation_plan, stage, attention_required, clarification_started,
                    created_at, updated_at
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
                    implementation_plan, stage, attention_required, clarification_started,
                    created_at, updated_at
             FROM specs
             WHERE repository_path = ?1 AND improve_plan_round_id = ?2",
        )?;
        let spec = stmt.query_row(params![repo_path.to_string_lossy(), round_id], row_to_spec)?;
        Ok(spec)
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
        attention_required: row.get(14)?,
        clarification_started: row.get(15)?,
        created_at: {
            let ts: i64 = row.get(16)?;
            utc_from_epoch_seconds_lossy(ts)
        },
        updated_at: {
            let ts: i64 = row.get(17)?;
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

        db.update_spec_stage("s3", SpecStage::Clarified).unwrap();
        db.update_spec_attention_required("s3", true).unwrap();
        db.update_spec_clarification_started("s3", true).unwrap();

        let fetched = db.get_spec_by_id("s3").unwrap();
        assert_eq!(fetched.stage, SpecStage::Clarified);
        assert!(fetched.attention_required);
        assert!(fetched.clarification_started);
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
