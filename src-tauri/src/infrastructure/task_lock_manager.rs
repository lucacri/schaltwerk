//! Per-task serialization registry. Operations on different tasks proceed
//! concurrently; operations on the same task serialize on the task's
//! `Arc<Mutex<()>>`.
//!
//! Locks are scoped to a `Project` (one `TaskLockManager` per `Project`),
//! so tasks in different projects are never coordinated through a shared
//! lock. The `DashMap` is owned by the `Project` and dropped with it.
//!
//! # Why this shape
//!
//! - `DashMap` over `Mutex<HashMap<…>>`: lock-free reads of the registry
//!   so concurrent operations on different tasks never contend on the
//!   registry itself.
//! - `tokio::sync::Mutex` over `std::sync::Mutex`: callers hold the lock
//!   across `.await` points (e.g. through `MergeService::merge_from_modal`
//!   which spawns subprocesses and awaits them). A blocking std mutex
//!   would either panic-hold across `.await` or force a `spawn_blocking`
//!   dance.
//! - Lock value `()`: the lock is a coordination primitive, not a data
//!   wrapper. Owners of the data (`Database`, services) are passed in
//!   directly via the lock-free `CoreHandle`.
//! - No cleanup on task delete: ~40 bytes per ever-created task. Lucode
//!   is a personal app; the practical bound is the number of tasks
//!   created in one app session. Project unload drops the whole map.
//!   If profiling ever flags this as a leak, switch to
//!   `DashMap<TaskId, Weak<Mutex<()>>>`.

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct TaskLockManager {
    locks: DashMap<String, Arc<Mutex<()>>>,
}

impl TaskLockManager {
    pub fn new() -> Self {
        Self {
            locks: DashMap::new(),
        }
    }

    pub fn lock_for(&self, task_id: &str) -> Arc<Mutex<()>> {
        if let Some(existing) = self.locks.get(task_id) {
            return existing.clone();
        }
        self.locks
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

impl Default for TaskLockManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lock_for_returns_same_arc_on_repeat() {
        let mgr = TaskLockManager::new();
        let first = mgr.lock_for("task-a");
        let second = mgr.lock_for("task-a");
        assert!(
            Arc::ptr_eq(&first, &second),
            "repeated lock_for(\"task-a\") must return the SAME Arc<Mutex<()>>; \
             otherwise two callers on the same task each get their own mutex \
             and serialization is silently broken"
        );
    }

    #[tokio::test]
    async fn lock_for_returns_different_arc_for_different_ids() {
        let mgr = TaskLockManager::new();
        let a = mgr.lock_for("task-a");
        let b = mgr.lock_for("task-b");
        assert!(
            !Arc::ptr_eq(&a, &b),
            "different task ids must return different Arc<Mutex<()>>; \
             otherwise unrelated tasks serialize on a shared mutex"
        );
    }

    #[tokio::test]
    async fn same_task_serializes_via_try_lock() {
        let mgr = TaskLockManager::new();
        let lock = mgr.lock_for("task-a");
        let _guard = lock.lock().await;

        let again = mgr.lock_for("task-a");
        assert!(
            again.try_lock().is_err(),
            "second acquire on the same task must fail try_lock while the \
             first guard is held; if try_lock succeeds, same-task ordering \
             is broken"
        );
    }

    #[tokio::test]
    async fn different_tasks_do_not_serialize_via_try_lock() {
        let mgr = TaskLockManager::new();
        let a = mgr.lock_for("task-a");
        let _guard_a = a.lock().await;

        let b = mgr.lock_for("task-b");
        let guard_b = b
            .try_lock()
            .expect("unrelated task lock must be free while task-a is held");
        drop(guard_b);
    }

    #[tokio::test]
    async fn concurrent_first_access_race_resolves_to_one_arc() {
        let mgr = Arc::new(TaskLockManager::new());
        let mut handles = Vec::with_capacity(16);
        for _ in 0..16 {
            let mgr = Arc::clone(&mgr);
            handles.push(tokio::spawn(async move {
                let arc = mgr.lock_for("task-shared");
                Arc::as_ptr(&arc) as usize
            }));
        }

        let mut pointers = Vec::with_capacity(16);
        for h in handles {
            pointers.push(h.await.expect("join"));
        }
        let first = pointers[0];
        for p in &pointers[1..] {
            assert_eq!(
                *p, first,
                "all racing first-access callers must observe the same \
                 Arc<Mutex<()>> (DashMap entry-API or_insert_with semantics)"
            );
        }
    }
}
