use super::types::{
    normalize_contextual_actions, ContextualAction, ContextualActionContext, ContextualActionMode,
    GenerationSettings,
};

pub const MERMAID_DIAGRAM_GUIDANCE: &str = "Diagrams: fenced `mermaid` code blocks render as diagrams in Lucode's spec, plan, and report viewers. Reach for one when it makes sense — architecture overviews, data or control flow, state machines, sequence of events — whenever a diagram communicates structure more clearly than prose.";

pub fn default_consolidation_prompt_template() -> String {
    format!(
        r#"You are consolidating the results of multiple parallel agent sessions.

Review each branch's changes, compare approaches, and produce a single
reconciled version that takes the best from each:

Sessions to review:
{{sessionList}}

Instructions:
0. Load the Lucode consolidate workflow from your native Lucode wrapper if available, or read the MCP resource lucode://skills/consolidate before making consolidation decisions
1. Lucode already created this dedicated consolidation session and linked it to the source version group
2. Read the diff for each session branch (git diff main...{{branch}})
3. Compare the approaches taken by each agent and pick the strongest source session as the conceptual base — record its session ID, you will include it in your lucode_consolidation_report as base_session_id
4. Apply that base implementation into your current consolidation session branch
5. Incorporate any valuable improvements from the other versions
6. Run the project's test suite to verify everything passes
7. Create a single squashed commit with the consolidated result
8. File a durable consolidation report with lucode_consolidation_report. Include the source session ID you chose as base in base_session_id and summarize what you kept from each version.
9. Do not call lucode_promote directly for a multi-agent consolidation round. Lucode will trigger the judge automatically when every candidate has filed a report, or the user can trigger or confirm it from the UI.

{guidance}"#,
        guidance = MERMAID_DIAGRAM_GUIDANCE,
    )
}

pub fn default_review_pr_prompt_template() -> String {
    "Review the following pull request:\n\nTitle: {{pr.title}}\nAuthor: {{pr.author}}\nSource: {{pr.sourceBranch}} -> {{pr.targetBranch}}\nURL: {{pr.url}}\n\nDescription:\n{{pr.description}}\n\nLabels: {{pr.labels}}\n\nFetch and review the diff using the CLI (e.g., `gh pr diff {{pr.number}}` or `git diff {{pr.targetBranch}}...{{pr.sourceBranch}}`).".to_string()
}

pub fn default_plan_issue_prompt_template() -> String {
    "Create an implementation plan for the following issue:\n\nTitle: {{issue.title}}\n\nDescription:\n{{issue.description}}\n\nLabels: {{issue.labels}}".to_string()
}

pub fn default_issue_session_prompt_template() -> String {
    [
        "GitHub Issue Context: {title} (#{number})",
        "Link: {url}",
        "{labelsSection}",
        "",
        "Issue Description:",
        "{body}",
        "{commentsSection}",
    ]
    .join("\n")
}

pub fn default_pr_session_prompt_template() -> String {
    [
        "GitHub Pull Request Context: {title} (#{number})",
        "Link: {url}",
        "Branch: {branch}",
        "{labelsSection}",
        "",
        "PR Description:",
        "{body}",
        "{commentsSection}",
    ]
    .join("\n")
}

pub fn default_autonomy_prompt_template() -> String {
    r#"## Agent Instructions

Use the full superpowers workflow autonomously -- no human interaction required.

- Brainstorm with the `brainstorming` skill/workflow before implementation to validate the approach
- Plan with `writing-plans` to break down the work into steps
- Use `test-driven-development` -- write tests first, then implement
- Execute with `executing-plans` when the plan is ready
- Verify with `verification-before-completion` -- run the project's test suite and confirm all green before claiming done
- Request code review with `requesting-code-review` when implementation is complete

If your platform supports skills, load them by name. Otherwise, read the matching workflow instructions from the repo before continuing.

If you have questions or uncertainty during any step, do not ask the user -- research the codebase yourself or use any available consultation or research tool to resolve ambiguity autonomously.

Complete the work by creating a squashed commit"#
        .to_string()
}

