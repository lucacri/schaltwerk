use serde::{Deserialize, Serialize};
use std::str::FromStr;

use super::entity::{SessionState, SessionStatus};

/// Unified Kanban lifecycle stage for sessions and specs.
///
/// Replaces the parallel `SpecStage`, `SessionState`, `SessionStatus`, and
/// `ready_to_merge` representations with a single ordered enum. `derive_stage`
/// is the single source of truth for the mapping from today's fields.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Idea,
    Clarified,
    WorkingOn,
    JudgeReview,
    ReadyToMerge,
    Merged,
    Cancelled,
}

impl Stage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Stage::Idea => "idea",
            Stage::Clarified => "clarified",
            Stage::WorkingOn => "working_on",
            Stage::JudgeReview => "judge_review",
            Stage::ReadyToMerge => "ready_to_merge",
            Stage::Merged => "merged",
            Stage::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Stage::Merged | Stage::Cancelled)
    }
}

impl FromStr for Stage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "idea" => Ok(Stage::Idea),
            "clarified" => Ok(Stage::Clarified),
            "working_on" => Ok(Stage::WorkingOn),
            "judge_review" => Ok(Stage::JudgeReview),
            "ready_to_merge" => Ok(Stage::ReadyToMerge),
            "merged" => Ok(Stage::Merged),
            "cancelled" => Ok(Stage::Cancelled),
            _ => Err(format!("Invalid stage: {s}")),
        }
    }
}

/// Immutable view of the lifecycle inputs used to derive a [`Stage`].
///
/// Kept as a distinct struct so the derivation can be unit-tested without
/// constructing a full [`super::entity::Session`] (which owns many unrelated
/// fields like `repository_path`, `branch`, etc.).
#[derive(Debug, Clone)]
pub struct StageInputs<'a> {
    pub status: &'a SessionStatus,
    pub session_state: &'a SessionState,
    pub ready_to_merge: bool,
    pub spec_stage: Option<&'a str>,
    pub consolidation_role: Option<&'a str>,
    pub consolidation_round_pending: bool,
    pub merged_at_is_some: bool,
}

