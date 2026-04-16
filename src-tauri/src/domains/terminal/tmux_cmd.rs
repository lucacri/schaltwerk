//! Thin wrapper around the system `tmux` binary. All invocations go through
//! a per-project `-L <socket>` and the Lucode-owned `-f <config>`; the user's
//! default socket and `~/.tmux.conf` are never touched.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::process::Command;

use crate::domains::terminal::ApplicationSpec;

/// Raw result of a tmux invocation.
#[derive(Debug, Clone)]
pub struct TmuxCliOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

impl TmuxCliOutput {
    pub fn ok(&self) -> bool {
        self.status == 0
    }
}

/// Classify a tmux stderr as meaning "no server/session to talk to" — the
/// tmux socket file is absent, the server died, or the named session is
/// missing. These are all states Lucode treats as "nothing to reattach to;
/// go ahead and create".
///
/// Deliberately narrow: `Permission denied`, `Address already in use`, and
/// every other kind of failure must bubble up as a real error. Keying on the
/// OS `errno` strings (`no such file or directory`, `connection refused`) is
/// stable across tmux versions because those come from `strerror(3)`.
fn is_no_server_or_session(stderr_lower: &str) -> bool {
    stderr_lower.contains("can't find session")
        || stderr_lower.contains("no server running")
        || stderr_lower.contains("session not found")
        || stderr_lower.contains("no such file or directory")
        || stderr_lower.contains("connection refused")
}

#[async_trait]
pub trait TmuxCli: Send + Sync {
    /// Absolute path to the tmux binary used by this backend.
    fn tmux_binary(&self) -> &Path;

    /// Arguments Lucode prepends to every tmux invocation: `-L <socket> -f <conf>`.
    fn global_args(&self) -> Vec<String>;

    /// Run tmux with the given subcommand + args. Lucode global args are prepended.
    async fn run(&self, args: &[&str]) -> Result<TmuxCliOutput, String>;

    /// `tmux has-session -t <name>` → Ok(true) on exit 0, Ok(false) when tmux
    /// reports that there's nothing to talk to (missing socket, dead server,
    /// or session not found), Err on any other failure.
    async fn has_session(&self, name: &str) -> Result<bool, String> {
        let out = self.run(&["has-session", "-t", name]).await?;
        if out.ok() {
            return Ok(true);
        }
        if is_no_server_or_session(&out.stderr.to_ascii_lowercase()) {
            return Ok(false);
        }
        Err(format!(
            "tmux has-session failed (status {}): {}",
            out.status, out.stderr
        ))
    }

    async fn session_has_live_pane(&self, name: &str) -> Result<bool, String> {
        let out = self
            .run(&["list-panes", "-t", name, "-F", "#{pane_dead}"])
            .await?;
        if out.ok() {
            return Ok(out
                .stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .any(|line| line != "1"));
        }
        if is_no_server_or_session(&out.stderr.to_ascii_lowercase()) {
            return Ok(false);
        }
        Err(format!(
            "tmux list-panes failed (status {}): {}",
            out.status, out.stderr
        ))
    }

    /// `tmux new-session -d -s <name> -x <cols> -y <rows> -c <cwd> [-e KEY=VAL ...] [-- command args...]`.
    async fn new_session_detached(
        &self,
        name: &str,
        cols: u16,
        rows: u16,
        cwd: &str,
        app: Option<&ApplicationSpec>,
    ) -> Result<(), String> {
        let cols_s = cols.to_string();
        let rows_s = rows.to_string();
        let mut args: Vec<String> = vec![
            "new-session".into(),
            "-d".into(),
            "-s".into(),
            name.to_string(),
            "-x".into(),
            cols_s,
            "-y".into(),
            rows_s,
            "-c".into(),
            cwd.to_string(),
        ];

        if let Some(spec) = app {
            for (k, v) in &spec.env {
                args.push("-e".into());
                args.push(format!("{k}={v}"));
            }
            args.push("--".into());
            args.push(spec.command.clone());
            for a in &spec.args {
                args.push(a.clone());
            }
        }

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let out = self.run(&arg_refs).await?;
        if !out.ok() {
            return Err(format!(
                "tmux new-session failed (status {}): {}",
                out.status, out.stderr
            ));
        }
        Ok(())
    }

