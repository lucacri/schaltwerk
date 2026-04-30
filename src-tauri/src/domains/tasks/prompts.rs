use crate::domains::tasks::entity::{SlotKind, Task, TaskStage};

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

/// Phase 4 Wave F: callers pre-resolve `current_spec` and `current_plan`
/// via `Task::current_spec(&db)` / `current_plan(&db)` and pass them
/// in. The prompt builders are pure formatters — they don't need DB
/// access, just the artifact bodies. This keeps the prompt module
/// independent of the DB layer.
pub fn build_stage_run_prompt(
    task: &Task,
    stage: TaskStage,
    kind: SlotKind,
    current_spec: Option<&str>,
    current_plan: Option<&str>,
) -> String {
    debug_assert!(
        matches!(
            stage,
            TaskStage::Brainstormed | TaskStage::Planned | TaskStage::Implemented
        ),
        "build_stage_run_prompt should only be called for stage-run stages"
    );
    match stage {
        TaskStage::Brainstormed => match kind {
            SlotKind::Single => build_brainstorm_single_prompt(task),
            SlotKind::Candidate => build_brainstorm_candidate_prompt(task),
            SlotKind::Consolidator => build_brainstorm_consolidator_prompt(task),
            SlotKind::Evaluator => build_brainstorm_evaluator_prompt(task),
            other => unsupported_role_prompt(task, stage, other),
        },
        TaskStage::Planned => match kind {
            SlotKind::Single => build_plan_single_prompt(task, current_spec),
            SlotKind::Candidate => build_plan_candidate_prompt(task, current_spec),
            SlotKind::Consolidator => build_plan_consolidator_prompt(task, current_spec),
            SlotKind::Evaluator => build_plan_evaluator_prompt(task, current_spec),
            other => unsupported_role_prompt(task, stage, other),
        },
        TaskStage::Implemented => match kind {
            SlotKind::Single => build_implementation_single_prompt(task, current_plan),
            SlotKind::Candidate => build_implementation_candidate_prompt(task, current_plan),
            SlotKind::Consolidator => build_implementation_consolidator_prompt(task, current_plan),
            SlotKind::Evaluator => build_implementation_evaluator_prompt(task, current_plan),
            other => unsupported_role_prompt(task, stage, other),
        },
        other => unsupported_stage_prompt(task, other, kind),
    }
}

fn unsupported_role_prompt(task: &Task, stage: TaskStage, kind: SlotKind) -> String {
    format!(
        "Task prompt wiring bug for `{name}`: unsupported role `{role}` reached stage `{stage}`. Surface this to the user and do not guess.",
        name = task.name,
        role = kind.as_str(),
        stage = stage.as_str(),
    )
}

