use crate::domains::sessions::entity::{Session, Spec};

pub fn render_plan_candidate_prompt(template: &str, spec: &Spec) -> String {
    render_action_prompt_template(
        template,
        &[
            ("SPEC_ID", spec.id.as_str()),
            ("BASE_SPEC_CONTENT", spec.content.as_str()),
        ],
    )
}

pub fn render_force_restart_prompt(template: &str, base_prompt: &str) -> String {
    render_action_prompt_template(template, &[("BASE_SPEC_CONTENT", base_prompt)])
}

fn build_source_sessions_block(source_session_ids: &[String]) -> String {
    let mut block = String::new();
    for s in source_session_ids {
        block.push_str(&format!("- {s}\n"));
    }
    block
}

fn build_plan_candidates_block(candidate_sessions: &[Session]) -> String {
    let mut block = String::new();
    for candidate in candidate_sessions {
        let report = candidate
            .consolidation_report
            .as_deref()
            .unwrap_or("<missing report>");
        let base = candidate
            .consolidation_base_session_id
            .as_deref()
            .unwrap_or("<missing base>");
        let report_source = candidate
            .consolidation_report_source
            .as_deref()
            .unwrap_or("agent");
        block.push_str(&format!(
            "- {name}\n  base_session_id: {base}\n  report_source: {report_source}\n",
            name = candidate.name,
        ));
        if report_source == "auto_stub" {
            block.push_str("  note: This candidate has only an auto-filed stub report.\n");
        }
        block.push_str(&format!("  report:\n{report}\n\n"));
    }
    block
}

fn build_synthesis_candidates_block(candidate_sessions: &[Session]) -> String {
    let mut block = String::new();
    for candidate in candidate_sessions {
        let report = candidate
            .consolidation_report
            .as_deref()
            .unwrap_or("<missing report>");
        let base = candidate
            .consolidation_base_session_id
            .as_deref()
            .unwrap_or("<missing base>");
        let report_source = candidate
            .consolidation_report_source
            .as_deref()
            .unwrap_or("agent");
        let worktree = candidate
            .worktree_path
            .to_str()
            .unwrap_or("<missing worktree>");
        block.push_str(&format!(
            "- name: {name}\n  branch: {branch}\n  worktree_path: {worktree}\n  base_session_id: {base}\n  report_source: {report_source}\n",
            name = candidate.name,
            branch = candidate.branch,
        ));
        if report_source == "auto_stub" {
            block.push_str("  note: This candidate has only an auto-filed stub report.\n");
        }
        block.push_str(&format!("  report:\n{report}\n\n"));
    }
    block
}

pub fn render_plan_judge_prompt(
    template: &str,
    candidate_sessions: &[Session],
    source_session_ids: &[String],
) -> String {
    let sources_block = build_source_sessions_block(source_session_ids);
    let candidates_block = build_plan_candidates_block(candidate_sessions);
    render_action_prompt_template(
        template,
        &[
            ("SOURCE_SESSIONS_BLOCK", sources_block.as_str()),
            ("CANDIDATES_BLOCK", candidates_block.as_str()),
        ],
    )
}

pub fn render_synthesis_judge_prompt(
    template: &str,
    candidate_sessions: &[Session],
    source_session_ids: &[String],
) -> String {
    let sources_block = build_source_sessions_block(source_session_ids);
    let candidates_block = build_synthesis_candidates_block(candidate_sessions);
    let candidate_count = candidate_sessions.len().to_string();
    render_action_prompt_template(
        template,
        &[
            ("CANDIDATE_COUNT", candidate_count.as_str()),
            ("SOURCE_SESSIONS_BLOCK", sources_block.as_str()),
            ("CANDIDATES_BLOCK", candidates_block.as_str()),
        ],
    )
}