    async fn kill_session(&self, name: &str) -> Result<(), String> {
        let out = self.run(&["kill-session", "-t", name]).await?;
        if out.ok() {
            return Ok(());
        }
        if is_no_server_or_session(&out.stderr.to_ascii_lowercase()) {
            return Ok(());
        }
        Err(format!(
            "tmux kill-session failed (status {}): {}",
            out.status, out.stderr
        ))
    }

    async fn list_sessions(&self) -> Result<Vec<String>, String> {
        let out = self
            .run(&["list-sessions", "-F", "#{session_name}"])
            .await?;
        if out.ok() {
            return Ok(out
                .stdout
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect());
        }
        if is_no_server_or_session(&out.stderr.to_ascii_lowercase()) {
            return Ok(Vec::new());
        }
        Err(format!(
            "tmux list-sessions failed (status {}): {}",
            out.status, out.stderr
        ))
    }

    async fn kill_server(&self) -> Result<(), String> {
        let out = self.run(&["kill-server"]).await?;
        if out.ok() {
            return Ok(());
        }
        if is_no_server_or_session(&out.stderr.to_ascii_lowercase()) {
            return Ok(());
        }
        Err(format!(
            "tmux kill-server failed (status {}): {}",
            out.status, out.stderr
        ))
    }
}

/// Concrete TmuxCli that spawns the system `tmux` binary.
pub struct SystemTmuxCli {
    binary: PathBuf,
    socket: String,
    config_path: PathBuf,
}

impl SystemTmuxCli {
    pub fn new(socket: impl Into<String>, config_path: PathBuf) -> Self {
        Self {
            binary: PathBuf::from("tmux"),
            socket: socket.into(),
            config_path,
        }
    }

    pub fn with_binary(mut self, binary: PathBuf) -> Self {
        self.binary = binary;
        self
    }

    pub fn socket(&self) -> &str {
        &self.socket
    }

    pub fn config_path(&self) -> &Path {
        &self.config_path
    }
}

#[async_trait]
impl TmuxCli for SystemTmuxCli {
    fn tmux_binary(&self) -> &Path {
        &self.binary
    }

    fn global_args(&self) -> Vec<String> {
        vec![
            "-L".into(),
            self.socket.clone(),
            "-f".into(),
            self.config_path.to_string_lossy().into_owned(),
        ]
    }

