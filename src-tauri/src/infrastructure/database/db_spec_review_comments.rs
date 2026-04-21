use super::connection::Database;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PersistedSpecReviewComment {
    pub id: String,
    pub spec_id: String,
    pub line_start: i64,
    pub line_end: i64,
    pub selected_text: String,
    pub comment: String,
    pub created_at: i64,
}

pub trait SpecReviewCommentMethods {
    fn list_spec_review_comments(&self, spec_id: &str)
    -> Result<Vec<PersistedSpecReviewComment>>;

    fn replace_spec_review_comments(
        &self,
        spec_id: &str,
        comments: &[PersistedSpecReviewComment],
    ) -> Result<()>;

    fn clear_spec_review_comments(&self, spec_id: &str) -> Result<()>;
}

impl SpecReviewCommentMethods for Database {
    fn list_spec_review_comments(
        &self,
        spec_id: &str,
    ) -> Result<Vec<PersistedSpecReviewComment>> {
        let conn = self.get_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, spec_id, line_start, line_end, selected_text, comment, created_at
             FROM spec_review_comments
             WHERE spec_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![spec_id], |row| {
            Ok(PersistedSpecReviewComment {
                id: row.get(0)?,
                spec_id: row.get(1)?,
                line_start: row.get(2)?,
                line_end: row.get(3)?,
                selected_text: row.get(4)?,
                comment: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    fn replace_spec_review_comments(
        &self,
        spec_id: &str,
        comments: &[PersistedSpecReviewComment],
    ) -> Result<()> {
        let mut conn = self.get_conn()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM spec_review_comments WHERE spec_id = ?1",
            params![spec_id],
        )?;
        for c in comments {
            tx.execute(
                "INSERT INTO spec_review_comments (
                    id, spec_id, line_start, line_end, selected_text, comment, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    c.id,
                    spec_id,
                    c.line_start,
                    c.line_end,
                    c.selected_text,
                    c.comment,
                    c.created_at,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn clear_spec_review_comments(&self, spec_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "DELETE FROM spec_review_comments WHERE spec_id = ?1",
            params![spec_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::entity::{Spec, SpecStage};
    use crate::infrastructure::database::connection::Database;
    use crate::infrastructure::database::db_specs::SpecMethods;
    use chrono::Utc;
    use std::path::PathBuf;

    fn seed_spec(db: &Database, id: &str) {
        let now = Utc::now();
        db.create_spec(&Spec {
            id: id.to_string(),
            name: format!("name-{id}"),
            display_name: None,
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".to_string(),
            content: "spec content".to_string(),
            implementation_plan: None,
            stage: SpecStage::Draft,
            variant: crate::domains::sessions::entity::TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: false,
            clarification_started: false,
            created_at: now,
            updated_at: now,
        })
        .unwrap();
    }

    fn make(id: &str, spec_id: &str, ts: i64) -> PersistedSpecReviewComment {
        PersistedSpecReviewComment {
            id: id.to_string(),
            spec_id: spec_id.to_string(),
            line_start: 1,
            line_end: 3,
            selected_text: "line body".to_string(),
            comment: "nit".to_string(),
            created_at: ts,
        }
    }

    #[test]
    fn replace_inserts_and_list_reads_in_order() {
        let db = Database::new_in_memory().unwrap();
        seed_spec(&db, "s1");

        db.replace_spec_review_comments(
            "s1",
            &[make("c1", "s1", 100), make("c2", "s1", 200)],
        )
        .unwrap();

        let fetched = db.list_spec_review_comments("s1").unwrap();
        assert_eq!(fetched.len(), 2);
        assert_eq!(fetched[0].id, "c1");
        assert_eq!(fetched[1].id, "c2");
        assert_eq!(fetched[0].line_start, 1);
        assert_eq!(fetched[0].line_end, 3);
        assert_eq!(fetched[0].comment, "nit");
    }

    #[test]
    fn replace_overwrites_existing_rows() {
        let db = Database::new_in_memory().unwrap();
        seed_spec(&db, "s1");

        db.replace_spec_review_comments("s1", &[make("c1", "s1", 1)])
            .unwrap();
        db.replace_spec_review_comments(
            "s1",
            &[make("c2", "s1", 2), make("c3", "s1", 3)],
        )
        .unwrap();

        let fetched = db.list_spec_review_comments("s1").unwrap();
        let ids: Vec<_> = fetched.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["c2", "c3"]);
    }

    #[test]
    fn clear_removes_only_scoped_spec() {
        let db = Database::new_in_memory().unwrap();
        seed_spec(&db, "s1");
        seed_spec(&db, "s2");

        db.replace_spec_review_comments("s1", &[make("a", "s1", 1)])
            .unwrap();
        db.replace_spec_review_comments("s2", &[make("b", "s2", 1)])
            .unwrap();

        db.clear_spec_review_comments("s1").unwrap();

        assert!(db.list_spec_review_comments("s1").unwrap().is_empty());
        assert_eq!(db.list_spec_review_comments("s2").unwrap().len(), 1);
    }

    #[test]
    fn deleting_spec_cascades_comments() {
        let db = Database::new_in_memory().unwrap();
        seed_spec(&db, "s1");
        db.replace_spec_review_comments("s1", &[make("a", "s1", 1)])
            .unwrap();

        db.delete_spec("s1").unwrap();

        assert!(db.list_spec_review_comments("s1").unwrap().is_empty());
    }

    #[test]
    fn list_for_unknown_spec_is_empty() {
        let db = Database::new_in_memory().unwrap();
        assert!(db.list_spec_review_comments("missing").unwrap().is_empty());
    }
}
