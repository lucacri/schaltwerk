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
    // Phase 3 Wave E: `Cancelled` is no longer a TaskStage variant.
    // Cancellation is recorded as `task.cancelled_at = now()` —
    // orthogonal to `stage`, so a cancelled task retains whatever stage
    // it had at cancel time and can be reopened by clearing the
    // timestamp without an awkward "advance from cancelled to ready"
    // backwards transition.
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
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStage::Done)
    }

    /// Canonical stage flow: Draft → Ready → Brainstormed → Planned →
    /// Implemented → Pushed → Done. Ready → Draft is the only allowed
    /// backwards edge so a reviewer can send a task back for rework.
    /// Cancellation is no longer a stage transition (Phase 3); it lives
    /// as `task.cancelled_at: Option<Timestamp>` — orthogonal to stage.
    pub fn can_advance_to(&self, next: TaskStage) -> bool {
        if *self == next {
            return false;
        }
        if self.is_terminal() {
            return false;
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
            // Phase 3 Wave E: legacy "cancelled" stage maps to Draft
            // here. The migration in v1_to_v2_task_cancelled.rs rewrites
            // tasks.stage='cancelled' rows to 'draft' before this
            // FromStr impl is exercised in production. The leniency
            // here is a defensive fallback for any in-flight wire-format
            // payload that crosses the upgrade boundary.
            "cancelled" => Ok(TaskStage::Draft),
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
    // Phase 4 Wave F: legacy `current_spec` / `current_plan` /
    // `current_summary` denormalized columns deleted. The values are
    // derived at read time from the `task_artifacts` table via the
    // `Task::current_spec(&db)` / `current_plan(&db)` / `current_summary(&db)`
    // methods (see impl block below). The artifact's `is_current = true`
    // flag is the canonical source of truth.
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

    /// Phase 4 Wave F: derived getter for the current Spec artifact's
    /// content. Returns the body of the `task_artifacts` row with
    /// `is_current = true` and `artifact_kind = 'spec'`, or None if no
    /// current Spec exists.
    pub fn current_spec(
        &self,
        db: &crate::infrastructure::database::Database,
    ) -> anyhow::Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Spec)
    }

    /// Phase 4 Wave F: derived getter for the current Plan artifact body.
    pub fn current_plan(
        &self,
        db: &crate::infrastructure::database::Database,
    ) -> anyhow::Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Plan)
    }

    /// Phase 4 Wave F: derived getter for the current Summary artifact body.
    pub fn current_summary(
        &self,
        db: &crate::infrastructure::database::Database,
    ) -> anyhow::Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Summary)
    }
}

