//! `TmuxAdapter` — the production `TerminalBackend`. Owns the lifecycle of
//! per-terminal tmux sessions on a per-project tmux server, and delegates PTY
//! reading / writing / coalescing / idle detection to an inner `LocalPtyAdapter`
//! whose spawned process is `tmux attach-session`.
//!
//! Behavior contract preserved from `LocalPtyAdapter`:
//! - `broadcast::Sender<(String, u64)>` output events.
//! - Monotonic `seq` byte counter over the attached PTY stream.
//!
//! Departures from `LocalPtyAdapter`:
//! - `snapshot` returns `{ seq: current, start_seq: current, data: [] }` — the
//!   tmux server owns scrollback; Lucode does not redeliver it from its own
//!   ring buffer on hydration.
//! - `exists` is authoritative via tmux; `has-session` is the source of truth.
//! - `close` kills the tmux session before tearing down the inner PTY.
//! - `create` wraps the caller's `ApplicationSpec` so tmux spawns it and the
//!   inner PTY just attaches.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tauri::AppHandle;
use tokio::sync::Mutex;

use super::local::LocalPtyAdapter;
use super::tmux_cmd::TmuxCli;
use super::{ApplicationSpec, CreateParams, TerminalBackend, TerminalSnapshot};
use crate::shared::terminal_id::is_lucode_owned_tmux_session;

