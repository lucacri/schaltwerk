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
0. Load the Lucode consolidate workflow from your native Lucode wrapper if available, or read the MCP resource lucode://skills/consolidate before making consolidation decisions
1. Lucode already created this dedicated consolidation session and linked it to the source version group
2. Read the diff for each session branch (git diff main...{branch})
3. Compare the approaches taken by each agent
4. Apply the best base implementation into your current consolidation session branch
5. Incorporate any valuable improvements from the other versions
6. Run the project's test suite to verify everything passes
7. Create a single squashed commit with the consolidated result
8. Call lucode_promote on the current consolidation session — this cleans up the source versions automatically."#
        .to_string()
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
