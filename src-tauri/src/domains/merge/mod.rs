pub mod lock;
pub mod service;
pub mod types;

pub use service::{update_session_from_parent, MergeService};
pub use types::{
    MergeCommitSummary, MergeMode, MergeOutcome, MergePreview, MergeState,
    UpdateFromParentStatus, UpdateSessionFromParentResult,
};
