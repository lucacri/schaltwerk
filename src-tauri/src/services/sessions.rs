use crate::domains::attention::get_session_attention_state;
use crate::domains::sessions::entity::EnrichedSession;
use crate::domains::sessions::{GitEnrichmentTask, apply_git_enrichment, compute_git_for_session};
use crate::infrastructure::database::SpecMethods;
use crate::project_manager::ProjectManager;
use crate::schaltwerk_core::SchaltwerkCore;
use async_trait::async_trait;
use futures::stream::{self, StreamExt};
use std::sync::Arc;

fn git_enrichment_parallelism(task_count: usize) -> usize {
    if task_count <= 1 {
        return task_count.max(1);
    }

    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4)
        .clamp(2, 4);
    task_count.min(available)
}

fn sort_git_enrichment_results(
    results: &mut [crate::domains::sessions::service::GitEnrichmentResult],
) {
    results.sort_unstable_by_key(|result| result.index);
}

async fn run_blocking_tasks_bounded<T, R, F>(tasks: Vec<T>, parallelism: usize, worker: F) -> Vec<R>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> R + Send + Sync + 'static,
{
    if tasks.is_empty() {
        return Vec::new();
    }

    let worker = Arc::new(worker);
    let mut results = Vec::with_capacity(tasks.len());
    let mut stream = stream::iter(tasks.into_iter().map(|task| {
        let worker = Arc::clone(&worker);
        async move { tokio::task::spawn_blocking(move || worker(task)).await }
    }))
    .buffer_unordered(parallelism.max(1));

    while let Some(result) = stream.next().await {
        match result {
            Ok(result) => results.push(result),
            Err(err) => log::error!("Blocking task panicked: {err}"),
        }
    }

    results
}

pub async fn compute_git_enrichment_parallel(
    tasks: Vec<GitEnrichmentTask>,
) -> Vec<crate::domains::sessions::service::GitEnrichmentResult> {
    if tasks.is_empty() {
        return Vec::new();
    }

    let parallelism = git_enrichment_parallelism(tasks.len());
    let mut results =
        run_blocking_tasks_bounded(tasks, parallelism, |task| compute_git_for_session(&task)).await;
    sort_git_enrichment_results(&mut results);
    results
}

pub async fn enrich_sessions_with_parallel_git(
    sessions: &mut [EnrichedSession],
    tasks: Vec<GitEnrichmentTask>,
) {
    if tasks.is_empty() {
        return;
    }
    let results = compute_git_enrichment_parallel(tasks).await;
    apply_git_enrichment(sessions, results);
}

#[async_trait]
pub trait SessionsBackend: Send + Sync {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String>;
}

#[async_trait]
pub trait SessionsService: Send + Sync {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String>;
}

pub struct SessionsServiceImpl<B: SessionsBackend> {
    backend: B,
}

impl<B: SessionsBackend> SessionsServiceImpl<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        let call_id = uuid::Uuid::new_v4();
        log::debug!("SessionsService list_enriched_sessions start call_id={call_id}");
        let start = std::time::Instant::now();

        let sessions = self
            .backend
            .list_enriched_sessions()
            .await
            .map_err(|err| format!("Failed to list sessions: {err}"))?;
        let mut sessions = sessions;

        if let Some(registry) = get_session_attention_state() {
            match registry.try_lock() {
                Ok(guard) => {
                    for session in &mut sessions {
                        if let Some(attention) = guard.get(&session.info.session_id) {
                            session.attention_required = Some(attention.needs_attention);
                            session.attention_kind = attention.kind.map(|kind| match kind {
                                crate::domains::attention::SessionAttentionKind::Idle => {
                                    "idle".to_string()
                                }
                                crate::domains::attention::SessionAttentionKind::WaitingForInput => {
                                    "waiting_for_input".to_string()
                                }
                            });
                        }
                    }
                }
                Err(_) => {
                    log::debug!(
                        "SessionsService list_enriched_sessions skipped attention hydration due to lock contention"
                    );
                }
            }
        }

        log::debug!(
            "SessionsService list_enriched_sessions done call_id={} count={} elapsed={}ms",
            call_id,
            sessions.len(),
            start.elapsed().as_millis()
        );
        Ok(sessions)
    }
}

