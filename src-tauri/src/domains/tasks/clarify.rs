use crate::domains::tasks::entity::Task;

pub fn build_task_clarification_prompt(task: &Task) -> String {
    format!(
        "You are clarifying the spec for task `{name}`.\n\
         \n\
         Current request body:\n\
         ---\n\
         {body}\n\
         ---\n\
         \n\
         Discuss with the user, then commit any spec edits by calling \
         `LucodeTaskUpdateContent` with `artifact_kind = 'spec'` and the updated content. \
         Do NOT modify code or open a PR — your only output is the spec content.",
        name = task.name,
        body = task.request_body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::{RunRole, Task, TaskStage, TaskVariant};
    use chrono::Utc;
    use std::path::PathBuf;
    use std::str::FromStr;

    fn make_task(body: &str) -> Task {
        let now = Utc::now();
        Task {
            id: "task-1".into(),
            name: "alpha".into(),
            display_name: None,
            repository_path: PathBuf::from("/repo"),
            repository_name: "repo".into(),
            variant: TaskVariant::Regular,
            stage: TaskStage::Draft,
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
    fn clarification_prompt_includes_request_body_and_update_instructions() {
        let task = make_task("write a robust task lifecycle plan");
        let prompt = build_task_clarification_prompt(&task);
        assert!(prompt.contains("write a robust task lifecycle plan"));
        assert!(prompt.contains("LucodeTaskUpdateContent"));
        assert!(prompt.contains("artifact_kind"));
        assert!(prompt.contains("'spec'"));
    }

    #[test]
    fn clarification_prompt_names_the_task() {
        let task = make_task("body text");
        let prompt = build_task_clarification_prompt(&task);
        assert!(
            prompt.contains("alpha"),
            "prompt should reference task name; got: {prompt}",
        );
    }

    #[test]
    fn clarification_prompt_forbids_code_changes() {
        let body = "Add client contact information to the dashboard";
        let task = make_task(body);
        let prompt = build_task_clarification_prompt(&task);
        assert_ne!(
            prompt, body,
            "clarify prompt must wrap, not equal, the raw request body — \
             passing the raw body lets the agent treat the task as work to implement",
        );
        assert!(
            prompt.contains("Do NOT modify code"),
            "clarify prompt must explicitly forbid code changes; got: {prompt}",
        );
    }

    #[test]
    fn run_role_round_trip_includes_clarify() {
        assert_eq!(RunRole::from_str("clarify").unwrap(), RunRole::Clarify);
        assert_eq!(RunRole::Clarify.as_str(), "clarify");
    }
}
