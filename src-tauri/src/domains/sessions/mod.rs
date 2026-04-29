pub mod action_prompts;
pub mod activity;
pub mod autonomy;
pub mod cache;
pub mod consolidation_stub;
pub mod db_sessions;
pub mod entity;
pub mod facts_recorder;
pub mod lifecycle;
pub mod process_cleanup;
pub mod repository;
pub mod service;
pub mod stage;
pub mod utils;

#[cfg(test)]
pub mod sorting;

pub use entity::{EnrichedSession, SessionState};
pub use stage::{Stage, StageInputs, derive_stage};
pub use repository::SessionDbManager;
pub use service::{
    AgentLaunchParams, GitEnrichmentTask, SessionCancellationInfo, SessionManager,
    apply_git_enrichment, compute_git_for_session, compute_ready_to_merge_for_event,
    compute_rebased_onto_parent,
};
