use serde::{Deserialize, Serialize};
use std::str::FromStr;

use super::entity::{SessionState, SessionStatus, SpecStage};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Draft,
    Ready,
    Brainstormed,
    Planned,
    Implemented,
    Pushed,
    Done,
    Cancelled,
}

impl Stage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Stage::Draft => "draft",
            Stage::Ready => "ready",
            Stage::Brainstormed => "brainstormed",
            Stage::Planned => "planned",
            Stage::Implemented => "implemented",
            Stage::Pushed => "pushed",
            Stage::Done => "done",
            Stage::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Stage::Done | Stage::Cancelled)
    }
}

impl FromStr for Stage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(Stage::Draft),
            "ready" => Ok(Stage::Ready),
            "brainstormed" => Ok(Stage::Brainstormed),
            "planned" => Ok(Stage::Planned),
            "implemented" => Ok(Stage::Implemented),
            "pushed" => Ok(Stage::Pushed),
            "done" => Ok(Stage::Done),
            "cancelled" => Ok(Stage::Cancelled),
            _ => Err(format!("Invalid stage: {s}")),
        }
    }
}

#[derive(Debug, Clone)]
pub struct StageInputs<'a> {
    pub status: &'a SessionStatus,
    pub session_state: &'a SessionState,
    pub ready_to_merge: bool,
    pub spec_stage: Option<&'a str>,
    pub task_stage: Option<&'a str>,
    pub consolidation_role: Option<&'a str>,
    pub consolidation_round_pending: bool,
    pub merged_at_is_some: bool,
}

pub fn derive_stage(inputs: &StageInputs<'_>) -> Stage {
    if let Some(task_stage) = inputs.task_stage.and_then(|value| Stage::from_str(value).ok()) {
        return task_stage;
    }

    if *inputs.status == SessionStatus::Cancelled {
        return Stage::Cancelled;
    }

    if inputs.merged_at_is_some {
        return Stage::Done;
    }

    if *inputs.status == SessionStatus::Spec || *inputs.session_state == SessionState::Spec {
        return inputs
            .spec_stage
            .and_then(|value| SpecStage::from_str(value).ok())
            .map(|stage| match stage {
                SpecStage::Draft => Stage::Draft,
                SpecStage::Ready => Stage::Ready,
                SpecStage::Brainstormed => Stage::Brainstormed,
                SpecStage::Planned => Stage::Planned,
                SpecStage::Implemented => Stage::Implemented,
                SpecStage::Pushed => Stage::Pushed,
                SpecStage::Done => Stage::Done,
                SpecStage::Cancelled => Stage::Cancelled,
            })
            .unwrap_or(Stage::Draft);
    }

    if inputs.ready_to_merge || inputs.consolidation_round_pending || inputs.consolidation_role.is_some() {
        return Stage::Implemented;
    }

    Stage::Implemented
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
            task_stage: None,
            consolidation_role: None,
            consolidation_round_pending: false,
            merged_at_is_some: false,
        }
    }

    #[test]
    fn spec_without_stage_maps_to_draft() {
        let inputs = base(&SessionStatus::Spec, &SessionState::Spec);
        assert_eq!(derive_stage(&inputs), Stage::Draft);
    }

    #[test]
    fn spec_ready_maps_to_ready() {
        let mut inputs = base(&SessionStatus::Spec, &SessionState::Spec);
        inputs.spec_stage = Some("ready");
        assert_eq!(derive_stage(&inputs), Stage::Ready);
    }

    #[test]
    fn persisted_task_stage_wins() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.task_stage = Some("planned");
        inputs.ready_to_merge = true;
        assert_eq!(derive_stage(&inputs), Stage::Planned);
    }

    #[test]
    fn running_session_defaults_to_implemented() {
        let inputs = base(&SessionStatus::Active, &SessionState::Running);
        assert_eq!(derive_stage(&inputs), Stage::Implemented);
    }

    #[test]
    fn ready_to_merge_compatibility_maps_to_implemented() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.ready_to_merge = true;
        assert_eq!(derive_stage(&inputs), Stage::Implemented);
    }

    #[test]
    fn consolidation_compatibility_maps_to_implemented() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.consolidation_role = Some("candidate");
        assert_eq!(derive_stage(&inputs), Stage::Implemented);
    }

    #[test]
    fn merged_maps_to_done() {
        let mut inputs = base(&SessionStatus::Active, &SessionState::Running);
        inputs.merged_at_is_some = true;
        assert_eq!(derive_stage(&inputs), Stage::Done);
    }

    #[test]
    fn cancelled_maps_to_cancelled() {
        let inputs = base(&SessionStatus::Cancelled, &SessionState::Running);
        assert_eq!(derive_stage(&inputs), Stage::Cancelled);
    }

    #[test]
    fn stage_as_str_round_trips() {
        for stage in [
            Stage::Draft,
            Stage::Ready,
            Stage::Brainstormed,
            Stage::Planned,
            Stage::Implemented,
            Stage::Pushed,
            Stage::Done,
            Stage::Cancelled,
        ] {
            assert_eq!(Stage::from_str(stage.as_str()).unwrap(), stage);
        }
    }

    #[test]
    fn is_terminal_flags_done_and_cancelled() {
        assert!(Stage::Done.is_terminal());
        assert!(Stage::Cancelled.is_terminal());
        assert!(!Stage::Implemented.is_terminal());
        assert!(!Stage::Ready.is_terminal());
    }
}
