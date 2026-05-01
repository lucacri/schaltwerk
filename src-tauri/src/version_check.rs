use crate::events::{SchaltEvent, emit_event};
use log::{debug, info, warn};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, PartialEq, Eq)]
pub enum VersionComparison {
    InstalledIsNewer,
    Same,
    RunningIsNewer,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewerBuildPayload {
    pub running_version: String,
    pub installed_version: String,
}

static LAST_NOTIFIED_VERSION: Mutex<Option<String>> = Mutex::new(None);

pub fn compare_versions(running: &str, installed: &str) -> VersionComparison {
    match (
        semver::Version::parse(running),
        semver::Version::parse(installed),
    ) {
        (Ok(r), Ok(i)) if i > r => VersionComparison::InstalledIsNewer,
        (Ok(r), Ok(i)) if i == r => VersionComparison::Same,
        _ => VersionComparison::RunningIsNewer,
    }
}

pub fn parse_version_from_plist_data(data: &[u8]) -> Option<String> {
    let dict: plist::Dictionary = plist::from_bytes(data).ok()?;
    dict.get("CFBundleShortVersionString")?
        .as_string()
        .map(|s| s.to_string())
}

pub fn read_installed_version(app_path: &str) -> Option<String> {
    let plist_path = format!("{app_path}/Contents/Info.plist");
    let data = std::fs::read(&plist_path).ok()?;
    parse_version_from_plist_data(&data)
}

/// Production install location. Flavor-isolated dev variants override this via
/// [`installed_app_path`] so they compare against their own bundle, not the
/// production `Lucode.app`.
const PRODUCTION_INSTALLED_APP_PATH: &str = "/Applications/Lucode.app";

/// Pure resolver: derive the install path from a flavor. Mirrors the
/// titlecase heuristic in `Justfile`'s `dev-install` recipe — split on `-`,
/// uppercase the first byte of each non-empty segment, and rejoin. Pinned by
/// `resolve_installed_app_path_*` tests below; if you change the heuristic
/// here, update the Justfile in lockstep (or the dev-install bundle and the
/// running binary will disagree on which path to read).
fn resolve_installed_app_path(flavor: Option<&str>) -> String {
    match flavor {
        None => PRODUCTION_INSTALLED_APP_PATH.to_string(),
        Some(f) => {
            let mut product = String::from("Lucode");
            for segment in f.split('-') {
                if segment.is_empty() {
                    continue;
                }
                let mut chars = segment.chars();
                let Some(head) = chars.next() else {
                    continue;
                };
                product.push('-');
                product.push(head.to_ascii_uppercase());
                product.extend(chars);
            }
            format!("/Applications/{product}.app")
        }
    }
}

/// Path the running binary compares its version against. Routes through
/// `app_paths::dev_flavor()` so a flavored dev-install reads its own bundle
/// (e.g. `/Applications/Lucode-Taskflow-V2.app`) rather than the production
/// `/Applications/Lucode.app`. With no flavor set this is byte-identical to
/// the legacy hardcoded constant.
fn installed_app_path() -> String {
    resolve_installed_app_path(lucode::shared::app_paths::dev_flavor().as_deref())
}

pub fn check_and_notify(app: &tauri::AppHandle) {
    let running = env!("CARGO_PKG_VERSION");
    let app_path = installed_app_path();
    let installed = match read_installed_version(&app_path) {
        Some(v) => v,
        None => {
            debug!("No installed Lucode.app found at {app_path}");
            return;
        }
    };

    info!("Version check: running={running}, installed={installed}");

    if compare_versions(running, &installed) == VersionComparison::InstalledIsNewer {
        if let Ok(mut last) = LAST_NOTIFIED_VERSION.lock() {
            if last.as_deref() == Some(&installed) {
                debug!("Already notified about version {installed}, skipping");
                return;
            }
            *last = Some(installed.clone());
        }

        info!("Newer build detected: {installed} > {running}");
        let payload = NewerBuildPayload {
            running_version: running.to_string(),
            installed_version: installed,
        };
        if let Err(e) = emit_event(app, SchaltEvent::NewerBuildAvailable, &payload) {
            warn!("Failed to emit NewerBuildAvailable event: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_newer_installed_version() {
        assert_eq!(
            compare_versions("2026.410.1200", "2026.410.1523"),
            VersionComparison::InstalledIsNewer
        );
    }

    #[test]
    fn detects_same_version() {
        assert_eq!(
            compare_versions("2026.410.1523", "2026.410.1523"),
            VersionComparison::Same
        );
    }

    #[test]
    fn detects_running_is_newer() {
        assert_eq!(
            compare_versions("2026.410.1523", "2026.410.1200"),
            VersionComparison::RunningIsNewer
        );
    }

    #[test]
    fn compares_across_days() {
        assert_eq!(
            compare_versions("2026.409.2359", "2026.410.0"),
            VersionComparison::InstalledIsNewer
        );
    }

    #[test]
    fn handles_legacy_semver() {
        assert_eq!(
            compare_versions("0.13.4", "2026.410.1523"),
            VersionComparison::InstalledIsNewer
        );
    }

    #[test]
    fn reads_version_from_plist_xml() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleShortVersionString</key>
    <string>2026.410.1523</string>
</dict>
</plist>"#;
        let version = parse_version_from_plist_data(xml).unwrap();
        assert_eq!(version, "2026.410.1523");
    }

    #[test]
    fn returns_none_for_missing_key() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Other</key><string>v1</string></dict></plist>"#;
        assert!(parse_version_from_plist_data(xml).is_none());
    }

    #[test]
    fn returns_none_for_missing_app() {
        assert!(read_installed_version("/nonexistent/path/Lucode.app").is_none());
    }

    #[test]
    fn returns_running_is_newer_for_unparseable_installed() {
        assert_eq!(
            compare_versions("2026.410.1523", "not-a-version"),
            VersionComparison::RunningIsNewer
        );
    }

    #[test]
    fn suppresses_duplicate_notifications() {
        if let Ok(mut last) = LAST_NOTIFIED_VERSION.lock() {
            *last = None;
        }

        if let Ok(mut last) = LAST_NOTIFIED_VERSION.lock() {
            *last = Some("2026.410.1523".to_string());
        }
        let should_skip = LAST_NOTIFIED_VERSION
            .lock()
            .ok()
            .and_then(|g| g.clone())
            == Some("2026.410.1523".to_string());
        assert!(should_skip);

        let should_notify = LAST_NOTIFIED_VERSION
            .lock()
            .ok()
            .and_then(|g| g.clone())
            != Some("2026.410.1600".to_string());
        assert!(should_notify);
    }

    // --- installed-app-path resolution (flavor isolation) ---
    //
    // These tests pin the contract between this module and the `Justfile`'s
    // `dev-install` recipe: the running binary must derive the *same* bundle
    // basename that `dev-install` produced, otherwise a flavored dev build
    // would compare its calver against production `Lucode.app` and surface a
    // spurious "newer build available" toast.

    use lucode::shared::app_paths::testing as app_paths_testing;
    use lucode::utils::env_adapter::EnvAdapter;

    /// Mirrors the FlavorEnvGuard from `app_paths::tests` so this module can
    /// flip `LUCODE_FLAVOR` for runtime-resolved tests without leaking the
    /// var into siblings on panic.
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
    fn resolve_installed_app_path_no_flavor_matches_production_constant() {
        // Pinning production semantics: with no flavor set the resolver must
        // return the byte-identical legacy path. Anything else is a regression.
        assert_eq!(
            resolve_installed_app_path(None),
            "/Applications/Lucode.app"
        );
    }

    #[test]
    fn resolve_installed_app_path_taskflow_v2() {
        assert_eq!(
            resolve_installed_app_path(Some("taskflow-v2")),
            "/Applications/Lucode-Taskflow-V2.app"
        );
    }

    #[test]
    fn resolve_installed_app_path_multi_segment_titlecase() {
        // Mirrors the Justfile heuristic: split on `-`, uppercase the first
        // char of each non-empty segment, leave the rest untouched.
        assert_eq!(
            resolve_installed_app_path(Some("foo-bar-baz")),
            "/Applications/Lucode-Foo-Bar-Baz.app"
        );
    }

    #[test]
    fn resolve_installed_app_path_single_segment() {
        assert_eq!(
            resolve_installed_app_path(Some("dev")),
            "/Applications/Lucode-Dev.app"
        );
    }

    #[test]
    fn resolve_installed_app_path_skips_empty_segments() {
        // Justfile's `IFS='-' read -ra` + `if [ -z "$_p" ]; then continue; fi`
        // skips empty segments (e.g. leading/trailing/double separators).
        assert_eq!(
            resolve_installed_app_path(Some("--foo--bar--")),
            "/Applications/Lucode-Foo-Bar.app"
        );
    }

    #[test]
    fn resolve_installed_app_path_preserves_inner_case() {
        // Heuristic only touches the first char of each segment; trailing
        // characters keep their case (matches `${_p:1}` in the Justfile).
        assert_eq!(
            resolve_installed_app_path(Some("myFlavor")),
            "/Applications/Lucode-MyFlavor.app"
        );
    }

    #[test]
    fn installed_app_path_default_matches_production() {
        // End-to-end: with neither compile-time nor runtime flavor set, the
        // production constant is what `check_and_notify` will read from.
        let _serial = app_paths_testing::serial_lock();
        let _flavor = FlavorEnvGuard::unset();
        assert_eq!(installed_app_path(), "/Applications/Lucode.app");
    }

    #[test]
    #[cfg(debug_assertions)]
    fn installed_app_path_runtime_flavor_routes_to_flavored_bundle() {
        // Runtime resolution path (debug-only). A `LUCODE_FLAVOR` set after
        // compile time still reroutes the install lookup so `just dev-run`
        // and `just dev-install` are symmetric.
        let _serial = app_paths_testing::serial_lock();
        let _flavor = FlavorEnvGuard::set("taskflow-v2");
        assert_eq!(
            installed_app_path(),
            "/Applications/Lucode-Taskflow-V2.app"
        );
    }
}
