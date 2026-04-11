pub mod activity;
pub mod autonomy;
pub mod cache;
pub mod db_sessions;
pub mod entity;
pub mod lifecycle;
pub mod process_cleanup;
pub mod repository;
pub mod service;
pub mod utils;

#[cfg(test)]
pub mod sorting;

pub use entity::{EnrichedSession, SessionState};
pub use repository::SessionDbManager;
pub use service::{
    AgentLaunchParams, GitEnrichmentTask, SessionCancellationInfo, SessionManager,
    apply_git_enrichment, compute_git_for_session, compute_ready_to_merge_for_event,
    compute_rebased_onto_parent,
};
