use std::path::PathBuf;

#[cfg(target_os = "macos")]
const APP_IDENTIFIER: &str = "com.lucacri.lucode";

#[cfg(not(target_os = "macos"))]
const APP_IDENTIFIER: &str = "lucode";

/// Lucode's per-user application support directory.
/// macOS: `~/Library/Application Support/com.lucacri.lucode`.
/// Other platforms: `$XDG_DATA_HOME/lucode` (fallback for Linux dev builds).
///
/// The override check is unconditionally compiled (not gated by `cfg(test)`)
/// so binary-target tests that import this lib see the override too. The
/// default override value is `None`, so production builds skip the branch
/// after a single `Mutex<Option>` check — negligible cost.
pub fn app_support_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = testing::app_support_override() {
        return Ok(override_dir);
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        "Failed to resolve the user's data directory (dirs::data_dir returned None)".to_string()
    })?;
    Ok(data_dir.join(APP_IDENTIFIER))
}

/// Per-project data root (`<data_dir>/lucode`). Honors the same test
/// override as `app_support_dir` so `set_app_support_override(tmp)`
/// redirects both surfaces during tests. Routed through here (not direct
/// `dirs::data_dir()`) because tests must be able to redirect writes
/// without touching the user's real Application Support.
pub fn project_data_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = testing::app_support_override() {
        return Ok(override_dir);
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        "Failed to resolve the user's data directory (dirs::data_dir returned None)".to_string()
    })?;
    Ok(data_dir.join("lucode"))
}

/// Canonical on-disk path to Lucode's tmux config.
pub fn tmux_conf_path() -> Result<PathBuf, String> {
    Ok(app_support_dir()?.join("tmux").join("tmux.conf"))
}

/// Test-only override mechanism, exposed unconditionally so binary-side
/// tests (which run under the `bin lucode` test target, not the library
/// test target) can reach it. The override is only READ by `app_support_dir`
/// / `project_data_dir` and defaults to `None`, so production semantics
/// are unchanged.
pub mod testing {
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};

    static OVERRIDE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    static OVERRIDE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn cell() -> &'static Mutex<Option<PathBuf>> {
        OVERRIDE.get_or_init(|| Mutex::new(None))
    }

    pub fn serial_lock() -> std::sync::MutexGuard<'static, ()> {
        OVERRIDE_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_app_support_override(path: &Path) {
        *cell().lock().unwrap() = Some(path.to_path_buf());
    }

    pub fn clear_app_support_override() {
        *cell().lock().unwrap() = None;
    }

    pub fn app_support_override() -> Option<PathBuf> {
        cell().lock().unwrap().clone()
    }

    /// RAII guard that sets the app-support override on construction and
    /// clears it on drop — including during panic-unwind. Replaces the
    /// `set_app_support_override(...)` / `clear_app_support_override()`
    /// pattern that left the override poisoned when a test panicked between
    /// the two calls.
    pub struct OverrideGuard;

    impl OverrideGuard {
        pub fn new(path: &Path) -> Self {
            set_app_support_override(path);
            Self
        }
    }

    impl Drop for OverrideGuard {
        fn drop(&mut self) {
            clear_app_support_override();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_app_support_dir_ends_with_bundle_id_on_macos() {
        let _g = testing::serial_lock();
        testing::clear_app_support_override();
        let dir = app_support_dir().unwrap();
        assert!(
            dir.ends_with("com.lucacri.lucode"),
            "expected bundle id suffix, got {dir:?}"
        );
    }

    #[test]
    fn test_tmux_conf_path_ends_with_tmux_conf() {
        let _g = testing::serial_lock();
        testing::clear_app_support_override();
        let p = tmux_conf_path().unwrap();
        let as_str = p.to_string_lossy().to_string();
        assert!(as_str.ends_with("/tmux/tmux.conf"), "got {as_str:?}");
    }

    #[test]
    fn test_app_support_override_is_honored() {
        let _g = testing::serial_lock();
        let tmp = std::env::temp_dir().join("lucode-app-support-override-test");
        testing::set_app_support_override(&tmp);
        assert_eq!(app_support_dir().unwrap(), tmp);
        assert_eq!(
            tmux_conf_path().unwrap(),
            tmp.join("tmux").join("tmux.conf")
        );
        testing::clear_app_support_override();
    }
}
