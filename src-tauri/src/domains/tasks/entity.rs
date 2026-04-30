use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;

/// Task variant — duplicated in `domains/sessions/entity.rs` for the same reason
/// the v1 task-flow surface duplicated it (per baseline §2): the `arch_domain_isolation`
/// test forbids `tasks → sessions` imports, and `sessions::Session.task_id` predates the
/// `tasks` domain. A scout-rule consolidation lives in a later phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskVariant {
    Regular,
    Main,
}

impl TaskVariant {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskVariant::Regular => "regular",
            TaskVariant::Main => "main",
        }
    }
}

impl FromStr for TaskVariant {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "regular" => Ok(TaskVariant::Regular),
            "main" => Ok(TaskVariant::Main),
            other => Err(format!("Invalid task variant: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStage {
    Draft,
    Ready,
    Brainstormed,
    Planned,
    Implemented,
    Pushed,
    Done,
    Cancelled,
}

impl TaskStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStage::Draft => "draft",
            TaskStage::Ready => "ready",
            TaskStage::Brainstormed => "brainstormed",
            TaskStage::Planned => "planned",
            TaskStage::Implemented => "implemented",
            TaskStage::Pushed => "pushed",
            TaskStage::Done => "done",
            TaskStage::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStage::Done | TaskStage::Cancelled)
    }

    /// Canonical stage flow: Draft → Ready → Brainstormed → Planned →
    /// Implemented → Pushed → Done. Any non-terminal stage may jump to
    /// Cancelled. Ready → Draft is the only allowed backwards edge so a
    /// reviewer can send a task back for rework.
    pub fn can_advance_to(&self, next: TaskStage) -> bool {
        if *self == next {
            return false;
        }
        if self.is_terminal() {
            return false;
        }
        if next == TaskStage::Cancelled {
            return true;
        }
        matches!(
            (*self, next),
            (TaskStage::Draft, TaskStage::Ready)
                | (TaskStage::Ready, TaskStage::Brainstormed)
                | (TaskStage::Ready, TaskStage::Draft)
                | (TaskStage::Brainstormed, TaskStage::Planned)
                | (TaskStage::Planned, TaskStage::Implemented)
                | (TaskStage::Implemented, TaskStage::Pushed)
                | (TaskStage::Pushed, TaskStage::Done)
        )
    }
}

impl FromStr for TaskStage {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "draft" => Ok(TaskStage::Draft),
            "ready" => Ok(TaskStage::Ready),
            "clarified" => Ok(TaskStage::Ready),
            "brainstormed" => Ok(TaskStage::Brainstormed),
            "planned" => Ok(TaskStage::Planned),
            "implemented" => Ok(TaskStage::Implemented),
            "pushed" => Ok(TaskStage::Pushed),
            "done" => Ok(TaskStage::Done),
            "cancelled" => Ok(TaskStage::Cancelled),
            other => Err(format!("Invalid task stage: {other}")),
        }
    }
}

/// Run status, as observed by [`crate::domains::tasks::run_status::compute_run_status`].
///
/// **Never persisted.** v2 stores the raw facts (`task_runs.cancelled_at`,
/// `task_runs.confirmed_at`, `task_runs.failed_at`, plus session `exited_at` /
/// `exit_code` / `first_idle_at`) and derives this enum on demand. The variant set
/// drops the v1 `Queued` state — Phase 0/1 of the v2 rewrite eliminates it as a
/// distinct status because v2-native runs never sit in a "queued but not started"
/// limbo (a freshly-created run with no sessions yet derives to `Running`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskRunStatus {
    Running,
    AwaitingSelection,
    Completed,
    Failed,
    Cancelled,
}

impl TaskRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskRunStatus::Running => "running",
            TaskRunStatus::AwaitingSelection => "awaiting_selection",
            TaskRunStatus::Completed => "completed",
            TaskRunStatus::Failed => "failed",
            TaskRunStatus::Cancelled => "cancelled",
        }
    }
}

impl FromStr for TaskRunStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "running" => Ok(TaskRunStatus::Running),
            "awaiting_selection" => Ok(TaskRunStatus::AwaitingSelection),
            "completed" => Ok(TaskRunStatus::Completed),
            "failed" => Ok(TaskRunStatus::Failed),
            "cancelled" => Ok(TaskRunStatus::Cancelled),
            other => Err(format!("Invalid task run status: {other}")),
        }
    }
}