pub struct TmuxAdapter {
    cli: Arc<dyn TmuxCli>,
    inner: Arc<dyn TerminalBackend>,
    tmux_binary: String,
    global_args: Vec<String>,
    last_sizes: Arc<Mutex<HashMap<String, (u16, u16)>>>,
    // Serializes the has-session → new-session check-then-create sequence per
    // terminal id. Without this, overlapping selection/hydration flows can both
    // observe `has-session=false` on a cold-launch tmux server and race into
    // `new-session`, producing a "duplicate session" failure for the loser.
    create_guards: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl TmuxAdapter {
    pub fn new(cli: Arc<dyn TmuxCli>) -> Self {
        let tmux_binary = resolve_tmux_binary(cli.tmux_binary().to_string_lossy().as_ref());
        let global_args = cli.global_args();
        Self {
            cli,
            inner: Arc::new(LocalPtyAdapter::new()),
            tmux_binary,
            global_args,
            last_sizes: Arc::new(Mutex::new(HashMap::new())),
            create_guards: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    fn new_with_backend_for_test(
        cli: Arc<dyn TmuxCli>,
        inner: Arc<dyn TerminalBackend>,
    ) -> Self {
        let tmux_binary = resolve_tmux_binary(cli.tmux_binary().to_string_lossy().as_ref());
        let global_args = cli.global_args();
        Self {
            cli,
            inner,
            tmux_binary,
            global_args,
            last_sizes: Arc::new(Mutex::new(HashMap::new())),
            create_guards: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn acquire_create_guard(&self, id: &str) -> Arc<Mutex<()>> {
        let mut guards = self.create_guards.lock().await;
        guards
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn release_create_guard_if_idle(&self, id: &str, guard: Arc<Mutex<()>>) {
        let mut guards = self.create_guards.lock().await;
        // Two strong refs here (ours + the map's) means no other racer is waiting.
        if Arc::strong_count(&guard) <= 2 {
            guards.remove(id);
        }
    }

    /// Kill any Lucode-owned tmux sessions on this project's socket whose name
    /// does not start with one of `live_bases`. Returns the names of the
    /// sessions that were killed.
    ///
    /// A live base is typically the wire-ID base of a live Lucode session
    /// (e.g. `session-fix-bug~abcd1234` or `orchestrator-myproj-deadbe`); any
    /// tmux session whose name starts with that base — including `-top`,
    /// `-bottom`, and `-bottom-{N}` variants — survives.
    ///
    /// Tmux sessions that aren't owned by Lucode are ignored (they belong to
    /// other tools sharing the socket, though Lucode's per-project socket
    /// name should prevent that in practice).
    pub async fn gc_orphans(&self, live_bases: &HashSet<String>) -> Result<Vec<String>, String> {
        let sessions = self.cli.list_sessions().await?;
        let mut killed: Vec<String> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for name in sessions {
            if !is_lucode_owned_tmux_session(&name) {
                continue;
            }
            if live_bases.iter().any(|base| name.starts_with(base)) {
                continue;
            }
            match self.cli.kill_session(&name).await {
                Ok(()) => killed.push(name),
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
        if !errors.is_empty() {
            return Err(format!("kill-session errors: {}", errors.join("; ")));
        }
        Ok(killed)
    }

    fn attach_application_spec(&self, id: &str, env: Vec<(String, String)>) -> ApplicationSpec {
        let mut args: Vec<String> = self.global_args.clone();
        args.push("attach-session".into());
        args.push("-t".into());
        args.push(id.to_string());
        ApplicationSpec {
            command: self.tmux_binary.clone(),
            args,
            env,
            ready_timeout_ms: 0,
        }
    }
}

fn resolve_tmux_binary(hint: &str) -> String {
    if hint.contains('/') {
        return hint.to_string();
    }
    which::which(hint)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| hint.to_string())
}

#[async_trait]
impl TerminalBackend for TmuxAdapter {
    async fn set_app_handle(&self, handle: AppHandle) {
        self.inner.set_app_handle(handle).await;
    }

    async fn create(&self, params: CreateParams) -> Result<(), String> {
        self.create_with_size(params, 80, 24).await
    }

    async fn create_with_size(
        &self,
        params: CreateParams,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let id = params.id.clone();

        let guard = self.acquire_create_guard(&id).await;
        let check_and_create = async {
            let _held = guard.lock().await;
            let exists = self.cli.has_session(&id).await?;
            if !exists {
                self.cli
                    .new_session_detached(&id, cols, rows, &params.cwd, params.app.as_ref())
                    .await?;
            }
            Ok::<bool, String>(exists)
        }
        .await;
        self.release_create_guard_if_idle(&id, guard).await;
        let session_exists = check_and_create?;

        // Propagate agent env to the attaching client as well so interactive
        // commands inside the pane can observe them if tmux's update-environment
        // misses one. Session-level env was already passed to new-session -e.
        let env = params
            .app
            .as_ref()
            .map(|a| a.env.clone())
            .unwrap_or_default();
        let attach_params = CreateParams {
            id: id.clone(),
            cwd: params.cwd.clone(),
            app: Some(self.attach_application_spec(&id, env)),
            // tmux owns scrollback (history-limit 50000 in our conf); the
            // attach client must not duplicate it in Lucode's ring buffer.
            disable_hydration_buffer: true,
        };

        match self.inner.create_with_size(attach_params, cols, rows).await {
            Ok(()) => {
                self.last_sizes.lock().await.insert(id, (cols, rows));
                Ok(())
            }
            Err(e) => {
                if !session_exists {
                    let _ = self.cli.kill_session(&id).await;
                }
                Err(e)
            }
        }
    }

    async fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        self.inner.write(id, data).await
    }

    async fn write_immediate(&self, id: &str, data: &[u8]) -> Result<(), String> {
        self.inner.write_immediate(id, data).await
    }

    async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.inner.resize(id, cols, rows).await?;
        self.last_sizes
            .lock()
            .await
            .insert(id.to_string(), (cols, rows));
        Ok(())
    }

    async fn close(&self, id: &str) -> Result<(), String> {
        let inner_result = self.inner.close(id).await;
        let tmux_result = self.cli.kill_session(id).await;
        self.last_sizes.lock().await.remove(id);
        match (inner_result, tmux_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(e), _) | (_, Err(e)) => Err(e),
        }
    }

    async fn exists(&self, id: &str) -> Result<bool, String> {
        self.cli.has_session(id).await
    }

    async fn agent_pane_alive(&self, id: &str) -> Result<bool, String> {
        self.cli.session_has_live_pane(id).await
    }

    async fn snapshot(&self, id: &str, from_seq: Option<u64>) -> Result<TerminalSnapshot, String> {
        let inner = self.inner.snapshot(id, from_seq).await?;
        Ok(TerminalSnapshot {
            seq: inner.seq,
            start_seq: inner.seq,
            data: Vec::new(),
        })
    }

    async fn queue_initial_command(
        &self,
        id: &str,
        command: String,
        ready_marker: Option<String>,
        dispatch_delay: Option<Duration>,
    ) -> Result<(), String> {
        self.inner
            .queue_initial_command(id, command, ready_marker, dispatch_delay)
            .await
    }

    async fn get_all_terminal_activity(&self) -> Vec<(String, u64)> {
        self.inner.get_all_terminal_activity().await
    }

    async fn get_activity_status(&self, id: &str) -> Result<(bool, u64), String> {
        self.inner.get_activity_status(id).await
    }

    async fn inject_terminal_error(
        &self,
        id: &str,
        cwd: &str,
        message: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        self.inner
            .inject_terminal_error(id, cwd, message, cols, rows)
            .await
    }

    async fn wait_for_output_change(&self, id: &str, min_seq: u64) -> Result<u64, String> {
        self.inner.wait_for_output_change(id, min_seq).await
    }

    async fn configure_attention_profile(&self, id: &str, agent_type: &str) -> Result<(), String> {
        self.inner.configure_attention_profile(id, agent_type).await
    }

    async fn suspend(&self, id: &str) -> Result<(), String> {
        self.inner.suspend(id).await
    }

    async fn resume(&self, id: &str) -> Result<(), String> {
        self.inner.resume(id).await
    }

    async fn is_suspended(&self, id: &str) -> Result<bool, String> {
        self.inner.is_suspended(id).await
    }

    async fn force_kill_all(&self) -> Result<(), String> {
        self.last_sizes.lock().await.clear();
        self.inner.force_kill_all().await
    }

    async fn gc_orphans(&self, live_bases: &HashSet<String>) -> Result<Vec<String>, String> {
        TmuxAdapter::gc_orphans(self, live_bases).await
    }

    async fn refresh_view(&self, id: &str) -> Result<(), String> {
        self.cli.refresh_client(id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::terminal::tmux_cmd::testing::{MockTmuxCli, success};

    #[derive(Default)]
    struct RecordingBackend {
        resize_calls: Mutex<Vec<(String, u16, u16)>>,
    }

    #[async_trait]
    impl TerminalBackend for RecordingBackend {
        async fn create(&self, _params: CreateParams) -> Result<(), String> {
            Ok(())
        }

        async fn create_with_size(
            &self,
            _params: CreateParams,
            _cols: u16,
            _rows: u16,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn write(&self, _id: &str, _data: &[u8]) -> Result<(), String> {
            Ok(())
        }

        async fn write_immediate(&self, _id: &str, _data: &[u8]) -> Result<(), String> {
            Ok(())
        }

        async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
            self.resize_calls
                .lock()
                .await
                .push((id.to_string(), cols, rows));
            Ok(())
        }

        async fn close(&self, _id: &str) -> Result<(), String> {
            Ok(())
        }

        async fn exists(&self, _id: &str) -> Result<bool, String> {
            Ok(true)
        }

        async fn snapshot(
            &self,
            _id: &str,
            _from_seq: Option<u64>,
        ) -> Result<TerminalSnapshot, String> {
            Ok(TerminalSnapshot {
                seq: 0,
                start_seq: 0,
                data: Vec::new(),
            })
        }
    }

    #[test]
    fn resolve_tmux_binary_honors_absolute_paths() {
        assert_eq!(
            resolve_tmux_binary("/opt/homebrew/bin/tmux"),
            "/opt/homebrew/bin/tmux"
        );
    }

    #[tokio::test]
    async fn exists_delegates_to_cli_has_session() {
        let cli = MockTmuxCli::new(|_| success());
        let adapter = TmuxAdapter::new(cli.clone());
        assert!(adapter.exists("t1").await.unwrap());
        let calls = cli.recorded_calls();
        assert_eq!(
            calls.last().unwrap(),
            &vec!["has-session".to_string(), "-t".into(), "t1".into()]
        );
    }

    #[tokio::test]
    async fn agent_pane_alive_delegates_to_cli_pane_liveness() {
        use crate::domains::terminal::tmux_cmd::TmuxCliOutput;

        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-panes") => TmuxCliOutput {
                status: 0,
                stdout: "0\n".into(),
                stderr: String::new(),
            },
            _ => success(),
        });
        let adapter = TmuxAdapter::new(cli.clone());

        assert!(adapter.agent_pane_alive("t1").await.unwrap());
        assert_eq!(
            cli.recorded_calls(),
            vec![vec![
                "list-panes".to_string(),
                "-t".to_string(),
                "t1".to_string(),
                "-F".to_string(),
                "#{pane_dead}".to_string(),
            ]]
        );
    }

    #[tokio::test]
    async fn snapshot_on_missing_terminal_returns_empty() {
        let cli = MockTmuxCli::new(|_| success());
        let adapter = TmuxAdapter::new(cli);
        let snap = adapter.snapshot("unknown", None).await.unwrap();
        assert_eq!(snap.seq, 0);
        assert_eq!(snap.start_seq, 0);
        assert!(snap.data.is_empty());
    }

    #[tokio::test]
    async fn close_kills_tmux_session_even_if_inner_close_errors() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static KILL_CALLS: AtomicUsize = AtomicUsize::new(0);
        KILL_CALLS.store(0, Ordering::SeqCst);

        let cli = MockTmuxCli::new(|args| {
            if args.first().map(String::as_str) == Some("kill-session") {
                KILL_CALLS.fetch_add(1, Ordering::SeqCst);
            }
            success()
        });
        let adapter = TmuxAdapter::new(cli);
        // Inner has no record of "ghost"; close still calls tmux kill-session.
        let _ = adapter.close("ghost").await;
        assert_eq!(KILL_CALLS.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn create_skips_new_session_when_session_already_exists() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEW_SESSION_CALLS: AtomicUsize = AtomicUsize::new(0);
        NEW_SESSION_CALLS.store(0, Ordering::SeqCst);

        let cli = MockTmuxCli::new(|args| {
            if args.first().map(String::as_str) == Some("new-session") {
                NEW_SESSION_CALLS.fetch_add(1, Ordering::SeqCst);
            }
            success()
        });
        let adapter = TmuxAdapter::new(cli);

        // Force inner PTY create to fail so we don't actually spawn tmux.
        let params = CreateParams {
            id: "reattach-me".into(),
            cwd: "/nonexistent-for-this-test".into(),
            app: None,
            disable_hydration_buffer: false,
        };
        // We can't easily let inner succeed without spawning a real PTY; just
        // verify the new-session argv was NOT emitted when has-session returned true.
        let _ = adapter.create_with_size(params, 80, 24).await;
        assert_eq!(NEW_SESSION_CALLS.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn create_calls_new_session_when_missing() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static HAS_CALLS: AtomicUsize = AtomicUsize::new(0);
        static NEW_CALLS: AtomicUsize = AtomicUsize::new(0);
        HAS_CALLS.store(0, Ordering::SeqCst);
        NEW_CALLS.store(0, Ordering::SeqCst);

        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("has-session") => {
                HAS_CALLS.fetch_add(1, Ordering::SeqCst);
                crate::domains::terminal::tmux_cmd::testing::failure(1, "can't find session: x")
            }
            Some("new-session") => {
                NEW_CALLS.fetch_add(1, Ordering::SeqCst);
                success()
            }
            _ => success(),
        });
        let adapter = TmuxAdapter::new(cli);
        let params = CreateParams {
            id: "fresh".into(),
            cwd: "/also-nonexistent".into(),
            app: None,
            disable_hydration_buffer: false,
        };
        let _ = adapter.create_with_size(params, 80, 24).await;
        assert_eq!(HAS_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(NEW_CALLS.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn same_size_resize_is_not_suppressed() {
        let cli = MockTmuxCli::new(|_| success());
        let inner = Arc::new(RecordingBackend::default());
        let adapter = TmuxAdapter::new_with_backend_for_test(cli, inner.clone());

        adapter
            .resize("session-redraw~abcdef12-top", 120, 40)
            .await
            .unwrap();
        adapter
            .resize("session-redraw~abcdef12-top", 120, 40)
            .await
            .unwrap();

        let calls = inner.resize_calls.lock().await.clone();
        assert_eq!(
            calls,
            vec![
                ("session-redraw~abcdef12-top".to_string(), 120, 40),
                ("session-redraw~abcdef12-top".to_string(), 120, 40),
            ],
            "same-size resize must reach the inner PTY so tmux receives SIGWINCH and redraws"
        );
    }

    #[tokio::test]
    async fn gc_orphans_kills_only_lucode_sessions_not_prefixed_by_live_base() {
        use crate::domains::terminal::tmux_cmd::TmuxCliOutput;

        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-sessions") => TmuxCliOutput {
                status: 0,
                stdout: "session-alpha~aaaaaaaa-top\n\
                         session-alpha~aaaaaaaa-bottom\n\
                         session-beta~bbbbbbbb-top\n\
                         orchestrator-proj-ccccc-top\n\
                         my-unrelated-session\n\
                         session-gone~dddddddd-top\n"
                    .into(),
                stderr: String::new(),
            },
            Some("kill-session") => success(),
            _ => success(),
        });
        let adapter = TmuxAdapter::new(cli.clone());
        let mut live = HashSet::new();
        live.insert("session-alpha~aaaaaaaa".to_string());
        live.insert("session-beta~bbbbbbbb".to_string());
        live.insert("orchestrator-proj-ccccc".to_string());
        // session-gone~dddddddd is not in live_bases → orphan.
        // my-unrelated-session is not Lucode-owned → skipped.
        let killed = adapter.gc_orphans(&live).await.unwrap();
        assert_eq!(killed, vec!["session-gone~dddddddd-top".to_string()]);
    }

    #[tokio::test]
    async fn gc_orphans_is_noop_on_empty_socket() {
        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-sessions") => success(),
            _ => panic!("unexpected call: {args:?}"),
        });
        let adapter = TmuxAdapter::new(cli);
        let killed = adapter.gc_orphans(&HashSet::new()).await.unwrap();
        assert!(killed.is_empty());
    }

