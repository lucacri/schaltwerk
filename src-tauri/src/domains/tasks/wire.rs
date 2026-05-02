//! Phase 7 Wave A.1: wire-shape extensions for the task aggregate.
//!
//! v2's `Task` struct does not carry artifact bodies (Phase 4 Wave F made them
//! derived getters that need `&Database`). v2's `TaskRun` does not carry a
//! `status` field (Phase 1 collapsed it into a derived getter `compute_run_status`).
//! Phase 7's frontend needs both surfaces. This module provides:
//!
//! 1. [`TaskWithBodies`] — wire-only wrapper around a [`Task`] that adds three
//!    optional body fields. Returned by `lucode_task_get` only; list/refresh
//!    payloads keep the body-free `Task` shape per the §0.3 split decision.
//! 2. [`enrich_task_runs_with_derived_status`] — populates each
//!    [`TaskRun::derived_status`] field from `compute_run_status` and the
//!    bound session-fact rows. Called by every read handler that returns a
//!    `Task`, `Vec<Task>`, `TaskRun`, or `Vec<TaskRun>` so the wire payload
//!    always carries the derived enum.
//!
//! The split is per [`plans/2026-04-29-task-flow-v2-phase-7-plan.md`] §0.3:
//! list and refresh payloads are body-free (cheap broadcast on every mutation);
//! get-by-id carries bodies. `derived_status` is always present on wire `TaskRun`s.

use crate::domains::sessions::db_sessions::SessionMethods;
use crate::domains::tasks::entity::Task;
use crate::domains::tasks::run_status::{SessionFacts, compute_run_status};
use crate::infrastructure::database::Database;
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Wire payload returned by `lucode_task_get`.
///
/// Wraps a [`Task`] (flattened into the same JSON object) and adds the three
/// optional body fields populated from the derived `current_*` getters. The
/// canonical [`Task`] struct stays body-free so list and refresh payloads —
/// which serialize tasks in bulk and would balloon under per-task body
/// inclusion — remain compact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithBodies {
    #[serde(flatten)]
    pub task: Task,
    /// Body of the current Spec artifact (`is_current = true`, `kind = spec`).
    /// `None` when no current Spec artifact exists for this task.
    pub current_spec_body: Option<String>,
    /// Body of the current Plan artifact.
    pub current_plan_body: Option<String>,
    /// Body of the current Summary artifact.
    pub current_summary_body: Option<String>,
}

impl TaskWithBodies {
    /// Construct a [`TaskWithBodies`] by reading the three current artifact
    /// bodies through the derived getters on [`Task`]. The `task.task_runs`
    /// embedded vector should already have been enriched by
    /// [`enrich_task_runs_with_derived_status`] before this is called.
    pub fn from_task(task: Task, db: &Database) -> Result<Self> {
        let current_spec_body = task.current_spec(db)?;
        let current_plan_body = task.current_plan(db)?;
        let current_summary_body = task.current_summary(db)?;
        Ok(Self {
            task,
            current_spec_body,
            current_plan_body,
            current_summary_body,
        })
    }
}

/// Populate `task.task_runs[*].derived_status` for every embedded run on the
/// task by calling [`compute_run_status`] over the bound session facts.
///
/// Idempotent — re-running on an already-enriched task is a no-op (the
/// derivation is a pure function of inputs).
pub fn enrich_task_runs_with_derived_status<T>(task: &mut Task, db: &T) -> Result<()>
where
    T: SessionMethods,
{
    for run in task.task_runs.iter_mut() {
        let sessions = db.get_sessions_by_task_run_id(&run.id)?;
        let facts: Vec<SessionFacts> = sessions
            .iter()
            .map(|s| SessionFacts {
                task_run_id: s.task_run_id.clone(),
                exit_code: s.exit_code,
                first_idle_at: s.first_idle_at,
            })
            .collect();
        run.derived_status = Some(compute_run_status(run, &facts));
    }
    Ok(())
}