/// Runtime-only role tag for orchestration / prompt building.
///
/// **Phase 3 successor to `RunRole`.** Unlike v1's `RunRole`, this enum is:
/// - **Not serialized** (no `Serialize`/`Deserialize`/`FromStr`).
/// - **Not persisted** (the SQL columns `sessions.run_role` and
///   `sessions.task_role` are dropped in the v1→v2 migration).
/// - **Derived inline** at the orchestration call site from `PresetShape`
///   position (`.candidates → SlotKind::Candidate`, `.consolidator →
///   SlotKind::Consolidator`, etc.). The "role" is implicit in *which*
///   collection a slot belongs to; storing it as a separate column is
///   redundant.
///
/// Slot identity *across* persistence is via `Session.slot_key:
/// Option<String>` (e.g. `"claude-0"`, `"consolidator"`). The wire-side
/// label that the UI shows ("Candidate", "Consolidator", "Evaluator") is
/// computed from `slot_key` patterns by the frontend, not stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotKind {
    TaskHost,
    Single,
    Candidate,
    Consolidator,
    Evaluator,
    MainHost,
    Clarify,
}

impl SlotKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SlotKind::TaskHost => "task_host",
            SlotKind::Single => "single",
            SlotKind::Candidate => "candidate",
            SlotKind::Consolidator => "consolidator",
            SlotKind::Evaluator => "evaluator",
            SlotKind::MainHost => "main_host",
            SlotKind::Clarify => "clarify",
        }
    }
}

// Kept alive across Wave D.1+D.2 so the orchestration/prompts/presets
// sweep can rewrite each call site one at a time without breaking the
// build. Deleted entirely in D.3 once every caller has moved to
// `SlotKind`.
//
// Compile-time invariant: every variant matches a `SlotKind` variant 1:1
// (the migration doesn't add or remove role identities, only renames
// the type). The conversion `From<RunRole> for SlotKind` below is the
// scaffolding that lets D.2's parallel agents migrate one file at a
// time without flipping every call site simultaneously.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunRole {
    TaskHost,
    Single,
    Candidate,
    Consolidator,
    Evaluator,
    MainHost,
    Clarify,
}

impl RunRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunRole::TaskHost => "task_host",
            RunRole::Single => "single",
            RunRole::Candidate => "candidate",
            RunRole::Consolidator => "consolidator",
            RunRole::Evaluator => "evaluator",
            RunRole::MainHost => "main_host",
            RunRole::Clarify => "clarify",
        }
    }
}

impl FromStr for RunRole {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "task_host" => Ok(RunRole::TaskHost),
            "single" => Ok(RunRole::Single),
            "candidate" => Ok(RunRole::Candidate),
            "consolidator" => Ok(RunRole::Consolidator),
            "evaluator" => Ok(RunRole::Evaluator),
            "main_host" => Ok(RunRole::MainHost),
            "clarify" => Ok(RunRole::Clarify),
            other => Err(format!("Invalid run role: {other}")),
        }
    }
}

impl From<RunRole> for SlotKind {
    fn from(role: RunRole) -> Self {
        match role {
            RunRole::TaskHost => SlotKind::TaskHost,
            RunRole::Single => SlotKind::Single,
            RunRole::Candidate => SlotKind::Candidate,
            RunRole::Consolidator => SlotKind::Consolidator,
            RunRole::Evaluator => SlotKind::Evaluator,
            RunRole::MainHost => SlotKind::MainHost,
            RunRole::Clarify => SlotKind::Clarify,
        }
    }
}

impl From<SlotKind> for RunRole {
    fn from(kind: SlotKind) -> Self {
        match kind {
            SlotKind::TaskHost => RunRole::TaskHost,
            SlotKind::Single => RunRole::Single,
            SlotKind::Candidate => RunRole::Candidate,
            SlotKind::Consolidator => RunRole::Consolidator,
            SlotKind::Evaluator => RunRole::Evaluator,
            SlotKind::MainHost => RunRole::MainHost,
            SlotKind::Clarify => RunRole::Clarify,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskArtifactKind {
    Request,
    Spec,
    Plan,
    Review,
    Decision,
    Summary,
    Attachment,
    Link,
}

impl TaskArtifactKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskArtifactKind::Request => "request",
            TaskArtifactKind::Spec => "spec",
            TaskArtifactKind::Plan => "plan",
            TaskArtifactKind::Review => "review",
            TaskArtifactKind::Decision => "decision",
            TaskArtifactKind::Summary => "summary",
            TaskArtifactKind::Attachment => "attachment",
            TaskArtifactKind::Link => "link",
        }
    }
}

