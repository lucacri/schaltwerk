use super::{
    ApplicationSpec, CreateParams, TerminalBackend, TerminalSnapshot, get_effective_shell,
    submission::build_submission_payload,
};
use crate::infrastructure::events::{SchaltEvent, emit_event};
use log::{debug, error, info, warn};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Arc,
    time::Duration,
};
use tauri::AppHandle;
use tokio::sync::RwLock;

/// Prefix for per-project tmux sockets created by this backend. The `v2`
/// generation marker is intentional: it prevents any tmux server left behind
/// by a pre-tmux Lucode build (or a hypothetical future incompatible
/// implementation) from being reattached by this one.
const TMUX_SOCKET_PREFIX: &str = "lucode-v2-";

fn project_tmux_socket_name(project_hash16: &str) -> String {
    format!("{TMUX_SOCKET_PREFIX}{project_hash16}")
}

/// Parameters for creating a terminal with an application and specific size
pub struct CreateTerminalWithAppAndSizeParams {
    pub id: String,
    pub cwd: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SessionKey {
    project_id: String,
    session_id: Option<String>,
}

impl SessionKey {
    fn new(project_id: String, session_id: Option<String>) -> Self {
        Self {
            project_id,
            session_id,
        }
    }
}

#[derive(Clone, Debug)]
struct TerminalMetadata {
    session: SessionKey,
}

pub struct TerminalManager {
    backend: Arc<dyn TerminalBackend>,
    active_ids: Arc<RwLock<HashSet<String>>>,
    metadata: Arc<RwLock<HashMap<String, TerminalMetadata>>>,
    session_index: Arc<RwLock<HashMap<SessionKey, HashSet<String>>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new_local()
    }
}

impl TerminalManager {
    fn build_session_key(project_id: &str, session_id: Option<&str>) -> SessionKey {
        SessionKey::new(project_id.to_string(), session_id.map(|s| s.to_string()))
    }

    fn resolve_cwd(cwd: &str) -> Result<String, String> {
        let trimmed = cwd.trim();
        if trimmed.is_empty() {
            let current_dir = std::env::current_dir().map_err(|err| {
                format!("Failed to determine current directory for terminal: {err}")
            })?;
            return Ok(current_dir.to_string_lossy().to_string());
        }

        let path = Path::new(trimmed);
        if !path.exists() {
            return Err(format!(
                "Terminal working directory does not exist: {trimmed}"
            ));
        }

        Ok(trimmed.to_string())
    }

