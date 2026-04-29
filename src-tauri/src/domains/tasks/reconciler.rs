use crate::domains::sessions::db_sessions::SessionMethods;
use crate::domains::tasks::entity::{Task, TaskRunStatus, TaskStage};
use crate::domains::tasks::run_status::{SessionFacts, compute_run_status};
use crate::infrastructure::database::{TaskMethods, TaskRunMethods};
use anyhow::Result;
use std::path::Path;

fn stage_rank(stage: TaskStage) -> u8 {
    match stage {
        TaskStage::Draft => 0,
        TaskStage::Ready => 1,
        TaskStage::Brainstormed => 2,
        TaskStage::Planned => 3,
        TaskStage::Implemented => 4,
        TaskStage::Pushed => 5,
        TaskStage::Done => 6,
        TaskStage::Cancelled => 7,
    }
}

/// Advance `task.stage` to match its latest run's stage iff the run resolves
/// to `Completed` per `compute_run_status`. Background sweep that catches
/// drift between the user's task-stage cursor and the run history.
///
/// **v2 transformation.** v1 read `run.status` directly. v2's status is
/// derived on demand from session-fact rows; we fetch the bound sessions and
/// project them into `SessionFacts` before consulting `compute_run_status`.
pub fn reconcile_task<T>(db: &T, task: &Task) -> Result<bool>
where
    T: TaskMethods + TaskRunMethods + SessionMethods,
{
    if task.stage.is_terminal() {
        return Ok(false);
    }

    let Some(latest_run) = db.list_task_runs(&task.id)?.into_iter().next() else {
        return Ok(false);
    };

    if stage_rank(task.stage) >= stage_rank(latest_run.stage) {
        return Ok(false);
    }

    let sessions = db.get_sessions_by_task_run_id(&latest_run.id)?;
    let facts: Vec<SessionFacts> = sessions
        .iter()
        .map(|s| SessionFacts {
            task_run_id: s.task_run_id.clone(),
            exit_code: s.exit_code,
            first_idle_at: s.first_idle_at,
        })
        .collect();

    match compute_run_status(&latest_run, &facts) {
        TaskRunStatus::Completed => {
            log::info!(
                "tasks::reconciler: advancing task {} {} -> {} from completed run {}",
                task.id,
                task.stage.as_str(),
                latest_run.stage.as_str(),
                latest_run.id
            );
            db.set_task_stage(&task.id, latest_run.stage)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

pub fn reconcile_all<T>(db: &T, repo_path: &Path) -> Result<usize>
where
    T: TaskMethods + TaskRunMethods + SessionMethods,
{
    let mut changed = 0usize;
    for task in db.list_tasks(repo_path)? {
        if task.stage.is_terminal() {
            continue;
        }
        if reconcile_task(db, &task)? {
            changed += 1;
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::{reconcile_all, reconcile_task};
    use crate::domains::tasks::entity::{Task, TaskRunStatus, TaskStage, TaskVariant};
    use crate::domains::tasks::runs::TaskRunService;
    use crate::domains::tasks::service::{CreateTaskInput, TaskService};
    use crate::infrastructure::database::{Database, TaskMethods, TaskRunMethods};
    use std::path::{Path, PathBuf};

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn create_task(db: &Database, id: &str, stage: TaskStage) -> Task {
        let svc = TaskService::new(db);
        let task = svc
            .create_task(CreateTaskInput {
                name: id,
                display_name: None,
                repository_path: Path::new("/repo"),
                repository_name: "repo",
                request_body: "body",
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: Some("main"),
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("create task");
        if task.id != id {
            db.get_conn()
                .unwrap()
                .execute(
                    "UPDATE tasks SET id = ?1 WHERE id = ?2",
                    rusqlite::params![id, task.id],
                )
                .unwrap();
        }
        for next in stage_path(stage) {
            svc.advance_stage(id, next).unwrap();
        }
        db.get_task_by_id(id).unwrap()
    }

    fn stage_path(target: TaskStage) -> Vec<TaskStage> {
        match target {
            TaskStage::Draft => vec![],
            TaskStage::Ready => vec![TaskStage::Ready],
            TaskStage::Brainstormed => vec![TaskStage::Ready, TaskStage::Brainstormed],
            TaskStage::Planned => vec![TaskStage::Ready, TaskStage::Brainstormed, TaskStage::Planned],
            TaskStage::Implemented => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
            ],
            TaskStage::Pushed => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
                TaskStage::Pushed,
            ],
            TaskStage::Done => vec![
                TaskStage::Ready,
                TaskStage::Brainstormed,
                TaskStage::Planned,
                TaskStage::Implemented,
                TaskStage::Pushed,
                TaskStage::Done,
            ],
            TaskStage::Cancelled => vec![TaskStage::Cancelled],
        }
    }

    /// v2-shaped seed helper. Maps a desired derived `TaskRunStatus` to the
    /// timestamp column that produces it. `Running` → no terminal timestamp;
    /// `AwaitingSelection` would require bound idle sessions and is not used
    /// by the existing reconciler tests.
    fn seed_run(db: &Database, task_id: &str, stage: TaskStage, status: TaskRunStatus) -> String {
        let svc = TaskRunService::new(db);
        let run = svc
            .create_task_run(task_id, stage, None, Some("main"), None)
            .expect("create run");
        match status {
            TaskRunStatus::Running => {}
            TaskRunStatus::Completed => {
                db.set_task_run_confirmed_at(&run.id).unwrap();
            }
            TaskRunStatus::Cancelled => {
                db.set_task_run_cancelled_at(&run.id).unwrap();
            }
            TaskRunStatus::Failed => {
                db.set_task_run_failed_at(&run.id).unwrap();
            }
            TaskRunStatus::AwaitingSelection => {
                panic!(
                    "seed_run cannot directly produce AwaitingSelection in v2 — that derived state requires bound idle sessions. Adjust the test to seed sessions and call SessionFactsRecorder if you need this path."
                );
            }
        }
        run.id
    }

    #[test]
    fn reconcile_advances_stage_when_run_completed_but_task_did_not() {
        let db = db();
        let task = create_task(&db, "t1", TaskStage::Ready);
        seed_run(&db, &task.id, TaskStage::Brainstormed, TaskRunStatus::Completed);

        let changed = reconcile_task(&db, &db.get_task_by_id(&task.id).unwrap()).unwrap();

        assert!(changed);
        assert_eq!(
            db.get_task_by_id(&task.id).unwrap().stage,
            TaskStage::Brainstormed
        );
    }

    #[test]
    fn reconcile_no_ops_on_running_run() {
        // v2: a run with no terminal timestamp derives Running; reconciler
        // must not advance the task stage in that case.
        let db = db();
        let task = create_task(&db, "t1", TaskStage::Ready);
        seed_run(&db, &task.id, TaskStage::Brainstormed, TaskRunStatus::Running);

        let changed = reconcile_task(&db, &db.get_task_by_id(&task.id).unwrap()).unwrap();

        assert!(!changed);
        assert_eq!(
            db.get_task_by_id(&task.id).unwrap().stage,
            TaskStage::Ready
        );
    }

    #[test]
    fn reconcile_no_ops_on_failed_or_cancelled_run() {
        let db = db();
        let failed = create_task(&db, "failed-task", TaskStage::Ready);
        seed_run(&db, &failed.id, TaskStage::Brainstormed, TaskRunStatus::Failed);
        let cancelled = create_task(&db, "cancelled-task", TaskStage::Ready);
        seed_run(
            &db,
            &cancelled.id,
            TaskStage::Brainstormed,
            TaskRunStatus::Cancelled,
        );

        assert!(!reconcile_task(&db, &db.get_task_by_id(&failed.id).unwrap()).unwrap());
        assert!(!reconcile_task(&db, &db.get_task_by_id(&cancelled.id).unwrap()).unwrap());
        assert_eq!(db.get_task_by_id(&failed.id).unwrap().stage, TaskStage::Ready);
        assert_eq!(
            db.get_task_by_id(&cancelled.id).unwrap().stage,
            TaskStage::Ready
        );
    }

    #[test]
    fn reconcile_all_iterates_all_non_terminal_tasks() {
        let db = db();
        let first = create_task(&db, "t1", TaskStage::Ready);
        seed_run(&db, &first.id, TaskStage::Brainstormed, TaskRunStatus::Completed);
        let second = create_task(&db, "t2", TaskStage::Brainstormed);
        seed_run(&db, &second.id, TaskStage::Planned, TaskRunStatus::Completed);
        let terminal = create_task(&db, "t3", TaskStage::Done);
        seed_run(&db, &terminal.id, TaskStage::Done, TaskRunStatus::Completed);

        let changed = reconcile_all(&db, &PathBuf::from("/repo")).unwrap();

        assert_eq!(changed, 2);
        assert_eq!(
            db.get_task_by_id(&first.id).unwrap().stage,
            TaskStage::Brainstormed
        );
        assert_eq!(
            db.get_task_by_id(&second.id).unwrap().stage,
            TaskStage::Planned
        );
        assert_eq!(
            db.get_task_by_id(&terminal.id).unwrap().stage,
            TaskStage::Done
        );
    }

    #[test]
    fn reconcile_is_idempotent() {
        let db = db();
        let task = create_task(&db, "t1", TaskStage::Ready);
        seed_run(&db, &task.id, TaskStage::Brainstormed, TaskRunStatus::Completed);

        let first = reconcile_all(&db, &PathBuf::from("/repo")).unwrap();
        let second = reconcile_all(&db, &PathBuf::from("/repo")).unwrap();

        assert_eq!(first, 1);
        assert_eq!(second, 0);
        assert_eq!(
            db.get_task_by_id(&task.id).unwrap().stage,
            TaskStage::Brainstormed
        );
    }
}