impl FromStr for TaskArtifactKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "request" => Ok(TaskArtifactKind::Request),
            "spec" => Ok(TaskArtifactKind::Spec),
            "plan" => Ok(TaskArtifactKind::Plan),
            "review" => Ok(TaskArtifactKind::Review),
            "decision" => Ok(TaskArtifactKind::Decision),
            "summary" => Ok(TaskArtifactKind::Summary),
            "attachment" => Ok(TaskArtifactKind::Attachment),
            "link" => Ok(TaskArtifactKind::Link),
            other => Err(format!("Invalid task artifact kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub repository_path: PathBuf,
    pub repository_name: String,
    pub variant: TaskVariant,
    pub stage: TaskStage,
    pub request_body: String,
    pub current_spec: Option<String>,
    pub current_plan: Option<String>,
    pub current_summary: Option<String>,
    pub source_kind: Option<String>,
    pub source_url: Option<String>,
    pub task_host_session_id: Option<String>,
    pub task_branch: Option<String>,
    pub base_branch: Option<String>,
    pub issue_number: Option<i64>,
    pub issue_url: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    pub pr_state: Option<String>,
    pub failure_flag: bool,
    pub epic_id: Option<String>,
    pub attention_required: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Phase 3: cancellation is no longer a stage transition. When a task is
    /// cancelled, `stage` stays at whatever it was and `cancelled_at` is
    /// stamped with the cancel time. `is_cancelled()` collapses the check.
    /// `None` for non-cancelled tasks, including reopened ones.
    #[serde(default)]
    pub cancelled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub task_runs: Vec<TaskRun>,
}

impl Task {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled_at.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStageConfig {
    pub task_id: String,
    pub stage: TaskStage,
    pub preset_id: Option<String>,
    pub auto_chain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectWorkflowDefault {
    pub repository_path: String,
    pub stage: TaskStage,
    pub preset_id: Option<String>,
    pub auto_chain: bool,
}

/// A task-run row.
///
/// v2 shape: no persisted `status` field. Status is derived by
/// [`crate::domains::tasks::run_status::compute_run_status`] from
/// `(cancelled_at, confirmed_at, failed_at)` plus the bound sessions' fact columns.
/// The `failed_at` field is the legacy carrier populated only by the v1→v2 user-DB
/// migration; v2-native code never sets it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub id: String,
    pub task_id: String,
    pub stage: TaskStage,
    pub preset_id: Option<String>,
    pub base_branch: Option<String>,
    pub target_branch: Option<String>,
    pub selected_session_id: Option<String>,
    pub selected_artifact_id: Option<String>,
    pub selection_mode: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub failed_at: Option<DateTime<Utc>>,
    pub failure_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskArtifact {
    pub id: String,
    pub task_id: String,
    pub artifact_kind: TaskArtifactKind,
    pub title: Option<String>,
    pub content: Option<String>,
    pub url: Option<String>,
    pub metadata_json: Option<String>,
    pub is_current: bool,
    pub produced_by_run_id: Option<String>,
    pub produced_by_session_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskArtifactVersion {
    pub history_id: Option<i64>,
    pub task_id: String,
    pub artifact_kind: TaskArtifactKind,
    pub content: Option<String>,
    pub produced_by_run_id: Option<String>,
    pub produced_by_session_id: Option<String>,
    pub is_current: bool,
    pub superseded_at: Option<i64>,
}

#[cfg(test)]
mod stage_transition_tests {
    use super::TaskStage;

    const ALL_STAGES: [TaskStage; 8] = [
        TaskStage::Draft,
        TaskStage::Ready,
        TaskStage::Brainstormed,
        TaskStage::Planned,
        TaskStage::Implemented,
        TaskStage::Pushed,
        TaskStage::Done,
        TaskStage::Cancelled,
    ];

    #[test]
    fn canonical_flow_is_allowed_step_by_step() {
        let flow = [
            (TaskStage::Draft, TaskStage::Ready),
            (TaskStage::Ready, TaskStage::Brainstormed),
            (TaskStage::Brainstormed, TaskStage::Planned),
            (TaskStage::Planned, TaskStage::Implemented),
            (TaskStage::Implemented, TaskStage::Pushed),
            (TaskStage::Pushed, TaskStage::Done),
        ];
        for (from, to) in flow {
            assert!(
                from.can_advance_to(to),
                "canonical {from:?} -> {to:?} must be allowed",
            );
        }
    }

    #[test]
    fn any_non_terminal_stage_can_jump_to_cancelled() {
        for stage in [
            TaskStage::Draft,
            TaskStage::Ready,
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
            TaskStage::Pushed,
        ] {
            assert!(
                stage.can_advance_to(TaskStage::Cancelled),
                "{stage:?} -> Cancelled must be allowed",
            );
        }
    }

    #[test]
    fn terminal_stages_cannot_transition_anywhere() {
        for terminal in [TaskStage::Done, TaskStage::Cancelled] {
            for next in ALL_STAGES {
                assert!(
                    !terminal.can_advance_to(next),
                    "{terminal:?} -> {next:?} must be forbidden",
                );
            }
        }
    }

    #[test]
    fn ready_to_draft_is_the_only_allowed_backwards_edge() {
        assert!(TaskStage::Ready.can_advance_to(TaskStage::Draft));

        let backwards = [
            (TaskStage::Brainstormed, TaskStage::Ready),
            (TaskStage::Brainstormed, TaskStage::Draft),
            (TaskStage::Planned, TaskStage::Brainstormed),
            (TaskStage::Implemented, TaskStage::Planned),
            (TaskStage::Pushed, TaskStage::Implemented),
        ];
        for (from, to) in backwards {
            assert!(
                !from.can_advance_to(to),
                "backwards edge {from:?} -> {to:?} must be forbidden",
            );
        }
    }
}

#[cfg(test)]
mod serde_round_trip_tests {
    use super::{RunRole, TaskArtifactKind, TaskRunStatus, TaskStage};
    use std::str::FromStr;

    fn round_trip<T>(value: T, wire: &str)
    where
        T: serde::Serialize + serde::de::DeserializeOwned + std::fmt::Debug + PartialEq + Clone,
    {
        let serialized = serde_json::to_string(&value).expect("serialize");
        assert_eq!(serialized, format!("\"{wire}\""), "wire format must match");
        let deserialized: T = serde_json::from_str(&serialized).expect("deserialize");
        assert_eq!(deserialized, value, "round-trip must preserve value");
    }

    #[test]
    fn task_run_status_round_trip_covers_every_variant() {
        let cases = [
            (TaskRunStatus::Running, "running"),
            (TaskRunStatus::AwaitingSelection, "awaiting_selection"),
            (TaskRunStatus::Completed, "completed"),
            (TaskRunStatus::Failed, "failed"),
            (TaskRunStatus::Cancelled, "cancelled"),
        ];
        for (status, wire) in cases {
            round_trip(status, wire);
            assert_eq!(TaskRunStatus::from_str(wire).unwrap(), status);
            assert_eq!(status.as_str(), wire);
        }
    }

    #[test]
    fn task_run_status_does_not_accept_queued() {
        // v2 drops Queued; deserializing legacy 'queued' must fail rather than silently
        // succeed, so that any v1 wire payload reaching v2 code gets caught at the boundary.
        assert!(serde_json::from_str::<TaskRunStatus>("\"queued\"").is_err());
        assert!(TaskRunStatus::from_str("queued").is_err());
    }

    #[test]
    fn task_stage_round_trip_covers_every_variant() {
        let cases = [
            (TaskStage::Draft, "draft"),
            (TaskStage::Ready, "ready"),
            (TaskStage::Brainstormed, "brainstormed"),
            (TaskStage::Planned, "planned"),
            (TaskStage::Implemented, "implemented"),
            (TaskStage::Pushed, "pushed"),
            (TaskStage::Done, "done"),
            (TaskStage::Cancelled, "cancelled"),
        ];
        for (stage, wire) in cases {
            round_trip(stage, wire);
            assert_eq!(TaskStage::from_str(wire).unwrap(), stage);
            assert_eq!(stage.as_str(), wire);
        }
    }

    #[test]
    fn task_stage_accepts_legacy_clarified_alias_on_parse() {
        // The legacy 'clarified' wire value is mapped to Ready by FromStr only;
        // serializing Ready always emits 'ready'. Pin both halves.
        assert_eq!(TaskStage::from_str("clarified").unwrap(), TaskStage::Ready);
        let serialized = serde_json::to_string(&TaskStage::Ready).unwrap();
        assert_eq!(serialized, "\"ready\"");
    }

    #[test]
    fn run_role_round_trip_covers_every_variant() {
        let cases = [
            (RunRole::TaskHost, "task_host"),
            (RunRole::Single, "single"),
            (RunRole::Candidate, "candidate"),
            (RunRole::Consolidator, "consolidator"),
            (RunRole::Evaluator, "evaluator"),
            (RunRole::MainHost, "main_host"),
            (RunRole::Clarify, "clarify"),
        ];
        for (role, wire) in cases {
            round_trip(role, wire);
            assert_eq!(RunRole::from_str(wire).unwrap(), role);
            assert_eq!(role.as_str(), wire);
        }
    }

    #[test]
    fn task_artifact_kind_round_trip_covers_every_variant() {
        let cases = [
            (TaskArtifactKind::Request, "request"),
            (TaskArtifactKind::Spec, "spec"),
            (TaskArtifactKind::Plan, "plan"),
            (TaskArtifactKind::Review, "review"),
            (TaskArtifactKind::Decision, "decision"),
            (TaskArtifactKind::Summary, "summary"),
            (TaskArtifactKind::Attachment, "attachment"),
            (TaskArtifactKind::Link, "link"),
        ];
        for (kind, wire) in cases {
            round_trip(kind, wire);
            assert_eq!(TaskArtifactKind::from_str(wire).unwrap(), kind);
            assert_eq!(kind.as_str(), wire);
        }
    }
}