fn resolve_prompt(custom: Option<&str>, default_prompt: fn() -> String) -> String {
    custom
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_prompt)
}

pub fn default_force_restart_prompt_template() -> String {
    concat!(
        "This is a continuation of prior work in this worktree, not a fresh start.\n",
        "There are already committed and/or uncommitted changes in this worktree. ",
        "Before doing anything else, inspect the current state with git status and ",
        "git diff and continue from what is already there instead of redoing completed work.\n\n",
        "The original spec follows below.\n\n",
        "{BASE_SPEC_CONTENT}",
    )
    .to_string()
}

pub fn default_plan_candidate_prompt_template() -> String {
    format!(
        concat!(
            "You are preparing an implementation plan for this clarified Lucode spec.\n\n",
            "Inspect the repository as needed. Do not implement code. Write a concise, ",
            "actionable Markdown implementation plan, then call lucode_consolidation_report ",
            "with your plan as report and base_session_id set to '{{SPEC_ID}}'.\n\n",
            "{guidance}\n\n",
            "Spec content:\n\n{{BASE_SPEC_CONTENT}}",
        ),
        guidance = MERMAID_DIAGRAM_GUIDANCE,
    )
}

pub fn default_plan_judge_prompt_template() -> String {
    format!(
        concat!(
            "Review every Improve Plan candidate for this Lucode plan round.\n\n",
            "Source sessions:\n{{SOURCE_SESSIONS_BLOCK}}\n",
            "Candidates:\n{{CANDIDATES_BLOCK}}\n",
            "Choose the strongest implementation plan. File your reasoning through ",
            "lucode_consolidation_report with recommended_session_id set to the winning ",
            "candidate session ID. Do not call lucode_promote directly.\n\n",
            "{guidance}",
        ),
        guidance = MERMAID_DIAGRAM_GUIDANCE,
    )
}

pub fn default_judge_prompt_template() -> String {
    format!(
        concat!(
            "You are the synthesis judge for this Lucode consolidation round.\n\n",
            "{{CANDIDATE_COUNT}} parallel agents have each produced an independent ",
            "implementation of the same task, checked in on their own branches/worktrees ",
            "listed below. Your job is NOT to pick one — your job is to synthesize the ",
            "best possible implementation by combining the strongest ideas and code from ",
            "all candidates.\n\n",
            "You are working in your own isolated judge worktree. Read each candidate's ",
            "branch (git diff against the parent branch) and their consolidation report ",
            "for intent, then commit a coherent synthesized implementation on YOUR branch. ",
            "Your branch is what will ship; your session will be promoted under the ",
            "original spec name on acceptance.\n\n",
            "Source sessions:\n{{SOURCE_SESSIONS_BLOCK}}\n",
            "Candidates:\n{{CANDIDATES_BLOCK}}\n",
            "When the synthesized implementation is committed and verified on your branch:\n",
            "1. Run the project's required verification.\n",
            "2. File lucode_consolidation_report from this judge session with `base_session_id` ",
            "set to the source session ID you used as the conceptual base.\n",
            "3. Do NOT set `recommended_session_id` for implementation rounds.\n",
            "4. Do NOT call `lucode_promote` directly.\n\n",
            "Lucode will promote this judge session after user confirmation, or immediately ",
            "when the round is configured for auto-promotion.\n\n",
            "{guidance}",
        ),
        guidance = MERMAID_DIAGRAM_GUIDANCE,
    )
}

#[cfg(test)]
mod action_template_default_tests {
    use super::*;

    #[test]
    fn force_restart_template_contains_base_spec_content_placeholder() {
        assert!(default_force_restart_prompt_template().contains("{BASE_SPEC_CONTENT}"));
    }