    pub fn new(backend: Arc<dyn TerminalBackend>) -> Self {
        Self {
            backend,
            active_ids: Arc::new(RwLock::new(HashSet::new())),
            metadata: Arc::new(RwLock::new(HashMap::new())),
            session_index: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn new_local() -> Self {
        Self::new(Arc::new(super::LocalPtyAdapter::new()))
    }

    /// Build a terminal manager backed by a per-project tmux server. Fails fast
    /// if tmux is missing, outdated, or cannot provision its config on disk.
    ///
    /// This is the production factory; `new_local` is retained for tests that
    /// need direct PTY spawning without a tmux round-trip.
    pub fn new_for_project(project_path: &Path) -> Result<Self, String> {
        use crate::domains::terminal::TmuxAdapter;
        use crate::domains::terminal::tmux_bootstrap::ensure_tmux_conf_on_disk;
        use crate::domains::terminal::tmux_cmd::make_system_cli;
        use crate::shared::project_hash::project_hash16;

        let hash = project_hash16(project_path).map_err(|e| e.to_string())?;
        let conf = ensure_tmux_conf_on_disk()?;
        let cli = make_system_cli(project_tmux_socket_name(&hash), conf.path.clone());
        Ok(Self::new(Arc::new(TmuxAdapter::new(cli))))
    }

    /// Ask the backend to prune any persistent sessions whose name isn't
    /// prefixed by one of `live_bases` (typically the wire-ID bases of the
    /// currently active Lucode sessions). Returns the names killed.
    pub async fn gc_orphaned_backend_sessions(
        &self,
        live_bases: &HashSet<String>,
    ) -> Result<Vec<String>, String> {
        self.backend.gc_orphans(live_bases).await
    }

    async fn register_terminal_session(&self, id: &str, session: SessionKey) {
        let mut metadata = self.metadata.write().await;
        metadata.insert(
            id.to_string(),
            TerminalMetadata {
                session: session.clone(),
            },
        );

        let mut index = self.session_index.write().await;
        let entry = index.entry(session).or_insert_with(HashSet::new);
        entry.insert(id.to_string());
    }

    async fn unregister_terminal_session(&self, id: &str) {
        let mut metadata = self.metadata.write().await;
        if let Some(meta) = metadata.remove(id) {
            let mut index = self.session_index.write().await;
            if let Some(ids) = index.get_mut(&meta.session) {
                ids.remove(id);
                if ids.is_empty() {
                    index.remove(&meta.session);
                }
            }
        }
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.write().await = Some(handle.clone());
        self.backend.set_app_handle(handle).await;
    }

    pub async fn attach_terminals_to_session(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        terminal_ids: &[String],
    ) {
        let key = Self::build_session_key(project_id, session_id);
        for id in terminal_ids {
            self.register_terminal_session(id, key.clone()).await;
        }
    }

    pub async fn register_terminal(
        &self,
        project_id: &str,
        session_id: Option<&str>,
        terminal_id: &str,
    ) {
        let key = Self::build_session_key(project_id, session_id);
        self.register_terminal_session(terminal_id, key).await;
    }

    async fn session_terminals(&self, session: &SessionKey) -> Vec<String> {
        let index = self.session_index.read().await;
        index
            .get(session)
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub async fn suspend_session_terminals(
        &self,
        project_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        let key = Self::build_session_key(project_id, session_id);
        let ids = self.session_terminals(&key).await;
        for id in ids {
            self.backend.suspend(&id).await?;
        }
        Ok(())
    }

    pub async fn resume_session_terminals(
        &self,
        project_id: &str,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        let key = Self::build_session_key(project_id, session_id);
        let ids = self.session_terminals(&key).await;
        for id in ids {
            self.backend.resume(&id).await?;
        }
        Ok(())
    }

    pub async fn configure_attention_profile(
        &self,
        terminal_id: &str,
        agent_type: &str,
    ) -> Result<(), String> {
        self.backend
            .configure_attention_profile(terminal_id, agent_type)
            .await
    }

    pub async fn create_terminal(&self, id: String, cwd: String) -> Result<(), String> {
        let start = std::time::Instant::now();
        let result = self.create_terminal_with_env(id.clone(), cwd, vec![]).await;
        let elapsed = start.elapsed();

        if elapsed.as_millis() > 500 {
            log::warn!("Terminal {} slow create: {}ms", id, elapsed.as_millis());
        } else {
            log::debug!("Terminal {} created in: {}ms", id, elapsed.as_millis());
        }

        result
    }

    pub async fn create_terminal_with_env(
        &self,
        id: String,
        cwd: String,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        let resolved_cwd = Self::resolve_cwd(&cwd)?;
        info!(
            "Creating terminal through manager: id={id}, cwd={resolved_cwd}, env_count={}",
            env.len()
        );

        let cwd_for_event = resolved_cwd.clone();
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd: resolved_cwd.clone(),
                app: None,
                disable_hydration_buffer: false,
            }
        } else {
            // Create a shell with environment variables set (respect user-configured shell)
            let (shell, args) = get_effective_shell();
            // Ensure `$SHELL` inside spawned process matches the configured shell
            let mut env = env;
            env.push(("SHELL".to_string(), shell.clone()));
            CreateParams {
                id: id.clone(),
                cwd: resolved_cwd.clone(),
                app: Some(ApplicationSpec {
                    command: shell,
                    args,
                    env,
                    ready_timeout_ms: 5000,
                }),
                disable_hydration_buffer: false,
            }
        };

        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_size(
        &self,
        id: String,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let start = std::time::Instant::now();
        let result = self
            .create_terminal_with_size_and_env(id.clone(), cwd, cols, rows, vec![])
            .await;
        let elapsed = start.elapsed();

        if elapsed.as_millis() > 500 {
            log::warn!(
                "Terminal {} slow create with size {}x{}: {}ms",
                id,
                cols,
                rows,
                elapsed.as_millis()
            );
        } else {
            log::debug!(
                "Terminal {} created with size {}x{} in: {}ms",
                id,
                cols,
                rows,
                elapsed.as_millis()
            );
        }

        result
    }

    pub async fn create_terminal_with_size_and_env(
        &self,
        id: String,
        cwd: String,
        cols: u16,
        rows: u16,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        let resolved_cwd = Self::resolve_cwd(&cwd)?;
        info!(
            "Creating terminal through manager with size: id={id}, cwd={resolved_cwd}, size={cols}x{rows}, env_count={}",
            env.len()
        );

        let cwd_for_event = resolved_cwd.clone();
        let params = if env.is_empty() {
            CreateParams {
                id: id.clone(),
                cwd: resolved_cwd.clone(),
                app: None,
                disable_hydration_buffer: false,
            }
        } else {
            // Create a shell with environment variables set (respect user-configured shell)
            let (shell, args) = get_effective_shell();
            // Ensure `$SHELL` inside spawned process matches the configured shell
            let mut env = env;
            env.push(("SHELL".to_string(), shell.clone()));
            CreateParams {
                id: id.clone(),
                cwd: resolved_cwd.clone(),
                app: Some(ApplicationSpec {
                    command: shell,
                    args,
                    env,
                    ready_timeout_ms: 5000,
                }),
                disable_hydration_buffer: false,
            }
        };

        self.backend.create_with_size(params, cols, rows).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_app(
        &self,
        id: String,
        cwd: String,
        command: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
    ) -> Result<(), String> {
        let resolved_cwd = Self::resolve_cwd(&cwd)?;
        info!(
            "Creating terminal with app through manager: id={id}, cwd={resolved_cwd}, command={command}"
        );

        let app_spec = ApplicationSpec {
            command,
            args,
            env,
            ready_timeout_ms: 5000,
        };

        let cwd_for_event = resolved_cwd.clone();
        let params = CreateParams {
            id: id.clone(),
            cwd: resolved_cwd.clone(),
            app: Some(app_spec),
            disable_hydration_buffer: false,
        };

        self.backend.create(params).await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn create_terminal_with_app_and_size(
        &self,
        params: CreateTerminalWithAppAndSizeParams,
    ) -> Result<(), String> {
        let CreateTerminalWithAppAndSizeParams {
            id,
            cwd,
            command,
            args,
            env,
            cols,
            rows,
        } = params;
        let resolved_cwd = Self::resolve_cwd(&cwd)?;
        info!(
            "Creating terminal with app and size through manager: id={id}, cwd={resolved_cwd}, command={command}, size={cols}x{rows}"
        );

        let app_spec = ApplicationSpec {
            command,
            args,
            env,
            ready_timeout_ms: 30000,
        };

        let cwd_for_event = resolved_cwd.clone();
        let create_params = CreateParams {
            id: id.clone(),
            cwd: resolved_cwd.clone(),
            app: Some(app_spec),
            disable_hydration_buffer: false,
        };

        self.backend
            .create_with_size(create_params, cols, rows)
            .await?;
        self.active_ids.write().await.insert(id.clone());

        // Start event bridge for this terminal
        self.start_event_bridge(id.clone()).await;
        // Emit TerminalCreated event if app handle is available
        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let payload = serde_json::json!({ "terminal_id": id, "cwd": cwd_for_event });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalCreated, &payload) {
                warn!("Failed to emit terminal created event: {e}");
            }
        }
        Ok(())
    }

    pub async fn inject_terminal_error(
        &self,
        id: String,
        cwd: String,
        message: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        self.backend
            .inject_terminal_error(&id, &cwd, &message, cols, rows)
            .await?;
        self.active_ids.write().await.insert(id);
        Ok(())
    }

    pub async fn write_terminal(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write(&id, &data).await
    }

    pub async fn write_terminal_immediate(&self, id: String, data: Vec<u8>) -> Result<(), String> {
        self.backend.write_immediate(&id, &data).await
    }

    pub async fn paste_and_submit_terminal(
        &self,
        id: String,
        data: Vec<u8>,
        use_bracketed_paste: bool,
        needs_delayed_submit: bool,
    ) -> Result<(), String> {
        let payload = build_submission_payload(&data, use_bracketed_paste, needs_delayed_submit);

        self.backend.write_immediate(&id, &payload).await?;

        if needs_delayed_submit {
            let backend = Arc::clone(&self.backend);
            let submit_id = id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(10)).await;
                if let Err(e) = backend.write_immediate(&submit_id, b"\r").await {
                    warn!("Failed to send delayed submit for terminal {submit_id}: {e}");
                }
            });
        }

