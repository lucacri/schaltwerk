//! Provisioning of Lucode's tmux configuration on disk. Writes the
//! compiled-in `TMUX_CONF_BODY` atomically and decides whether existing
//! Lucode tmux servers need to be reloaded when the config version stamp
//! changes.

use std::fs;
use std::path::PathBuf;

use crate::domains::terminal::tmux_conf::{TMUX_CONF_BODY, config_version_stamp};
use crate::shared::app_paths::tmux_conf_path;

/// Result of `ensure_tmux_conf_on_disk`. Callers use `wrote` to decide
/// whether running tmux servers need to be reloaded.
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

pub trait TmuxReloadRunner {
    fn run(
        &self,
        socket_path: &std::path::Path,
        args: &[&str],
    ) -> Result<(i32, String), String>;
}

pub fn reload_with_runner(
    socket_paths: &[std::path::PathBuf],
    conf_path: &std::path::Path,
    runner: &dyn TmuxReloadRunner,
) -> Result<Vec<std::path::PathBuf>, String> {
    let conf_str = conf_path.to_string_lossy().into_owned();
    let mut reloaded = Vec::new();
    for socket in socket_paths {
        let probe = match runner.run(socket, &["list-sessions", "-F", "#{session_name}"]) {
            Ok(pair) => pair,
            Err(err) => {
                log::warn!("tmux reload probe failed for {}: {err}", socket.display());
                continue;
            }
        };
        let (status, stderr) = probe;
        if status != 0 {
            if is_no_server_or_session(&stderr.to_ascii_lowercase()) {
                continue;
            }
            log::warn!(
                "tmux reload probe for {} returned status {status}: {stderr}",
                socket.display()
            );
            continue;
        }
        match runner.run(socket, &["source-file", &conf_str]) {
            Ok((0, _)) => reloaded.push(socket.clone()),
            Ok((status, stderr)) => {
                log::warn!(
                    "tmux source-file on {} returned status {status}: {stderr}",
                    socket.display()
                );
            }
            Err(err) => log::warn!(
                "tmux source-file on {} failed to spawn: {err}",
                socket.display()
            ),
        }
    }
    Ok(reloaded)
}

fn is_no_server_or_session(stderr_lower: &str) -> bool {
    stderr_lower.contains("can't find session")
        || stderr_lower.contains("no server running")
        || stderr_lower.contains("session not found")
        || stderr_lower.contains("no current target")
        || stderr_lower.contains("no such file or directory")
        || stderr_lower.contains("connection refused")
}

pub struct SystemTmuxReloadRunner;

impl TmuxReloadRunner for SystemTmuxReloadRunner {
    fn run(
        &self,
        socket_path: &std::path::Path,
        args: &[&str],
    ) -> Result<(i32, String), String> {
        use std::process::Command;

        let output = Command::new("tmux")
            .arg("-S")
            .arg(socket_path)
            .args(args)
            .output()
            .map_err(|e| format!("failed to spawn tmux: {e}"))?;
        let status = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        Ok((status, stderr))
    }
}

