//! Provisioning of Lucode's tmux configuration on disk. Writes the
//! compiled-in `TMUX_CONF_BODY` atomically and decides whether existing
//! per-project tmux servers need to be killed when the config version
//! stamp changes.

use std::fs;
use std::path::PathBuf;

use crate::domains::terminal::tmux_conf::{TMUX_CONF_BODY, config_version_stamp};
use crate::shared::app_paths::tmux_conf_path;

/// Result of `ensure_tmux_conf_on_disk`. Callers use `wrote` to decide
/// whether running tmux servers need to be recycled.
#[derive(Debug)]
pub struct TmuxConfState {
    pub path: PathBuf,
    pub wrote: bool,
    pub previous_stamp: Option<String>,
}

/// Ensure the Lucode tmux.conf is on disk with the current version stamp.
/// No-op if the existing file's first line matches the compiled stamp;
/// otherwise atomically overwrite and report the previous stamp (if any).
pub fn ensure_tmux_conf_on_disk() -> Result<TmuxConfState, String> {
    let path = tmux_conf_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("tmux.conf path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("create_dir_all({}): {e}", parent.display()))?;

    let current_stamp = config_version_stamp();
    let previous_stamp = read_first_line(&path);

    if previous_stamp.as_deref() == Some(current_stamp) {
        return Ok(TmuxConfState {
            path,
            wrote: false,
            previous_stamp,
        });
    }

    write_atomic(&path, TMUX_CONF_BODY)?;
    Ok(TmuxConfState {
        path,
        wrote: true,
        previous_stamp,
    })
}

fn read_first_line(path: &std::path::Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    Some(text.lines().next().unwrap_or("").to_string())
}

fn write_atomic(path: &std::path::Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension("conf.tmp");
    fs::write(&tmp, body).map_err(|e| format!("write tmp {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::app_paths::testing as app_paths_testing;
    use tempfile::TempDir;

    #[test]
    fn first_call_writes_the_file() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        app_paths_testing::set_app_support_override(tmp.path());

        let state = ensure_tmux_conf_on_disk().unwrap();

        assert!(state.wrote);
        assert!(state.previous_stamp.is_none());
        assert!(state.path.exists());
        let body = fs::read_to_string(&state.path).unwrap();
        assert_eq!(body, TMUX_CONF_BODY);

        app_paths_testing::clear_app_support_override();
    }

    #[test]
    fn second_call_is_noop_when_stamp_matches() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        app_paths_testing::set_app_support_override(tmp.path());

        let first = ensure_tmux_conf_on_disk().unwrap();
        assert!(first.wrote);
        let second = ensure_tmux_conf_on_disk().unwrap();
        assert!(!second.wrote, "second call should be a no-op");
        assert_eq!(
            second.previous_stamp.as_deref(),
            Some(config_version_stamp())
        );

        app_paths_testing::clear_app_support_override();
    }

    #[test]
    fn rewrites_when_stamp_changes() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        app_paths_testing::set_app_support_override(tmp.path());

        let path = tmux_conf_path().unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "# lucode-tmux-conf v0.0.0-stale\nset -g status on\n").unwrap();

        let state = ensure_tmux_conf_on_disk().unwrap();
        assert!(state.wrote);
        assert_eq!(
            state.previous_stamp.as_deref(),
            Some("# lucode-tmux-conf v0.0.0-stale")
        );
        let body = fs::read_to_string(&path).unwrap();
        assert_eq!(body, TMUX_CONF_BODY);

        app_paths_testing::clear_app_support_override();
    }

    #[test]
    fn creates_parent_directories() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("a").join("b").join("c");
        app_paths_testing::set_app_support_override(&nested);

        let state = ensure_tmux_conf_on_disk().unwrap();
        assert!(state.wrote);
        assert!(state.path.exists());

        app_paths_testing::clear_app_support_override();
    }
}
