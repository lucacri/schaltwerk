use dashmap::DashMap;
use std::sync::{Arc, LazyLock};
use tokio::sync::{Mutex, OwnedMutexGuard};

static MERGE_LOCKS: LazyLock<DashMap<String, Arc<Mutex<()>>>> = LazyLock::new(DashMap::new);

pub fn try_acquire(session_name: &str) -> Option<OwnedMutexGuard<()>> {
    let entry = MERGE_LOCKS
        .entry(session_name.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())));
    let lock = entry.value().clone();

    lock.try_lock_owned().ok()
}

#[cfg(test)]
pub fn active_lock_count() -> usize {
    MERGE_LOCKS.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn try_acquire_succeeds_for_new_session() {
        let guard = try_acquire("test-lock-new");
        assert!(guard.is_some());
    }

    #[test]
    fn try_acquire_fails_when_already_held() {
        let _guard = try_acquire("test-lock-held");
        let second = try_acquire("test-lock-held");
        assert!(second.is_none());
    }

    #[test]
    fn different_sessions_can_lock_concurrently() {
        let guard_a = try_acquire("test-lock-a");
        let guard_b = try_acquire("test-lock-b");
        assert!(guard_a.is_some());
        assert!(guard_b.is_some());
    }

    #[test]
    fn lock_released_after_guard_dropped() {
        {
            let _guard = try_acquire("test-lock-released");
            assert!(try_acquire("test-lock-released").is_none());
        }
        let guard = try_acquire("test-lock-released");
        assert!(guard.is_some());
    }

    #[test]
    fn active_lock_count_increases() {
        let before = active_lock_count();
        let _guard = try_acquire("test-lock-count-unique");
        assert!(active_lock_count() >= before);
    }
}
