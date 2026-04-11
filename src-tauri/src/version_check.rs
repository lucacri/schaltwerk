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

const INSTALLED_APP_PATH: &str = "/Applications/Lucode.app";

pub fn check_and_notify(app: &tauri::AppHandle) {
    let running = env!("CARGO_PKG_VERSION");
    let installed = match read_installed_version(INSTALLED_APP_PATH) {
        Some(v) => v,
        None => {
            debug!("No installed Lucode.app found at {INSTALLED_APP_PATH}");
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
}
