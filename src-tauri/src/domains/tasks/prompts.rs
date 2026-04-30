use crate::domains::tasks::entity::{RunRole, Task, TaskStage};

pub fn build_task_host_prompt(task: &Task) -> String {
    format!(
        "You are the task host for `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         Stage-specific runs will be launched separately for brainstorming, planning, and implementation. \
         Use this terminal for ad-hoc inspection and coordination only. \
         Do NOT implement the task, modify code, or open a PR from this host session unless the user explicitly changes the workflow.",
        name = task.name,
        body = task.request_body,
    )
}

pub fn build_stage_run_prompt(task: &Task, stage: TaskStage, role: RunRole) -> String {
    debug_assert!(
        matches!(
            stage,
            TaskStage::Brainstormed | TaskStage::Planned | TaskStage::Implemented
        ),
        "build_stage_run_prompt should only be called for stage-run stages"
    );
    match stage {
        TaskStage::Brainstormed => match role {
            RunRole::Single => build_brainstorm_single_prompt(task),
            RunRole::Candidate => build_brainstorm_candidate_prompt(task),
            RunRole::Consolidator => build_brainstorm_consolidator_prompt(task),
            RunRole::Evaluator => build_brainstorm_evaluator_prompt(task),
            other => unsupported_role_prompt(task, stage, other),
        },
        TaskStage::Planned => match role {
            RunRole::Single => build_plan_single_prompt(task),
            RunRole::Candidate => build_plan_candidate_prompt(task),
            RunRole::Consolidator => build_plan_consolidator_prompt(task),
            RunRole::Evaluator => build_plan_evaluator_prompt(task),
            other => unsupported_role_prompt(task, stage, other),
        },
        TaskStage::Implemented => match role {
            RunRole::Single => build_implementation_single_prompt(task),
            RunRole::Candidate => build_implementation_candidate_prompt(task),
            RunRole::Consolidator => build_implementation_consolidator_prompt(task),
            RunRole::Evaluator => build_implementation_evaluator_prompt(task),
            other => unsupported_role_prompt(task, stage, other),
        },
        other => unsupported_stage_prompt(task, other, role),
    }
}

fn unsupported_role_prompt(task: &Task, stage: TaskStage, role: RunRole) -> String {
    format!(
        "Task prompt wiring bug for `{name}`: unsupported role `{role}` reached stage `{stage}`. Surface this to the user and do not guess.",
        name = task.name,
        role = role.as_str(),
        stage = stage.as_str(),
    )
}

fn unsupported_stage_prompt(task: &Task, stage: TaskStage, role: RunRole) -> String {
    format!(
        "Task prompt wiring bug for `{name}`: build_stage_run_prompt was called for unsupported stage `{stage}` and role `{role}`. Surface this to the user and do not guess.",
        name = task.name,
        stage = stage.as_str(),
        role = role.as_str(),
    )
}

fn brainstorm_prompt(task: &Task, role_text: &str, delivery_text: &str) -> String {
    format!(
        "You are working on the brainstorm stage for task `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         {role_text}\n\
         {delivery_text}\n\
         Do NOT modify code or open a PR at the brainstorm stage. Focus on options, trade-offs, and task framing only.",
        name = task.name,
        body = task.request_body,
        role_text = role_text,
        delivery_text = delivery_text,
    )
}

fn build_brainstorm_single_prompt(task: &Task) -> String {
    brainstorm_prompt(
        task,
        "You are producing the single brainstorm for this task.",
        "Then output a brainstorm via `LucodeTaskUpdateContent` with `artifact_kind = 'spec'` so the winning brainstorm can become the task spec.",
    )
}

fn build_brainstorm_candidate_prompt(task: &Task) -> String {
    brainstorm_prompt(
        task,
        "You are one of the brainstorm candidates for this task.",
        "Then output a brainstorm via `LucodeTaskUpdateContent` with `artifact_kind = 'spec'` and make your option set distinct and defensible.",
    )
}

fn build_brainstorm_consolidator_prompt(task: &Task) -> String {
    brainstorm_prompt(
        task,
        "You synthesize the brainstorm candidates into one consolidated brainstorm for this task.",
        "Then output a brainstorm via `LucodeTaskUpdateContent` with `artifact_kind = 'spec'`, preserving the strongest options and trade-offs from the candidates you review.",
    )
}

fn build_brainstorm_evaluator_prompt(task: &Task) -> String {
    brainstorm_prompt(
        task,
        "You score each brainstorm candidate against the request, constraints, and implementation readiness.",
        "Write the evaluation via `LucodeTaskUpdateContent` with `artifact_kind = 'review'`, and call out the strongest candidate with concrete reasons.",
    )
}