    async fn run(&self, args: &[&str]) -> Result<TmuxCliOutput, String> {
        let mut cmd = Command::new(&self.binary);
        cmd.args(self.global_args());
        cmd.args(args);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("failed to spawn tmux: {e}"))?;
        Ok(TmuxCliOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Convenience: wraps a SystemTmuxCli in an Arc for shared ownership.
pub fn make_system_cli(socket: impl Into<String>, config_path: PathBuf) -> Arc<dyn TmuxCli> {
    Arc::new(SystemTmuxCli::new(socket, config_path))
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use std::sync::Mutex;

    /// Mock TmuxCli that records invocations and returns scripted outputs.
    pub struct MockTmuxCli {
        pub calls: Mutex<Vec<Vec<String>>>,
        pub responder: Box<dyn Fn(&[String]) -> TmuxCliOutput + Send + Sync>,
    }

    impl MockTmuxCli {
        pub fn new<F>(responder: F) -> Arc<Self>
        where
            F: Fn(&[String]) -> TmuxCliOutput + Send + Sync + 'static,
        {
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                responder: Box::new(responder),
            })
        }

        pub fn recorded_calls(&self) -> Vec<Vec<String>> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl TmuxCli for MockTmuxCli {
        fn tmux_binary(&self) -> &Path {
            Path::new("tmux")
        }

        fn global_args(&self) -> Vec<String> {
            vec!["-L".into(), "mock".into()]
        }

        async fn run(&self, args: &[&str]) -> Result<TmuxCliOutput, String> {
            let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            self.calls.lock().unwrap().push(owned.clone());
            let out = (self.responder)(&owned);
            // Force a cooperative reschedule so concurrency tests can interleave
            // pending racers between tmux CLI invocations.
            tokio::task::yield_now().await;
            Ok(out)
        }
    }

    pub fn success() -> TmuxCliOutput {
        TmuxCliOutput {
            status: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    }

    pub fn failure(status: i32, stderr: &str) -> TmuxCliOutput {
        TmuxCliOutput {
            status,
            stdout: String::new(),
            stderr: stderr.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    #[tokio::test]
    async fn has_session_true_on_status_zero() {
        let cli = MockTmuxCli::new(|_| success());
        assert!(cli.has_session("foo").await.unwrap());
        assert_eq!(
            cli.recorded_calls(),
            vec![vec![
                "has-session".to_string(),
                "-t".to_string(),
                "foo".to_string()
            ]]
        );
    }

    #[tokio::test]
    async fn has_session_false_on_expected_missing_messages() {
        for msg in [
            "can't find session: foo",
            "no server running on /tmp/x",
            "session not found",
        ] {
            let cli = MockTmuxCli::new(move |_| failure(1, msg));
            assert_eq!(cli.has_session("foo").await.unwrap(), false, "msg: {msg}");
        }
    }

    #[tokio::test]
    async fn has_session_error_on_unexpected_stderr() {
        let cli = MockTmuxCli::new(|_| failure(2, "wild unexpected failure"));
        assert!(cli.has_session("foo").await.is_err());
    }

    #[tokio::test]
    async fn has_session_false_on_cold_socket_enoent() {
        // Reproduces the first-run failure seen in 0.14.0 after the
        // `lucode-v2-` socket rename: the per-project socket file doesn't
        // exist yet, so tmux returns the OS errno string instead of
        // "no server running".
        let stderr = "error connecting to /private/tmp/tmux-501/lucode-v2-20f49ececfb47119 \
             (No such file or directory)";
        let cli = MockTmuxCli::new(move |_| failure(1, stderr));
        assert_eq!(
            cli.has_session("session-foo~abcd1234-top").await.unwrap(),
            false,
            "cold-socket ENOENT must be treated as 'no session' so new-session can create it"
        );
    }

    #[tokio::test]
    async fn has_session_false_on_dead_server_socket_refused() {
        // Socket file exists but the server died — connect() gets ECONNREFUSED.
        // Same semantic as "no server running": nothing for us to reattach to.
        let cli = MockTmuxCli::new(|_| {
            failure(
                1,
                "error connecting to /private/tmp/tmux-501/lucode-v2-... (Connection refused)",
            )
        });
        assert_eq!(cli.has_session("foo").await.unwrap(), false);
    }

    #[tokio::test]
    async fn has_session_error_on_permission_denied() {
        // Safety check: a genuine access error must still surface, not be
        // silently swallowed as "no session".
        let cli = MockTmuxCli::new(|_| {
            failure(
                1,
                "error connecting to /private/tmp/tmux-501/lucode-v2-... (Permission denied)",
            )
        });
        assert!(cli.has_session("foo").await.is_err());
    }

    #[tokio::test]
    async fn session_has_live_pane_true_when_pane_dead_is_zero() {
        let cli = MockTmuxCli::new(|_| TmuxCliOutput {
            status: 0,
            stdout: "0\n".into(),
            stderr: String::new(),
        });

        assert!(cli.session_has_live_pane("foo").await.unwrap());
        assert_eq!(
            cli.recorded_calls(),
            vec![vec![
                "list-panes".to_string(),
                "-t".to_string(),
                "foo".to_string(),
                "-F".to_string(),
                "#{pane_dead}".to_string(),
            ]]
        );
    }

    #[tokio::test]
    async fn session_has_live_pane_false_when_all_panes_are_dead() {
        let cli = MockTmuxCli::new(|_| TmuxCliOutput {
            status: 0,
            stdout: "1\n".into(),
            stderr: String::new(),
        });

        assert!(!cli.session_has_live_pane("foo").await.unwrap());
    }

    #[tokio::test]
    async fn session_has_live_pane_true_when_any_pane_is_live() {
        let cli = MockTmuxCli::new(|_| TmuxCliOutput {
            status: 0,
            stdout: "1\n0\n".into(),
            stderr: String::new(),
        });

        assert!(cli.session_has_live_pane("foo").await.unwrap());
    }

    #[tokio::test]
    async fn kill_session_tolerates_cold_socket_enoent() {
        let cli = MockTmuxCli::new(|_| {
            failure(
                1,
                "error connecting to /private/tmp/tmux-501/lucode-v2-... \
                 (No such file or directory)",
            )
        });
        assert!(cli.kill_session("foo").await.is_ok());
    }

    #[tokio::test]
    async fn list_sessions_returns_empty_on_cold_socket_enoent() {
        let cli = MockTmuxCli::new(|_| {
            failure(
                1,
                "error connecting to /private/tmp/tmux-501/lucode-v2-... \
                 (No such file or directory)",
            )
        });
        assert_eq!(cli.list_sessions().await.unwrap(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn new_session_detached_emits_expected_argv() {
        let cli = MockTmuxCli::new(|_| success());
        cli.new_session_detached("term1", 120, 40, "/tmp", None)
            .await
            .unwrap();
        let calls = cli.recorded_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            vec![
                "new-session",
                "-d",
                "-s",
                "term1",
                "-x",
                "120",
                "-y",
                "40",
                "-c",
                "/tmp"
            ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn new_session_detached_includes_env_and_command_after_double_dash() {
        let cli = MockTmuxCli::new(|_| success());
        let app = ApplicationSpec {
            command: "echo".into(),
            args: vec!["hello".into(), "world".into()],
            env: vec![("FOO".into(), "bar".into()), ("BAZ".into(), "qux".into())],
            ready_timeout_ms: 1000,
        };
        cli.new_session_detached("t", 80, 24, "/tmp", Some(&app))
            .await
            .unwrap();
        let calls = cli.recorded_calls();
        assert_eq!(calls.len(), 1);
        let args = &calls[0];
        let dd_idx = args.iter().position(|s| s == "--").expect("missing --");
        assert_eq!(
            &args[dd_idx + 1..],
            &["echo".to_string(), "hello".into(), "world".into()]
        );
        let pre = &args[..dd_idx];
        let env_segments: Vec<&String> = pre
            .windows(2)
            .filter(|w| w[0] == "-e")
            .map(|w| &w[1])
            .collect();
        assert_eq!(
            env_segments,
            vec![&"FOO=bar".to_string(), &"BAZ=qux".to_string()]
        );
    }

    #[tokio::test]
    async fn kill_session_swallows_missing_session() {
        let cli = MockTmuxCli::new(|_| failure(1, "can't find session: foo"));
        assert!(cli.kill_session("foo").await.is_ok());
    }

    #[tokio::test]
    async fn kill_session_errors_on_unexpected_failure() {
        let cli = MockTmuxCli::new(|_| failure(3, "permission denied"));
        assert!(cli.kill_session("foo").await.is_err());
    }

    #[tokio::test]
    async fn list_sessions_parses_lines_and_tolerates_empty_server() {
        let cli = MockTmuxCli::new(|_| TmuxCliOutput {
            status: 0,
            stdout: "a\nb\n  c  \n\n".into(),
            stderr: String::new(),
        });
        assert_eq!(cli.list_sessions().await.unwrap(), vec!["a", "b", "c"]);

        let cli2 = MockTmuxCli::new(|_| failure(1, "no server running on /tmp/x"));
        assert_eq!(cli2.list_sessions().await.unwrap(), Vec::<String>::new());
    }

    #[test]
    fn system_cli_builds_global_args_with_socket_and_config() {
        let cli = SystemTmuxCli::new("lucode-deadbeef", PathBuf::from("/tmp/tmux.conf"));
        assert_eq!(
            cli.global_args(),
            vec![
                "-L".to_string(),
                "lucode-deadbeef".into(),
                "-f".into(),
                "/tmp/tmux.conf".into(),
            ]
        );
        assert_eq!(cli.socket(), "lucode-deadbeef");
        assert_eq!(cli.config_path(), Path::new("/tmp/tmux.conf"));
    }
}
