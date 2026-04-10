use crate::domains::attention::get_session_attention_state;
use crate::domains::sessions::entity::EnrichedSession;
use crate::domains::sessions::{
    GitEnrichmentTask, apply_git_enrichment, compute_git_for_session,
};
use crate::infrastructure::database::SpecMethods;
use crate::project_manager::ProjectManager;
use crate::schaltwerk_core::SchaltwerkCore;
use async_trait::async_trait;
use std::sync::Arc;

pub async fn compute_git_enrichment_parallel(
    tasks: Vec<GitEnrichmentTask>,
) -> Vec<crate::domains::sessions::service::GitEnrichmentResult> {
    if tasks.is_empty() {
        return Vec::new();
    }

    let handles: Vec<_> = tasks
        .into_iter()
        .map(|task| {
            tokio::task::spawn_blocking(move || compute_git_for_session(&task))
        })
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(err) => {
                log::error!("Git enrichment task panicked: {err}");
            }
        }
    }
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
                        if let Some(attention_required) = guard.get(&session.info.session_id) {
                            session.attention_required = Some(attention_required);
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

    async fn get_core(&self) -> Result<Arc<tokio::sync::RwLock<SchaltwerkCore>>, String> {
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
            let core_wait = std::time::Instant::now();
            let core = core.read().await;
            let core_ready = core_wait.elapsed().as_millis();
            if core_ready > 200 {
                log::warn!(
                    "ProjectSessionsBackend call_id={call_id} core read lock wait={core_ready}ms"
                );
            } else {
                log::debug!(
                    "ProjectSessionsBackend call_id={call_id} core read lock wait={core_ready}ms"
                );
            }

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
                        let Some(attention_required) = guard.get(&session.info.session_id) else {
                            continue;
                        };

                        session.attention_required = Some(attention_required);

                        if session.info.session_state == crate::domains::sessions::entity::SessionState::Spec
                            && previous_attention != Some(attention_required)
                            && let Some(stable_id) = session.info.stable_id.as_deref()
                        {
                            spec_attention_updates.push((stable_id.to_string(), attention_required));
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
    use std::sync::Arc;
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
            SessionInfo, SessionState, SessionStatusType, SessionType,
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
                current_task: None,
                diff_stats: None,
                ready_to_merge: false,
                spec_content: None,
                spec_stage: None,
                clarification_started: None,
                session_state: SessionState::Running,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
                is_consolidation: false,
                consolidation_sources: None,
                promotion_reason: None,
            },
            status: None,
            terminals: vec![],
            attention_required: None,
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
        registry.lock().await.update("one", true);
        registry.lock().await.update("two", false);

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
    }
}