fn derive_current_artifact_body(
    db: &crate::infrastructure::database::Database,
    task_id: &str,
    kind: TaskArtifactKind,
) -> anyhow::Result<Option<String>> {
    use crate::infrastructure::database::TaskArtifactMethods;
    Ok(db
        .get_current_task_artifact(task_id, kind)?
        .and_then(|a| a.content))
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

    const ALL_STAGES: [TaskStage; 7] = [
        TaskStage::Draft,
        TaskStage::Ready,
        TaskStage::Brainstormed,
        TaskStage::Planned,
        TaskStage::Implemented,
        TaskStage::Pushed,
        TaskStage::Done,
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

    /// Phase 3 Wave E: cancellation is no longer a stage transition.
    /// Compile-time pin via exhaustive match — if `Cancelled` ever
    /// returns to the `TaskStage` enum, the wildcard-free match below
    /// becomes non-exhaustive and rustc rejects this test.
    #[test]
    fn task_stage_has_seven_variants_not_eight() {
        let stage = TaskStage::Done;
        let _label: &str = match stage {
            TaskStage::Draft => "draft",
            TaskStage::Ready => "ready",
            TaskStage::Brainstormed => "brainstormed",
            TaskStage::Planned => "planned",
            TaskStage::Implemented => "implemented",
            TaskStage::Pushed => "pushed",
            TaskStage::Done => "done",
        };
    }

    #[test]
    fn done_is_the_only_terminal_stage() {
        for stage in ALL_STAGES {
            assert_eq!(
                stage.is_terminal(),
                matches!(stage, TaskStage::Done),
                "{stage:?} is_terminal must be true iff stage == Done",
            );
        }
    }

    #[test]
    fn done_cannot_transition_anywhere() {
        for next in ALL_STAGES {
            assert!(
                !TaskStage::Done.can_advance_to(next),
                "Done -> {next:?} must be forbidden (Done is terminal)",
            );
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
    use super::{SlotKind, TaskArtifactKind, TaskRunStatus, TaskStage};
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
        ];
        for (stage, wire) in cases {
            round_trip(stage, wire);
            assert_eq!(TaskStage::from_str(wire).unwrap(), stage);
            assert_eq!(stage.as_str(), wire);
        }
    }

    /// Phase 3 Wave E: legacy `"cancelled"` strings (in-flight wire
    /// payloads, archived rows) map to `TaskStage::Draft`. Migration
    /// rewrites stored stages; this FromStr leniency catches any
    /// payload that crosses the upgrade boundary in flight. Cancelled
    /// state is now in `task.cancelled_at`, not `stage`.
    #[test]
    fn legacy_cancelled_stage_string_maps_to_draft_on_parse() {
        assert_eq!(TaskStage::from_str("cancelled").unwrap(), TaskStage::Draft);
        // Serializing Draft always emits "draft", never "cancelled".
        let serialized = serde_json::to_string(&TaskStage::Draft).unwrap();
        assert_eq!(serialized, "\"draft\"");
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
    fn slot_kind_as_str_covers_every_variant() {
        let cases = [
            (SlotKind::TaskHost, "task_host"),
            (SlotKind::Single, "single"),
            (SlotKind::Candidate, "candidate"),
            (SlotKind::Consolidator, "consolidator"),
            (SlotKind::Evaluator, "evaluator"),
            (SlotKind::MainHost, "main_host"),
            (SlotKind::Clarify, "clarify"),
        ];
        for (kind, wire) in cases {
            assert_eq!(kind.as_str(), wire);
        }
        // Phase 3 invariant: SlotKind has no FromStr/Serde — wire-side
        // role identifiers flow through as plain strings (set by
        // SlotKind::as_str at the orchestration call site, read back
        // as String by every consumer). The deleted `round_trip` half
        // of this test would have required Deserialize, which the type
        // deliberately doesn't have.
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

    /// **Phase 4 Wave F structural pin.** `Task::current_spec` /
    /// `current_plan` / `current_summary` exist with the expected
    /// signature `fn(&Task, &Database) -> Result<Option<String>>`. If a
    /// future refactor changes any of these, the fn-pointer coercions
    /// fail to compile.
    #[test]
    fn task_current_artifact_methods_are_pinned() {
        use crate::infrastructure::database::Database;
        fn assert_signature(_: fn(&super::Task, &Database) -> anyhow::Result<Option<String>>) {}
        assert_signature(super::Task::current_spec);
        assert_signature(super::Task::current_plan);
        assert_signature(super::Task::current_summary);
    }
}

#[cfg(test)]
mod current_artifact_round_trip_tests {
    use super::*;
    use crate::domains::tasks::service::{CreateTaskInput, TaskService};
    use crate::infrastructure::database::{Database, TaskArtifactMethods};
    use chrono::Utc;
    use std::path::PathBuf;
    use uuid::Uuid;

    /// **Phase 4 Wave F load-bearing DB round-trip test.** Per
    /// `feedback_compile_pins_dont_catch_wiring.md`: compile-time pins
    /// prove the field/method exists; only a DB round-trip proves the
    /// SELECT/INSERT path actually serves it. This test exercises
    /// `Task::current_spec(&db)` against artifacts inserted through
    /// the production write path (`mark_task_artifact_current`) and
    /// reads them back through the production hydrator
    /// (`get_current_task_artifact`).
    #[test]
    fn current_spec_round_trips_through_write_and_read_paths() {
        let db = Database::new_in_memory().expect("in-memory db");
        crate::infrastructure::database::initialize_schema(&db).expect("init schema");

        let svc = TaskService::new(&db);
        let repo = PathBuf::from("/tmp/repo");
        let task = svc
            .create_task(CreateTaskInput {
                name: "rt-spec",
                display_name: None,
                repository_path: &repo,
                repository_name: "repo",
                request_body: "body",
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: None,
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("create task");

        // Initially no current Spec → derived getter returns None.
        let initial = task.current_spec(&db).expect("call current_spec");
        assert!(initial.is_none());

        // Insert a Spec artifact via the production write path.
        let artifact = TaskArtifact {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            artifact_kind: TaskArtifactKind::Spec,
            title: None,
            content: Some("the spec".to_string()),
            url: None,
            metadata_json: None,
            is_current: false,
            produced_by_run_id: None,
            produced_by_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        db.create_task_artifact(&artifact).expect("create artifact");
        db.mark_task_artifact_current(&task.id, TaskArtifactKind::Spec, &artifact.id)
            .expect("mark current");

        // Derived getter now returns the artifact body.
        let after = task.current_spec(&db).expect("call current_spec");
        assert_eq!(after.as_deref(), Some("the spec"));

        // Replace the artifact: insert a new one and mark it current.
        let artifact2 = TaskArtifact {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            artifact_kind: TaskArtifactKind::Spec,
            title: None,
            content: Some("revised spec".to_string()),
            url: None,
            metadata_json: None,
            is_current: false,
            produced_by_run_id: None,
            produced_by_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        db.create_task_artifact(&artifact2).expect("create v2");
        db.mark_task_artifact_current(&task.id, TaskArtifactKind::Spec, &artifact2.id)
            .expect("mark v2 current");

        // Derived getter returns the new content. If the
        // `is_current = true` flag isn't being flipped correctly (or
        // if the SELECT doesn't filter by it), the assertion fails.
        let revised = task.current_spec(&db).expect("call current_spec");
        assert_eq!(revised.as_deref(), Some("revised spec"));
    }

    /// Same DB round-trip pattern for current_plan, ensuring the kind
    /// dispatch picks the right artifact_kind through the production
    /// query.
    #[test]
    fn current_plan_round_trips_independent_of_other_kinds() {
        let db = Database::new_in_memory().expect("in-memory db");
        crate::infrastructure::database::initialize_schema(&db).expect("init schema");

        let svc = TaskService::new(&db);
        let repo = PathBuf::from("/tmp/repo");
        let task = svc
            .create_task(CreateTaskInput {
                name: "rt-plan",
                display_name: None,
                repository_path: &repo,
                repository_name: "repo",
                request_body: "body",
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: None,
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("create task");

        // Add a Spec artifact (NOT a Plan) to verify the kind dispatch.
        let spec_artifact = TaskArtifact {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            artifact_kind: TaskArtifactKind::Spec,
            title: None,
            content: Some("spec content".to_string()),
            url: None,
            metadata_json: None,
            is_current: false,
            produced_by_run_id: None,
            produced_by_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        db.create_task_artifact(&spec_artifact).expect("create spec");
        db.mark_task_artifact_current(&task.id, TaskArtifactKind::Spec, &spec_artifact.id)
            .expect("mark spec");

        // current_plan should still be None because no Plan artifact exists.
        assert!(
            task.current_plan(&db).expect("plan getter").is_none(),
            "current_plan must NOT pick up the Spec artifact"
        );

        // Now add the Plan.
        let plan_artifact = TaskArtifact {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            artifact_kind: TaskArtifactKind::Plan,
            title: None,
            content: Some("plan content".to_string()),
            url: None,
            metadata_json: None,
            is_current: false,
            produced_by_run_id: None,
            produced_by_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        db.create_task_artifact(&plan_artifact).expect("create plan");
        db.mark_task_artifact_current(&task.id, TaskArtifactKind::Plan, &plan_artifact.id)
            .expect("mark plan");

        assert_eq!(
            task.current_plan(&db).expect("plan getter").as_deref(),
            Some("plan content")
        );
    }
}