pub fn ensure_and_reload_if_rewrote(
    socket_paths: &[std::path::PathBuf],
    runner: &dyn TmuxReloadRunner,
) -> Result<TmuxConfState, String> {
    let state = ensure_tmux_conf_on_disk()?;
    if state.wrote {
        match reload_with_runner(socket_paths, &state.path, runner) {
            Ok(reloaded) if !reloaded.is_empty() => {
                log::info!(
                    "Reloaded tmux config on {} running server(s)",
                    reloaded.len()
                );
            }
            Ok(_) => {
                log::debug!("No live tmux servers to reload");
            }
            Err(err) => {
                log::warn!("tmux config reload failed: {err}");
            }
        }
    }
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::app_paths::testing as app_paths_testing;
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    struct RecordingRunner {
        calls: RefCell<Vec<Vec<String>>>,
        responder: Box<dyn Fn(&Path, &[&str]) -> Result<(i32, String), String>>,
    }

    impl RecordingRunner {
        fn new<F>(responder: F) -> Self
        where
            F: Fn(&Path, &[&str]) -> Result<(i32, String), String> + 'static,
        {
            Self {
                calls: RefCell::new(Vec::new()),
                responder: Box::new(responder),
            }
        }

        fn calls(&self) -> Vec<Vec<String>> {
            self.calls.borrow().clone()
        }
    }

    impl super::TmuxReloadRunner for RecordingRunner {
        fn run(&self, socket_path: &Path, args: &[&str]) -> Result<(i32, String), String> {
            let mut call = vec![socket_path.to_string_lossy().into_owned()];
            call.extend(args.iter().map(|s| s.to_string()));
            self.calls.borrow_mut().push(call);
            (self.responder)(socket_path, args)
        }
    }

    #[test]
    fn reload_reloads_each_live_socket() {
        let rec = RecordingRunner::new(|_socket, _args| Ok((0, String::new())));
        let sockets = vec![
            PathBuf::from("/tmp/tmux-501/lucode-v2-aaaaaaaaaaaaaaaa"),
            PathBuf::from("/tmp/tmux-501/lucode-v2-bbbbbbbbbbbbbbbb"),
        ];
        let conf = PathBuf::from("/etc/lucode/tmux.conf");

        let reloaded = super::reload_with_runner(&sockets, &conf, &rec).unwrap();
        assert_eq!(reloaded, sockets);

        let calls = rec.calls();
        assert_eq!(calls.len(), 4);
        assert_eq!(calls[0][0], sockets[0].to_string_lossy());
        assert_eq!(calls[0][1], "list-sessions");
        assert_eq!(calls[1][0], sockets[0].to_string_lossy());
        assert_eq!(calls[1][1], "source-file");
        assert_eq!(calls[1][2], conf.to_string_lossy());
        assert_eq!(calls[2][0], sockets[1].to_string_lossy());
        assert_eq!(calls[2][1], "list-sessions");
        assert_eq!(calls[3][0], sockets[1].to_string_lossy());
        assert_eq!(calls[3][1], "source-file");
    }

    #[test]
    fn reload_skips_dead_socket() {
        let rec = RecordingRunner::new(|_socket, _args| {
            Ok((
                1,
                "no server running on /tmp/tmux-501/lucode-v2-deadbeefdeadbeef".into(),
            ))
        });
        let sockets = vec![PathBuf::from(
            "/tmp/tmux-501/lucode-v2-deadbeefdeadbeef",
        )];
        let conf = PathBuf::from("/etc/lucode/tmux.conf");

        let reloaded = super::reload_with_runner(&sockets, &conf, &rec).unwrap();
        assert!(reloaded.is_empty());

        let calls = rec.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0][1], "list-sessions");
    }

    #[test]
    fn reload_skips_dead_socket_enoent() {
        let rec = RecordingRunner::new(|_socket, _args| {
            Ok((
                1,
                "error connecting to /tmp/tmux-501/lucode-v2-xxx (No such file or directory)"
                    .into(),
            ))
        });
        let sockets = vec![PathBuf::from("/tmp/tmux-501/lucode-v2-stale00000000000")];
        let conf = PathBuf::from("/etc/lucode/tmux.conf");

        let reloaded = super::reload_with_runner(&sockets, &conf, &rec).unwrap();
        assert!(reloaded.is_empty());
        assert_eq!(rec.calls().len(), 1);
    }

    #[test]
    fn reload_continues_after_individual_failure() {
        let rec = RecordingRunner::new(|socket, args| {
            if socket.to_string_lossy().contains("aaaa")
                && args.first() == Some(&"source-file")
            {
                return Ok((1, "permission denied".into()));
            }
            Ok((0, String::new()))
        });
        let sockets = vec![
            PathBuf::from("/tmp/tmux-501/lucode-v2-aaaaaaaaaaaaaaaa"),
            PathBuf::from("/tmp/tmux-501/lucode-v2-bbbbbbbbbbbbbbbb"),
        ];
        let conf = PathBuf::from("/etc/lucode/tmux.conf");
        let reloaded = super::reload_with_runner(&sockets, &conf, &rec).unwrap();

        assert_eq!(
            reloaded,
            vec![PathBuf::from("/tmp/tmux-501/lucode-v2-bbbbbbbbbbbbbbbb")]
        );
    }

    #[test]
    fn reload_is_noop_for_empty_socket_list() {
        let rec = RecordingRunner::new(|_, _| panic!("runner must not be invoked"));
        let reloaded = super::reload_with_runner(
            &Vec::<PathBuf>::new(),
            &PathBuf::from("/etc/lucode/tmux.conf"),
            &rec,
        )
        .unwrap();
        assert!(reloaded.is_empty());
    }

    #[test]
    fn ensure_and_reload_only_reloads_when_stamp_changed() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let _override = app_paths_testing::OverrideGuard::new(tmp.path());

        let sockets = vec![PathBuf::from(
            "/tmp/tmux-501/lucode-v2-aaaaaaaaaaaaaaaa",
        )];

        let first = RecordingRunner::new(|_, _| Ok((0, String::new())));
        let state = super::ensure_and_reload_if_rewrote(&sockets, &first).unwrap();
        assert!(state.wrote);
        assert_eq!(first.calls().len(), 2);

        let second = RecordingRunner::new(|_, _| panic!("runner must be skipped on no-op ensure"));
        let state2 = super::ensure_and_reload_if_rewrote(&sockets, &second).unwrap();
        assert!(!state2.wrote);

    }

    #[test]
    fn first_call_writes_the_file() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let _override = app_paths_testing::OverrideGuard::new(tmp.path());

        let state = ensure_tmux_conf_on_disk().unwrap();

        assert!(state.wrote);
        assert!(state.previous_stamp.is_none());
        assert!(state.path.exists());
        let body = fs::read_to_string(&state.path).unwrap();
        assert_eq!(body, TMUX_CONF_BODY);

    }

    #[test]
    fn second_call_is_noop_when_stamp_matches() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let _override = app_paths_testing::OverrideGuard::new(tmp.path());

        let first = ensure_tmux_conf_on_disk().unwrap();
        assert!(first.wrote);
        let second = ensure_tmux_conf_on_disk().unwrap();
        assert!(!second.wrote, "second call should be a no-op");
        assert_eq!(
            second.previous_stamp.as_deref(),
            Some(config_version_stamp())
        );

    }

    #[test]
    fn rewrites_when_stamp_changes() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let _override = app_paths_testing::OverrideGuard::new(tmp.path());

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

    }

    #[test]
    fn creates_parent_directories() {
        let _g = app_paths_testing::serial_lock();
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("a").join("b").join("c");
        let _override = app_paths_testing::OverrideGuard::new(&nested);

        let state = ensure_tmux_conf_on_disk().unwrap();
        assert!(state.wrote);
        assert!(state.path.exists());

    }
}
