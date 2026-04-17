//! Read-only inspector that enumerates Lucode-owned tmux servers and the
//! processes running inside their panes. Backs the View Processes window.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;

use crate::domains::terminal::tmux_cmd::{TmuxCli, make_system_cli};

const TMUX_SOCKET_PREFIX: &str = "lucode-v2-";

pub(crate) const LIST_SESSIONS_FORMAT: &str =
    "#{session_name}\t#{session_created}\t#{session_activity}\t#{session_attached}";

pub(crate) const LIST_PANES_FORMAT: &str =
    "#{session_name}\t#{pane_id}\t#{pane_pid}\t#{pane_current_command}";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionInfo {
    pub name: String,
    pub created_unix: Option<i64>,
    pub last_activity_unix: Option<i64>,
    pub attached: bool,
    pub panes: Vec<PaneInfo>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PaneInfo {
    pub session_name: String,
    pub pane_id: String,
    pub pid: i32,
    pub command: String,
    pub rss_kb: Option<u64>,
    pub cpu_percent: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    pub socket_name: String,
    pub project_hash: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub socket_path: String,
    pub is_stale: bool,
    pub error: Option<String>,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone)]
pub(crate) struct SocketEntry {
    pub file_name: String,
    pub project_hash: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PaneMetrics {
    pub rss_kb: u64,
    pub cpu_percent: f32,
}

pub(crate) fn lucode_socket_hash(socket_file_name: &str) -> Option<&str> {
    socket_file_name.strip_prefix(TMUX_SOCKET_PREFIX)
}

pub(crate) fn parse_list_sessions(raw: &str) -> Vec<SessionInfo> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let created = parts.next()?.trim().parse::<i64>().ok();
            let activity = parts.next()?.trim().parse::<i64>().ok();
            let attached = parts.next()?.trim() == "1";
            Some(SessionInfo {
                name: name.to_string(),
                created_unix: created,
                last_activity_unix: activity,
                attached,
                panes: Vec::new(),
            })
        })
        .collect()
}

pub(crate) fn parse_list_panes(raw: &str) -> Vec<PaneInfo> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let session_name = parts.next()?.trim();
            let pane_id = parts.next()?.trim();
            let pid = parts.next()?.trim().parse::<i32>().ok()?;
            let command = parts.next()?.trim();
            if session_name.is_empty() || pane_id.is_empty() {
                return None;
            }
            Some(PaneInfo {
                session_name: session_name.to_string(),
                pane_id: pane_id.to_string(),
                pid,
                command: command.to_string(),
                rss_kb: None,
                cpu_percent: None,
            })
        })
        .collect()
}

pub(crate) fn parse_ps_output(raw: &str) -> HashMap<i32, PaneMetrics> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid: i32 = parts.next()?.parse().ok()?;
            let rss_kb: u64 = parts.next()?.parse().ok()?;
            let cpu_percent: f32 = parts.next()?.parse().ok()?;
            Some((pid, PaneMetrics { rss_kb, cpu_percent }))
        })
        .collect()
}

pub(crate) fn join_metrics(panes: &mut [PaneInfo], metrics: &HashMap<i32, PaneMetrics>) {
    for pane in panes.iter_mut() {
        if let Some(m) = metrics.get(&pane.pid) {
            pane.rss_kb = Some(m.rss_kb);
            pane.cpu_percent = Some(m.cpu_percent);
        }
    }
}

pub(crate) trait EnvLookup {
    fn get(&self, key: &str) -> Option<String>;
}

pub(crate) struct SystemEnv;

impl EnvLookup for SystemEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

/// tmux's own convention: server sockets live in `$TMUX_TMPDIR/tmux-<uid>`,
/// falling back to `/tmp/tmux-<uid>`. tmux does **not** honor `TMPDIR` (see
/// the ENVIRONMENT section of `man tmux`), so neither do we — on macOS
/// `TMPDIR` is always set to a per-user `/var/folders/...` dir that tmux
/// never writes into.
pub(crate) fn resolve_socket_dir<E: EnvLookup>(env: &E, uid: u32) -> PathBuf {
    let base = env
        .get("TMUX_TMPDIR")
        .unwrap_or_else(|| "/tmp".to_string());
    let trimmed = base.trim_end_matches('/');
    PathBuf::from(format!("{trimmed}/tmux-{uid}"))
}