    #[test]
    fn plan_candidate_template_contains_required_placeholders() {
        let tmpl = default_plan_candidate_prompt_template();
        assert!(tmpl.contains("{BASE_SPEC_CONTENT}"));
        assert!(tmpl.contains("{SPEC_ID}"));
    }

    #[test]
    fn plan_judge_template_contains_block_placeholders() {
        let tmpl = default_plan_judge_prompt_template();
        assert!(tmpl.contains("{SOURCE_SESSIONS_BLOCK}"));
        assert!(tmpl.contains("{CANDIDATES_BLOCK}"));
        assert!(tmpl.contains("recommended_session_id"));
    }

    #[test]
    fn judge_template_contains_synthesis_placeholders() {
        let tmpl = default_judge_prompt_template();
        assert!(tmpl.contains("{CANDIDATE_COUNT}"));
        assert!(tmpl.contains("{SOURCE_SESSIONS_BLOCK}"));
        assert!(tmpl.contains("{CANDIDATES_BLOCK}"));
        assert!(tmpl.contains("synthesis judge"));
    }

    fn assert_mermaid_guidance(tmpl: &str, label: &str) {
        assert!(
            tmpl.contains("mermaid"),
            "{label} must mention mermaid diagrams"
        );
        assert!(
            tmpl.contains("when it makes sense"),
            "{label} must keep the \"when it makes sense\" trigger phrase"
        );
        for trigger in [
            "architecture",
            "data or control flow",
            "state machines",
            "sequence of events",
        ] {
            assert!(
                tmpl.contains(trigger),
                "{label} must list \"{trigger}\" as a diagram use case"
            );
        }
    }

    #[test]
    fn consolidation_template_includes_mermaid_guidance() {
        assert_mermaid_guidance(
            &default_consolidation_prompt_template(),
            "consolidation template",
        );
    }

    #[test]
    fn plan_candidate_template_includes_mermaid_guidance() {
        assert_mermaid_guidance(
            &default_plan_candidate_prompt_template(),
            "plan candidate template",
        );
    }

    #[test]
    fn plan_judge_template_includes_mermaid_guidance() {
        assert_mermaid_guidance(
            &default_plan_judge_prompt_template(),
            "plan judge template",
        );
    }

    #[test]
    fn judge_template_includes_mermaid_guidance() {
        assert_mermaid_guidance(&default_judge_prompt_template(), "synthesis judge template");
    }

    #[test]
    fn consolidation_template_uses_report_base_session_id_not_promotion_winner() {
        let tmpl = default_consolidation_prompt_template();
        assert!(
            tmpl.contains("base_session_id"),
            "consolidation template must direct agents to lucode_consolidation_report base_session_id"
        );
        assert!(
            !tmpl.contains("winner_session_id"),
            "consolidation template must not reference the removed lucode_promote winner_session_id argument"
        );
    }
}

pub fn default_contextual_actions(generation: &GenerationSettings) -> Vec<ContextualAction> {
    normalize_contextual_actions(vec![
        ContextualAction {
            id: "builtin-review-pr".to_string(),
            name: "Review this PR".to_string(),
            context: ContextualActionContext::Pr,
            prompt_template: resolve_prompt(
                generation.review_pr_prompt.as_deref(),
                default_review_pr_prompt_template,
            ),
            mode: ContextualActionMode::Session,
            agent_type: Some("claude".to_string()),
            variant_id: None,
            preset_id: None,
            is_built_in: true,
        },
        ContextualAction {
            id: "builtin-plan-issue".to_string(),
            name: "Plan fix for this issue".to_string(),
            context: ContextualActionContext::Issue,
            prompt_template: resolve_prompt(
                generation.plan_issue_prompt.as_deref(),
                default_plan_issue_prompt_template,
            ),
            mode: ContextualActionMode::Spec,
            agent_type: Some("claude".to_string()),
            variant_id: None,
            preset_id: None,
            is_built_in: true,
        },
    ])
}