#[async_trait]
impl<B> SessionsService for SessionsServiceImpl<B>
where
    B: SessionsBackend + Sync,
{
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        SessionsServiceImpl::list_enriched_sessions(self).await
    }
}

pub struct ProjectSessionsBackend {
    project_manager: Arc<ProjectManager>,
}

impl ProjectSessionsBackend {
    pub fn new(project_manager: Arc<ProjectManager>) -> Self {
        Self { project_manager }
    }

    async fn get_core(&self) -> Result<Arc<SchaltwerkCore>, String> {
        self.project_manager
            .current_schaltwerk_core()
            .await
            .map_err(|e| {
                log::error!("Failed to get Lucode core: {e}");
                format!("Failed to get Lucode core: {e}")
            })
    }
}

#[async_trait]
impl SessionsBackend for ProjectSessionsBackend {
    async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
        let call_id = uuid::Uuid::new_v4();
        let start = std::time::Instant::now();
        log::debug!("ProjectSessionsBackend list_enriched_sessions start call_id={call_id}");

        let (mut sessions, git_tasks, db) = {
            let core = self.get_core().await?;
            let manager = core.session_manager();
            let (sessions, git_tasks) = manager
                .list_enriched_sessions_base()
                .map_err(|err| err.to_string())?;
            (sessions, git_tasks, core.db.clone())
        };

        let git_results = compute_git_enrichment_parallel(git_tasks).await;
        apply_git_enrichment(&mut sessions, git_results);

        if let Some(registry) = get_session_attention_state() {
            match registry.try_lock() {
                Ok(guard) => {
                    let mut spec_attention_updates = Vec::new();

                    for session in &mut sessions {
                        let previous_attention = session.attention_required;
                        let Some(attention) = guard.get(&session.info.session_id) else {
                            continue;
                        };

                        session.attention_required = Some(attention.needs_attention);
                        session.attention_kind = attention.kind.map(|kind| match kind {
                            crate::domains::attention::SessionAttentionKind::Idle => {
                                "idle".to_string()
                            }
                            crate::domains::attention::SessionAttentionKind::WaitingForInput => {
                                "waiting_for_input".to_string()
                            }
                        });

                        if session.info.session_state == "spec"
                            && let Some(stable_id) = session.info.stable_id.as_deref()
                        {
                            let persisted_attention = match attention.kind {
                                Some(crate::domains::attention::SessionAttentionKind::WaitingForInput) => {
                                    Some(true)
                                }
                                Some(crate::domains::attention::SessionAttentionKind::Idle) => {
                                    Some(false)
                                }
                                None if !attention.needs_attention => Some(false),
                                None => Some(attention.needs_attention),
                            };

                            if let Some(persisted_attention) = persisted_attention
                                && previous_attention != Some(persisted_attention)
                            {
                                spec_attention_updates
                                    .push((stable_id.to_string(), persisted_attention));
                            }
                        }
                    }

                    drop(guard);

                    for (stable_id, attention_required) in spec_attention_updates {
                        if let Err(err) =
                            db.update_spec_attention_required(&stable_id, attention_required)
                        {
                            log::warn!(
                                "Failed to persist spec attention for stable_id={stable_id}: {err}"
                            );
                        }
                    }
                }
                Err(_) => {
                    log::debug!(
                        "ProjectSessionsBackend skipped attention hydration due to lock contention"
                    );
                }
            }
        }

        log::debug!(
            "ProjectSessionsBackend call_id={call_id} done count={} elapsed={}ms",
            sessions.len(),
            start.elapsed().as_millis()
        );

        Ok(sessions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::attention::{
        SessionAttentionState, get_session_attention_state, set_session_attention_state,
    };
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Condvar, Mutex as StdMutex};
    use tokio::sync::Mutex;

    struct SuccessBackend {
        sessions: Vec<EnrichedSession>,
    }