pub(crate) fn scan_lucode_sockets(dir: &Path) -> std::io::Result<Vec<SocketEntry>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let os_name = entry.file_name();
        let Some(name) = os_name.to_str() else {
            continue;
        };
        let Some(hash) = lucode_socket_hash(name) else {
            continue;
        };
        out.push(SocketEntry {
            file_name: name.to_string(),
            project_hash: hash.to_string(),
            path: entry.path(),
        });
    }
    Ok(out)
}

/// Local copy of `tmux_cmd::is_no_server_or_session` — kept private to the
/// inspector to avoid widening that module's public surface for five small
/// substring checks.
fn is_no_server_or_session(stderr_lower: &str) -> bool {
    stderr_lower.contains("can't find session")
        || stderr_lower.contains("no server running")
        || stderr_lower.contains("session not found")
        || stderr_lower.contains("no such file or directory")
        || stderr_lower.contains("connection refused")
}

/// Calls `list-sessions` then `list-panes` against an already-configured tmux
/// CLI (a specific -L socket). Returns `Ok(None)` if the server is not
/// running (stale socket), `Ok(Some(sessions))` otherwise.
pub(crate) async fn load_sessions_for_server(
    cli: &dyn TmuxCli,
) -> Result<Option<Vec<SessionInfo>>, String> {
    let list = cli
        .run(&["list-sessions", "-F", LIST_SESSIONS_FORMAT])
        .await?;
    if !list.ok() {
        let lower = list.stderr.to_ascii_lowercase();
        if is_no_server_or_session(&lower) {
            return Ok(None);
        }
        return Err(format!(
            "tmux list-sessions failed (status {}): {}",
            list.status, list.stderr
        ));
    }

    let mut sessions = parse_list_sessions(&list.stdout);
    if sessions.is_empty() {
        return Ok(Some(Vec::new()));
    }

    let panes_out = cli
        .run(&["list-panes", "-a", "-F", LIST_PANES_FORMAT])
        .await?;
    if !panes_out.ok() {
        return Err(format!(
            "tmux list-panes failed (status {}): {}",
            panes_out.status, panes_out.stderr
        ));
    }
    let panes = parse_list_panes(&panes_out.stdout);
    for session in sessions.iter_mut() {
        session.panes = panes
            .iter()
            .filter(|p| p.session_name == session.name)
            .cloned()
            .collect();
    }
    Ok(Some(sessions))
}

#[async_trait]
pub(crate) trait PsRunner: Send + Sync {
    async fn run(&self, pids: &[i32]) -> Result<String, String>;
}

pub(crate) struct SystemPs;

