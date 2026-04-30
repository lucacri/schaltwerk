use crate::domains::tasks::entity::SlotKind;
use anyhow::{Result, anyhow};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetSlot {
    pub slot_key: String,
    pub agent_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetShape {
    pub candidates: Vec<PresetSlot>,
    pub synthesize: bool,
    pub select: bool,
    pub consolidator: Option<PresetSlot>,
    pub evaluator: Option<PresetSlot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpandedRunSlot {
    pub run_role: SlotKind,
    pub slot_key: Option<String>,
    pub agent_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionMode {
    Auto,
    Manual,
    Evaluator,
}

pub fn expand_preset(shape: &PresetShape) -> Result<Vec<ExpandedRunSlot>> {
    if shape.candidates.is_empty() {
        return Err(anyhow!("preset requires at least one candidate slot"));
    }
    if shape.synthesize && shape.consolidator.is_none() {
        return Err(anyhow!(
            "preset declares synthesize=true but has no consolidator slot"
        ));
    }
    if shape.select && shape.evaluator.is_none() {
        return Err(anyhow!(
            "preset declares select=true but has no evaluator slot"
        ));
    }

    let mut expanded: Vec<ExpandedRunSlot> = Vec::new();

    // A preset with a single candidate and no downstream synthesis/selection collapses
    // into one `Single` slot because there is nothing to pick between.
    if shape.candidates.len() == 1 && !shape.synthesize && !shape.select {
        let slot = &shape.candidates[0];
        expanded.push(ExpandedRunSlot {
            run_role: SlotKind::Single,
            slot_key: Some(slot.slot_key.clone()),
            agent_type: slot.agent_type.clone(),
        });
        return Ok(expanded);
    }

    for slot in &shape.candidates {
        expanded.push(ExpandedRunSlot {
            run_role: SlotKind::Candidate,
            slot_key: Some(slot.slot_key.clone()),
            agent_type: slot.agent_type.clone(),
        });
    }

    if shape.synthesize {
        let consolidator = shape
            .consolidator
            .as_ref()
            .expect("consolidator presence checked above");
        expanded.push(ExpandedRunSlot {
            run_role: SlotKind::Consolidator,
            slot_key: None,
            agent_type: consolidator.agent_type.clone(),
        });
    }

    if shape.select {
        let evaluator = shape
            .evaluator
            .as_ref()
            .expect("evaluator presence checked above");
        expanded.push(ExpandedRunSlot {
            run_role: SlotKind::Evaluator,
            slot_key: None,
            agent_type: evaluator.agent_type.clone(),
        });
    }

    Ok(expanded)
}

pub fn selection_mode_for(shape: &PresetShape) -> SelectionMode {
    if shape.select {
        SelectionMode::Evaluator
    } else if shape.candidates.len() == 1 && !shape.synthesize {
        SelectionMode::Auto
    } else {
        SelectionMode::Manual
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(key: &str, agent: &str) -> PresetSlot {
        PresetSlot {
            slot_key: key.to_string(),
            agent_type: agent.to_string(),
        }
    }

    fn base_shape(candidates: Vec<PresetSlot>) -> PresetShape {
        PresetShape {
            candidates,
            synthesize: false,
            select: false,
            consolidator: None,
            evaluator: None,
        }
    }

    #[test]
    fn expand_empty_preset_errors() {
        let shape = base_shape(vec![]);
        let err = expand_preset(&shape).unwrap_err();
        assert!(
            err.to_string().contains("at least one candidate"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn expand_single_candidate_emits_single_role() {
        let shape = base_shape(vec![slot("claude", "claude")]);
        let out = expand_preset(&shape).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].run_role, SlotKind::Single);
        assert_eq!(out[0].slot_key.as_deref(), Some("claude"));
        assert_eq!(out[0].agent_type, "claude");
    }

    #[test]
    fn expand_two_candidates_emits_two_candidate_roles_in_order() {
        let shape = base_shape(vec![slot("claude-0", "claude"), slot("codex-1", "codex")]);
        let out = expand_preset(&shape).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].run_role, SlotKind::Candidate);
        assert_eq!(out[0].slot_key.as_deref(), Some("claude-0"));
        assert_eq!(out[0].agent_type, "claude");
        assert_eq!(out[1].run_role, SlotKind::Candidate);
        assert_eq!(out[1].slot_key.as_deref(), Some("codex-1"));
        assert_eq!(out[1].agent_type, "codex");
    }

    #[test]
    fn expand_three_candidates_with_synthesize_appends_consolidator() {
        let shape = PresetShape {
            candidates: vec![
                slot("claude-0", "claude"),
                slot("codex-1", "codex"),
                slot("gemini-2", "gemini"),
            ],
            synthesize: true,
            select: false,
            consolidator: Some(slot("consolidator", "claude")),
            evaluator: None,
        };
        let out = expand_preset(&shape).unwrap();
        assert_eq!(out.len(), 4);
        assert_eq!(out[0].run_role, SlotKind::Candidate);
        assert_eq!(out[1].run_role, SlotKind::Candidate);
        assert_eq!(out[2].run_role, SlotKind::Candidate);
        assert_eq!(out[3].run_role, SlotKind::Consolidator);
        assert_eq!(out[3].slot_key, None);
        assert_eq!(out[3].agent_type, "claude");
    }

    #[test]
    fn expand_with_select_appends_evaluator() {
        let shape = PresetShape {
            candidates: vec![slot("claude-0", "claude"), slot("codex-1", "codex")],
            synthesize: false,
            select: true,
            consolidator: None,
            evaluator: Some(slot("evaluator", "gemini")),
        };
        let out = expand_preset(&shape).unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].run_role, SlotKind::Candidate);
        assert_eq!(out[1].run_role, SlotKind::Candidate);
        assert_eq!(out[2].run_role, SlotKind::Evaluator);
        assert_eq!(out[2].slot_key, None);
        assert_eq!(out[2].agent_type, "gemini");
    }

    #[test]
    fn expand_with_synthesize_and_select_appends_both_in_order_consolidator_then_evaluator() {
        let shape = PresetShape {
            candidates: vec![slot("claude-0", "claude"), slot("codex-1", "codex")],
            synthesize: true,
            select: true,
            consolidator: Some(slot("consolidator", "claude")),
            evaluator: Some(slot("evaluator", "gemini")),
        };
        let out = expand_preset(&shape).unwrap();
        assert_eq!(out.len(), 4);
        assert_eq!(out[0].run_role, SlotKind::Candidate);
        assert_eq!(out[1].run_role, SlotKind::Candidate);
        assert_eq!(out[2].run_role, SlotKind::Consolidator);
        assert_eq!(out[2].agent_type, "claude");
        assert_eq!(out[3].run_role, SlotKind::Evaluator);
        assert_eq!(out[3].agent_type, "gemini");
    }

    #[test]
    fn expand_rejects_synthesize_without_consolidator() {
        let shape = PresetShape {
            candidates: vec![slot("claude-0", "claude")],
            synthesize: true,
            select: false,
            consolidator: None,
            evaluator: None,
        };
        let err = expand_preset(&shape).unwrap_err();
        assert!(
            err.to_string().contains("consolidator"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn expand_rejects_select_without_evaluator() {
        let shape = PresetShape {
            candidates: vec![slot("claude-0", "claude")],
            synthesize: false,
            select: true,
            consolidator: None,
            evaluator: None,
        };
        let err = expand_preset(&shape).unwrap_err();
        assert!(
            err.to_string().contains("evaluator"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn selection_mode_single_and_no_select_returns_auto() {
        let shape = base_shape(vec![slot("claude", "claude")]);
        assert_eq!(selection_mode_for(&shape), SelectionMode::Auto);
    }

    #[test]
    fn selection_mode_multi_without_evaluator_returns_manual() {
        let shape = base_shape(vec![slot("claude-0", "claude"), slot("codex-1", "codex")]);
        assert_eq!(selection_mode_for(&shape), SelectionMode::Manual);
    }

    #[test]
    fn selection_mode_with_evaluator_always_returns_evaluator() {
        let single_with_evaluator = PresetShape {
            candidates: vec![slot("claude-0", "claude")],
            synthesize: false,
            select: true,
            consolidator: None,
            evaluator: Some(slot("evaluator", "gemini")),
        };
        assert_eq!(
            selection_mode_for(&single_with_evaluator),
            SelectionMode::Evaluator
        );

        let multi_with_evaluator = PresetShape {
            candidates: vec![slot("claude-0", "claude"), slot("codex-1", "codex")],
            synthesize: false,
            select: true,
            consolidator: None,
            evaluator: Some(slot("evaluator", "gemini")),
        };
        assert_eq!(
            selection_mode_for(&multi_with_evaluator),
            SelectionMode::Evaluator
        );
    }

    #[test]
    fn expanded_candidate_order_is_preserved_stably() {
        let shape = PresetShape {
            candidates: vec![
                slot("zeta", "claude"),
                slot("alpha", "codex"),
                slot("mu", "gemini"),
                slot("beta", "opencode"),
            ],
            synthesize: true,
            select: true,
            consolidator: Some(slot("consolidator", "claude")),
            evaluator: Some(slot("evaluator", "gemini")),
        };
        let out = expand_preset(&shape).unwrap();
        let candidate_keys: Vec<Option<&str>> = out
            .iter()
            .filter(|s| s.run_role == SlotKind::Candidate)
            .map(|s| s.slot_key.as_deref())
            .collect();
        assert_eq!(
            candidate_keys,
            vec![Some("zeta"), Some("alpha"), Some("mu"), Some("beta")]
        );
    }
}