        if let Some(app_handle) = self.app_handle.read().await.as_ref() {
            let event_payload = serde_json::json!({ "terminal_id": id });
            if let Err(e) = emit_event(app_handle, SchaltEvent::TerminalForceScroll, &event_payload)
            {
                warn!("Failed to emit terminal force scroll event for {id}: {e}");
            }
        }

        Ok(())
    }

    pub async fn resize_terminal(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        debug!("Resizing terminal {id}: {cols}x{rows}");
        self.backend.resize(&id, cols, rows).await
    }

    pub async fn refresh_terminal_view(&self, id: String) -> Result<(), String> {
        self.backend.refresh_view(&id).await
    }

    pub async fn close_terminal(&self, id: String) -> Result<(), String> {
        info!("Closing terminal through manager: {id}");
        self.active_ids.write().await.remove(&id);
        self.unregister_terminal_session(&id).await;
        self.backend.close(&id).await
    }

    pub async fn terminal_exists(&self, id: &str) -> Result<bool, String> {
        self.backend.exists(id).await
    }

    pub async fn agent_pane_alive(&self, id: &str) -> Result<bool, String> {
        self.backend.agent_pane_alive(id).await
    }

    pub async fn queue_initial_command(
        &self,
        id: String,
        command: String,
        ready_marker: Option<String>,
        dispatch_delay: Option<Duration>,
        use_bracketed_paste: bool,
        needs_delayed_submit: bool,
    ) -> Result<(), String> {
        let preview = command
            .chars()
            .filter(|c| *c != '\r' && *c != '\n')
            .take(80)
            .collect::<String>();
        info!(
            "TerminalManager queue_initial_command: id={id}, len={}, ready_marker={:?}, delay_ms={}, preview=\"{preview}\"",
            command.len(),
            ready_marker.as_deref(),
            dispatch_delay.map(|d| d.as_millis()).unwrap_or(0)
        );
        self.backend
            .queue_initial_command(
                &id,
                command,
                ready_marker,
                dispatch_delay,
                use_bracketed_paste,
                needs_delayed_submit,
            )
            .await
    }

    pub async fn get_terminal_buffer(
        &self,
        id: String,
        from_seq: Option<u64>,
    ) -> Result<TerminalSnapshot, String> {
        let start_time = std::time::Instant::now();
        let snapshot = self.backend.snapshot(&id, from_seq).await?;
        let snapshot_duration = start_time.elapsed();

        let data_len = snapshot.data.len();
        let size_mb = data_len as f64 / (1024.0 * 1024.0);
        info!(
            "get_terminal_buffer {}: {:.2}MB, snapshot: {:.1}ms, total: {:.1}ms",
            id,
            size_mb,
            snapshot_duration.as_secs_f64() * 1000.0,
            start_time.elapsed().as_secs_f64() * 1000.0
        );

        Ok(snapshot)
    }

    pub async fn wait_for_output_change(&self, id: &str, min_seq: u64) -> Result<u64, String> {
        self.backend.wait_for_output_change(id, min_seq).await
    }

    pub async fn close_all(&self) -> Result<(), String> {
        info!("Closing all terminals");
        let ids: Vec<String> = self.active_ids.read().await.iter().cloned().collect();

        for id in ids {
            if let Err(e) = self.close_terminal(id.clone()).await {
                error!("Failed to close terminal {id}: {e}");
            }
        }

        Ok(())
    }

    pub async fn cleanup_all(&self) -> Result<(), String> {
        info!("Starting comprehensive terminal cleanup");

        // First try to close all known terminals
        let close_result = self.close_all().await;

        // Force cleanup any orphaned processes that might have been missed
        self.cleanup_orphaned_processes().await;

        close_result
    }

    pub async fn force_kill_all(&self) -> Result<(), String> {
        info!("Force killing all terminals via manager");

        self.active_ids.write().await.clear();
        self.metadata.write().await.clear();
        self.session_index.write().await.clear();

        self.backend.force_kill_all().await
    }

    async fn cleanup_orphaned_processes(&self) {
        info!("Checking for orphaned terminal processes");

        // Get all terminal IDs that we know about
        let known_ids: std::collections::HashSet<String> = self.active_ids.read().await.clone();

        // Check backend for any additional orphaned terminals
        let backend_terminals = self.backend.get_all_terminal_activity().await;

        for (id, _elapsed) in backend_terminals {
            if !known_ids.contains(&id) {
                warn!("Found orphaned terminal: {id}, cleaning up");
                if let Err(e) = self.backend.close(&id).await {
                    error!("Failed to cleanup orphaned terminal {id}: {e}");
                }
            }
        }

        info!("Orphaned process cleanup completed");
    }

    async fn start_event_bridge(&self, id: String) {
        // Backends that need explicit event bridging can extend this path later.
        debug!("Event bridge started for terminal {id}");
    }

    pub async fn get_terminal_activity_status(&self, id: String) -> Result<(bool, u64), String> {
        self.backend.get_activity_status(&id).await
    }

    pub async fn get_all_terminal_activity(&self) -> Vec<(String, u64)> {
        self.backend.get_all_terminal_activity().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use tokio::sync::Mutex;

    fn local_manager() -> TerminalManager {
        TerminalManager::new_local()
    }

    #[test]
    fn project_tmux_socket_name_uses_v2_generation_prefix() {
        let got = project_tmux_socket_name("abcdef0123456789");
        assert_eq!(
            got, "lucode-v2-abcdef0123456789",
            "socket name must carry the v2 generation marker so pre-tmux-backend \
             Lucode servers can't be silently reattached by this implementation"
        );
        assert!(got.starts_with(TMUX_SOCKET_PREFIX));
    }

    struct FakeBackend {
        existing: Mutex<HashSet<String>>,
        injected_errors: Mutex<Vec<(String, String, String, u16, u16)>>,
        attention_profiles: Mutex<Vec<(String, String)>>,
    }

    impl FakeBackend {
        fn new() -> Self {
            Self {
                existing: Mutex::new(HashSet::new()),
                injected_errors: Mutex::new(Vec::new()),
                attention_profiles: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait::async_trait]
    impl TerminalBackend for FakeBackend {
        async fn create(&self, params: CreateParams) -> Result<(), String> {
            self.existing.lock().await.insert(params.id);
            Ok(())
        }

        async fn create_with_size(
            &self,
            params: CreateParams,
            _cols: u16,
            _rows: u16,
        ) -> Result<(), String> {
            self.create(params).await
        }

        async fn write(&self, _id: &str, _data: &[u8]) -> Result<(), String> {
            Ok(())
        }

        async fn write_immediate(&self, _id: &str, _data: &[u8]) -> Result<(), String> {
            Ok(())
        }

        async fn resize(&self, _id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
            Ok(())
        }

        async fn close(&self, id: &str) -> Result<(), String> {
            self.existing.lock().await.remove(id);
            Ok(())
        }

        async fn exists(&self, id: &str) -> Result<bool, String> {
            Ok(self.existing.lock().await.contains(id))
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

        async fn wait_for_output_change(&self, _id: &str, min_seq: u64) -> Result<u64, String> {
            Ok(min_seq + 1)
        }

        async fn get_all_terminal_activity(&self) -> Vec<(String, u64)> {
            self.existing
                .lock()
                .await
                .iter()
                .cloned()
                .map(|id| (id, 0))
                .collect()
        }

        async fn get_activity_status(&self, id: &str) -> Result<(bool, u64), String> {
            if self.existing.lock().await.contains(id) {
                Ok((false, 7))
            } else {
                Err(format!("Terminal {id} not found"))
            }
        }

        async fn inject_terminal_error(
            &self,
            id: &str,
            cwd: &str,
            message: &str,
            cols: u16,
            rows: u16,
        ) -> Result<(), String> {
            self.existing.lock().await.insert(id.to_string());
            self.injected_errors.lock().await.push((
                id.to_string(),
                cwd.to_string(),
                message.to_string(),
                cols,
                rows,
            ));
            Ok(())
        }

        async fn configure_attention_profile(
            &self,
            id: &str,
            agent_type: &str,
        ) -> Result<(), String> {
            self.attention_profiles
                .lock()
                .await
                .push((id.to_string(), agent_type.to_string()));
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_close_all_kills_all_terminals() {
        let manager = local_manager();

        manager
            .create_terminal("test-mgr-1".to_string(), "/tmp".to_string())
            .await
            .unwrap();
        manager
            .create_terminal("test-mgr-2".to_string(), "/tmp".to_string())
            .await
            .unwrap();

        assert!(manager.terminal_exists("test-mgr-1").await.unwrap());
        assert!(manager.terminal_exists("test-mgr-2").await.unwrap());

        manager.close_all().await.unwrap();

        assert!(!manager.terminal_exists("test-mgr-1").await.unwrap());
        assert!(!manager.terminal_exists("test-mgr-2").await.unwrap());
    }

    #[tokio::test]
    async fn test_get_terminal_buffer_returns_output() {
        let manager = local_manager();
        manager
            .create_terminal("buf-term".to_string(), "/tmp".to_string())
            .await
            .unwrap();
        // Nudge some output
        manager
            .write_terminal("buf-term".into(), b"echo hi\n".to_vec())
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let snapshot = manager
            .get_terminal_buffer("buf-term".into(), None)
            .await
            .unwrap();
        assert!(!snapshot.data.is_empty());

        manager.close_terminal("buf-term".into()).await.unwrap();
    }

    #[test]
    fn resolve_cwd_defaults_to_current_dir() {
        let expected = std::env::current_dir()
            .expect("current dir")
            .to_string_lossy()
            .to_string();
        let resolved = TerminalManager::resolve_cwd("").expect("should fallback to current dir");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn resolve_cwd_errors_for_missing_path() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let missing_path = std::env::temp_dir().join(format!("lucode-missing-{unique_suffix}"));
        assert!(
            !missing_path.exists(),
            "test path unexpectedly exists: {}",
            missing_path.display()
        );

        let result = TerminalManager::resolve_cwd(&missing_path.to_string_lossy());
        assert!(
            result.is_err(),
            "expected resolve_cwd to error for missing path"
        );
    }

    #[tokio::test]
    async fn terminal_manager_uses_backend_trait() {
        let backend: Arc<dyn TerminalBackend> = Arc::new(FakeBackend::new());
        let manager = TerminalManager::new(backend);

        manager
            .create_terminal("trait-backed".to_string(), "/tmp".to_string())
            .await
            .expect("create should succeed through trait backend");

        assert!(
            manager
                .terminal_exists("trait-backed")
                .await
                .expect("exists should succeed"),
            "manager should delegate terminal existence to the trait backend"
        );

        let seq = manager
            .wait_for_output_change("trait-backed", 41)
            .await
            .expect("wait should delegate to the trait backend");
        assert_eq!(seq, 42);
    }

    #[tokio::test]
    async fn cleanup_orphaned_processes_uses_backend_activity() {
        let backend = Arc::new(FakeBackend::new());
        backend
            .existing
            .lock()
            .await
            .extend(["known-terminal".to_string(), "orphan-terminal".to_string()]);

        let manager = TerminalManager::new(backend.clone());
        manager
            .active_ids
            .write()
            .await
            .insert("known-terminal".to_string());

        manager.cleanup_orphaned_processes().await;

        let remaining = backend.existing.lock().await.clone();
        assert!(
            remaining.contains("known-terminal"),
            "cleanup should preserve known terminals"
        );
        assert!(
            !remaining.contains("orphan-terminal"),
            "cleanup should close backend-reported orphaned terminals"
        );
    }

    #[tokio::test]
    async fn manager_delegates_activity_error_and_attention_calls() {
        let backend = Arc::new(FakeBackend::new());
        backend
            .existing
            .lock()
            .await
            .insert("trait-backed".to_string());
        let manager = TerminalManager::new(backend.clone());

        let activity = manager
            .get_terminal_activity_status("trait-backed".to_string())
            .await
            .expect("activity status should delegate to the trait backend");
        assert_eq!(activity, (false, 7));

        manager
            .inject_terminal_error(
                "error-backed".to_string(),
                "/tmp".to_string(),
                "boom".to_string(),
                120,
                40,
            )
            .await
            .expect("error injection should delegate to the trait backend");

        manager
            .configure_attention_profile("error-backed", "claude")
            .await
            .expect("attention profile should delegate to the trait backend");

        let injected_errors = backend.injected_errors.lock().await.clone();
        assert_eq!(
            injected_errors,
            vec![(
                "error-backed".to_string(),
                "/tmp".to_string(),
                "boom".to_string(),
                120,
                40,
            )]
        );

        let attention_profiles = backend.attention_profiles.lock().await.clone();
        assert_eq!(
            attention_profiles,
            vec![("error-backed".to_string(), "claude".to_string())]
        );
        assert!(
            manager
                .terminal_exists("error-backed")
                .await
                .expect("exists should delegate after injected error"),
            "injected error terminal should be tracked by the backend"
        );
    }
}