#[async_trait]
impl PsRunner for SystemPs {
    async fn run(&self, pids: &[i32]) -> Result<String, String> {
        if pids.is_empty() {
            return Ok(String::new());
        }
        let joined = pids
            .iter()
            .map(i32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let out = tokio::process::Command::new("ps")
            .args(["-o", "pid=,rss=,%cpu=", "-p", &joined])
            .output()
            .await
            .map_err(|e| format!("failed to spawn ps: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

pub(crate) async fn gather_metrics(
    runner: &dyn PsRunner,
    pids: &[i32],
) -> Result<HashMap<i32, PaneMetrics>, String> {
    if pids.is_empty() {
        return Ok(HashMap::new());
    }
    let raw = runner.run(pids).await?;
    Ok(parse_ps_output(&raw))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProject {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Default, Clone)]
pub struct ProjectLookup(HashMap<String, ResolvedProject>);

impl ProjectLookup {
    /// Build a hash→project map by canonicalizing each known project path.
    /// Paths that fail to canonicalize are silently skipped — the inspector
    /// then falls back to the raw socket hash for those rows.
    pub fn from_pairs(pairs: &[(&str, &str)]) -> Self {
        let mut map = HashMap::new();
        for (path, name) in pairs {
            let Ok(canonical) = std::fs::canonicalize(path) else {
                continue;
            };
            let hash = crate::shared::project_hash::project_hash16_for_canonical(&canonical);
            map.insert(
                hash,
                ResolvedProject {
                    name: (*name).to_string(),
                    path: (*path).to_string(),
                },
            );
        }
        Self(map)
    }

    pub(crate) fn resolve(&self, hash: &str) -> Option<&ResolvedProject> {
        self.0.get(hash)
    }
}

/// Orchestrator. Each (hash, cli) pair maps to a tmux socket to inspect;
/// the ps runner is called once with all PIDs across all live servers.
pub(crate) async fn assemble_servers(
    sockets: Vec<SocketEntry>,
    mut clis: HashMap<String, Arc<dyn TmuxCli>>,
    ps: &dyn PsRunner,
    projects: &ProjectLookup,
) -> Vec<ServerInfo> {
    let mut servers: Vec<ServerInfo> = Vec::with_capacity(sockets.len());

    for socket in sockets {
        let cli = match clis.remove(&socket.project_hash) {
            Some(c) => c,
            None => continue,
        };
        let project = projects.resolve(&socket.project_hash);
        let base = ServerInfo {
            socket_name: socket.file_name.clone(),
            project_hash: socket.project_hash.clone(),
            project_path: project.map(|p| p.path.clone()),
            project_name: project.map(|p| p.name.clone()),
            socket_path: socket.path.to_string_lossy().into_owned(),
            is_stale: false,
            error: None,
            sessions: Vec::new(),
        };

        match load_sessions_for_server(cli.as_ref()).await {
            Ok(None) => servers.push(ServerInfo {
                is_stale: true,
                ..base
            }),
            Ok(Some(sessions)) => servers.push(ServerInfo { sessions, ..base }),
            Err(e) => {
                log::warn!(
                    "[tmux_inspect] {} inspection failed: {}",
                    socket.file_name,
                    e
                );
                servers.push(ServerInfo {
                    is_stale: true,
                    error: Some(e),
                    ..base
                });
            }
        }
    }

    let pids: Vec<i32> = servers
        .iter()
        .flat_map(|s| {
            s.sessions
                .iter()
                .flat_map(|sess| sess.panes.iter().map(|p| p.pid))
        })
        .collect();

    if let Ok(metrics) = gather_metrics(ps, &pids).await {
        for server in servers.iter_mut() {
            for session in server.sessions.iter_mut() {
                join_metrics(&mut session.panes, &metrics);
            }
        }
    }

    servers
}

/// Production entry point. Scans the tmux socket directory for Lucode-owned
/// servers, builds a per-server `SystemTmuxCli` pointed at the Lucode conf,
/// and returns the assembled read-only snapshot. The caller supplies a
/// `ProjectLookup` so this library function can stay agnostic of the binary's
/// project-history module.
pub async fn list_lucode_tmux_servers(
    projects: &ProjectLookup,
) -> Result<Vec<ServerInfo>, String> {
    let uid: u32 = unsafe { libc::geteuid() };
    let dir = resolve_socket_dir(&SystemEnv, uid);
    let sockets = scan_lucode_sockets(&dir)
        .map_err(|e| format!("failed to scan tmux socket dir {}: {}", dir.display(), e))?;

    if sockets.is_empty() {
        return Ok(Vec::new());
    }

    let conf_path = crate::shared::app_paths::tmux_conf_path()
        .map_err(|e| format!("failed to resolve tmux conf path: {e}"))?;

    let mut clis: HashMap<String, Arc<dyn TmuxCli>> = HashMap::new();
    for socket in &sockets {
        let cli = make_system_cli(socket.file_name.clone(), conf_path.clone());
        clis.insert(socket.project_hash.clone(), cli);
    }

    let ps = SystemPs;
    Ok(assemble_servers(sockets, clis, &ps, projects).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::terminal::tmux_cmd::TmuxCliOutput;
    use crate::domains::terminal::tmux_cmd::testing::{MockTmuxCli, failure};

    #[test]
    fn recognizes_lucode_socket_and_extracts_hash() {
        assert_eq!(
            lucode_socket_hash("lucode-v2-0123456789abcdef"),
            Some("0123456789abcdef")
        );
    }

    #[test]
    fn rejects_non_lucode_socket_names() {
        assert_eq!(lucode_socket_hash("default"), None);
        assert_eq!(lucode_socket_hash("lucode-v1-abcd"), None);
        assert_eq!(lucode_socket_hash(""), None);
    }

    #[test]
    fn parses_list_sessions_output() {
        let raw = "main\t1700000000\t1700000100\t1\nscratch\t1700000200\t1700000300\t0\n";
        let parsed = parse_list_sessions(raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "main");
        assert_eq!(parsed[0].created_unix, Some(1_700_000_000));
        assert_eq!(parsed[0].last_activity_unix, Some(1_700_000_100));
        assert!(parsed[0].attached);
        assert_eq!(parsed[1].name, "scratch");
        assert!(!parsed[1].attached);
    }

    #[test]
    fn parses_list_sessions_output_skips_malformed_lines() {
        let raw = "main\t1700000000\t1700000100\t1\nmalformed-line\n";
        let parsed = parse_list_sessions(raw);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "main");
    }

    #[test]
    fn parses_list_panes_output() {
        let raw = "main\t%0\t42\tzsh\nmain\t%1\t43\tclaude\nscratch\t%2\t44\tvim\n";
        let parsed = parse_list_panes(raw);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].session_name, "main");
        assert_eq!(parsed[0].pane_id, "%0");
        assert_eq!(parsed[0].pid, 42);
        assert_eq!(parsed[0].command, "zsh");
        assert_eq!(parsed[2].session_name, "scratch");
        assert_eq!(parsed[2].command, "vim");
    }

    #[test]
    fn parses_list_panes_skips_bad_pids() {
        let raw = "main\t%0\tNaN\tzsh\nmain\t%1\t43\tclaude\n";
        let parsed = parse_list_panes(raw);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].pid, 43);
    }

    #[test]
    fn parses_ps_output_into_metrics_map() {
        let raw = "  42 12345 1.5\n  43 200 0.0\n";
        let metrics = parse_ps_output(raw);
        assert_eq!(metrics.get(&42).unwrap().rss_kb, 12345);
        assert!((metrics.get(&42).unwrap().cpu_percent - 1.5).abs() < 0.001);
        assert_eq!(metrics.get(&43).unwrap().rss_kb, 200);
    }

    #[test]
    fn parse_ps_tolerates_extra_columns() {
        let raw = "100 1024 0.25 extra garbage here\n";
        let metrics = parse_ps_output(raw);
        assert_eq!(metrics.get(&100).unwrap().rss_kb, 1024);
    }

    #[test]
    fn join_metrics_attaches_rss_and_cpu() {
        let mut panes = vec![
            PaneInfo {
                session_name: "main".into(),
                pane_id: "%0".into(),
                pid: 42,
                command: "zsh".into(),
                rss_kb: None,
                cpu_percent: None,
            },
            PaneInfo {
                session_name: "main".into(),
                pane_id: "%1".into(),
                pid: 99,
                command: "claude".into(),
                rss_kb: None,
                cpu_percent: None,
            },
        ];
        let mut metrics = HashMap::new();
        metrics.insert(
            42,
            PaneMetrics {
                rss_kb: 12345,
                cpu_percent: 1.5,
            },
        );
        join_metrics(&mut panes, &metrics);
        assert_eq!(panes[0].rss_kb, Some(12345));
        assert_eq!(panes[0].cpu_percent, Some(1.5));
        assert_eq!(panes[1].rss_kb, None);
        assert_eq!(panes[1].cpu_percent, None);
    }

    struct FakeEnv(HashMap<String, String>);

    impl FakeEnv {
        fn with(pairs: &[(&str, &str)]) -> Self {
            Self(
                pairs
                    .iter()
                    .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                    .collect(),
            )
        }
    }

    impl EnvLookup for FakeEnv {
        fn get(&self, key: &str) -> Option<String> {
            self.0.get(key).cloned()
        }
    }

    #[test]
    fn socket_dir_prefers_tmux_tmpdir_env() {
        let env = FakeEnv::with(&[("TMUX_TMPDIR", "/fake/tmux-tmp")]);
        assert_eq!(
            resolve_socket_dir(&env, 501),
            PathBuf::from("/fake/tmux-tmp/tmux-501")
        );
    }

    #[test]
    fn socket_dir_ignores_tmpdir_because_tmux_does() {
        // Regression for the empty "No Lucode tmux servers running" state:
        // tmux only honors TMUX_TMPDIR, never TMPDIR. On macOS, TMPDIR is
        // always set to a per-user /var/folders/... dir that tmux never
        // writes into, so falling back through TMPDIR would point scans at
        // a path that doesn't exist even though live sockets sit in /tmp.
        let env = FakeEnv::with(&[("TMPDIR", "/var/folders/nw/xyz/T/")]);
        assert_eq!(
            resolve_socket_dir(&env, 42),
            PathBuf::from("/tmp/tmux-42")
        );
    }

    #[test]
    fn socket_dir_falls_back_to_slash_tmp() {
        let env = FakeEnv::with(&[]);
        assert_eq!(
            resolve_socket_dir(&env, 99),
            PathBuf::from("/tmp/tmux-99")
        );
    }

    #[test]
    fn scan_sockets_returns_only_lucode_v2_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("lucode-v2-aaaaaaaaaaaaaaaa"), "").unwrap();
        std::fs::write(dir.path().join("lucode-v2-bbbbbbbbbbbbbbbb"), "").unwrap();
        std::fs::write(dir.path().join("default"), "").unwrap();
        std::fs::write(dir.path().join("lucode-v1-old"), "").unwrap();