    #[async_trait]
    impl SessionsBackend for SuccessBackend {
        async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
            Ok(self.sessions.clone())
        }
    }

    struct ErrorBackend;

    #[async_trait]
    impl SessionsBackend for ErrorBackend {
        async fn list_enriched_sessions(&self) -> Result<Vec<EnrichedSession>, String> {
            Err("backend failure".to_string())
        }
    }

    fn sample_session(name: &str) -> EnrichedSession {
        use crate::domains::sessions::entity::{
            SessionInfo, SessionStatusType, SessionType,
        };

        EnrichedSession {
            info: SessionInfo {
                session_id: name.to_string(),
                stable_id: Some(format!("{name}-stable")),
                display_name: None,
                version_group_id: None,
                version_number: None,
                epic: None,
                branch: format!("{name}-branch"),
                worktree_path: "/tmp".to_string(),
                base_branch: "main".to_string(),
                original_base_branch: Some("main".to_string()),
                status: SessionStatusType::Active,
                created_at: Some(chrono::Utc::now()),
                last_modified: None,
                has_uncommitted_changes: Some(false),
                dirty_files_count: None,
                commits_ahead_count: None,
                has_conflicts: Some(false),
                is_current: false,
                session_type: SessionType::Worktree,
                container_status: None,
                original_agent_type: None,
                original_agent_model: None,
                current_task: None,
                diff_stats: None,
                ready_to_merge: false,
                ready_to_merge_checks: None,
                spec_content: None,
                spec_implementation_plan: None,
                spec_stage: None,
                improve_plan_round_id: None,
                clarification_started: None,
                session_state: "running".to_string(),
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
                pr_state: None,
                is_consolidation: false,
                consolidation_sources: None,
                consolidation_round_id: None,
                consolidation_role: None,
                consolidation_report: None,
                consolidation_report_source: None,
                consolidation_base_session_id: None,
                consolidation_recommended_session_id: None,
                consolidation_confirmation_mode: None,
                promotion_reason: None,
                attention_kind: None,
                stage: None,
            },
            status: None,
            terminals: vec![],
            attention_required: None,
            attention_kind: None,
        }
    }

    fn init_attention_registry() -> Arc<Mutex<SessionAttentionState>> {
        if let Some(registry) = get_session_attention_state() {
            registry
        } else {
            let registry = Arc::new(Mutex::new(SessionAttentionState::default()));
            set_session_attention_state(registry.clone());
            registry
        }
    }

    #[tokio::test]
    async fn delegates_to_backend() {
        let backend = SuccessBackend {
            sessions: vec![sample_session("one"), sample_session("two")],
        };
        let service = SessionsServiceImpl::new(backend);

        let result = service.list_enriched_sessions().await;
        assert!(
            result.is_ok(),
            "expected successful session listing, got {result:?}"
        );
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].info.session_id, "one");
        assert_eq!(sessions[1].info.session_id, "two");
    }

    #[tokio::test]
    async fn augments_error_with_context() {
        let backend = ErrorBackend;
        let service = SessionsServiceImpl::new(backend);

        let result = service.list_enriched_sessions().await;
        assert!(
            result.is_err(),
            "expected error when backend fails, got {result:?}"
        );
        let message = result.unwrap_err();
        assert!(
            message.contains("backend failure"),
            "error should include backend message: {message}"
        );
        assert!(
            message.contains("list sessions"),
            "error should include context about listing sessions: {message}"
        );
    }

    #[tokio::test]
    async fn hydrates_runtime_attention_from_registry() {
        let registry = init_attention_registry();
        registry.lock().await.update(
            "one",
            true,
            Some(crate::domains::attention::SessionAttentionKind::Idle),
        );
        registry.lock().await.update("two", false, None);

        let backend = SuccessBackend {
            sessions: vec![sample_session("one"), sample_session("two")],
        };
        let service = SessionsServiceImpl::new(backend);

        let result = service.list_enriched_sessions().await;
        assert!(
            result.is_ok(),
            "expected successful session listing, got {result:?}"
        );
        let sessions = result.unwrap();

        assert_eq!(sessions[0].attention_required, Some(true));
        assert_eq!(sessions[1].attention_required, Some(false));
        assert_eq!(sessions[0].attention_kind.as_deref(), Some("idle"));
        assert_eq!(sessions[1].attention_kind, None);
    }

    #[tokio::test]
    async fn hydrates_waiting_for_input_attention_kind_from_registry() {
        let registry = init_attention_registry();
        registry.lock().await.update(
            "one",
            true,
            Some(crate::domains::attention::SessionAttentionKind::WaitingForInput),
        );

        let backend = SuccessBackend {
            sessions: vec![sample_session("one")],
        };
        let service = SessionsServiceImpl::new(backend);

        let sessions = service
            .list_enriched_sessions()
            .await
            .expect("expected successful session listing");

        assert_eq!(sessions[0].attention_required, Some(true));
        assert_eq!(
            sessions[0].attention_kind.as_deref(),
            Some("waiting_for_input")
        );
    }

    #[test]
    fn git_enrichment_parallelism_caps_large_batches() {
        assert_eq!(git_enrichment_parallelism(1), 1);
        assert_eq!(git_enrichment_parallelism(2), 2);
        assert!(git_enrichment_parallelism(20) <= 4);
        assert!(git_enrichment_parallelism(20) >= 1);
    }

    #[test]
    fn sort_git_enrichment_results_restores_input_order() {
        use crate::domains::sessions::service::GitEnrichmentResult;

        let mut results = vec![
            GitEnrichmentResult {
                index: 2,
                git_stats: None,
                has_conflicts: None,
                commits_ahead_count: None,
                rebased_onto_parent: None,
            },
            GitEnrichmentResult {
                index: 0,
                git_stats: None,
                has_conflicts: None,
                commits_ahead_count: None,
                rebased_onto_parent: None,
            },
            GitEnrichmentResult {
                index: 1,
                git_stats: None,
                has_conflicts: None,
                commits_ahead_count: None,
                rebased_onto_parent: None,
            },
        ];

        sort_git_enrichment_results(&mut results);

        assert_eq!(
            results
                .iter()
                .map(|result| result.index)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[tokio::test]
    async fn bounded_blocking_tasks_never_exceed_parallelism() {
        let task_count = 8;
        let parallelism = git_enrichment_parallelism(task_count);
        let gate = Arc::new((StdMutex::new((0usize, false)), Condvar::new()));
        let max_running = Arc::new(AtomicUsize::new(0));
        let (started_tx, started_rx) = mpsc::channel();
        let started_tx = Arc::new(StdMutex::new(Some(started_tx)));

        let task_handle = tokio::spawn({
            let gate = gate.clone();
            let max_running = max_running.clone();
            let started_tx = started_tx.clone();
            async move {
                run_blocking_tasks_bounded((0..task_count).collect(), parallelism, move |task| {
                    let (lock, cv) = &*gate;
                    let mut state = lock.lock().unwrap();
                    state.0 += 1;
                    max_running.fetch_max(state.0, Ordering::SeqCst);
                    if state.0 == parallelism
                        && let Some(tx) = started_tx.lock().unwrap().take()
                    {
                        let _ = tx.send(());
                    }
                    cv.notify_all();

                    while !state.1 {
                        state = cv.wait(state).unwrap();
                    }

                    state.0 -= 1;
                    task
                })
                .await
            }
        });

        tokio::task::spawn_blocking(move || started_rx.recv().unwrap())
            .await
            .unwrap();

        {
            let (lock, cv) = &*gate;
            let mut state = lock.lock().unwrap();
            state.1 = true;
            cv.notify_all();
        }

        let mut results = task_handle.await.unwrap();
        results.sort_unstable();
        assert_eq!(results, (0..task_count).collect::<Vec<_>>());
        assert!(
            max_running.load(Ordering::SeqCst) <= parallelism,
            "expected max concurrency <= {parallelism}, got {}",
            max_running.load(Ordering::SeqCst)
        );
    }
}
