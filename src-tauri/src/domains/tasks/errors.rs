//! Phase 4 Wave E.1: canonical error type for the task command surface.
//!
//! All `#[tauri::command]` functions in `commands/tasks.rs` return
//! `Result<_, TaskFlowError>`. The frontend's `getErrorMessage` gets one
//! exhaustive switch via the tagged-enum `{type, data}` shape that
//! `SchaltError` already established.
//!
//! `SchaltError` continues to exist for non-task surfaces; the three
//! task variants previously living there (TaskNotFound, TaskCancelFailed,
//! StageAdvanceFailedAfterMerge) are moved here in Wave E.4.

use crate::domains::tasks::entity::{TaskArtifactKind, TaskStage};
use crate::errors::SchaltError;
use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum TaskFlowError {
    /// Task lookup by id failed. Frontend may render a 404 placeholder.
    TaskNotFound {
        task_id: String,
    },
    /// Cascade cancel encountered one or more session-level failures.
    /// `failures` is the per-session error list.
    TaskCancelFailed {
        task_id: String,
        failures: Vec<String>,
    },
    /// `confirm_stage` succeeded the merge but failed to advance the
    /// task stage. Critical recovery surface — user must know the merge
    /// already happened so they don't re-merge.
    StageAdvanceFailedAfterMerge {
        task_id: String,
        message: String,
    },
    /// Stage transition not allowed by `TaskStage::can_advance_to`.
    /// Frontend can disable the offending stage button.
    InvalidStageTransition {
        task_id: String,
        from_stage: TaskStage,
        to_stage: TaskStage,
    },
    /// Operation requires the task to be active; this task is cancelled.
    /// Carries `cancelled_at` so the UI can render "cancelled X ago"
    /// without a second round-trip.
    TaskCancelled {
        task_id: String,
        cancelled_at: chrono::DateTime<chrono::Utc>,
    },
    /// Stage-config / preset / orchestration setup failed.
    OrchestrationSetupFailed {
        task_id: String,
        operation: String,
        message: String,
    },
    /// Required artifact (typically a Spec or Plan) is missing for the
    /// requested operation.
    MissingArtifact {
        task_id: String,
        kind: TaskArtifactKind,
    },
    /// User-visible validation error (e.g. malformed payload).
    InvalidInput {
        field: String,
        message: String,
    },
    /// Bridge into the broader `SchaltError` surface for non-task
    /// operations the task command happens to perform (e.g. a session
    /// cancel triggered by a task cancel cascade).
    Schalt(SchaltError),
    /// Free-form database error. Use sparingly — prefer the structured
    /// variants above for things the UI is expected to act on.
    DatabaseError {
        message: String,
    },
}

impl fmt::Display for TaskFlowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TaskNotFound { task_id } => {
                write!(f, "Task '{task_id}' not found")
            }
            Self::TaskCancelFailed { task_id, failures } => {
                write!(
                    f,
                    "Failed to cancel task '{task_id}': {} session error(s): {}",
                    failures.len(),
                    failures.join("; ")
                )
            }
            Self::StageAdvanceFailedAfterMerge { task_id, message } => {
                write!(
                    f,
                    "Task '{task_id}' merged but failed to advance stage: {message}"
                )
            }
            Self::InvalidStageTransition {
                task_id,
                from_stage,
                to_stage,
            } => {
                write!(
                    f,
                    "Task '{task_id}' cannot advance from {from_stage:?} to {to_stage:?}"
                )
            }
            Self::TaskCancelled {
                task_id,
                cancelled_at,
            } => {
                write!(
                    f,
                    "Task '{task_id}' was cancelled at {} and cannot be modified",
                    cancelled_at.to_rfc3339()
                )
            }
            Self::OrchestrationSetupFailed {
                task_id,
                operation,
                message,
            } => {
                write!(
                    f,
                    "Orchestration setup '{operation}' failed for task '{task_id}': {message}"
                )
            }
            Self::MissingArtifact { task_id, kind } => {
                write!(
                    f,
                    "Task '{task_id}' has no current artifact of kind {kind:?}"
                )
            }
            Self::InvalidInput { field, message } => {
                write!(f, "Invalid input for field '{field}': {message}")
            }
            Self::Schalt(e) => write!(f, "{e}"),
            Self::DatabaseError { message } => write!(f, "Database error: {message}"),
        }
    }
}

impl std::error::Error for TaskFlowError {}

