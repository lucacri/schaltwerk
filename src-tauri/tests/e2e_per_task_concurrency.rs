//! End-to-end concurrency proof for Phase 2 Wave G.
//!
//! Pins the headline contract: operations on different tasks proceed
//! concurrently; operations on the same task serialize on the task's
//! `Arc<Mutex<()>>`. Drives `infrastructure::task_lock_manager::TaskLockManager`
//! directly (the same registry every `Project` instance owns) so a
//! regression to a single global mutex would surface here without
//! needing a full Tauri-driven harness.
//!
//! Tests are deterministic per CLAUDE.md "no timing-based solutions" —
//! ordering is observed via a shared `Arc<tokio::sync::Mutex<Vec<&str>>>`
//! event log and `try_lock` rather than wall-clock thresholds.

use lucode::infrastructure::task_lock_manager::TaskLockManager;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

/// Two tasks, two concurrent acquirers. Each acquirer logs `acquired:<id>`
/// when it gets the lock and `released:<id>` when it drops the guard.
/// Because the locks are per-task, both acquirers MUST observe their
/// `acquired` event without waiting for the other; in the event log the
/// two `acquired` lines appear before either `released` line.
#[tokio::test]
async fn two_tasks_acquire_locks_concurrently() {
    let mgr = Arc::new(TaskLockManager::new());
    let log = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let release_a = Arc::new(Notify::new());
    let release_b = Arc::new(Notify::new());

    let task_a = {
        let mgr = Arc::clone(&mgr);
        let log = Arc::clone(&log);
        let release = Arc::clone(&release_a);
        tokio::spawn(async move {
            let lock = mgr.lock_for("task-a");
            let _guard = lock.lock().await;
            log.lock().await.push("acquired:a");
            release.notified().await;
            log.lock().await.push("released:a");
        })
    };

    let task_b = {
        let mgr = Arc::clone(&mgr);
        let log = Arc::clone(&log);
        let release = Arc::clone(&release_b);
        tokio::spawn(async move {
            let lock = mgr.lock_for("task-b");
            let _guard = lock.lock().await;
            log.lock().await.push("acquired:b");
            release.notified().await;
            log.lock().await.push("released:b");
        })
    };

    // Wait until both have logged "acquired:*" — proven by polling the
    // log length until it reaches 2. If a regression makes the locks
    // serialize, only one "acquired:*" line will ever appear and the
    // until-loop never terminates; the test will time out via the
    // tokio test runner instead of asserting falsely.
    loop {
        let entries = log.lock().await;
        if entries.len() == 2 {
            assert!(
                entries.contains(&"acquired:a") && entries.contains(&"acquired:b"),
                "both acquirers must reach the log; got {:?}",
                *entries
            );
            break;
        }
        drop(entries);
        tokio::task::yield_now().await;
    }

    release_a.notify_one();
    release_b.notify_one();

    task_a.await.expect("task_a join");
    task_b.await.expect("task_b join");

    let final_log = log.lock().await.clone();
    let acquired_a = final_log
        .iter()
        .position(|e| *e == "acquired:a")
        .expect("acquired:a present");
    let acquired_b = final_log
        .iter()
        .position(|e| *e == "acquired:b")
        .expect("acquired:b present");
    let released_a = final_log
        .iter()
        .position(|e| *e == "released:a")
        .expect("released:a present");
    let released_b = final_log
        .iter()
        .position(|e| *e == "released:b")
        .expect("released:b present");

    // Both acquired events fire before either released event — the
    // proof that the per-task locks did not serialize.
    assert!(
        acquired_a < released_a && acquired_a < released_b,
        "acquired:a must precede every released:* (log: {:?})",
        final_log
    );
    assert!(
        acquired_b < released_a && acquired_b < released_b,
        "acquired:b must precede every released:* (log: {:?})",
        final_log
    );
}

/// Same task, two acquirers. The second acquirer MUST wait for the
/// first to release. Proven by `try_lock` returning Err while the first
/// guard is held, then succeeding after release.
#[tokio::test]
async fn same_task_acquirers_serialize() {
    let mgr = TaskLockManager::new();
    let lock = mgr.lock_for("task-shared");
    let guard = lock.lock().await;

    let same = mgr.lock_for("task-shared");
    assert!(
        same.try_lock().is_err(),
        "second acquire on the same task must block while the first \
         guard is held; if try_lock succeeds, same-task ordering is \
         broken and the orchestration commands can race"
    );

    drop(guard);

    let post_release = same
        .try_lock()
        .expect("after the first guard is dropped, the second acquire must succeed");
    drop(post_release);
}

/// Two-way binding for the per-project scoping. `TaskLockManager` is
/// owned by each `Project`, so two managers must hand out independent
/// locks for the same task id. If a regression makes the registry
/// process-wide, this assertion fails.
#[tokio::test]
async fn task_lock_manager_is_per_project_scoped() {
    let mgr_a = TaskLockManager::new();
    let mgr_b = TaskLockManager::new();

    let lock_a = mgr_a.lock_for("task-1");
    let _guard_a = lock_a.lock().await;

    let lock_b = mgr_b.lock_for("task-1");
    let guard_b = lock_b
        .try_lock()
        .expect("manager_b's lock for task-1 must be independent of manager_a's");
    drop(guard_b);
}