        let mut found = scan_lucode_sockets(dir.path()).unwrap();
        found.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].file_name, "lucode-v2-aaaaaaaaaaaaaaaa");
        assert_eq!(found[0].project_hash, "aaaaaaaaaaaaaaaa");
        assert_eq!(found[1].file_name, "lucode-v2-bbbbbbbbbbbbbbbb");
    }

    #[test]
    fn scan_sockets_empty_when_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("not-here");
        let found = scan_lucode_sockets(&missing).unwrap();
        assert!(found.is_empty());
    }

    #[tokio::test]
    async fn inspect_flags_stale_socket_when_server_is_gone() {
        let cli = MockTmuxCli::new(|args| {
            if args.first().map(String::as_str) == Some("list-sessions") {
                failure(1, "no server running on /tmp/tmux-501/lucode-v2-abcdef")
            } else {
                failure(1, "unexpected call")
            }
        });
        let result = load_sessions_for_server(cli.as_ref()).await.unwrap();
        assert!(result.is_none(), "stale socket should return None");
    }

    #[tokio::test]
    async fn inspect_reads_sessions_and_panes_for_live_server() {
        let cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-sessions") => TmuxCliOutput {
                status: 0,
                stdout: "main\t1700000000\t1700000100\t1\n".into(),
                stderr: String::new(),
            },
            Some("list-panes") => TmuxCliOutput {
                status: 0,
                stdout: "main\t%0\t42\tzsh\nmain\t%1\t43\tclaude\n".into(),
                stderr: String::new(),
            },
            _ => TmuxCliOutput {
                status: 1,
                stdout: String::new(),
                stderr: "unexpected".into(),
            },
        });
        let sessions = load_sessions_for_server(cli.as_ref()).await.unwrap().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].name, "main");
        assert_eq!(sessions[0].panes.len(), 2);
        assert_eq!(sessions[0].panes[0].pid, 42);
    }

    struct NoopPs;
    #[async_trait]
    impl PsRunner for NoopPs {
        async fn run(&self, _pids: &[i32]) -> Result<String, String> {
            panic!("ps must not be invoked when pid list is empty");
        }
    }

    struct FakePs;
    #[async_trait]
    impl PsRunner for FakePs {
        async fn run(&self, pids: &[i32]) -> Result<String, String> {
            assert_eq!(pids, &[42, 43]);
            Ok("42 12345 1.5\n43 200 0.0\n".to_string())
        }
    }

    #[tokio::test]
    async fn gather_metrics_returns_empty_map_for_empty_pid_list() {
        let metrics = gather_metrics(&NoopPs, &[]).await.unwrap();
        assert!(metrics.is_empty());
    }

    #[tokio::test]
    async fn gather_metrics_joins_ps_output() {
        let metrics = gather_metrics(&FakePs, &[42, 43]).await.unwrap();
        assert_eq!(metrics.get(&42).unwrap().rss_kb, 12345);
        assert_eq!(metrics.get(&43).unwrap().rss_kb, 200);
    }

    #[test]
    fn resolves_socket_hashes_to_projects_when_known() {
        let tmp = tempfile::tempdir().unwrap();
        let path_str = tmp.path().to_string_lossy().into_owned();
        let canonical = std::fs::canonicalize(tmp.path()).unwrap();
        let expected_hash =
            crate::shared::project_hash::project_hash16_for_canonical(&canonical);
        let history = ProjectLookup::from_pairs(&[(&path_str, "my-project")]);
        let resolved = history.resolve(&expected_hash);
        let r = resolved.unwrap();
        assert_eq!(r.name, "my-project");
        assert_eq!(r.path, path_str);
    }

    #[test]
    fn resolve_returns_none_for_unknown_hash() {
        let history = ProjectLookup::from_pairs(&[]);
        assert!(history.resolve("deadbeefdeadbeef").is_none());
    }

    struct AssembleFakePs;
    #[async_trait]
    impl PsRunner for AssembleFakePs {
        async fn run(&self, _pids: &[i32]) -> Result<String, String> {
            Ok("42 9999 0.5\n".to_string())
        }
    }

    #[tokio::test]
    async fn list_servers_assembles_live_and_stale_entries() {
        let live_cli = MockTmuxCli::new(|args| match args.first().map(String::as_str) {
            Some("list-sessions") => TmuxCliOutput {
                status: 0,
                stdout: "main\t1700000000\t1700000100\t1\n".into(),
                stderr: String::new(),
            },
            Some("list-panes") => TmuxCliOutput {
                status: 0,
                stdout: "main\t%0\t42\tzsh\n".into(),
                stderr: String::new(),
            },
            _ => TmuxCliOutput {
                status: 1,
                stdout: String::new(),
                stderr: "unexpected".into(),
            },
        });
        let stale_cli = MockTmuxCli::new(|_| TmuxCliOutput {
            status: 1,
            stdout: String::new(),
            stderr: "no server running".into(),
        });

        let sockets = vec![
            SocketEntry {
                file_name: "lucode-v2-live0000000000000".into(),
                project_hash: "live0000000000000".into(),
                path: "/tmp/x/lucode-v2-live0000000000000".into(),
            },
            SocketEntry {
                file_name: "lucode-v2-stale000000000000".into(),
                project_hash: "stale000000000000".into(),
                path: "/tmp/x/lucode-v2-stale000000000000".into(),
            },
        ];

        let mut clis: HashMap<String, Arc<dyn TmuxCli>> = HashMap::new();
        clis.insert("live0000000000000".into(), live_cli);
        clis.insert("stale000000000000".into(), stale_cli);

        let servers =
            assemble_servers(sockets, clis, &AssembleFakePs, &ProjectLookup::default()).await;

        assert_eq!(servers.len(), 2);
        let live = servers
            .iter()
            .find(|s| s.project_hash == "live0000000000000")
            .unwrap();
        assert!(!live.is_stale);
        assert_eq!(live.sessions.len(), 1);
        assert_eq!(live.sessions[0].panes.len(), 1);
        assert_eq!(live.sessions[0].panes[0].rss_kb, Some(9999));

        let stale = servers
            .iter()
            .find(|s| s.project_hash == "stale000000000000")
            .unwrap();
        assert!(stale.is_stale);
        assert!(stale.sessions.is_empty());
    }
}