fn plan_prompt(task: &Task, role_text: &str, delivery_text: &str) -> String {
    let Some(current_spec) = task.current_spec.as_deref() else {
        return missing_required_artifact_prompt(
            task,
            "current_spec is missing",
            role_text,
            "Surface this gap to the user, ask for the brainstorm/spec artifact, and do not guess.",
        );
    };

    format!(
        "You are working on the planning stage for task `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         Current spec:\n\
         ---\n\
         {current_spec}\n\
         ---\n\
         \n\
         {role_text}\n\
         {delivery_text}\n\
         You may read files for context, but Do NOT modify code or open a PR at the planning stage.",
        name = task.name,
        body = task.request_body,
        current_spec = current_spec,
        role_text = role_text,
        delivery_text = delivery_text,
    )
}

fn missing_required_artifact_prompt(
    task: &Task,
    missing_artifact: &str,
    role_text: &str,
    delivery_text: &str,
) -> String {
    format!(
        "You are working on task `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         {role_text}\n\
         The required artifact is missing: {missing_artifact}.\n\
         {delivery_text}\n\
         Surface the missing artifact explicitly and do not guess.",
        name = task.name,
        body = task.request_body,
        role_text = role_text,
        missing_artifact = missing_artifact,
        delivery_text = delivery_text,
    )
}

fn build_plan_single_prompt(task: &Task) -> String {
    plan_prompt(
        task,
        "You are producing the single implementation plan for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'` so the winning plan can drive implementation.",
    )
}

fn build_plan_candidate_prompt(task: &Task) -> String {
    plan_prompt(
        task,
        "You are one of the planning candidates for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'`, making the milestones, risks, and verification steps concrete.",
    )
}

fn build_plan_consolidator_prompt(task: &Task) -> String {
    plan_prompt(
        task,
        "You synthesize the plan candidates into one consolidated implementation plan for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'`, preserving the strongest sequencing and verification details from the plans you review.",
    )
}

fn build_plan_evaluator_prompt(task: &Task) -> String {
    plan_prompt(
        task,
        "You score each plan candidate against the current spec, constraints, and implementation readiness.",
        "Write the evaluation via `LucodeTaskUpdateContent` with `artifact_kind = 'review'`, and justify the strongest plan with specific gaps and trade-offs.",
    )
}

fn implementation_prompt(
    task: &Task,
    role_text: &str,
    delivery_text: &str,
    code_change_text: &str,
) -> String {
    let Some(current_plan) = task.current_plan.as_deref() else {
        return missing_required_artifact_prompt(
            task,
            "current_plan is missing",
            role_text,
            "Surface this gap to the user, ask for the approved plan artifact, and do not guess.",
        );
    };

    format!(
        "You are working on the implementation stage for task `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         Current plan:\n\
         ---\n\
         {current_plan}\n\
         ---\n\
         \n\
         {role_text}\n\
         {code_change_text}\n\
         {delivery_text}",
        name = task.name,
        body = task.request_body,
        current_plan = current_plan,
        role_text = role_text,
        code_change_text = code_change_text,
        delivery_text = delivery_text,
    )
}

fn build_implementation_single_prompt(task: &Task) -> String {
    implementation_prompt(
        task,
        "You are implementing the approved plan for this task as the single implementation run.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "You may modify code, run tests, and update supporting files that the plan requires. Then implement the approved plan in this worktree.",
    )
}

fn build_implementation_candidate_prompt(task: &Task) -> String {
    implementation_prompt(
        task,
        "You are one of the implementation candidates for this task.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "You may modify code, run tests, and make the candidate distinct in approach where the plan leaves room. Then implement the approved plan in this worktree.",
    )
}

fn build_implementation_consolidator_prompt(task: &Task) -> String {
    implementation_prompt(
        task,
        "You synthesize the implementation candidates into one consolidated implementation for this task.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "Then implement the approved plan by integrating the strongest code changes from the implementation candidates in this worktree.",
    )
}

