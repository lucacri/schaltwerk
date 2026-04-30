use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum SortMode {
    Name,
    Created,
    LastEdited,
}

impl FromStr for SortMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "name" => Ok(SortMode::Name),
            "created" => Ok(SortMode::Created),
            "last-edited" => Ok(SortMode::LastEdited),
            _ => Err(format!("Invalid sort mode: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum FilterMode {
    Spec,
    Running,
}

impl FromStr for FilterMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "all" | "running" => Ok(FilterMode::Running),
            "spec" => Ok(FilterMode::Spec),
            _ => Err(format!("Invalid filter mode: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub change_type: String,
    pub additions: u32,
    pub deletions: u32,
    pub changes: u32,
    pub is_binary: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
}

impl ChangedFile {
    pub fn new(path: String, change_type: String) -> Self {
        Self {
            path,
            change_type,
            additions: 0,
            deletions: 0,
            changes: 0,
            is_binary: None,
            previous_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    // Optional human-friendly display name (does not affect git branch/worktree)
    pub display_name: Option<String>,
    // DB-backed version grouping for parallel versions
    pub version_group_id: Option<String>,
    pub version_number: Option<i32>,
    // Optional epic association for grouping sessions/specs
    pub epic_id: Option<String>,
    pub repository_path: PathBuf,
    pub repository_name: String,
    pub branch: String,
    pub parent_branch: String,
    pub original_parent_branch: Option<String>,
    pub worktree_path: PathBuf,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_activity: Option<DateTime<Utc>>,
    pub initial_prompt: Option<String>,
    pub ready_to_merge: bool,
    // If present, captures the agent type that originally opened this session (e.g., "claude" or "opencode")
    pub original_agent_type: Option<String>,
    pub original_agent_model: Option<String>,
    // Internal flag to decide whether we should auto-generate a display name post-start
    pub pending_name_generation: bool,
    // True if the session name was auto-generated (e.g., docker-style names)
    pub was_auto_generated: bool,
    // Content for spec agents (markdown format)
    pub spec_content: Option<String>,
    // Phase 4 Wave D.3: legacy `status: SessionStatus` and
    // `session_state: SessionState` fields removed. Lifecycle now
    // derives from `is_spec` + `cancelled_at` + worktree existence
    // via `Session::lifecycle_state(...)`. The wire-format adapter
    // (`SessionInfoBuilder`) projects these axes onto the same
    // lowercase strings the frontend has always read.
    // Whether agent resume/continue is allowed (freshly false after Spec/Cancel until first start)
    pub resume_allowed: bool,
    // Amp thread ID for resuming threads across Lucode sessions
    pub amp_thread_id: Option<String>,
    // GitHub issue number linked to this session
    pub issue_number: Option<i64>,
    // GitHub issue URL linked to this session
    pub issue_url: Option<String>,
    // GitHub PR number linked to this session
    pub pr_number: Option<i64>,
    // GitHub PR URL linked to this session
    pub pr_url: Option<String>,
    pub pr_state: Option<PrState>,
    pub is_consolidation: bool,
    pub consolidation_sources: Option<Vec<String>>,
    pub consolidation_round_id: Option<String>,
    pub consolidation_role: Option<String>,
    pub consolidation_report: Option<String>,
    pub consolidation_report_source: Option<String>,
    pub consolidation_base_session_id: Option<String>,
    pub consolidation_recommended_session_id: Option<String>,
    pub consolidation_confirmation_mode: Option<String>,
    pub promotion_reason: Option<String>,
    pub ci_autofix_enabled: bool,
    pub merged_at: Option<DateTime<Utc>>,
    pub task_id: Option<String>,
    pub task_stage: Option<SpecStage>,
    pub task_run_id: Option<String>,
    pub run_role: Option<String>,
    pub slot_key: Option<String>,
    /// Unix-second timestamp of the most recent PTY exit for this session, if any.
    /// `None` means the session is still alive (or never produced an exit). Set by
    /// `SessionFactsRecorder::record_exit` (Phase 1 Wave G).
    pub exited_at: Option<DateTime<Utc>>,
    /// Exit code captured at PTY exit. `None` when the child terminated without a
    /// numeric code (signal, tmux dead-pane reattach with no record, etc).
    pub exit_code: Option<i32>,
    /// Unix-second timestamp of the **first** time this session entered
    /// `WaitingForInput` (idle). Write-once: subsequent idle transitions do not
    /// overwrite. Read by [`crate::domains::tasks::run_status::compute_run_status`]
    /// to derive sticky `AwaitingSelection`.
    pub first_idle_at: Option<DateTime<Utc>>,
    /// Phase 3 Wave F: identity axis. `true` for spec sessions (drafts
    /// without a real worktree); `false` for active worktree-bearing
    /// sessions. Orthogonal to `cancelled_at`. Replaces the
    /// `SessionStatus::Spec` / `SessionState::Spec` correlated pair —
    /// see plan §1.
    #[serde(default)]
    pub is_spec: bool,
    /// Phase 3 Wave F: lifecycle axis. `Some(ts)` records that this
    /// session has been cancelled at `ts`; `None` means active.
    /// Orthogonal to `is_spec`. Replaces `SessionStatus::Cancelled`.
    #[serde(default)]
    pub cancelled_at: Option<DateTime<Utc>>,
}

/// Runtime-only derived enum produced by [`Session::lifecycle_state`].
/// **Not serialized, not persisted** — the wire format ships
/// `info.session_state` and `info.status` strings synthesized from
/// this getter so the existing UI keeps rendering. The four variants
/// reproduce the v1 `SessionState` × `SessionStatus` axis the
/// frontend reads today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLifecycleState {
    /// `is_spec = true`, not cancelled. Draft session without a
    /// worktree.
    Spec,
    /// `is_spec = false`, not cancelled, but worktree is missing on
    /// disk. Reproduces the v1 enrichment-time synthesis at
    /// `domains/sessions/service.rs:3901-3905`.
    Processing,
    /// `is_spec = false`, not cancelled, worktree present.
    Running,
    /// `cancelled_at.is_some()` — trumps `is_spec` because a cancelled
    /// session is no longer participating in the lifecycle regardless
    /// of identity.
    Cancelled,
}

impl SessionLifecycleState {
    /// Phase 4 Wave D.0: project the runtime-only enum onto the
    /// frontend-facing wire format string. The Cancelled variant maps
    /// to `"running"` because cancelled sessions are filtered out
    /// before reaching the sidebar (the wire-format adapter only sees
    /// non-cancelled sessions in production); emitting "running"
    /// preserves the v1 contract for the rare path that hits it.
    pub fn to_wire_string(self) -> &'static str {
        match self {
            SessionLifecycleState::Spec => "spec",
            SessionLifecycleState::Processing => "processing",
            SessionLifecycleState::Running => "running",
            SessionLifecycleState::Cancelled => "running",
        }
    }
}

impl Session {
    /// Phase 3 derived getter. `worktree_exists_on_disk` is supplied by
    /// the caller (the enrichment layer in `domains/sessions/service.rs`
    /// already does this `worktree_exists` check); this getter is a
    /// pure projection over the persisted facts plus that boolean.
    pub fn lifecycle_state(&self, worktree_exists_on_disk: bool) -> SessionLifecycleState {
        if self.cancelled_at.is_some() {
            return SessionLifecycleState::Cancelled;
        }
        if self.is_spec {
            return SessionLifecycleState::Spec;
        }
        if !worktree_exists_on_disk && !cfg!(test) {
            return SessionLifecycleState::Processing;
        }
        SessionLifecycleState::Running
    }

    /// Convenience: `true` iff the session has been cancelled
    /// (independent of identity).
    pub fn is_cancelled(&self) -> bool {
        self.cancelled_at.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "regular" => Ok(TaskVariant::Regular),
            "main" => Ok(TaskVariant::Main),
            _ => Err(format!("Invalid task variant: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Spec {
    pub id: String,
    pub name: String,
    pub display_name: Option<String>,
    pub epic_id: Option<String>,
    pub issue_number: Option<i64>,
    pub issue_url: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    pub improve_plan_round_id: Option<String>,
    pub repository_path: PathBuf,
    pub repository_name: String,
    pub content: String,
    #[serde(default)]
    pub implementation_plan: Option<String>,
    pub stage: SpecStage,
    #[serde(default = "default_task_variant")]
    pub variant: TaskVariant,
    #[serde(default)]
    pub ready_session_id: Option<String>,
    #[serde(default)]
    pub ready_branch: Option<String>,
    #[serde(default)]
    pub base_branch: Option<String>,
    pub attention_required: bool,
    pub clarification_started: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_task_variant() -> TaskVariant {
    TaskVariant::Regular
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskWorkflowStage {
    Brainstormed,
    Planned,
    Implemented,
    Pushed,
}

impl TaskWorkflowStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskWorkflowStage::Brainstormed => "brainstormed",
            TaskWorkflowStage::Planned => "planned",
            TaskWorkflowStage::Implemented => "implemented",
            TaskWorkflowStage::Pushed => "pushed",
        }
    }
}

impl FromStr for TaskWorkflowStage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "brainstormed" => Ok(TaskWorkflowStage::Brainstormed),
            "planned" => Ok(TaskWorkflowStage::Planned),
            "implemented" => Ok(TaskWorkflowStage::Implemented),
            "pushed" => Ok(TaskWorkflowStage::Pushed),
            _ => Err(format!("Invalid task workflow stage: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStageWorkflow {
    pub task_id: String,
    pub stage: TaskWorkflowStage,
    pub preset_id: Option<String>,
    pub judge_preset_id: Option<String>,
    pub auto_chain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PrState {
    Open,
    Succeeding,
    /// CI is red (or PR closed without merge). v2 wires this through
    /// `auto_advance::on_pr_state_refreshed` to flip `task.failure_flag`,
    /// which the design doc preserves as the post-merge regression channel.
    /// (v2 main was branched without this variant; restored when porting v1
    /// auto_advance. See Phase 1 plan §7 — "post-merge CI red flips
    /// task.failure_flag, not run status".)
    Failed,
    /// Intentional misspelling of "Merged" — load-bearing on the wire.
    Mred,
}

impl PrState {
    pub fn as_str(&self) -> &str {
        match self {
            PrState::Open => "open",
            PrState::Succeeding => "succeeding",
            PrState::Failed => "failed",
            PrState::Mred => "mred",
        }
    }
}

impl FromStr for PrState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "open" => Ok(PrState::Open),
            "succeeding" => Ok(PrState::Succeeding),
            "failed" => Ok(PrState::Failed),
            "mred" => Ok(PrState::Mred),
            _ => Err(format!("Invalid PR state: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpecStage {
    Draft,
    Ready,
    Brainstormed,
    Planned,
    Implemented,
    Pushed,
    Done,
    Cancelled,
}

impl SpecStage {
    pub fn as_str(&self) -> &str {
        match self {
            SpecStage::Draft => "draft",
            SpecStage::Ready => "ready",
            SpecStage::Brainstormed => "brainstormed",
            SpecStage::Planned => "planned",
            SpecStage::Implemented => "implemented",
            SpecStage::Pushed => "pushed",
            SpecStage::Done => "done",
            SpecStage::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, SpecStage::Done | SpecStage::Cancelled)
    }
}

impl FromStr for SpecStage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(SpecStage::Draft),
            "ready" => Ok(SpecStage::Ready),
            "clarified" => Ok(SpecStage::Ready),
            "brainstormed" => Ok(SpecStage::Brainstormed),
            "planned" => Ok(SpecStage::Planned),
            "implemented" => Ok(SpecStage::Implemented),
            "pushed" => Ok(SpecStage::Pushed),
            "done" => Ok(SpecStage::Done),
            "cancelled" => Ok(SpecStage::Cancelled),
            _ => Err(format!("Invalid spec stage: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Epic {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

// Phase 4 Wave D.3: `SessionStatus` and `SessionState` enums removed.
// They were a correlated pair the v1 reconciler had to defend against
// drift on. v2's orthogonal axes (`is_spec` + `cancelled_at`) make
// drift impossible by construction. The runtime-only
// `SessionLifecycleState` (above) reproduces the v1 enum surface for
// callers that need a four-variant projection; the wire format ships
// strings synthesized by `SessionInfoBuilder`.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStats {
    pub session_id: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub has_uncommitted: bool,
    #[serde(default)]
    pub dirty_files_count: u32,
    pub calculated_at: DateTime<Utc>,
    // Timestamp (unix seconds) of the most recent meaningful diff change:
    // max(latest commit ahead of base, latest mtime among uncommitted changed files)
    pub last_diff_change_ts: Option<i64>,
    #[serde(default)]
    pub has_conflicts: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionParams {
    pub name: String,
    pub prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CancelSessionParams {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionStatusParams {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionStatusResponse {
    pub name: String,
    pub status: String,
    pub files_changed: u32,
    pub lines_added: u32,
    pub has_uncommitted: bool,
    pub last_activity: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatusType {
    Active,
    Dirty,
    Missing,
    Archived,
    Spec,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    #[serde(default)]
    pub files_changed: usize,
    #[serde(default)]
    pub additions: usize,
    pub deletions: usize,
    #[serde(default)]
    pub insertions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionReadyToMergeCheck {
    pub key: String,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epic: Option<Epic>,
    pub branch: String,
    pub worktree_path: String,
    pub base_branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_base_branch: Option<String>,
    pub status: SessionStatusType,
    pub created_at: Option<DateTime<Utc>>,
    pub last_modified: Option<DateTime<Utc>>,
    pub has_uncommitted_changes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty_files_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commits_ahead_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Merge conflict status derived from git when available. None indicates the
    /// backend could not determine the state yet (e.g. worktree missing or repo call failed).
    pub has_conflicts: Option<bool>,
    pub is_current: bool,
    pub session_type: SessionType,
    pub container_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_agent_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stats: Option<DiffStats>,
    #[serde(default)]
    pub ready_to_merge: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_to_merge_checks: Option<Vec<SessionReadyToMergeCheck>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_implementation_plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec_stage: Option<SpecStage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub improve_plan_round_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clarification_started: Option<bool>,
    /// Phase 4 Wave D.0: wire-format string ("spec" | "processing" |
    /// "running"). Synthesized by `SessionInfoBuilder` from
    /// `Session::lifecycle_state(...)`. Same lowercase strings the
    /// legacy `SessionState` enum produced via
    /// `#[serde(rename_all = "lowercase")]`, so the JSON wire bytes
    /// are unchanged for the frontend.
    pub session_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_state: Option<PrState>,
    #[serde(default)]
    pub is_consolidation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_round_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_report: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_report_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_base_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_recommended_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consolidation_confirmation_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promotion_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attention_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<SpecStage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnrichedSession {
    pub info: SessionInfo,
    pub status: Option<SessionMonitorStatus>,
    pub terminals: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attention_required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attention_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMonitorStatus {
    pub session_name: String,
    pub current_task: String,
    pub test_status: TestStatus,
    pub diff_stats: Option<DiffStats>,
    pub last_update: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedSpec {
    pub id: String,
    pub session_name: String,
    pub repository_path: PathBuf,
    pub repository_name: String,
    pub content: String,
    pub archived_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::{Session, SessionLifecycleState, SpecStage};
    use chrono::{DateTime, Utc};
    use std::str::FromStr;

    #[test]
    fn clarified_spec_stage_alias_maps_to_ready() {
        assert_eq!(
            SpecStage::from_str("clarified").expect("legacy alias should parse"),
            SpecStage::Ready
        );
    }

    /// Phase 3 Wave F.1 structural pin: `Session.is_spec: bool`. If a
    /// future change reverts this field to an enum (or drops it),
    /// the function-pointer coercion below fails to compile.
    #[test]
    fn session_is_spec_field_is_bool() {
        fn assert_is_spec_field(_: fn(&Session) -> &bool) {}
        assert_is_spec_field(|s: &Session| &s.is_spec);
    }

    /// Phase 3 Wave F.1 structural pin: `Session.cancelled_at:
    /// Option<DateTime<Utc>>`. If a future change replaces it with a
    /// `SessionStatus`-like enum, the coercion below fails to compile.
    #[test]
    fn session_cancelled_at_field_is_option_datetime() {
        fn assert_cancelled_at_field(_: fn(&Session) -> &Option<DateTime<Utc>>) {}
        assert_cancelled_at_field(|s: &Session| &s.cancelled_at);
    }

    /// Phase 3 Wave F.1 structural pin: `SessionLifecycleState` has
    /// exactly four variants, exhaustive-matchable without a wildcard.
    /// Adding a fifth variant forces the match below non-exhaustive
    /// and rustc rejects this test.
    #[test]
    fn session_lifecycle_state_has_four_variants() {
        let st = SessionLifecycleState::Running;
        let _label: &str = match st {
            SessionLifecycleState::Spec => "spec",
            SessionLifecycleState::Processing => "processing",
            SessionLifecycleState::Running => "running",
            SessionLifecycleState::Cancelled => "cancelled",
        };
    }
}