fn unsupported_stage_prompt(task: &Task, stage: TaskStage, kind: SlotKind) -> String {
    format!(
        "Task prompt wiring bug for `{name}`: build_stage_run_prompt was called for unsupported stage `{stage}` and role `{role}`. Surface this to the user and do not guess.",
        name = task.name,
        stage = stage.as_str(),
        role = kind.as_str(),
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

fn plan_prompt(
    task: &Task,
    current_spec: Option<&str>,
    role_text: &str,
    delivery_text: &str,
) -> String {
    let Some(current_spec) = current_spec else {
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

fn build_plan_single_prompt(task: &Task, current_spec: Option<&str>) -> String {
    plan_prompt(
        task,
        current_spec,
        "You are producing the single implementation plan for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'` so the winning plan can drive implementation.",
    )
}

fn build_plan_candidate_prompt(task: &Task, current_spec: Option<&str>) -> String {
    plan_prompt(
        task,
        current_spec,
        "You are one of the planning candidates for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'`, making the milestones, risks, and verification steps concrete.",
    )
}

fn build_plan_consolidator_prompt(task: &Task, current_spec: Option<&str>) -> String {
    plan_prompt(
        task,
        current_spec,
        "You synthesize the plan candidates into one consolidated implementation plan for this task.",
        "Then write the implementation plan via `LucodeTaskUpdateContent` with `artifact_kind = 'plan'`, preserving the strongest sequencing and verification details from the plans you review.",
    )
}

fn build_plan_evaluator_prompt(task: &Task, current_spec: Option<&str>) -> String {
    plan_prompt(
        task,
        current_spec,
        "You score each plan candidate against the current spec, constraints, and implementation readiness.",
        "Write the evaluation via `LucodeTaskUpdateContent` with `artifact_kind = 'review'`, and justify the strongest plan with specific gaps and trade-offs.",
    )
}

fn implementation_prompt(
    task: &Task,
    current_plan: Option<&str>,
    role_text: &str,
    delivery_text: &str,
    code_change_text: &str,
) -> String {
    let Some(current_plan) = current_plan else {
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

fn build_implementation_single_prompt(task: &Task, current_plan: Option<&str>) -> String {
    implementation_prompt(
        task,
        current_plan,
        "You are implementing the approved plan for this task as the single implementation run.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "You may modify code, run tests, and update supporting files that the plan requires. Then implement the approved plan in this worktree.",
    )
}

fn build_implementation_candidate_prompt(task: &Task, current_plan: Option<&str>) -> String {
    implementation_prompt(
        task,
        current_plan,
        "You are one of the implementation candidates for this task.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "You may modify code, run tests, and make the candidate distinct in approach where the plan leaves room. Then implement the approved plan in this worktree.",
    )
}

fn build_implementation_consolidator_prompt(task: &Task, current_plan: Option<&str>) -> String {
    implementation_prompt(
        task,
        current_plan,
        "You synthesize the implementation candidates into one consolidated implementation for this task.",
        "After coding, write a summary via `LucodeTaskUpdateContent` with `artifact_kind = 'summary'`, and open a PR or clearly surface the resulting code changes.",
        "Then implement the approved plan by integrating the strongest code changes from the implementation candidates in this worktree.",
    )
}

fn build_implementation_evaluator_prompt(task: &Task, current_plan: Option<&str>) -> String {
    implementation_prompt(
        task,
        current_plan,
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

    fn make_task_with_spec(body: &str, current_spec: Option<&str>) -> (Task, Option<String>) {
        (make_task(body), current_spec.map(str::to_string))
    }

    #[test]
    fn plan_single_prompt_includes_request_body() {
        let (task, current_spec) = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_single_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_single_prompt_states_role() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_single_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("single implementation plan"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_single_prompt_forbids_code_changes() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_single_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_single_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_spec) = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_single_prompt(&task, current_spec.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_single_prompt_surfaces_missing_current_spec() {
        let (task, current_spec) = make_task_with_spec("body", None);
        let prompt = build_plan_single_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_candidate_prompt_includes_request_body() {
        let (task, current_spec) = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_candidate_prompt_states_role() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("one of the planning candidates"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_candidate_prompt_forbids_code_changes() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_candidate_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_spec) = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_candidate_prompt(&task, current_spec.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_candidate_prompt_surfaces_missing_current_spec() {
        let (task, current_spec) = make_task_with_spec("body", None);
        let prompt = build_plan_candidate_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_consolidator_prompt_includes_request_body() {
        let (task, current_spec) = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_consolidator_prompt_states_role() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("synthesize the plan candidates"));
        assert!(prompt.contains("write the implementation plan via"));
    }

    #[test]
    fn plan_consolidator_prompt_forbids_code_changes() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_consolidator_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_spec) = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_consolidator_prompt(&task, current_spec.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_consolidator_prompt_surfaces_missing_current_spec() {
        let (task, current_spec) = make_task_with_spec("body", None);
        let prompt = build_plan_consolidator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn plan_evaluator_prompt_includes_request_body() {
        let (task, current_spec) = make_task_with_spec("capture a migration strategy", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("capture a migration strategy"));
    }

    #[test]
    fn plan_evaluator_prompt_states_role() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("score each plan candidate"));
        assert!(prompt.contains("artifact_kind = 'review'"));
    }

    #[test]
    fn plan_evaluator_prompt_forbids_code_changes() {
        let (task, current_spec) = make_task_with_spec("body", Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn plan_evaluator_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_spec) = make_task_with_spec(body, Some("spec text"));
        let prompt = build_plan_evaluator_prompt(&task, current_spec.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn plan_evaluator_prompt_surfaces_missing_current_spec() {
        let (task, current_spec) = make_task_with_spec("body", None);
        let prompt = build_plan_evaluator_prompt(&task, current_spec.as_deref());
        assert!(prompt.contains("current_spec is missing"));
        assert!(prompt.contains("do not guess"));
    }

    fn make_task_with_plan(body: &str, current_plan: Option<&str>) -> (Task, Option<String>) {
        (make_task(body), current_plan.map(str::to_string))
    }

    #[test]
    fn implementation_single_prompt_includes_request_body() {
        let (task, current_plan) = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_single_prompt_states_role() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("single implementation run"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_single_prompt_allows_code_changes() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_single_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("You may modify code"));
        assert!(prompt.contains("implement the approved plan"));
    }

    #[test]
    fn implementation_single_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_plan) = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_single_prompt(&task, current_plan.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_single_prompt_surfaces_missing_current_plan() {
        let (task, current_plan) = make_task_with_plan("body", None);
        let prompt = build_implementation_single_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_candidate_prompt_includes_request_body() {
        let (task, current_plan) = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_candidate_prompt_states_role() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("one of the implementation candidates"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_candidate_prompt_allows_code_changes() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("You may modify code"));
        assert!(prompt.contains("implement the approved plan"));
    }

    #[test]
    fn implementation_candidate_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_plan) = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_candidate_prompt(&task, current_plan.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_candidate_prompt_surfaces_missing_current_plan() {
        let (task, current_plan) = make_task_with_plan("body", None);
        let prompt = build_implementation_candidate_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_consolidator_prompt_includes_request_body() {
        let (task, current_plan) = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_consolidator_prompt_states_role() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("synthesize the implementation candidates"));
        assert!(prompt.contains("artifact_kind = 'summary'"));
    }

    #[test]
    fn implementation_consolidator_prompt_allows_code_changes() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("implement the approved plan"));
        assert!(prompt.contains("integrating the strongest code changes"));
    }

    #[test]
    fn implementation_consolidator_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_plan) = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_consolidator_prompt(&task, current_plan.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_consolidator_prompt_surfaces_missing_current_plan() {
        let (task, current_plan) = make_task_with_plan("body", None);
        let prompt = build_implementation_consolidator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn implementation_evaluator_prompt_includes_request_body() {
        let (task, current_plan) = make_task_with_plan("ship the feature", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("ship the feature"));
    }

    #[test]
    fn implementation_evaluator_prompt_states_role() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("score each implementation candidate"));
        assert!(prompt.contains("artifact_kind = 'review'"));
    }

    #[test]
    fn implementation_evaluator_prompt_forbids_code_changes() {
        let (task, current_plan) = make_task_with_plan("body", Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("Do NOT modify code"));
    }

    #[test]
    fn implementation_evaluator_prompt_differs_from_raw_body() {
        let body = "body";
        let (task, current_plan) = make_task_with_plan(body, Some("plan text"));
        let prompt = build_implementation_evaluator_prompt(&task, current_plan.as_deref());
        assert_ne!(prompt, body);
    }

    #[test]
    fn implementation_evaluator_prompt_surfaces_missing_current_plan() {
        let (task, current_plan) = make_task_with_plan("body", None);
        let prompt = build_implementation_evaluator_prompt(&task, current_plan.as_deref());
        assert!(prompt.contains("current_plan is missing"));
        assert!(prompt.contains("do not guess"));
    }

    #[test]
    fn stage_run_prompt_matrix_never_equals_raw_request_body() {
        let task = make_task("body");
        let current_spec = Some("spec text");
        let current_plan = Some("plan text");

        let cells = [
            (TaskStage::Brainstormed, SlotKind::Single),
            (TaskStage::Brainstormed, SlotKind::Candidate),
            (TaskStage::Brainstormed, SlotKind::Consolidator),
            (TaskStage::Brainstormed, SlotKind::Evaluator),
            (TaskStage::Planned, SlotKind::Single),
            (TaskStage::Planned, SlotKind::Candidate),
            (TaskStage::Planned, SlotKind::Consolidator),
            (TaskStage::Planned, SlotKind::Evaluator),
            (TaskStage::Implemented, SlotKind::Single),
            (TaskStage::Implemented, SlotKind::Candidate),
            (TaskStage::Implemented, SlotKind::Consolidator),
            (TaskStage::Implemented, SlotKind::Evaluator),
        ];

        for (stage, kind) in cells {
            let prompt = build_stage_run_prompt(&task, stage, kind, current_spec, current_plan);
            assert_ne!(
                prompt, task.request_body,
                "stage {:?} kind {:?} regressed to the raw request body",
                stage, kind,
            );
        }
    }
}
