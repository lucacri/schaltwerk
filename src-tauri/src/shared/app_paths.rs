use std::path::PathBuf;

#[cfg(target_os = "macos")]
const APP_IDENTIFIER: &str = "com.lucacri.lucode";

#[cfg(not(target_os = "macos"))]
const APP_IDENTIFIER: &str = "lucode";

/// Optional flavor suffix used to isolate dev installs from production data.
///
/// Resolution order (first non-empty wins):
/// 1. Compile-time `LUCODE_FLAVOR` (baked into the binary by `just dev-install`).
/// 2. Runtime `LUCODE_FLAVOR` env var, **only in debug builds**, so a stray
///    shell export cannot redirect a packaged production app.
///
/// Returning `Some(flavor)` causes [`app_support_dir`] / [`project_data_dir`] to
/// suffix their bases with `-{flavor}` (e.g. `com.lucacri.lucode-taskflow-v2`,
/// `lucode-taskflow-v2`). Empty strings are treated as unset.
pub fn dev_flavor() -> Option<String> {
    if let Some(compile_time) = option_env!("LUCODE_FLAVOR") {
        let trimmed = compile_time.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    runtime_flavor()
}

#[cfg(debug_assertions)]
fn runtime_flavor() -> Option<String> {
    match std::env::var("LUCODE_FLAVOR") {
        Ok(v) => {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Err(_) => None,
    }
}

#[cfg(not(debug_assertions))]
fn runtime_flavor() -> Option<String> {
    None
}

fn flavored(base: &str) -> String {
    match dev_flavor() {
        Some(flavor) => format!("{base}-{flavor}"),
        None => base.to_string(),
    }
}

/// Lucode's per-user application support directory.
/// macOS: `~/Library/Application Support/com.lucacri.lucode`.
/// Other platforms: `$XDG_DATA_HOME/lucode` (fallback for Linux dev builds).
///
/// The override check is unconditionally compiled (not gated by `cfg(test)`)
/// so binary-target tests that import this lib see the override too. The
/// default override value is `None`, so production builds skip the branch
/// after a single `Mutex<Option>` check — negligible cost.
///
/// When [`dev_flavor`] is `Some`, the bundle id is suffixed with `-{flavor}`
/// so dev variants stay isolated from production data.
pub fn app_support_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = testing::app_support_override() {
        return Ok(override_dir);
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        "Failed to resolve the user's data directory (dirs::data_dir returned None)".to_string()
    })?;
    Ok(data_dir.join(flavored(APP_IDENTIFIER)))
}

/// Per-project data root (`<data_dir>/lucode`). Honors the same test
/// override as `app_support_dir` so `set_app_support_override(tmp)`
/// redirects both surfaces during tests. Routed through here (not direct
/// `dirs::data_dir()`) because tests must be able to redirect writes
/// without touching the user's real Application Support.
///
/// Suffixed with `-{flavor}` when [`dev_flavor`] is `Some`.
pub fn project_data_dir() -> Result<PathBuf, String> {
    if let Some(override_dir) = testing::app_support_override() {
        return Ok(override_dir);
    }

    let data_dir = dirs::data_dir().ok_or_else(|| {
        "Failed to resolve the user's data directory (dirs::data_dir returned None)".to_string()
    })?;
    Ok(data_dir.join(flavored("lucode")))
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
    use crate::utils::env_adapter::EnvAdapter;

    /// RAII guard that snapshots and restores `LUCODE_FLAVOR` so tests can
    /// flip the runtime flavor without leaking into siblings, even on panic.
    struct FlavorEnvGuard {
        prior: Option<String>,
    }

    impl FlavorEnvGuard {
        fn set(value: &str) -> Self {
            let prior = std::env::var("LUCODE_FLAVOR").ok();
            EnvAdapter::set_var("LUCODE_FLAVOR", value);
            Self { prior }
        }

        fn unset() -> Self {
            let prior = std::env::var("LUCODE_FLAVOR").ok();
            EnvAdapter::remove_var("LUCODE_FLAVOR");
            Self { prior }
        }
    }

    impl Drop for FlavorEnvGuard {
        fn drop(&mut self) {
            match &self.prior {
                Some(v) => EnvAdapter::set_var("LUCODE_FLAVOR", v),
                None => EnvAdapter::remove_var("LUCODE_FLAVOR"),
            }
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_app_support_dir_ends_with_bundle_id_on_macos() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::unset();
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
        let _flavor = FlavorEnvGuard::unset();
        testing::clear_app_support_override();
        let p = tmux_conf_path().unwrap();
        let as_str = p.to_string_lossy().to_string();
        assert!(as_str.ends_with("/tmux/tmux.conf"), "got {as_str:?}");
    }

    #[test]
    fn test_app_support_override_is_honored() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::unset();
        let tmp = std::env::temp_dir().join("lucode-app-support-override-test");
        testing::set_app_support_override(&tmp);
        assert_eq!(app_support_dir().unwrap(), tmp);
        assert_eq!(
            tmux_conf_path().unwrap(),
            tmp.join("tmux").join("tmux.conf")
        );
        testing::clear_app_support_override();
    }

    #[test]
    fn test_dev_flavor_unset_returns_none() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::unset();
        // Compile-time flavor must NOT be baked into normal `cargo test` runs;
        // if a developer runs `LUCODE_FLAVOR=foo cargo test`, that env var
        // affects compilation, and this assertion will surface the misuse.
        assert_eq!(
            dev_flavor(),
            None,
            "dev_flavor should be None when neither compile-time nor runtime LUCODE_FLAVOR is set"
        );
    }

    #[test]
    fn test_dev_flavor_empty_runtime_treated_as_none() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("");
        assert_eq!(dev_flavor(), None);
    }

    #[test]
    #[cfg(debug_assertions)]
    fn test_runtime_flavor_suffixes_app_support_dir() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("taskflow-v2");
        testing::clear_app_support_override();
        let dir = app_support_dir().unwrap();
        let last = dir
            .file_name()
            .expect("app_support_dir should have a final component")
            .to_string_lossy()
            .to_string();
        assert!(
            last.ends_with("-taskflow-v2"),
            "expected suffix on app_support_dir, got {last}"
        );
        let expected_base = if cfg!(target_os = "macos") {
            "com.lucacri.lucode"
        } else {
            "lucode"
        };
        assert_eq!(last, format!("{expected_base}-taskflow-v2"));
    }

    #[test]
    #[cfg(debug_assertions)]
    fn test_runtime_flavor_suffixes_project_data_dir() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("taskflow-v2");
        testing::clear_app_support_override();
        let dir = project_data_dir().unwrap();
        let last = dir.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(last, "lucode-taskflow-v2");
    }

    #[test]
    #[cfg(debug_assertions)]
    fn test_test_override_beats_runtime_flavor() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("taskflow-v2");
        let tmp = std::env::temp_dir().join("lucode-flavor-vs-override-test");
        let _override = testing::OverrideGuard::new(&tmp);
        // Override must win even when the flavor env var would otherwise
        // suffix the path — this preserves test isolation.
        assert_eq!(app_support_dir().unwrap(), tmp);
        assert_eq!(project_data_dir().unwrap(), tmp);
    }

    #[test]
    #[cfg(debug_assertions)]
    fn test_runtime_flavor_trims_whitespace() {
        let _g = testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("  taskflow-v2  ");
        testing::clear_app_support_override();
        assert_eq!(dev_flavor().as_deref(), Some("taskflow-v2"));
    }
}