pub fn render_action_prompt_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(close_rel) = template[i + 1..].find('}')
        {
            let key = &template[i + 1..i + 1 + close_rel];
            let is_valid_key = !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_');
            if is_valid_key
                && let Some((_, value)) = vars.iter().find(|(k, _)| *k == key)
            {
                out.push_str(value);
                i += 1 + close_rel + 1;
                continue;
            }
        }
        let ch = template[i..].chars().next().expect("non-empty remainder");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        render_action_prompt_template, render_force_restart_prompt, render_plan_candidate_prompt,
        render_plan_judge_prompt, render_synthesis_judge_prompt,
    };
    use crate::domains::sessions::entity::{
        PrState, Session, SessionState, SessionStatus, Spec, SpecStage,
    };
    use chrono::Utc;
    use std::path::PathBuf;

    fn fixture_spec(name: &str, id: &str, content: &str) -> Spec {
        let now = Utc::now();
        Spec {
            id: id.to_string(),
            name: name.to_string(),
            display_name: None,
            epic_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            improve_plan_round_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            content: content.to_string(),
            implementation_plan: None,
            stage: SpecStage::Draft,
            variant: crate::domains::sessions::entity::TaskVariant::Regular,
            ready_session_id: None,
            ready_branch: None,
            base_branch: None,
            attention_required: false,
            clarification_started: false,
            created_at: now,
            updated_at: now,
        }
    }

    fn fixture_candidate_session(
        name: &str,
        report: Option<&str>,
        base: Option<&str>,
        report_source: &str,
    ) -> Session {
        let _ = PrState::Open;
        let now = Utc::now();
        Session {
            id: format!("id-{name}"),
            name: name.to_string(),
            display_name: None,
            version_group_id: None,
            version_number: None,
            epic_id: None,
            repository_path: PathBuf::from("/tmp/repo"),
            repository_name: "repo".to_string(),
            branch: format!("lucode/{name}"),
            parent_branch: "main".to_string(),
            original_parent_branch: None,
            worktree_path: PathBuf::from(format!("/tmp/wt/{name}")),
            status: SessionStatus::Active,
            created_at: now,
            updated_at: now,
            last_activity: None,
            initial_prompt: None,
            ready_to_merge: false,
            original_agent_type: None,
            original_agent_model: None,
            pending_name_generation: false,
            was_auto_generated: false,
            spec_content: None,
            session_state: SessionState::Running,
            resume_allowed: true,
            amp_thread_id: None,
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            is_consolidation: true,
            consolidation_sources: None,
            consolidation_round_id: Some("round-1".to_string()),
            consolidation_role: Some("candidate".to_string()),
            consolidation_report: report.map(str::to_string),
            consolidation_report_source: Some(report_source.to_string()),
            consolidation_base_session_id: base.map(str::to_string),
            consolidation_recommended_session_id: None,
            consolidation_confirmation_mode: Some("confirm".to_string()),
            promotion_reason: None,
            ci_autofix_enabled: false,
            merged_at: None,
            task_id: None,
            task_stage: None,
            task_role: None,
            task_run_id: None,
            run_role: None,
            slot_key: None,
            exited_at: None,
            exit_code: None,
            first_idle_at: None,
        }
    }

    #[test]
    fn substitutes_single_placeholder() {
        let rendered = render_action_prompt_template("Hello {NAME}!", &[("NAME", "world")]);
        assert_eq!(rendered, "Hello world!");
    }

    #[test]
    fn substitutes_multiple_placeholders() {
        let rendered = render_action_prompt_template(
            "{GREETING}, {NAME}!",
            &[("GREETING", "Hi"), ("NAME", "there")],
        );
        assert_eq!(rendered, "Hi, there!");
    }

    #[test]
    fn leaves_unknown_placeholders_untouched() {
        let rendered = render_action_prompt_template(
            "Known {KNOWN}, unknown {MISSING}",
            &[("KNOWN", "ok")],
        );
        assert_eq!(rendered, "Known ok, unknown {MISSING}");
    }

    #[test]
    fn does_not_recursively_substitute_values_containing_placeholder_tokens() {
        let rendered =
            render_action_prompt_template("{A} then {B}", &[("A", "{B}"), ("B", "final")]);
        assert_eq!(rendered, "{B} then final");
    }

    #[test]
    fn handles_empty_value() {
        let rendered = render_action_prompt_template("Before{X}After", &[("X", "")]);
        assert_eq!(rendered, "BeforeAfter");
    }

    #[test]
    fn handles_repeated_placeholder() {
        let rendered = render_action_prompt_template("{X} and {X} again", &[("X", "foo")]);
        assert_eq!(rendered, "foo and foo again");
    }

    #[test]
    fn preserves_non_placeholder_braces() {
        let rendered = render_action_prompt_template("plain {} and {123}", &[]);
        assert_eq!(rendered, "plain {} and {123}");
    }

    #[test]
    fn render_plan_candidate_substitutes_spec_id_and_content() {
        let spec = fixture_spec("alpha", "SPEC-ID-42", "Do the thing.");
        let template = "Plan for {SPEC_ID}:\n{BASE_SPEC_CONTENT}";
        let rendered = render_plan_candidate_prompt(template, &spec);
        assert_eq!(rendered, "Plan for SPEC-ID-42:\nDo the thing.");
    }

    #[test]
    fn render_plan_candidate_uses_default_template_placeholders() {
        let spec = fixture_spec("alpha", "SPEC-777", "Spec body here.");
        let template = super::super::super::settings::default_plan_candidate_prompt_template();
        let rendered = render_plan_candidate_prompt(&template, &spec);
        assert!(rendered.contains("SPEC-777"));
        assert!(rendered.contains("Spec body here."));
        assert!(!rendered.contains("{BASE_SPEC_CONTENT}"));
        assert!(!rendered.contains("{SPEC_ID}"));
    }

    #[test]
    fn render_force_restart_substitutes_base_prompt() {
        let template = "Preamble.\n\n{BASE_SPEC_CONTENT}";
        let rendered = render_force_restart_prompt(template, "original prompt body");
        assert_eq!(rendered, "Preamble.\n\noriginal prompt body");
    }

    #[test]
    fn render_force_restart_uses_default_template_placeholders() {
        let template = super::super::super::settings::default_force_restart_prompt_template();
        let rendered = render_force_restart_prompt(&template, "original prompt body");
        assert!(rendered.contains("continuation of prior work"));
        assert!(rendered.contains("original prompt body"));
        assert!(!rendered.contains("{BASE_SPEC_CONTENT}"));
    }

    #[test]
    fn render_plan_judge_lists_candidates_with_reports() {
        let candidates = vec![
            fixture_candidate_session("cand-a", Some("report-a"), Some("base-a"), "agent"),
            fixture_candidate_session("cand-b", Some("report-b"), Some("base-b"), "auto_stub"),
        ];
        let sources = vec!["source-x".to_string()];
        let template = super::super::super::settings::default_plan_judge_prompt_template();

        let rendered = render_plan_judge_prompt(&template, &candidates, &sources);

        assert!(rendered.contains("Improve Plan candidate"));
        assert!(rendered.contains("- source-x"));
        assert!(rendered.contains("cand-a"));
        assert!(rendered.contains("base_session_id: base-a"));
        assert!(rendered.contains("report_source: agent"));
        assert!(rendered.contains("report:\nreport-a"));
        assert!(rendered.contains("cand-b"));
        assert!(rendered.contains("report_source: auto_stub"));
        assert!(rendered.contains("note: This candidate has only an auto-filed stub report."));
        assert!(rendered.contains("recommended_session_id"));
        assert!(rendered.contains("Choose the strongest implementation plan"));
        assert!(!rendered.contains("{CANDIDATES_BLOCK}"));
    }

    #[test]
    fn render_synthesis_judge_renders_candidate_count_and_branch_details() {
        let mut candidate = fixture_candidate_session("cand-a", Some("report-a"), Some("base-a"), "agent");
        candidate.branch = "lucode/cand-a".to_string();
        let candidates = vec![candidate, fixture_candidate_session("cand-b", None, None, "auto_stub")];
        let sources = vec!["source-x".to_string()];
        let template = super::super::super::settings::default_judge_prompt_template();

        let rendered = render_synthesis_judge_prompt(&template, &candidates, &sources);

        assert!(rendered.contains("synthesis judge"));
        assert!(rendered.contains("2 parallel agents"));
        assert!(rendered.contains("- name: cand-a"));
        assert!(rendered.contains("branch: lucode/cand-a"));
        assert!(rendered.contains("worktree_path:"));
        assert!(rendered.contains("<missing report>"));
        assert!(rendered.contains("note: This candidate has only an auto-filed stub report."));
        assert!(rendered.contains("Do NOT set `recommended_session_id`"));
        assert!(rendered.contains("synthesize"));
        assert!(!rendered.contains("{CANDIDATE_COUNT}"));
    }
}
