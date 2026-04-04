use super::types::{
    normalize_contextual_actions, ContextualAction, ContextualActionContext, ContextualActionMode,
    GenerationSettings,
};

pub fn default_consolidation_prompt_template() -> String {
    r#"You are consolidating the results of multiple parallel agent sessions.

Review each branch's changes, compare approaches, and produce a single
reconciled version that takes the best from each:

Sessions to review:
{sessionList}

Instructions:
1. Read the code in each worktree path listed above
2. Compare the approaches taken by each agent
3. Choose the best base implementation
4. Incorporate any valuable improvements from the other versions
5. Produce a clean, unified result in this worktree
6. Run the project's test suite to verify everything passes"#
        .to_string()
}

pub fn default_review_pr_prompt_template() -> String {
    "Review the following pull request or merge request:\n\nTitle: {{pr.title}}\nAuthor: {{pr.author}}\nSource: {{pr.sourceBranch}} -> {{pr.targetBranch}}\n\nDescription:\n{{pr.description}}\n\nLabels: {{pr.labels}}\n\nDiff:\n{{pr.diff}}".to_string()
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

- Brainstorm (/superpowers:brainstorming) before implementation to validate the approach
- Plan (/superpowers:writing-plans) to break down the work into steps
- TDD (/superpowers:test-driven-development) -- write tests first, then implement
- Execute (/superpowers:executing-plans) the plan with review checkpoints
- Verify (/superpowers:verification-before-completion) -- run the project's test suite and confirm all green before claiming done
- Code review (/superpowers:requesting-code-review) when implementation is complete

If you have questions or uncertainty during any step, do not ask the user -- research the codebase yourself or use /mart-panda:consult:quick to get AI advice. Resolve ambiguity autonomously.

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

pub fn default_contextual_actions(generation: &GenerationSettings) -> Vec<ContextualAction> {
    normalize_contextual_actions(vec![
        ContextualAction {
            id: "builtin-review-pr".to_string(),
            name: "Review this PR/MR".to_string(),
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