impl From<SchaltError> for TaskFlowError {
    fn from(e: SchaltError) -> Self {
        // Phase 4 Wave E.4 will delete the three task variants from
        // SchaltError; until then this match routes the legacy variants
        // to their new home. After E.4 the routed arms become
        // unreachable (the variants no longer exist) and the match
        // collapses to `other => Self::Schalt(other)`.
        match e {
            SchaltError::TaskNotFound { task_id } => Self::TaskNotFound { task_id },
            SchaltError::TaskCancelFailed { task_id, failures } => {
                Self::TaskCancelFailed { task_id, failures }
            }
            SchaltError::StageAdvanceFailedAfterMerge { task_id, message } => {
                Self::StageAdvanceFailedAfterMerge { task_id, message }
            }
            other => Self::Schalt(other),
        }
    }
}

impl From<rusqlite::Error> for TaskFlowError {
    fn from(e: rusqlite::Error) -> Self {
        Self::DatabaseError {
            message: e.to_string(),
        }
    }
}

impl From<anyhow::Error> for TaskFlowError {
    fn from(e: anyhow::Error) -> Self {
        // anyhow errors at the task surface are the unstructured fallback;
        // wrap as DatabaseError so the frontend can show the message.
        Self::DatabaseError {
            message: e.to_string(),
        }
    }
}

impl From<TaskFlowError> for String {
    fn from(e: TaskFlowError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Phase 4 Wave E.1 structural pin: `TaskFlowError` is `Serialize`.
    /// If a future variant breaks serializability, the trait bound below
    /// fails to satisfy.
    #[test]
    fn task_flow_error_is_serializable() {
        fn assert_serializable<T: Serialize>(_: &T) {}
        let e = TaskFlowError::TaskNotFound {
            task_id: "x".into(),
        };
        assert_serializable(&e);
    }

    /// Phase 4 Wave E.1 structural pin: exhaustive match without
    /// wildcard. Adding a variant requires updating every consumer (the
    /// match below included). Removing a variant breaks the literal
    /// matched in the test.
    #[test]
    fn task_flow_error_match_is_exhaustive_without_wildcard() {
        let e = TaskFlowError::TaskNotFound {
            task_id: "x".into(),
        };
        let _label: &'static str = match e {
            TaskFlowError::TaskNotFound { .. } => "not_found",
            TaskFlowError::TaskCancelFailed { .. } => "cancel_failed",
            TaskFlowError::StageAdvanceFailedAfterMerge { .. } => "stage_advance_failed",
            TaskFlowError::InvalidStageTransition { .. } => "invalid_transition",
            TaskFlowError::TaskCancelled { .. } => "task_cancelled",
            TaskFlowError::OrchestrationSetupFailed { .. } => "orchestration_setup_failed",
            TaskFlowError::MissingArtifact { .. } => "missing_artifact",
            TaskFlowError::InvalidInput { .. } => "invalid_input",
            TaskFlowError::Schalt(_) => "schalt",
            TaskFlowError::DatabaseError { .. } => "database_error",
        };
    }

    /// Phase 4 Wave E.1 structural pin: serialization shape is the
    /// tagged-enum `{type, data}` discriminator the frontend already
    /// uses for SchaltError. A regression to `#[serde(untagged)]` or
    /// `#[serde(rename_all = "...")]` on the enum breaks the
    /// frontend's discriminator and this assertion.
    #[test]
    fn task_flow_error_serializes_with_tagged_enum_format() {
        let e = TaskFlowError::TaskNotFound {
            task_id: "abc".into(),
        };
        let json = serde_json::to_value(&e).expect("serialize");
        assert_eq!(json["type"], "TaskNotFound");
        assert_eq!(json["data"]["task_id"], "abc");
    }

    #[test]
    fn from_schalt_error_routes_task_variants_through() {
        let task_not_found = SchaltError::TaskNotFound {
            task_id: "t".into(),
        };
        let routed: TaskFlowError = task_not_found.into();
        assert!(matches!(
            routed,
            TaskFlowError::TaskNotFound { ref task_id } if task_id == "t"
        ));

        let cancel_failed = SchaltError::TaskCancelFailed {
            task_id: "t".into(),
            failures: vec!["err".into()],
        };
        let routed: TaskFlowError = cancel_failed.into();
        assert!(matches!(routed, TaskFlowError::TaskCancelFailed { .. }));
    }

    #[test]
    fn from_schalt_error_wraps_non_task_variants() {
        let session_not_found = SchaltError::SessionNotFound {
            session_id: "s".into(),
        };
        let routed: TaskFlowError = session_not_found.into();
        assert!(matches!(routed, TaskFlowError::Schalt(_)));
    }
}