/// Same as [`enrich_task_runs_with_derived_status`] but operates on a bare
/// run vector — used by `lucode_task_run_list` / `lucode_task_run_get` which
/// return runs without a parent `Task` envelope.
pub fn enrich_runs_with_derived_status<T>(
    runs: &mut [crate::domains::tasks::entity::TaskRun],
    db: &T,
) -> Result<()>
where
    T: SessionMethods,
{
    for run in runs.iter_mut() {
        let sessions = db.get_sessions_by_task_run_id(&run.id)?;
        let facts: Vec<SessionFacts> = sessions
            .iter()
            .map(|s| SessionFacts {
                task_run_id: s.task_run_id.clone(),
                exit_code: s.exit_code,
                first_idle_at: s.first_idle_at,
            })
            .collect();
        run.derived_status = Some(compute_run_status(run, &facts));
    }
    Ok(())
}

/// Apply [`enrich_task_runs_with_derived_status`] to every task in a slice.
/// Used by `lucode_task_list` and the `TasksRefreshedPayload` builder.
pub fn enrich_tasks_with_derived_run_statuses<T>(tasks: &mut [Task], db: &T) -> Result<()>
where
    T: SessionMethods,
{
    for task in tasks.iter_mut() {
        enrich_task_runs_with_derived_status(task, db)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::{
        TaskArtifactKind, TaskRunStatus, TaskStage, TaskVariant,
    };
    use crate::domains::tasks::runs::TaskRunService;
    use crate::domains::tasks::service::{CreateTaskInput, TaskService};
    use crate::infrastructure::database::Database;
    use std::path::PathBuf;

    fn fresh_db_and_repo() -> (Database, PathBuf) {
        let db = Database::new_in_memory().expect("create in-memory db");
        let repo = PathBuf::from("/tmp/wire-tests-repo");
        (db, repo)
    }

    fn create_task(db: &Database, repo: &std::path::Path, name: &str) -> Task {
        let body = format!("body for {name}");
        TaskService::new(db)
            .create_task(CreateTaskInput {
                name,
                display_name: None,
                repository_path: repo,
                repository_name: "wire-tests-repo",
                request_body: &body,
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: None,
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("create task")
    }

    /// Wave A.1.a positive pin: when a current Spec artifact exists for the
    /// task, `TaskWithBodies::from_task` carries its content through the
    /// `current_spec_body` field. Per `feedback_compile_pins_dont_catch_wiring.md`
    /// — this exercises the actual production read path
    /// (`task.current_spec(&db)` against `task_artifacts` rows inserted via
    /// `mark_task_artifact_current`).
    #[test]
    fn task_with_bodies_carries_current_spec_body_when_artifact_exists() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "with-spec");

        let svc = TaskService::new(&db);
        svc.update_content(&task.id, TaskArtifactKind::Spec, "spec body v1", None, None)
            .expect("write spec artifact");

        let task = svc.get_task(&task.id).expect("reload task");
        let wired = TaskWithBodies::from_task(task, &db).expect("build wire payload");

        assert_eq!(
            wired.current_spec_body.as_deref(),
            Some("spec body v1"),
            "wire shape must carry current Spec body"
        );
    }

    /// Negative side: tasks without artifacts get `None` body fields, not a
    /// silent empty string or panic. Bug-class regression for the kind of UI
    /// fallback synthesis the user has called out before.
    #[test]
    fn task_with_bodies_returns_none_when_no_current_artifacts_exist() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "no-artifacts");
        let wired = TaskWithBodies::from_task(task, &db).expect("build wire payload");

        assert!(wired.current_spec_body.is_none());
        assert!(wired.current_plan_body.is_none());
        assert!(wired.current_summary_body.is_none());
    }

    /// Round-trip pin for the kind dispatch. A Spec artifact must NOT show up
    /// under `current_plan_body`. Ports the safety guard from
    /// `Task::current_plan_round_trips_independent_of_other_kinds`
    /// (Phase 4 Wave F) to the wire boundary.
    #[test]
    fn task_with_bodies_kind_dispatch_does_not_cross_artifacts() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "spec-only");
        let svc = TaskService::new(&db);
        svc.update_content(&task.id, TaskArtifactKind::Spec, "only spec", None, None)
            .expect("write spec");

        let task = svc.get_task(&task.id).expect("reload");
        let wired = TaskWithBodies::from_task(task, &db).expect("wire");

        assert_eq!(wired.current_spec_body.as_deref(), Some("only spec"));
        assert!(
            wired.current_plan_body.is_none(),
            "Spec artifact must not bleed into current_plan_body"
        );
        assert!(wired.current_summary_body.is_none());
    }

    /// Wave A.1.a primary pin: enrichment writes `derived_status` to every
    /// embedded run by routing the run + bound session facts through
    /// `compute_run_status`. The round-trip exercises the production read
    /// path (DB-stored run + DB-stored session-fact columns).
    #[test]
    fn task_run_wire_payload_carries_derived_status_through_compute_run_status() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "with-run");

        // Provision a run with a single session that has not yet idled —
        // expected derivation: Running.
        let run = TaskRunService::new(&db)
            .create_task_run(&task.id, TaskStage::Brainstormed, None, None, None)
            .expect("create run");

        // Insert a session bound to this run with no exit code and no idle.
        let session_id = format!("sess-{}-running", run.id);
        let session = synthetic_session(&session_id, &task.repository_path, Some(&run.id));
        db.create_session(&session).expect("persist session");
        link_session_to_run(&db, &session_id, &run.id);

        // Re-load task and enrich.
        let mut task = TaskService::new(&db).get_task(&task.id).expect("reload");
        super::enrich_task_runs_with_derived_status(&mut task, &db).expect("enrich");

        assert_eq!(task.task_runs.len(), 1);
        assert_eq!(
            task.task_runs[0].derived_status,
            Some(TaskRunStatus::Running),
            "derived_status must reflect compute_run_status output"
        );
    }

    /// Two-way binding for the AwaitingSelection branch: once the bound
    /// session has `first_idle_at` set, enrichment must flip the wire
    /// `derived_status` to `AwaitingSelection`. Per
    /// `feedback_compile_pins_dont_catch_wiring.md` the test exercises the
    /// production `set_session_first_idle_at` writer + the production
    /// `get_sessions_by_task_run_id` reader.
    #[test]
    fn enrichment_flips_to_awaiting_selection_when_bound_session_has_first_idle() {
        use crate::domains::sessions::db_sessions::SessionMethods;
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "idle-flip");
        let run = TaskRunService::new(&db)
            .create_task_run(&task.id, TaskStage::Brainstormed, None, None, None)
            .expect("create run");

        let session_id = format!("sess-{}-idle", run.id);
        let session = synthetic_session(&session_id, &task.repository_path, Some(&run.id));
        db.create_session(&session).expect("persist session");
        link_session_to_run(&db, &session_id, &run.id);
        db.set_session_first_idle_at(&session_id, chrono::Utc::now())
            .expect("set first_idle_at");

        let mut task = TaskService::new(&db).get_task(&task.id).expect("reload");
        super::enrich_task_runs_with_derived_status(&mut task, &db).expect("enrich");

        assert_eq!(
            task.task_runs[0].derived_status,
            Some(TaskRunStatus::AwaitingSelection),
            "first_idle_at on every bound session must produce AwaitingSelection"
        );
    }

    /// Phase 7 Wave A.1 multi-task pin: the list/refresh enrichment helper
    /// (`enrich_tasks_with_derived_run_statuses`) must populate every run
    /// across every task, not just the first task's runs. Bug-class guard
    /// against an early-return regression in the loop body.
    #[test]
    fn enrich_tasks_with_derived_run_statuses_covers_every_task_and_run() {
        let (db, repo) = fresh_db_and_repo();
        let task_a = create_task(&db, &repo, "alpha");
        let task_b = create_task(&db, &repo, "bravo");

        TaskRunService::new(&db)
            .create_task_run(&task_a.id, TaskStage::Brainstormed, None, None, None)
            .expect("run a1");
        TaskRunService::new(&db)
            .create_task_run(&task_a.id, TaskStage::Planned, None, None, None)
            .expect("run a2");
        TaskRunService::new(&db)
            .create_task_run(&task_b.id, TaskStage::Brainstormed, None, None, None)
            .expect("run b1");

        let mut tasks = vec![
            TaskService::new(&db).get_task(&task_a.id).expect("reload a"),
            TaskService::new(&db).get_task(&task_b.id).expect("reload b"),
        ];

        super::enrich_tasks_with_derived_run_statuses(&mut tasks, &db).expect("enrich");

        for task in &tasks {
            assert!(
                !task.task_runs.is_empty(),
                "fixture: task {} should have runs",
                task.name
            );
            for run in &task.task_runs {
                assert!(
                    run.derived_status.is_some(),
                    "every run on every task must carry derived_status after enrichment, \
                     but run {} on task {} did not",
                    run.id,
                    task.name
                );
            }
        }
    }

    /// Helper: bind a freshly-created session row to a task run via raw
    /// UPDATE. Mirrors the pattern in `db_sessions::tests::link_session_to_run`
    /// — `create_session` predates the task-run binding columns and does not
    /// write `task_run_id` directly.
    fn link_session_to_run(db: &Database, session_id: &str, task_run_id: &str) {
        let conn = db.get_conn().expect("conn");
        conn.execute(
            "UPDATE sessions SET task_run_id = ?1 WHERE id = ?2",
            rusqlite::params![task_run_id, session_id],
        )
        .expect("link");
    }

    /// Wave A.1.a regression guard: serialized `Task` JSON (the list/refresh
    /// shape) must NOT carry body fields, even after the wire-shape extension
    /// lands. Asserted via JSON key inspection so a future serde annotation
    /// drift would fail this test.
    #[test]
    fn serialized_task_omits_body_fields_in_list_shape() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "list-shape");
        // Even with a current Spec artifact present:
        TaskService::new(&db)
            .update_content(
                &task.id,
                TaskArtifactKind::Spec,
                "should-not-bleed",
                None,
                None,
            )
            .expect("write spec");

        let task = TaskService::new(&db).get_task(&task.id).expect("reload");
        let json = serde_json::to_value(&task).expect("serialize task");
        let obj = json.as_object().expect("task serializes as object");

        assert!(
            !obj.contains_key("current_spec_body"),
            "Task list/refresh shape must not include body fields; \
             body shape is the get-by-id surface only"
        );
        assert!(!obj.contains_key("current_plan_body"));
        assert!(!obj.contains_key("current_summary_body"));
    }

    /// Wave A.1.a positive pin for the get shape: `TaskWithBodies` JSON
    /// includes `current_spec_body` (when present) at the top level via
    /// `#[serde(flatten)]`. Sibling assertion to the negative test above.
    #[test]
    fn serialized_task_with_bodies_includes_body_fields_in_get_shape() {
        let (db, repo) = fresh_db_and_repo();
        let task = create_task(&db, &repo, "get-shape");
        TaskService::new(&db)
            .update_content(&task.id, TaskArtifactKind::Spec, "the body", None, None)
            .expect("write spec");

        let task = TaskService::new(&db).get_task(&task.id).expect("reload");
        let wired = TaskWithBodies::from_task(task, &db).expect("wire");
        let json = serde_json::to_value(&wired).expect("serialize wire");
        let obj = json.as_object().expect("wire serializes as object");

        assert!(obj.contains_key("id"), "flatten must lift base Task fields");
        assert_eq!(
            obj.get("current_spec_body").and_then(|v| v.as_str()),
            Some("the body"),
            "get shape must carry current_spec_body"
        );
        assert!(obj.contains_key("current_plan_body"));
        assert!(obj.contains_key("current_summary_body"));
    }

    /// Helper: synthesize a Session row with the minimum fields required by
    /// the v2 sessions schema for binding to a task_run. Mirrors
    /// `db_sessions::tests::make_session_for_run` — kept inline rather than
    /// crossing a `pub(crate)` test boundary because that helper isn't
    /// exported from the test module.
    fn synthetic_session(
        id: &str,
        repository_path: &std::path::Path,
        task_run_id: Option<&str>,
    ) -> crate::domains::sessions::entity::Session {
        use crate::domains::sessions::entity::Session;
        Session {
            id: id.to_string(),
            name: id.to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: repository_path.to_path_buf(),
            repository_name: "wire-tests-repo".to_string(),
            branch: format!("lucode/{id}"),
            parent_branch: "main".to_string(),
            original_parent_branch: Some("main".to_string()),
            worktree_path: repository_path.join(format!(".lucode/worktrees/{id}")),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_agent_model: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            resume_allowed: true,
            amp_thread_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            is_consolidation: false,
            consolidation_sources: None,
            consolidation_round_id: None,
            consolidation_role: None,
            consolidation_report: None,
            consolidation_report_source: None,
            consolidation_base_session_id: None,
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: None,
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,
            task_run_id: task_run_id.map(String::from),
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
            is_spec: false,
            cancelled_at: None,
        }
    }
}