fn build_implementation_evaluator_prompt(task: &Task) -> String {
    implementation_prompt(
        task,
        "You score each implementation candidate against the current plan, code quality, and verification evidence.",
        "Write the evaluation via `LucodeTaskUpdateContent` with `artifact_kind = 'review'`, and justify the strongest implementation with concrete evidence.",
        "Do NOT modify code in the evaluator slot. Review the implementation candidates and their diffs against the approved plan.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::{Task, TaskStage, TaskVariant};
    use chrono::Utc;
    use std::path::PathBuf;

    fn make_task(body: &str) -> Task {
        let now = Utc::now();
        Task {
            id: "task-1".into(),
            name: "alpha".into(),
            display_name: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".into(),
            variant: TaskVariant::Regular,
            stage: TaskStage::Ready,
            request_body: body.into(),
            current_spec: None,
            current_plan: None,
            current_summary: None,
            source_kind: None,
            source_url: None,
            task_host_session_id: None,
            task_branch: None,
            base_branch: Some("main".into()),
            issue_number: None,
            issue_url: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            failure_flag: false,
            epic_id: None,
            attention_required: false,
            created_at: now,
            updated_at: now,
            cancelled_at: None,
            task_runs: Vec::new(),
        }
    }

    #[test]
    fn task_host_prompt_includes_task_name() {
        let task = make_task("body");
        let prompt = build_task_host_prompt(&task);
        assert!(
            prompt.contains("alpha"),
            "prompt should reference task name; got: {prompt}",
        );
    }

    #[test]
    fn task_host_prompt_forbids_implementation() {
        let task = make_task("body");
        let prompt = build_task_host_prompt(&task);
        assert!(
            prompt.contains("Do NOT implement"),
            "task host prompt must explicitly forbid implementation; got: {prompt}",
        );
    }

    #[test]
    fn task_host_prompt_differs_from_request_body() {
        let body = "implement the task";
        let task = make_task(body);
        let prompt = build_task_host_prompt(&task);
        assert_ne!(
            prompt, body,
            "task host prompt must wrap, not equal, the raw request body",
        );
    }

    #[test]
    fn brainstorm_single_prompt_includes_request_body() {
        let task = make_task("capture a migration strategy");
        let prompt = build_brainstorm_single_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn brainstorm_single_prompt_states_role() {
        let task = make_task("body");
        let prompt = build_brainstorm_single_prompt(&task);
        assert!(prompt.contains("single brainstorm"));
        assert!(prompt.contains("output a brainstorm via"));
    }

    #[test]
    fn brainstorm_single_prompt_forbids_code_changes() {
        let task = make_task("body");
        let prompt = build_brainstorm_single_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn brainstorm_single_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task(body);
        let prompt = build_brainstorm_single_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn brainstorm_candidate_prompt_includes_request_body() {
        let task = make_task("capture a migration strategy");
        let prompt = build_brainstorm_candidate_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn brainstorm_candidate_prompt_states_role() {
        let task = make_task("body");
        let prompt = build_brainstorm_candidate_prompt(&task);
        assert!(prompt.contains("one of the brainstorm candidates"));
        assert!(prompt.contains("output a brainstorm via"));
    }

    #[test]
    fn brainstorm_candidate_prompt_forbids_code_changes() {
        let task = make_task("body");
        let prompt = build_brainstorm_candidate_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn brainstorm_candidate_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task(body);
        let prompt = build_brainstorm_candidate_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn brainstorm_consolidator_prompt_includes_request_body() {
        let task = make_task("capture a migration strategy");
        let prompt = build_brainstorm_consolidator_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn brainstorm_consolidator_prompt_states_role() {
        let task = make_task("body");
        let prompt = build_brainstorm_consolidator_prompt(&task);
        assert!(prompt.contains("synthesize the brainstorm candidates"));
        assert!(prompt.contains("output a brainstorm via"));
    }

    #[test]
    fn brainstorm_consolidator_prompt_forbids_code_changes() {
        let task = make_task("body");
        let prompt = build_brainstorm_consolidator_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn brainstorm_consolidator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task(body);
        let prompt = build_brainstorm_consolidator_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn brainstorm_evaluator_prompt_includes_request_body() {
        let task = make_task("capture a migration strategy");
        let prompt = build_brainstorm_evaluator_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn brainstorm_evaluator_prompt_states_role() {
        let task = make_task("body");
        let prompt = build_brainstorm_evaluator_prompt(&task);
        assert!(prompt.contains("score each brainstorm candidate"));
        assert!(prompt.contains("artifact_kind = 'review'"));
    }

    #[test]
    fn brainstorm_evaluator_prompt_forbids_code_changes() {
        let task = make_task("body");
        let prompt = build_brainstorm_evaluator_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn brainstorm_evaluator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task(body);
        let prompt = build_brainstorm_evaluator_prompt(&task);
        assert_ne!(prompt, body);
    }

    fn make_task_with_spec(body: &str, current_spec: Option<&str>) -> Task {
        let mut task = make_task(body);
        task.current_spec = current_spec.map(str::to_string);
        task
    }

    #[test]
    fn plan_single_prompt_includes_request_body() {
        let task = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_single_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_single_prompt_states_role() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_single_prompt(&task);
        assert!(prompt.contains("single implementation plan"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_single_prompt_forbids_code_changes() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_single_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_single_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_single_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_single_prompt_surfaces_missing_current_spec() {
        let task = make_task_with_spec("body", None);
        let prompt = build_plan_single_prompt(&task);
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_candidate_prompt_includes_request_body() {
        let task = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_candidate_prompt_states_role() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task);
        assert!(prompt.contains("one of the planning candidates"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_candidate_prompt_forbids_code_changes() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_candidate_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_candidate_prompt_surfaces_missing_current_spec() {
        let task = make_task_with_spec("body", None);
        let prompt = build_plan_candidate_prompt(&task);
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_consolidator_prompt_includes_request_body() {
        let task = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_consolidator_prompt_states_role() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task);
        assert!(prompt.contains("synthesize the plan candidates"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_consolidator_prompt_forbids_code_changes() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_consolidator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_consolidator_prompt_surfaces_missing_current_spec() {
        let task = make_task_with_spec("body", None);
        let prompt = build_plan_consolidator_prompt(&task);
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_evaluator_prompt_includes_request_body() {
        let task = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task);
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_evaluator_prompt_states_role() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task);
        assert!(prompt.contains("score each plan candidate"));
        assert!(prompt.contains("artifact_kind = 'review'"));
    }

    #[test]
    fn plan_evaluator_prompt_forbids_code_changes() {
        let task = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_evaluator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_evaluator_prompt_surfaces_missing_current_spec() {
        let task = make_task_with_spec("body", None);
        let prompt = build_plan_evaluator_prompt(&task);
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    fn make_task_with_plan(body: &str, current_plan: Option<&str>) -> Task {
        let mut task = make_task(body);
        task.current_plan = current_plan.map(str::to_string);
        task
    }

    #[test]
    fn implementation_single_prompt_includes_request_body() {
        let task = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task);
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_single_prompt_states_role() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task);
        assert!(prompt.contains("single implementation run"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_single_prompt_allows_code_changes() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task);
        assert!(prompt.contains("You may modify code"));
        assert!(prompt.contains("implement the approved plan"));
    }

    #[test]
    fn implementation_single_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_single_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_single_prompt_surfaces_missing_current_plan() {
        let task = make_task_with_plan("body", None);
        let prompt = build_implementation_single_prompt(&task);
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_candidate_prompt_includes_request_body() {
        let task = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task);
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_candidate_prompt_states_role() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task);
        assert!(prompt.contains("one of the implementation candidates"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_candidate_prompt_allows_code_changes() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task);
        assert!(prompt.contains("You may modify code"));
        assert!(prompt.contains("implement the approved plan"));
    }

    #[test]
    fn implementation_candidate_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_candidate_prompt_surfaces_missing_current_plan() {
        let task = make_task_with_plan("body", None);
        let prompt = build_implementation_candidate_prompt(&task);
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_consolidator_prompt_includes_request_body() {
        let task = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task);
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_consolidator_prompt_states_role() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task);
        assert!(prompt.contains("synthesize the implementation candidates"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_consolidator_prompt_allows_code_changes() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task);
        assert!(prompt.contains("implement the approved plan"));
        assert!(prompt.contains("integrating the strongest code changes"));
    }

    #[test]
    fn implementation_consolidator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_consolidator_prompt_surfaces_missing_current_plan() {
        let task = make_task_with_plan("body", None);
        let prompt = build_implementation_consolidator_prompt(&task);
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_evaluator_prompt_includes_request_body() {
        let task = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task);
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_evaluator_prompt_states_role() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task);
        assert!(prompt.contains("score each implementation candidate"));
        assert!(prompt.contains("artifact_kind = 'review'"));
    }

    #[test]
    fn implementation_evaluator_prompt_forbids_code_changes() {
        let task = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task);
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn implementation_evaluator_prompt_differs_from_raw_body() {
        let body = "body";
        let task = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task);
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_evaluator_prompt_surfaces_missing_current_plan() {
        let task = make_task_with_plan("body", None);
        let prompt = build_implementation_evaluator_prompt(&task);
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn stage_run_prompt_matrix_never_equals_raw_request_body() {
        let mut task = make_task("body");
        task.current_spec = Some("spec text".into());
        task.current_plan = Some("plan text".into());

        let cells = [
            (TaskStage::Brainstormed, RunRole::Single),
            (TaskStage::Brainstormed, RunRole::Candidate),
            (TaskStage::Brainstormed, RunRole::Consolidator),
            (TaskStage::Brainstormed, RunRole::Evaluator),
            (TaskStage::Planned, RunRole::Single),
            (TaskStage::Planned, RunRole::Candidate),
            (TaskStage::Planned, RunRole::Consolidator),
            (TaskStage::Planned, RunRole::Evaluator),
            (TaskStage::Implemented, RunRole::Single),
            (TaskStage::Implemented, RunRole::Candidate),
            (TaskStage::Implemented, RunRole::Consolidator),
            (TaskStage::Implemented, RunRole::Evaluator),
        ];

        for (stage, role) in cells {
            let prompt = build_stage_run_prompt(&task, stage, role);
            assert_ne!(
                prompt, task.request_body,
                "stage {:?} role {:?} regressed to the raw request body",
                stage, role,
            );
        }
    }
}