    #[tokio::test]
    async fn force_kill_all_only_detaches_attach_clients() {
        let cli = MockTmuxCli::new(|args| {
            if args.first().map(String::as_str) == Some("kill-server") {
                panic!("force_kill_all must not kill the persistent tmux server");
            }
            success()
        });
        let adapter = TmuxAdapter::new(cli);

        adapter.force_kill_all().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_create_with_same_id_issues_new_session_exactly_once() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

        let session_created = Arc::new(AtomicBool::new(false));
        let new_session_calls = Arc::new(AtomicUsize::new(0));

        let session_flag = session_created.clone();
        let new_count = new_session_calls.clone();

        let cli = MockTmuxCli::new(move |args| match args.first().map(String::as_str) {
            Some("has-session") => {
                if session_flag.load(Ordering::SeqCst) {
                    crate::domains::terminal::tmux_cmd::testing::success()
                } else {
                    crate::domains::terminal::tmux_cmd::testing::failure(
                        1,
                        "can't find session: racing",
                    )
                }
            }
            Some("new-session") => {
                new_count.fetch_add(1, Ordering::SeqCst);
                let was_created = session_flag.swap(true, Ordering::SeqCst);
                if was_created {
                    crate::domains::terminal::tmux_cmd::testing::failure(
                        1,
                        "duplicate session: racing",
                    )
                } else {
                    crate::domains::terminal::tmux_cmd::testing::success()
                }
            }
            _ => crate::domains::terminal::tmux_cmd::testing::success(),
        });

        let adapter = Arc::new(TmuxAdapter::new(cli));

        let spawn_create = |adapter: Arc<TmuxAdapter>| {
            tokio::spawn(async move {
                let params = CreateParams {
                    id: "racing".into(),
                    cwd: "/nonexistent-for-this-test".into(),
                    app: None,
                    disable_hydration_buffer: false,
                };
                adapter.create_with_size(params, 80, 24).await
            })
        };

        let a = spawn_create(adapter.clone());
        let b = spawn_create(adapter.clone());

        let _ = a.await.expect("task A join");
        let _ = b.await.expect("task B join");

        assert_eq!(
            new_session_calls.load(Ordering::SeqCst),
            1,
            "TOCTOU guard failed: new-session must fire exactly once for same-id concurrent creates"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_create_with_different_ids_does_not_serialize() {
        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("has-session") => crate::domains::terminal::tmux_cmd::testing::failure(
                1,
                "can't find session: x",
            ),
            _ => crate::domains::terminal::tmux_cmd::testing::success(),
        });

        let adapter = Arc::new(TmuxAdapter::new(cli.clone()));

        let spawn_create = |adapter: Arc<TmuxAdapter>, id: &'static str| {
            tokio::spawn(async move {
                let params = CreateParams {
                    id: id.into(),
                    cwd: "/nonexistent-for-this-test".into(),
                    app: None,
                    disable_hydration_buffer: false,
                };
                adapter.create_with_size(params, 80, 24).await
            })
        };