/// Single source of truth for deriving a [`Stage`] from today's lifecycle fields.
///
/// Precedence (highest wins): `Merged` > `Cancelled` > `JudgeReview` >
/// `ReadyToMerge` > (`Idea` | `Clarified`) > `WorkingOn`.
///
/// `Merged` outranks `Cancelled` so that a session explicitly merged and then
/// archived (which today also flips status to `Cancelled`) still shows as
/// merged. When `merged_at_is_some` is false, the function falls through to
/// the status-based branches — callers that do not track `merged_at` can
/// always pass `false` and the result will be backwards compatible.
pub fn derive_stage(inputs: &StageInputs<'_>) -> Stage {
    if inputs.merged_at_is_some {
        return Stage::Merged;
    }

    if *inputs.status == SessionStatus::Cancelled {
        return Stage::Cancelled;
    }

    if inputs.consolidation_round_pending || inputs.consolidation_role.is_some() {
        return Stage::JudgeReview;
    }

    if *inputs.status == SessionStatus::Spec || *inputs.session_state == SessionState::Spec {
        return match inputs.spec_stage {
            Some("clarified") => Stage::Clarified,
            _ => Stage::Idea,
        };
    }

    if inputs.ready_to_merge {
        return Stage::ReadyToMerge;
    }

    Stage::WorkingOn
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base<'a>(status: &'a SessionStatus, session_state: &'a SessionState) -> StageInputs<'a> {
        StageInputs {
            status,
            session_state,
            ready_to_merge: false,
            spec_stage: None,
            consolidation_role: None,
            consolidation_round_pending: false,
            merged_at_is_some: false,
        }
    }

    #[test]
    fn spec_without_clarification_maps_to_idea() {
        let inputs = base(&SessionStatus::Spec, &SessionState::Spec);
        assert_eq!(derive_stage(&inputs), Stage::Idea);
    }

    #[test]
    fn spec_with_draft_stage_maps_to_idea() {
        let mut inputs = base(&SessionStatus::Spec, &SessionState::Spec);
        inputs.spec_stage = Some("draft");
        assert_eq!(derive_stage(&inputs), Stage::Idea);
    }

    #[test]
    fn spec_with_clarified_stage_maps_to_clarified() {
        let mut inputs = base(&SessionStatus::Spec, &SessionState::Spec);
        inputs.spec_stage = Some("clarified");
        assert_eq!(derive_stage(&inputs), Stage::Clarified);
    }

    #[test]
    fn running_session_maps_to_working_on() {
        let inputs = base(&SessionStatus::Active, &SessionState::Running);
        assert_eq!(derive_stage(&inputs), Stage::WorkingOn);
    }

    #[test]
    fn processing_session_maps_to_working_on() {
        let inputs = base(&SessionStatus::Active, &SessionState::Processing);
        assert_eq!(derive_stage(&inputs), Stage::WorkingOn);
    }

    #[test]
    fn ready_to_merge_overrides_working_on() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.ready_to_merge = true;
        assert_eq!(derive_stage(&inputs), Stage::ReadyToMerge);
    }

    #[test]
    fn consolidation_candidate_maps_to_judge_review() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.consolidation_role = Some("candidate");
        assert_eq!(derive_stage(&inputs), Stage::JudgeReview);
    }

    #[test]
    fn consolidation_judge_maps_to_judge_review() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.consolidation_role = Some("judge");
        assert_eq!(derive_stage(&inputs), Stage::JudgeReview);
    }

    #[test]
    fn pending_consolidation_round_maps_to_judge_review() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.consolidation_round_pending = true;
        assert_eq!(derive_stage(&inputs), Stage::JudgeReview);
    }

    #[test]
    fn judge_review_beats_ready_to_merge() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.ready_to_merge = true;
        inputs.consolidation_role = Some("candidate");
        assert_eq!(derive_stage(&inputs), Stage::JudgeReview);
    }

    #[test]
    fn cancelled_status_maps_to_cancelled() {
        let inputs = base(&SessionStatus::Cancelled, &SessionState::Running);
        assert_eq!(derive_stage(&inputs), Stage::Cancelled);
    }

    #[test]
    fn cancelled_beats_ready_to_merge() {
        let mut inputs = base(&SessionStatus::Cancelled, &SessionState::Running);
        inputs.ready_to_merge = true;
        assert_eq!(derive_stage(&inputs), Stage::Cancelled);
    }

    #[test]
    fn merged_beats_everything() {
        let mut inputs = base(&SessionStatus::Cancelled, &SessionState::Running);
        inputs.ready_to_merge = true;
        inputs.merged_at_is_some = true;
        inputs.consolidation_role = Some("judge");
        assert_eq!(derive_stage(&inputs), Stage::Merged);
    }

    #[test]
    fn stage_as_str_round_trips() {
        for stage in [
            Stage::Idea,
            Stage::Clarified,
            Stage::WorkingOn,
            Stage::JudgeReview,
            Stage::ReadyToMerge,
            Stage::Merged,
            Stage::Cancelled,
        ] {
            assert_eq!(Stage::from_str(stage.as_str()).unwrap(), stage);
        }
    }

    #[test]
    fn is_terminal_flags_merged_and_cancelled() {
        assert!(Stage::Merged.is_terminal());
        assert!(Stage::Cancelled.is_terminal());
        assert!(!Stage::WorkingOn.is_terminal());
        assert!(!Stage::ReadyToMerge.is_terminal());
        assert!(!Stage::JudgeReview.is_terminal());
        assert!(!Stage::Idea.is_terminal());
        assert!(!Stage::Clarified.is_terminal());
    }

    #[test]
    fn from_str_rejects_unknown_values() {
        assert!(Stage::from_str("bogus").is_err());
        assert!(Stage::from_str("").is_err());
    }

    #[test]
    fn spec_session_state_without_spec_status_still_treated_as_idea() {
        let inputs = base(&SessionStatus::Active, &SessionState::Spec);
        assert_eq!(derive_stage(&inputs), Stage::Idea);
    }
}