        let a = spawn_create(adapter.clone(), "term-a");
        let b = spawn_create(adapter.clone(), "term-b");
        let _ = a.await.expect("task A join");
        let _ = b.await.expect("task B join");

        let calls = cli.recorded_calls();
        let has_a_pos = calls
            .iter()
            .position(|c| c.first().map(String::as_str) == Some("has-session") && c.get(2).map(String::as_str) == Some("term-a"))
            .expect("has-session for term-a");
        let has_b_pos = calls
            .iter()
            .position(|c| c.first().map(String::as_str) == Some("has-session") && c.get(2).map(String::as_str) == Some("term-b"))
            .expect("has-session for term-b");
        let new_first = calls
            .iter()
            .position(|c| c.first().map(String::as_str) == Some("new-session"))
            .expect("at least one new-session");

        assert!(
            has_a_pos < new_first && has_b_pos < new_first,
            "different ids should interleave in has-session before any new-session (got calls {calls:?})"
        );
    }

    #[tokio::test]
    async fn attach_application_spec_builds_tmux_argv() {
        let cli = MockTmuxCli::new(|_| success());
        let adapter = TmuxAdapter::new(cli);
        let spec = adapter.attach_application_spec("my-term", vec![("K".into(), "v".into())]);
        assert!(spec.command.ends_with("tmux") || spec.command == "tmux");
        assert!(spec.args.iter().any(|a| a == "attach-session"));
        assert!(spec.args.iter().any(|a| a == "my-term"));
        assert_eq!(spec.env, vec![("K".to_string(), "v".to_string())]);
    }

    #[tokio::test]
    async fn refresh_view_invokes_list_clients_then_refresh_client_on_session_ttys() {
        use crate::domains::terminal::tmux_cmd::TmuxCliOutput;

        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-clients") => TmuxCliOutput {
                status: 0,
                stdout: "/dev/ttys004\n".into(),
                stderr: String::new(),
            },
            _ => success(),
        });
        let adapter = TmuxAdapter::new(cli.clone());

        adapter
            .refresh_view("session-redraw~abcdef12-top")
            .await
            .expect("tmux-backed refresh_view must succeed");

        let calls = cli.recorded_calls();
        let list = calls
            .iter()
            .find(|c| c.first().map(String::as_str) == Some("list-clients"))
            .expect("list-clients must run");
        assert_eq!(list[2], "session-redraw~abcdef12-top");
        assert!(calls.iter().any(|c| c
            == &vec![
                "refresh-client".to_string(),
                "-t".into(),
                "/dev/ttys004".into(),
            ]));
    }
}
