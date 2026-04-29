use crate::domains::merge::service::MergeService;
use crate::domains::merge::types::MergeMode;
use crate::domains::sessions::db_sessions::SessionMethods;
use crate::domains::sessions::service::{SessionCreationParams, SessionManager};
use crate::domains::tasks::clarify::build_task_clarification_prompt;
use crate::domains::tasks::entity::{RunRole, Task, TaskRun, TaskStage};
use crate::domains::tasks::prompts::{build_stage_run_prompt, build_task_host_prompt};
use crate::domains::tasks::presets::{ExpandedRunSlot, PresetShape, expand_preset};
use crate::domains::tasks::runs::TaskRunService;
use crate::domains::tasks::service::{ResolvedStagePreset, TaskService};
use crate::infrastructure::database::{Database, TaskMethods};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use uuid::Uuid;

/// Sentinel error wrapped in anyhow so the Tauri command boundary can
/// downcast and surface the conflict as a structured `SchaltError::MergeConflict`
/// (which the frontend matches on `error.type === 'MergeConflict'`) instead
/// of forcing the UI to substring-match a localized message. Carries the
/// conflicting file list parsed from `MergeService`'s error text so the
/// merge-resolver UI can render the paths instead of an empty array.
#[derive(Debug, Clone)]
pub struct MergeConflictDuringConfirm {
    pub message: String,
    pub files: Vec<String>,
}

impl std::fmt::Display for MergeConflictDuringConfirm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "merge conflict during stage confirmation: {}", self.message)
    }
}

impl std::error::Error for MergeConflictDuringConfirm {}

/// Parse the conflicting file list out of a `MergeService` error message.
/// `MergeService` formats the tail of every conflict error as
/// "Conflicting paths: a, b, c" — so we split on that marker, trim each
/// entry, and drop empties. Kept private to orchestration: this is a
/// boundary-layer translation, not a domain concept.
fn parse_conflicting_paths(message: &str) -> Vec<String> {
    let marker = "Conflicting paths:";
    let Some((_, tail)) = message.rsplit_once(marker) else {
        return Vec::new();
    };

    let first_line = tail.lines().next().unwrap_or(tail);
    first_line
        .split(',')
        .map(|part| part.trim().trim_end_matches('.').trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

/// Sentinel error for the post-merge advance failure path. The merge
/// itself succeeded — the task's branch already has the winning commit —
/// but advancing the task stage afterwards failed (DB error, etc.). The
/// user must reconcile the task stage manually. Surfaces as a typed
/// `SchaltError::StageAdvanceFailedAfterMerge` variant.
#[derive(Debug, Clone)]
pub struct StageAdvanceAfterMergeFailed {
    pub message: String,
}

impl std::fmt::Display for StageAdvanceAfterMergeFailed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "merge succeeded but stage advance failed — manual recovery required: {}",
            self.message
        )
    }
}

impl std::error::Error for StageAdvanceAfterMergeFailed {}

/// Result of provisioning a single session for a task (either the host
/// session or one of a run's slot sessions). Only the session identifier is
/// exposed here — downstream lineage storage happens in the orchestrator
/// through the task/run services.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionedSession {
    pub session_id: String,
    pub branch: String,
}

/// Provisions worktree-backed sessions for the task lifecycle. Split out
/// behind a trait so the orchestrator can be unit-tested against a fake that
/// only writes the DB lineage (`task_id`, `task_run_id`, `run_role`,
/// `slot_key`) without having to create real git worktrees.
pub trait SessionProvisioner {
    fn provision_task_host(&self, task: &Task, branch: &str, base_branch: &str)
    -> Result<ProvisionedSession>;

    fn provision_run_slot(
        &self,
        task: &Task,
        run: &TaskRun,
        slot: &ExpandedRunSlot,
        branch: &str,
        base_branch: &str,
    ) -> Result<ProvisionedSession>;

    /// Provision the single session that hosts a task-bound clarify agent.
    /// Unlike stage-run slots, clarify is a one-off discussion session that
    /// does not participate in candidate selection or merge — it only
    /// produces edits to the task's spec artifact via MCP.
    fn provision_clarify(
        &self,
        task: &Task,
        run: &TaskRun,
        branch: &str,
        base_branch: &str,
        agent_type: Option<&str>,
    ) -> Result<ProvisionedSession>;
}

/// Marks the winning branch as merged into the task's durable branch. Kept as
/// a trait so the orchestrator does not depend on the `MergeService` module
/// layout during unit tests; production wires this to the real merge path.
///
/// Async because the production merger drives git operations that live inside
/// the async `MergeService::merge_from_modal` path.
#[async_trait]
pub trait BranchMerger {
    async fn merge_into_task_branch(
        &self,
        task: &Task,
        winning_session_id: &str,
        winning_branch: &str,
    ) -> Result<()>;
}

/// Canonical stage flow for post-run advancement. After a stage run
/// completes, the task advances to exactly the next stage in this list.
fn next_stage_after(stage: TaskStage) -> Option<TaskStage> {
    match stage {
        TaskStage::Draft => Some(TaskStage::Ready),
        TaskStage::Ready => Some(TaskStage::Brainstormed),
        TaskStage::Brainstormed => Some(TaskStage::Planned),
        TaskStage::Planned => Some(TaskStage::Implemented),
        TaskStage::Implemented => Some(TaskStage::Pushed),
        TaskStage::Pushed => Some(TaskStage::Done),
        TaskStage::Done | TaskStage::Cancelled => None,
    }
}

fn ensure_stage_run_stage(stage: TaskStage) -> Result<()> {
    if matches!(
        stage,
        TaskStage::Brainstormed | TaskStage::Planned | TaskStage::Implemented
    ) {
        Ok(())
    } else {
        Err(anyhow!(
            "unsupported stage run stage '{}'; expected brainstormed, planned, or implemented",
            stage.as_str()
        ))
    }
}

pub struct TaskOrchestrator<'a, P: SessionProvisioner, M: BranchMerger> {
    db: &'a Database,
    provisioner: &'a P,
    merger: &'a M,
    branch_prefix: &'a str,
}

impl<'a, P: SessionProvisioner, M: BranchMerger> TaskOrchestrator<'a, P, M> {
    pub fn new(db: &'a Database, provisioner: &'a P, merger: &'a M, branch_prefix: &'a str) -> Self {
        Self { db, provisioner, merger, branch_prefix }
    }

    fn task_svc(&self) -> TaskService<'_> {
        TaskService::new(self.db)
    }

    fn run_svc(&self) -> TaskRunService<'_> {
        TaskRunService::new(self.db)
    }

    pub fn resolve_stage_preset(&self, task: &Task, stage: TaskStage) -> Result<ResolvedStagePreset> {
        self.task_svc().resolve_stage_preset(task, stage)
    }

    fn task_branch_name(&self, task: &Task) -> String {
        if self.branch_prefix.is_empty() {
            format!("lucode/{}", task.name)
        } else {
            format!("{prefix}/{name}", prefix = self.branch_prefix, name = task.name)
        }
    }

    fn run_slot_branch_name(&self, task: &Task, run_id: &str, slot_idx: usize) -> String {
        let short = if run_id.len() >= 8 { &run_id[..8] } else { run_id };
        // Slot branches are siblings of the task branch — not nested under it —
        // because git refuses to create `refs/heads/foo/bar` while `refs/heads/foo`
        // already exists (the leaf ref file blocks the directory).
        if self.branch_prefix.is_empty() {
            format!("lucode/{}-run-{short}-{slot_idx:02}", task.name)
        } else {
            format!(
                "{prefix}/{name}-run-{short}-{slot_idx:02}",
                prefix = self.branch_prefix,
                name = task.name,
            )
        }
    }

    /// Promote a task from `Draft → Ready`, spawning a single `task_host`
    /// session on the task's canonical branch. Idempotent: calling again on a
    /// task that already has a host session is an error (callers should read
    /// the task first to branch on presence).
    pub fn promote_to_ready(&self, task_id: &str) -> Result<Task> {
        let task = self.task_svc().get_task(task_id)?;
        if task.task_host_session_id.is_some() {
            return Err(anyhow!(
                "task '{}' already has a task_host session provisioned",
                task.name
            ));
        }

        let base_branch = task
            .base_branch
            .clone()
            .ok_or_else(|| anyhow!("task '{}' has no base_branch set", task.name))?;
        let branch = self.task_branch_name(&task);

        let provisioned = self
            .provisioner
            .provision_task_host(&task, &branch, &base_branch)?;

        self.db.set_task_host(
            task_id,
            Some(&provisioned.session_id),
            Some(&branch),
            Some(&base_branch),
        )?;

        self.task_svc().advance_stage(task_id, TaskStage::Ready)?;

        self.task_svc().get_task(task_id)
    }

    /// Start a stage run for the given task. Creates the `task_run` row and
    /// provisions one session per expanded preset slot. Each slot gets its
    /// own short-uuid-suffixed branch under the task branch so candidate
    /// sessions never collide.
    ///
    /// The caller-submitted `preset_id` and `shape` remain authoritative here.
    /// The stage-preset cascade resolves task overrides first, then project
    /// defaults, then the builtin fallback through `resolve_stage_preset` so
    /// the UI and backend share one lookup path, but `start_stage_run` does
    /// not auto-pick a preset on the caller's behalf.
    pub fn start_stage_run(
        &self,
        task_id: &str,
        stage: TaskStage,
        preset_id: Option<&str>,
        shape: &PresetShape,
    ) -> Result<StageRunStarted> {
        ensure_stage_run_stage(stage)?;
        let task = self.task_svc().get_task(task_id)?;
        let _resolved_preset = self.resolve_stage_preset(&task, stage)?;
        let task_branch = task
            .task_branch
            .clone()
            .ok_or_else(|| anyhow!("task '{}' has no task_branch; promote it first", task.name))?;

        let slots = expand_preset(shape)?;

        let run = self.run_svc().create_task_run(
            task_id,
            stage,
            preset_id,
            Some(&task_branch),
            Some(&task_branch),
        )?;

        let mut sessions = Vec::with_capacity(slots.len());
        for (idx, slot) in slots.iter().enumerate() {
            let branch = self.run_slot_branch_name(&task, &run.id, idx);
            let provisioned = self.provisioner.provision_run_slot(
                &task,
                &run,
                slot,
                &branch,
                &task_branch,
            )?;
            sessions.push(ProvisionedRunSession {
                session_id: provisioned.session_id,
                branch: provisioned.branch,
                run_role: slot.run_role,
                slot_key: slot.slot_key.clone(),
            });
        }

        let run = self.run_svc().get_run(&run.id)?;

        Ok(StageRunStarted { run, sessions })
    }

    fn clarify_branch_name(&self, task: &Task, run_id: &str) -> String {
        let short = if run_id.len() >= 8 { &run_id[..8] } else { run_id };
        if self.branch_prefix.is_empty() {
            format!("lucode/{}-clarify-{short}", task.name)
        } else {
            format!(
                "{prefix}/{name}-clarify-{short}",
                prefix = self.branch_prefix,
                name = task.name,
            )
        }
    }

    /// Find an existing active clarify run for the task, if any.
    /// v2 "Active" = no terminal timestamp on the run row
    /// (cancelled_at IS NULL AND confirmed_at IS NULL AND failed_at IS NULL).
    /// Returns the run plus the session id provisioned for it (looked up via
    /// `task_run_id + run_role='clarify'` on the sessions table).
    fn find_active_clarify(&self, task_id: &str) -> Result<Option<ClarifyRunStarted>> {
        let runs = self.run_svc().list_runs_for_task(task_id)?;
        for run in runs {
            let is_active = run.cancelled_at.is_none()
                && run.confirmed_at.is_none()
                && run.failed_at.is_none();
            if !is_active {
                continue;
            }
            if let Some(session) = self.db.find_session_for_task_run(&run.id, "clarify")? {
                return Ok(Some(ClarifyRunStarted {
                    task_id: task_id.to_string(),
                    session_id: session.session_id,
                    run_id: run.id,
                    branch: session.branch,
                    reused: true,
                }));
            }
        }
        Ok(None)
    }

    /// Spawn (or reuse) the task-bound clarify run for this task.
    ///
    /// The clarify run is a single, long-lived discussion session bound to
    /// the task by `task_id + run_role='clarify'`. It exists outside the
    /// canonical stage flow (Brainstormed → Planned → ...): the agent only
    /// edits the task's spec artifact via `LucodeTaskUpdateContent` and
    /// never participates in candidate selection or merge.
    ///
    /// Idempotent across the active set: if a clarify run already exists for
    /// the task whose `task_runs.status` is `queued`, `running`, or
    /// `awaiting_selection`, the existing session is returned and `reused`
    /// is true. Once the previous run flips to a terminal state (completed,
    /// failed, cancelled), a subsequent call spawns a fresh session.
    pub fn start_clarify_run(
        &self,
        task_id: &str,
        agent_type: Option<&str>,
    ) -> Result<ClarifyRunStarted> {
        if let Some(existing) = self.find_active_clarify(task_id)? {
            return Ok(existing);
        }

        let task = self.task_svc().get_task(task_id)?;
        let base_branch = task
            .base_branch
            .clone()
            .ok_or_else(|| anyhow!("task '{}' has no base_branch set", task.name))?;

        let run = self.run_svc().create_task_run(
            task_id,
            task.stage,
            None,
            Some(&base_branch),
            Some(&base_branch),
        )?;

        let branch = self.clarify_branch_name(&task, &run.id);
        let provisioned =
            self.provisioner
                .provision_clarify(&task, &run, &branch, &base_branch, agent_type)?;


        Ok(ClarifyRunStarted {
            task_id: task.id,
            session_id: provisioned.session_id,
            run_id: run.id,
            branch: provisioned.branch,
            reused: false,
        })
    }

    /// Confirm a stage run's winner, merge the winning branch into the task
    /// branch, and advance the task to the next stage in the canonical flow.
    ///
    /// The lineage check before merging is load-bearing: a caller that picked
    /// the wrong session id (or one belonging to a different run) must NOT end
    /// up with its work merged onto our task branch. We verify the winning
    /// session's `task_id` and `task_run_id` match the run being confirmed.
    ///
    /// Atomicity note: the merge and the subsequent stage advance are not
    /// currently wrapped in a single DB transaction — the merge touches the
    /// filesystem and spans async work, which can't live inside a rusqlite
    /// transaction. If the stage advance fails after the merge succeeded we
    /// surface a clearly-worded error so the operator knows manual recovery
    /// is needed rather than retrying the whole command.
    // TODO(r4-transactional): explore whether we can stage the run selection
    // and the post-merge advance under a single rusqlite transaction, e.g.
    // by separating "mark-confirmed" from "advance-stage" and having the
    // caller observe the merged state before advancing.
    pub async fn confirm_stage(
        &self,
        run_id: &str,
        winning_session_id: &str,
        winning_branch: &str,
        selection_mode: &str,
    ) -> Result<Task> {
        let run = self.run_svc().get_run(run_id)?;
        let task = self.task_svc().get_task(&run.task_id)?;

        // The merge target is the task's durable branch, set by
        // promote_to_ready. If the caller somehow reached confirm_stage
        // without that branch being provisioned (e.g., a Tauri command
        // invoked directly with a Draft-stage task or a corrupt DB row),
        // fail before we mutate any state — `merge_into_task_branch` would
        // otherwise blow up halfway through with a less-actionable error.
        if task.task_branch.is_none() {
            return Err(anyhow!(
                "task '{}' has no task_branch set; promote it to Ready before confirming a stage run",
                task.name
            ));
        }

        let lineage = self.db.get_session_task_lineage(winning_session_id)?;
        if lineage.task_id.as_deref() != Some(task.id.as_str()) {
            return Err(anyhow!(
                "winning session '{winning_session_id}' is bound to task '{:?}', not task '{}'",
                lineage.task_id,
                task.id,
            ));
        }
        if lineage.task_run_id.as_deref() != Some(run.id.as_str()) {
            return Err(anyhow!(
                "winning session '{winning_session_id}' is bound to run '{:?}', not run '{}'",
                lineage.task_run_id,
                run.id,
            ));
        }

        self.run_svc()
            .confirm_selection(run_id, Some(winning_session_id), None, selection_mode)?;

        if let Err(merge_err) = self
            .merger
            .merge_into_task_branch(&task, winning_session_id, winning_branch)
            .await
        {
            let raw = merge_err.to_string();
            // Downstream `MergeService` surfaces conflicts with the literal
            // word "conflict" in the error message. Promote it to a typed
            // sentinel so the Tauri command can return SchaltError::MergeConflict
            // — frontend now branches on the structured tag, not substring text.
            if raw.to_lowercase().contains("conflict") {
                let files = parse_conflicting_paths(&raw);
                return Err(anyhow::Error::new(MergeConflictDuringConfirm {
                    message: raw,
                    files,
                }));
            }
            return Err(merge_err);
        }

        if let Some(next) = next_stage_after(task.stage)
            && let Err(e) = self.task_svc().advance_stage(&task.id, next)
        {
            return Err(anyhow::Error::new(StageAdvanceAfterMergeFailed {
                message: e.to_string(),
            }));
        }

        self.task_svc().get_task(&task.id)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StageRunStarted {
    pub run: TaskRun,
    pub sessions: Vec<ProvisionedRunSession>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarifyRunStarted {
    pub task_id: String,
    pub session_id: String,
    pub run_id: String,
    pub branch: String,
    /// True when an active clarify run already existed for the task and the
    /// orchestrator returned the existing session id instead of spawning.
    pub reused: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProvisionedRunSession {
    pub session_id: String,
    pub branch: String,
    pub run_role: RunRole,
    pub slot_key: Option<String>,
}

/// Helper used by production wrappers to mint per-slot session names.
pub fn default_slot_session_name(task_name: &str, run_id: &str, slot_idx: usize) -> String {
    let short = if run_id.len() >= 8 { &run_id[..8] } else { run_id };
    format!("{task_name}-{short}-{slot_idx:02}")
}

/// Short, URL-safe identifier used when the orchestrator needs to mint a
/// placeholder session id without going through SessionManager (used by
/// fakes in tests).
pub fn short_session_id() -> String {
    Uuid::new_v4().to_string()
}

fn short_run_id(run_id: &str) -> &str {
    if run_id.len() >= 8 {
        &run_id[..8]
    } else {
        run_id
    }
}

fn slot_discriminator(slot: &ExpandedRunSlot, idx: usize) -> String {
    if let Some(key) = slot.slot_key.as_deref() {
        sanitize_for_session_name(key)
    } else {
        format!("{}-{:02}", slot.run_role.as_str().replace('_', "-"), idx)
    }
}

fn sanitize_for_session_name(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Production adapter that drives the real `SessionManager` to create git
/// worktrees for task host and stage slot sessions, and stamps
/// task/run/role/slot lineage onto the resulting session row.
pub struct ProductionProvisioner<'a> {
    session_manager: &'a SessionManager,
    db: &'a Database,
    agent_type: Option<&'a str>,
    slot_counter: std::sync::atomic::AtomicUsize,
}

impl<'a> ProductionProvisioner<'a> {
    pub fn new(session_manager: &'a SessionManager, db: &'a Database) -> Self {
        Self {
            session_manager,
            db,
            agent_type: None,
            slot_counter: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub fn with_agent_type(mut self, agent_type: &'a str) -> Self {
        self.agent_type = Some(agent_type);
        self
    }
}

impl<'a> SessionProvisioner for ProductionProvisioner<'a> {
    fn provision_task_host(
        &self,
        task: &Task,
        branch: &str,
        base_branch: &str,
    ) -> Result<ProvisionedSession> {
        let prompt = build_task_host_prompt(task);
        let params = SessionCreationParams {
            name: &task.name,
            prompt: Some(prompt.as_str()),
            base_branch: Some(base_branch),
            custom_branch: Some(branch),
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            epic_id: task.epic_id.as_deref(),
            agent_type: self.agent_type,
            pr_number: None,
            is_consolidation: false,
            consolidation_source_ids: None,
            consolidation_round_id: None,
            consolidation_role: None,
            consolidation_confirmation_mode: None,
        };

        let session = self.session_manager.create_session_with_agent(params)?;

        self.db.set_session_task_lineage(
            &session.id,
            Some(&task.id),
            None,
            Some(task.stage.as_str()),
            Some(RunRole::TaskHost.as_str()),
            None,
        )?;

        Ok(ProvisionedSession {
            session_id: session.id,
            branch: session.branch,
        })
    }

    fn provision_run_slot(
        &self,
        task: &Task,
        run: &TaskRun,
        slot: &ExpandedRunSlot,
        branch: &str,
        base_branch: &str,
    ) -> Result<ProvisionedSession> {
        let idx = self
            .slot_counter
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        let discriminator = slot_discriminator(slot, idx);
        let session_name = format!(
            "{task}-{run}-{disc}",
            task = task.name,
            run = short_run_id(&run.id),
            disc = discriminator,
        );
        let prompt = build_stage_run_prompt(task, run.stage, slot.run_role);

        let params = SessionCreationParams {
            name: &session_name,
            prompt: Some(prompt.as_str()),
            base_branch: Some(base_branch),
            custom_branch: Some(branch),
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            epic_id: task.epic_id.as_deref(),
            agent_type: Some(slot.agent_type.as_str()),
            pr_number: None,
            is_consolidation: false,
            consolidation_source_ids: None,
            consolidation_round_id: None,
            consolidation_role: None,
            consolidation_confirmation_mode: None,
        };

        let session = self.session_manager.create_session_with_agent(params)?;

        self.db.set_session_task_lineage(
            &session.id,
            Some(&task.id),
            Some(&run.id),
            Some(run.stage.as_str()),
            Some(slot.run_role.as_str()),
            slot.slot_key.as_deref(),
        )?;

        Ok(ProvisionedSession {
            session_id: session.id,
            branch: session.branch,
        })
    }

    fn provision_clarify(
        &self,
        task: &Task,
        run: &TaskRun,
        branch: &str,
        base_branch: &str,
        agent_type: Option<&str>,
    ) -> Result<ProvisionedSession> {
        let session_name = format!(
            "{task}-clarify-{run}",
            task = task.name,
            run = short_run_id(&run.id),
        );

        let prompt = build_task_clarification_prompt(task);

        let params = SessionCreationParams {
            name: &session_name,
            prompt: Some(prompt.as_str()),
            base_branch: Some(base_branch),
            custom_branch: Some(branch),
            use_existing_branch: false,
            sync_with_origin: false,
            was_auto_generated: false,
            version_group_id: None,
            version_number: None,
            epic_id: task.epic_id.as_deref(),
            agent_type,
            pr_number: None,
            is_consolidation: false,
            consolidation_source_ids: None,
            consolidation_round_id: None,
            consolidation_role: None,
            consolidation_confirmation_mode: None,
        };

        let session = self.session_manager.create_session_with_agent(params)?;

        self.db.set_session_task_lineage(
            &session.id,
            Some(&task.id),
            Some(&run.id),
            Some(run.stage.as_str()),
            Some(RunRole::Clarify.as_str()),
            None,
        )?;

        Ok(ProvisionedSession {
            session_id: session.id,
            branch: session.branch,
        })
    }
}

/// Production adapter that drives the real `MergeService` to merge a winning
/// slot session's branch back into the task's durable branch (via the
/// reapply-mode merge path).
pub struct ProductionMerger<'a> {
    merge_service: &'a MergeService,
    session_manager: &'a SessionManager,
}

impl<'a> ProductionMerger<'a> {
    pub fn new(merge_service: &'a MergeService, session_manager: &'a SessionManager) -> Self {
        Self {
            merge_service,
            session_manager,
        }
    }
}

#[async_trait]
impl<'a> BranchMerger for ProductionMerger<'a> {
    async fn merge_into_task_branch(
        &self,
        task: &Task,
        winning_session_id: &str,
        _winning_branch: &str,
    ) -> Result<()> {
        // Require an explicit task branch — silently treating `None` as
        // the empty string (via `as_deref().unwrap_or_default()`) would
        // merge the winner onto "" and produce confusing git failures.
        let task_branch = match task.task_branch.as_deref() {
            Some(s) if !s.is_empty() => s,
            _ => {
                return Err(anyhow!(
                    "task '{}' has no task_branch; winners cannot be merged before promotion",
                    task.name,
                ));
            }
        };

        let session = self
            .session_manager
            .get_session_by_id(winning_session_id)?;

        if session.task_id.as_deref() != Some(task.id.as_str()) {
            return Err(anyhow!(
                "winning session '{}' is bound to task '{:?}', not task '{}'",
                session.name,
                session.task_id,
                task.id,
            ));
        }

        if session.parent_branch.is_empty() {
            return Err(anyhow!(
                "winning session '{}' has no parent_branch — refusing to merge into task branch '{}'",
                session.name,
                task_branch,
            ));
        }

        if session.parent_branch != task_branch {
            return Err(anyhow!(
                "winning session '{}' has parent_branch '{}', which does not match the task branch '{}'",
                session.name,
                session.parent_branch,
                task_branch,
            ));
        }

        self.merge_service
            .merge_from_modal(&session.name, MergeMode::Reapply, None)
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::tasks::entity::{ProjectWorkflowDefault, Task, TaskStageConfig, TaskVariant};
    use crate::domains::tasks::presets::{PresetShape, PresetSlot};
    use crate::domains::tasks::service::{CreateTaskInput, TaskService};
    use crate::infrastructure::database::{Database, TaskMethods, TaskRunMethods};
    use std::cell::RefCell;
    use std::path::Path;

    fn db() -> Database {
        Database::new_in_memory().expect("in-memory db")
    }

    fn seed_task(db: &Database, name: &str, base: Option<&str>) -> Task {
        TaskService::new(db)
            .create_task(CreateTaskInput {
                name,
                display_name: None,
                repository_path: Path::new("/repo"),
                repository_name: "repo",
                request_body: "body",
                variant: TaskVariant::Regular,
                epic_id: None,
                base_branch: base,
                source_kind: None,
                source_url: None,
                issue_number: None,
                issue_url: None,
                pr_number: None,
                pr_url: None,
            })
            .expect("seed task")
    }

    #[derive(Debug, Clone)]
    struct HostCall {
        task_id: String,
        branch: String,
        base_branch: String,
    }

    #[derive(Debug, Clone)]
    struct SlotCall {
        task_id: String,
        run_id: String,
        run_role: RunRole,
        slot_key: Option<String>,
        agent_type: String,
        prompt: String,
        branch: String,
        base_branch: String,
    }

    struct FakeProvisioner<'a> {
        db: &'a Database,
        host_calls: RefCell<Vec<HostCall>>,
        slot_calls: RefCell<Vec<SlotCall>>,
        next_id: RefCell<u64>,
    }

    impl<'a> FakeProvisioner<'a> {
        fn new(db: &'a Database) -> Self {
            Self {
                db,
                host_calls: RefCell::new(Vec::new()),
                slot_calls: RefCell::new(Vec::new()),
                next_id: RefCell::new(0),
            }
        }

        fn mint(&self, kind: &str) -> String {
            let mut n = self.next_id.borrow_mut();
            *n += 1;
            format!("fake-{kind}-{n:04}")
        }

        /// Insert the minimal session row needed for FK lineage queries. We
        /// bypass `SessionManager` (which expects a real git worktree) because
        /// these tests run entirely in-memory.
        fn insert_session_stub(
            &self,
            session_id: &str,
            name: &str,
            branch: &str,
            parent_branch: &str,
        ) -> Result<()> {
            let conn = self.db.get_conn()?;
            conn.execute(
                "INSERT INTO sessions (
                    id, name, repository_path, repository_name,
                    branch, parent_branch, worktree_path, status,
                    created_at, updated_at
                ) VALUES (?1, ?2, '/repo', 'repo', ?3, ?4, ?5, 'active', 0, 0)",
                rusqlite::params![
                    session_id,
                    name,
                    branch,
                    parent_branch,
                    format!("/tmp/{session_id}"),
                ],
            )?;
            Ok(())
        }
    }

    impl<'a> SessionProvisioner for FakeProvisioner<'a> {
        fn provision_task_host(
            &self,
            task: &Task,
            branch: &str,
            base_branch: &str,
        ) -> Result<ProvisionedSession> {
            let session_id = self.mint("host");
            self.insert_session_stub(&session_id, &task.name, branch, base_branch)?;
            self.db.set_session_task_lineage(
                &session_id,
                Some(&task.id),
                None,
                Some(task.stage.as_str()),
                Some(RunRole::TaskHost.as_str()),
                None,
            )?;
            self.host_calls.borrow_mut().push(HostCall {
                task_id: task.id.clone(),
                branch: branch.to_string(),
                base_branch: base_branch.to_string(),
            });
            Ok(ProvisionedSession {
                session_id,
                branch: branch.to_string(),
            })
        }

        fn provision_run_slot(
            &self,
            task: &Task,
            run: &TaskRun,
            slot: &ExpandedRunSlot,
            branch: &str,
            base_branch: &str,
        ) -> Result<ProvisionedSession> {
            let session_id = self.mint("slot");
            let stub_name = format!("{}-{}", task.name, &session_id);
            self.insert_session_stub(&session_id, &stub_name, branch, base_branch)?;
            self.db.set_session_task_lineage(
                &session_id,
                Some(&task.id),
                Some(&run.id),
                Some(run.stage.as_str()),
                Some(slot.run_role.as_str()),
                slot.slot_key.as_deref(),
            )?;
            self.slot_calls.borrow_mut().push(SlotCall {
                task_id: task.id.clone(),
                run_id: run.id.clone(),
                run_role: slot.run_role,
                slot_key: slot.slot_key.clone(),
                agent_type: slot.agent_type.clone(),
                prompt: build_stage_run_prompt(task, run.stage, slot.run_role),
                branch: branch.to_string(),
                base_branch: base_branch.to_string(),
            });
            Ok(ProvisionedSession {
                session_id,
                branch: branch.to_string(),
            })
        }

        fn provision_clarify(
            &self,
            _task: &Task,
            _run: &TaskRun,
            _branch: &str,
            _base_branch: &str,
            _agent_type: Option<&str>,
        ) -> Result<ProvisionedSession> {
            unreachable!(
                "stage-run orchestration tests do not exercise the clarify path; \
                 see commands/tasks.rs::tests for clarify coverage",
            )
        }
    }

    #[derive(Default)]
    struct FakeMerger {
        merges: std::sync::Mutex<Vec<(String, String, String)>>,
        force_conflict: std::sync::atomic::AtomicBool,
        conflict_paths: std::sync::Mutex<Vec<String>>,
    }

    impl FakeMerger {
        fn recorded(&self) -> Vec<(String, String, String)> {
            self.merges.lock().unwrap().clone()
        }

        fn arm_conflict(&self) {
            self.force_conflict
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }

        fn arm_conflict_with_paths(&self, paths: &[&str]) {
            *self.conflict_paths.lock().unwrap() =
                paths.iter().map(|p| p.to_string()).collect();
            self.arm_conflict();
        }
    }

    #[async_trait]
    impl BranchMerger for FakeMerger {
        async fn merge_into_task_branch(
            &self,
            task: &Task,
            winning_session_id: &str,
            winning_branch: &str,
        ) -> Result<()> {
            if self
                .force_conflict
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                let paths = self.conflict_paths.lock().unwrap().clone();
                if paths.is_empty() {
                    return Err(anyhow!("merge conflict during reapply"));
                }
                return Err(anyhow!(
                    "Rebase produced conflicts for session '{}'. Conflicting paths: {}",
                    winning_session_id,
                    paths.join(", ")
                ));
            }
            self.merges.lock().unwrap().push((
                task.id.clone(),
                winning_session_id.to_string(),
                winning_branch.to_string(),
            ));
            Ok(())
        }
    }

    fn single_agent_shape() -> PresetShape {
        PresetShape {
            candidates: vec![PresetSlot {
                slot_key: "claude".into(),
                agent_type: "claude".into(),
            }],
            synthesize: false,
            select: false,
            consolidator: None,
            evaluator: None,
        }
    }

    fn multi_agent_shape() -> PresetShape {
        PresetShape {
            candidates: vec![
                PresetSlot {
                    slot_key: "claude".into(),
                    agent_type: "claude".into(),
                },
                PresetSlot {
                    slot_key: "codex".into(),
                    agent_type: "codex".into(),
                },
            ],
            synthesize: true,
            select: true,
            consolidator: Some(PresetSlot {
                slot_key: "synth".into(),
                agent_type: "claude".into(),
            }),
            evaluator: Some(PresetSlot {
                slot_key: "judge".into(),
                agent_type: "gemini".into(),
            }),
        }
    }

    #[test]
    fn promote_to_ready_provisions_task_host_and_stamps_task_row() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        let ready = orch.promote_to_ready(&task.id).expect("promote");

        assert_eq!(ready.stage, TaskStage::Ready);
        assert_eq!(ready.task_branch.as_deref(), Some("lucode/alpha"));
        assert!(ready.task_host_session_id.is_some());

        let calls = prov.host_calls.borrow();
        assert_eq!(calls.len(), 1, "exactly one task_host provisioning call");
        assert_eq!(calls[0].branch, "lucode/alpha");
        assert_eq!(calls[0].base_branch, "main");
        assert_eq!(calls[0].task_id, task.id);
        assert!(prov.slot_calls.borrow().is_empty());
    }

    #[test]
    fn promote_to_ready_fails_when_base_branch_missing() {
        let db = db();
        let task = seed_task(&db, "no-base", None);
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        let err = orch.promote_to_ready(&task.id).unwrap_err();
        assert!(err.to_string().contains("no base_branch"));
        assert_eq!(
            TaskService::new(&db).get_task(&task.id).unwrap().stage,
            TaskStage::Draft
        );
    }

    #[test]
    fn promote_to_ready_is_not_called_twice() {
        let db = db();
        let task = seed_task(&db, "twice", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");
        orch.promote_to_ready(&task.id).expect("first");

        let err = orch.promote_to_ready(&task.id).unwrap_err();
        assert!(err.to_string().contains("already has a task_host"));
    }

    #[test]
    fn start_stage_run_resolves_preset_task_override_beats_project_default() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        db.upsert_project_workflow_default(&ProjectWorkflowDefault {
            repository_path: task.repository_path.to_string_lossy().into_owned(),
            stage: TaskStage::Brainstormed,
            preset_id: Some("project-default".into()),
            auto_chain: false,
        })
        .unwrap();
        db.upsert_task_stage_config(&TaskStageConfig {
            task_id: task.id.clone(),
            stage: TaskStage::Brainstormed,
            preset_id: Some("task-override".into()),
            auto_chain: false,
        })
        .unwrap();

        let resolved = orch.resolve_stage_preset(&task, TaskStage::Brainstormed).unwrap();
        assert_eq!(resolved.preset_id.as_deref(), Some("task-override"));
    }

    #[test]
    fn start_stage_run_falls_back_to_project_default_when_no_task_override() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        db.upsert_project_workflow_default(&ProjectWorkflowDefault {
            repository_path: task.repository_path.to_string_lossy().into_owned(),
            stage: TaskStage::Brainstormed,
            preset_id: Some("project-default".into()),
            auto_chain: true,
        })
        .unwrap();

        let resolved = orch.resolve_stage_preset(&task, TaskStage::Brainstormed).unwrap();
        assert_eq!(resolved.preset_id.as_deref(), Some("project-default"));
        assert!(resolved.auto_chain);
    }

    #[test]
    fn start_stage_run_returns_none_when_no_config_anywhere() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();

        let resolved = orch.resolve_stage_preset(&task, TaskStage::Brainstormed).unwrap();
        assert_eq!(resolved.preset_id, None);
        assert!(!resolved.auto_chain);
    }

    #[test]
    fn start_stage_run_collapses_single_agent_preset_into_one_single_slot() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(
                &task.id,
                TaskStage::Brainstormed,
                Some("preset-single"),
                &single_agent_shape(),
            )
            .expect("start run");

        assert_eq!(started.sessions.len(), 1);
        assert_eq!(started.sessions[0].run_role, RunRole::Single);
        assert_eq!(
            started.sessions[0].slot_key.as_deref(),
            Some("claude"),
            "single-agent slot retains its slot_key for UI display",
        );
        assert!(
            started.sessions[0].branch.starts_with("lucode/alpha-run-"),
            "slot branch must be a sibling of the task branch: {}",
            started.sessions[0].branch,
        );
        assert_eq!(started.run.base_branch.as_deref(), Some("lucode/alpha"));
        // v2: a fresh run with no terminal timestamp + no bound sessions yet
        // derives Running. Pin the no-terminal-timestamp shape directly so the
        // assertion stays meaningful even as compute_run_status evolves.
        assert!(started.run.cancelled_at.is_none());
        assert!(started.run.confirmed_at.is_none());
        assert!(started.run.failed_at.is_none());

        // Provisioner was called with the same lineage we persisted on the
        // run row, not a stale/mismatched copy.
        let slot_calls = prov.slot_calls.borrow();
        assert_eq!(slot_calls.len(), 1);
        let call = &slot_calls[0];
        assert_eq!(call.task_id, task.id);
        assert_eq!(call.run_id, started.run.id);
        assert_eq!(call.run_role, RunRole::Single);
        assert_eq!(call.slot_key.as_deref(), Some("claude"));
        assert_eq!(call.agent_type, "claude");
        assert_eq!(call.branch, started.sessions[0].branch);
        assert_eq!(call.base_branch, "lucode/alpha");
    }

    #[test]
    fn start_stage_run_marks_run_running_after_slots_provisioned() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(
                &task.id,
                TaskStage::Brainstormed,
                Some("preset-single"),
                &single_agent_shape(),
            )
            .expect("start run");

        assert_eq!(
            started.run.cancelled_at.is_none() && started.run.confirmed_at.is_none() && started.run.failed_at.is_none(),
            true,
            "run must transition Queued -> Running after provisioning so the sidebar badge reflects active state",
        );
        let persisted = db.get_task_run(&started.run.id).unwrap();
        assert!(
            persisted.cancelled_at.is_none()
                && persisted.confirmed_at.is_none()
                && persisted.failed_at.is_none(),
            "DB row must agree with the returned StageRunStarted (no terminal timestamps)",
        );
    }

    #[test]
    fn start_stage_run_brainstorm_single_slot_records_wrapped_prompt() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Brainstormed,
            Some("preset-single"),
            &single_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let call = calls.first().expect("single slot call");
        assert_ne!(
            call.prompt, task.request_body,
            "brainstorm single slot must not receive the raw request body",
        );
        assert!(
            call.prompt.contains("output a brainstorm via"),
            "brainstorm single slot prompt must tell the agent how to deliver the brainstorm; got: {}",
            call.prompt,
        );
    }

    #[test]
    fn start_stage_run_spawns_candidate_consolidator_and_evaluator_on_distinct_branches() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(
                &task.id,
                TaskStage::Implemented,
                Some("preset-multi"),
                &multi_agent_shape(),
            )
            .expect("start run");

        // 2 candidates + consolidator + evaluator = 4 slots
        assert_eq!(started.sessions.len(), 4);
        let roles: Vec<RunRole> = started.sessions.iter().map(|s| s.run_role).collect();
        assert_eq!(
            roles,
            vec![
                RunRole::Candidate,
                RunRole::Candidate,
                RunRole::Consolidator,
                RunRole::Evaluator,
            ]
        );

        // Branches must be distinct and siblings of the task branch (not nested,
        // or git would refuse to create them).
        let branches: Vec<&str> = started.sessions.iter().map(|s| s.branch.as_str()).collect();
        for b in &branches {
            assert!(
                b.starts_with("lucode/alpha-run-"),
                "slot branch '{b}' must be a sibling of the task branch",
            );
        }
        let unique: std::collections::BTreeSet<&&str> = branches.iter().collect();
        assert_eq!(
            unique.len(),
            branches.len(),
            "each slot must get a distinct branch; saw {branches:?}",
        );

        // Verify the full lineage reached the provisioner: each slot's call
        // carries task_id/run_id/run_role/slot_key/agent_type/branch/base_branch.
        let calls = prov.slot_calls.borrow();
        assert_eq!(calls.len(), 4);
        let roles_in_calls: Vec<RunRole> = calls.iter().map(|c| c.run_role).collect();
        assert_eq!(roles_in_calls, roles);
        assert!(
            calls.iter().all(|c| c.task_id == task.id
                && c.run_id == started.run.id
                && c.base_branch == "lucode/alpha"),
            "all slot calls must share task/run lineage and the task branch as base",
        );
        // Candidate slots expose their slot_key/agent_type; consolidator and
        // evaluator bypass slot_key but carry a synthetic agent_type.
        let candidate_keys: Vec<Option<&str>> = calls
            .iter()
            .filter(|c| c.run_role == RunRole::Candidate)
            .map(|c| c.slot_key.as_deref())
            .collect();
        assert_eq!(candidate_keys, vec![Some("claude"), Some("codex")]);
        let consolidator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Consolidator)
            .expect("consolidator slot");
        assert_eq!(consolidator.agent_type, "claude");
        let evaluator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Evaluator)
            .expect("evaluator slot");
        assert_eq!(evaluator.agent_type, "gemini");
    }

    #[test]
    fn start_stage_run_brainstorm_multi_agent_slots_record_role_specific_prompts() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Brainstormed,
            Some("preset-multi"),
            &multi_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let candidate = calls
            .iter()
            .find(|c| c.run_role == RunRole::Candidate)
            .expect("candidate slot");
        assert!(
            candidate.prompt.contains("one of the brainstorm candidates"),
            "candidate prompt must frame the candidate role; got: {}",
            candidate.prompt,
        );

        let consolidator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Consolidator)
            .expect("consolidator slot");
        assert!(
            consolidator
                .prompt
                .contains("synthesize the brainstorm candidates"),
            "consolidator prompt must frame the synthesis role; got: {}",
            consolidator.prompt,
        );

        let evaluator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Evaluator)
            .expect("evaluator slot");
        assert!(
            evaluator
                .prompt
                .contains("score each brainstorm candidate"),
            "evaluator prompt must frame the scoring role; got: {}",
            evaluator.prompt,
        );
    }

    #[test]
    fn start_stage_run_planned_single_slot_records_wrapped_prompt() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Spec,
                "spec text",
                None,
                None,
            )
            .unwrap();
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Planned,
            Some("preset-single"),
            &single_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let call = calls.first().expect("single slot call");
        assert_ne!(
            call.prompt, task.request_body,
            "planned single slot must not receive the raw request body",
        );
        assert!(
            call.prompt.contains("write the implementation plan via"),
            "planned single slot prompt must tell the agent how to deliver the plan; got: {}",
            call.prompt,
        );
    }

    #[test]
    fn start_stage_run_planned_single_slot_surfaces_missing_spec() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Planned,
            Some("preset-single"),
            &single_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let call = calls.first().expect("single slot call");
        assert!(
            call.prompt.contains("current_spec is missing"),
            "planned prompt must surface a missing current_spec artifact; got: {}",
            call.prompt,
        );
        assert!(
            call.prompt.contains("do not guess"),
            "planned prompt must forbid guessing when current_spec is missing; got: {}",
            call.prompt,
        );
    }

    #[test]
    fn start_stage_run_planned_multi_agent_slots_record_role_specific_prompts() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Spec,
                "spec text",
                None,
                None,
            )
            .unwrap();
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Planned,
            Some("preset-multi"),
            &multi_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let candidate = calls
            .iter()
            .find(|c| c.run_role == RunRole::Candidate)
            .expect("candidate slot");
        assert!(
            candidate.prompt.contains("one of the planning candidates"),
            "candidate prompt must frame the planning candidate role; got: {}",
            candidate.prompt,
        );

        let consolidator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Consolidator)
            .expect("consolidator slot");
        assert!(
            consolidator.prompt.contains("synthesize the plan candidates"),
            "consolidator prompt must frame the plan synthesis role; got: {}",
            consolidator.prompt,
        );

        let evaluator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Evaluator)
            .expect("evaluator slot");
        assert!(
            evaluator
                .prompt
                .contains("score each plan candidate"),
            "evaluator prompt must frame the plan scoring role; got: {}",
            evaluator.prompt,
        );
    }

    #[test]
    fn start_stage_run_implemented_single_slot_records_wrapped_prompt() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Plan,
                "plan text",
                None,
                None,
            )
            .unwrap();
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Implemented,
            Some("preset-single"),
            &single_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let call = calls.first().expect("single slot call");
        assert_ne!(
            call.prompt, task.request_body,
            "implementation single slot must not receive the raw request body",
        );
        assert!(
            call.prompt.contains("implement the approved plan"),
            "implementation single slot prompt must authorize implementation work; got: {}",
            call.prompt,
        );
    }

    #[test]
    fn start_stage_run_implemented_single_slot_surfaces_missing_plan() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Implemented,
            Some("preset-single"),
            &single_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let call = calls.first().expect("single slot call");
        assert!(
            call.prompt.contains("current_plan is missing"),
            "implementation prompt must surface a missing current_plan artifact; got: {}",
            call.prompt,
        );
        assert!(
            call.prompt.contains("do not guess"),
            "implementation prompt must forbid guessing when current_plan is missing; got: {}",
            call.prompt,
        );
    }

    #[test]
    fn start_stage_run_implemented_multi_agent_slots_record_role_specific_prompts() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Plan,
                "plan text",
                None,
                None,
            )
            .unwrap();
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        orch.start_stage_run(
            &task.id,
            TaskStage::Implemented,
            Some("preset-multi"),
            &multi_agent_shape(),
        )
        .expect("start run");

        let calls = prov.slot_calls.borrow();
        let candidate = calls
            .iter()
            .find(|c| c.run_role == RunRole::Candidate)
            .expect("candidate slot");
        assert!(
            candidate
                .prompt
                .contains("one of the implementation candidates"),
            "candidate prompt must frame the implementation candidate role; got: {}",
            candidate.prompt,
        );

        let consolidator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Consolidator)
            .expect("consolidator slot");
        assert!(
            consolidator
                .prompt
                .contains("synthesize the implementation candidates"),
            "consolidator prompt must frame the implementation synthesis role; got: {}",
            consolidator.prompt,
        );

        let evaluator = calls
            .iter()
            .find(|c| c.run_role == RunRole::Evaluator)
            .expect("evaluator slot");
        assert!(
            evaluator
                .prompt
                .contains("score each implementation candidate"),
            "evaluator prompt must frame the implementation scoring role; got: {}",
            evaluator.prompt,
        );
    }

    #[test]
    fn start_stage_run_fails_when_task_not_promoted() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        let err = orch
            .start_stage_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                &single_agent_shape(),
            )
            .unwrap_err();
        assert!(err.to_string().contains("no task_branch"));
    }

    #[test]
    fn start_stage_run_rejects_unsupported_stage() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let err = orch
            .start_stage_run(&task.id, TaskStage::Pushed, None, &single_agent_shape())
            .expect_err("pushed must not be a startable stage run");

        assert!(err.to_string().contains("unsupported stage run stage"));
    }

    #[tokio::test]
    async fn confirm_stage_merges_winning_branch_and_advances_task_stage() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(
                &task.id,
                TaskStage::Brainstormed,
                None,
                &single_agent_shape(),
            )
            .unwrap();
        let winning = &started.sessions[0];

        let advanced = orch
            .confirm_stage(
                &started.run.id,
                &winning.session_id,
                &winning.branch,
                "manual",
            )
            .await
            .expect("confirm");

        assert_eq!(advanced.stage, TaskStage::Brainstormed);

        let merges = merger.recorded();
        assert_eq!(merges.len(), 1);
        assert_eq!(merges[0].0, task.id);
        assert_eq!(merges[0].1, winning.session_id);
        assert_eq!(merges[0].2, winning.branch);

        // Run row is now Completed (confirmed_at set) with the session as the selection.
        let run = db.get_task_run(&started.run.id).unwrap();
        assert!(
            run.confirmed_at.is_some(),
            "confirm_stage must stamp confirmed_at; compute_run_status reads that to derive Completed",
        );
        assert_eq!(
            crate::domains::tasks::run_status::compute_run_status(&run, &[]),
            crate::domains::tasks::entity::TaskRunStatus::Completed
        );
        assert_eq!(run.selected_session_id.as_deref(), Some(winning.session_id.as_str()));
    }

    #[tokio::test]
    async fn confirm_stage_walks_stage_run_flow_to_implemented() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Spec,
                "spec text",
                None,
                None,
            )
            .unwrap();
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Plan,
                "plan text",
                None,
                None,
            )
            .unwrap();
        for stage in [
            TaskStage::Brainstormed,
            TaskStage::Planned,
            TaskStage::Implemented,
        ] {
            let started = orch
                .start_stage_run(&task.id, stage, None, &single_agent_shape())
                .unwrap();
            let w = &started.sessions[0];
            orch.confirm_stage(&started.run.id, &w.session_id, &w.branch, "manual")
                .await
                .unwrap();
        }

        assert_eq!(
            TaskService::new(&db).get_task(&task.id).unwrap().stage,
            TaskStage::Implemented
        );
    }

    #[tokio::test]
    async fn confirm_stage_is_a_no_op_for_terminal_tasks() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        TaskService::new(&db)
            .update_content(
                &task.id,
                crate::domains::tasks::entity::TaskArtifactKind::Plan,
                "plan text",
                None,
                None,
            )
            .unwrap();
        db.set_task_stage(&task.id, TaskStage::Done).unwrap();

        let started = orch
            .start_stage_run(&task.id, TaskStage::Implemented, None, &single_agent_shape())
            .unwrap();
        let w = &started.sessions[0];
        let merges_before = merger.recorded().len();
        orch.confirm_stage(&started.run.id, &w.session_id, &w.branch, "manual")
            .await
            .unwrap();
        let merges_after = merger.recorded().len();
        assert_eq!(merges_after, merges_before + 1, "merger still fires once");
        assert_eq!(
            TaskService::new(&db).get_task(&task.id).unwrap().stage,
            TaskStage::Done,
            "task stage must not downgrade from Done",
        );
    }

    /// A winning session from a different run must be rejected before the
    /// merger is invoked — otherwise we'd merge the wrong work onto the task
    /// branch and silently advance a stage.
    #[tokio::test]
    async fn confirm_stage_rejects_session_from_different_run() {
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let run_a = orch
            .start_stage_run(&task.id, TaskStage::Brainstormed, None, &single_agent_shape())
            .expect("run A");
        let run_b = orch
            .start_stage_run(&task.id, TaskStage::Brainstormed, None, &single_agent_shape())
            .expect("run B");

        let winner_from_b = &run_b.sessions[0];
        let err = orch
            .confirm_stage(
                &run_a.run.id,
                &winner_from_b.session_id,
                &winner_from_b.branch,
                "manual",
            )
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("not run"),
            "expected cross-run rejection, got: {msg}"
        );
        assert!(
            merger.recorded().is_empty(),
            "merger must not fire when FK guard rejects session"
        );
    }

    #[tokio::test]
    async fn confirm_stage_wraps_merge_conflict_in_typed_sentinel() {
        // The merger fails with a "merge conflict" message; orchestration
        // must downgrade-tag it as MergeConflictDuringConfirm so the Tauri
        // command boundary can lift it into SchaltError::MergeConflict
        // without substring-matching localized text.
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        merger.arm_conflict();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(&task.id, TaskStage::Brainstormed, None, &single_agent_shape())
            .expect("run started");
        let winner = &started.sessions[0];

        let err = orch
            .confirm_stage(&started.run.id, &winner.session_id, &winner.branch, "manual")
            .await
            .unwrap_err();

        assert!(
            err.downcast_ref::<MergeConflictDuringConfirm>().is_some(),
            "expected MergeConflictDuringConfirm sentinel, got: {err}"
        );
    }

    #[test]
    fn parse_conflicting_paths_extracts_comma_list_after_marker() {
        let msg = "Rebase produced conflicts for session 'alpha'. \
                   Conflicting paths: src/foo.rs, src/bar.rs, src/baz.rs";
        assert_eq!(
            parse_conflicting_paths(msg),
            vec![
                "src/foo.rs".to_string(),
                "src/bar.rs".to_string(),
                "src/baz.rs".to_string(),
            ],
        );
    }

    #[test]
    fn parse_conflicting_paths_returns_empty_when_marker_absent() {
        assert!(parse_conflicting_paths("merge failed for unknown reason").is_empty());
    }

    #[test]
    fn parse_conflicting_paths_trims_trailing_period_and_whitespace() {
        let msg = "...unresolved conflicts. Conflicting paths:  a/b.rs ,  c/d.rs.";
        assert_eq!(
            parse_conflicting_paths(msg),
            vec!["a/b.rs".to_string(), "c/d.rs".to_string()],
        );
    }

    #[tokio::test]
    async fn confirm_stage_preserves_conflicting_files_in_typed_sentinel() {
        // When MergeService surfaces conflicting paths in its error message
        // (the canonical "Conflicting paths: a, b, c" tail), orchestration
        // must extract and forward those paths through
        // MergeConflictDuringConfirm.files so the Tauri boundary can hand
        // them to SchaltError::MergeConflict.files. Empty Vec hides the
        // conflict list from the merge-resolver UI.
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        merger.arm_conflict_with_paths(&["src/foo.rs", "src/bar.rs"]);
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(&task.id, TaskStage::Brainstormed, None, &single_agent_shape())
            .expect("run started");
        let winner = &started.sessions[0];

        let err = orch
            .confirm_stage(&started.run.id, &winner.session_id, &winner.branch, "manual")
            .await
            .unwrap_err();

        let sentinel = err
            .downcast_ref::<MergeConflictDuringConfirm>()
            .unwrap_or_else(|| panic!("expected MergeConflictDuringConfirm sentinel, got: {err}"));
        assert_eq!(
            sentinel.files,
            vec!["src/foo.rs".to_string(), "src/bar.rs".to_string()],
            "expected conflicting paths to be plumbed through the sentinel",
        );
    }

    #[tokio::test]
    async fn confirm_stage_rejects_when_task_branch_is_unset() {
        // A task without a task_branch (i.e. never promoted) cannot have a
        // canonical merge target. confirm_stage must fail-fast before the
        // merger tries to merge into a None branch — otherwise the user
        // sees "merge succeeded but stage advance failed — manual recovery
        // required" with no path forward.
        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));
        let prov = FakeProvisioner::new(&db);
        let merger = FakeMerger::default();
        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");

        // Manually start a run without going through promote_to_ready —
        // the run-svc layer doesn't require task_branch, but confirm_stage
        // does, so this exercises exactly the gap.
        let run = orch
            .run_svc()
            .create_task_run(&task.id, TaskStage::Brainstormed, None, None, None)
            .expect("start_run on un-promoted task");

        let err = orch
            .confirm_stage(&run.id, "any-session", "any-branch", "manual")
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("task_branch") || msg.contains("promote it to Ready"),
            "expected task_branch guard to surface, got: {msg}"
        );
        assert!(
            merger.recorded().is_empty(),
            "merger must not fire when task has no task_branch"
        );
    }

    #[test]
    fn default_slot_session_name_pairs_task_name_short_run_id_and_slot_index() {
        let name = default_slot_session_name("alpha", "abcdef1234", 0);
        assert_eq!(name, "alpha-abcdef12-00");

        let short_run = default_slot_session_name("alpha", "abc", 2);
        assert_eq!(
            short_run, "alpha-abc-02",
            "short run ids are used as-is without panicking"
        );
    }

    /// Regression for the head-of-line blocking bug where the Tauri command
    /// `lucode_task_confirm_stage` held the global `SchaltwerkCore` write
    /// guard for the full duration of `MergeService::merge_from_modal`,
    /// stalling every reader project-wide for up to 30s. The orchestrator
    /// itself only borrows `&Database` (which is internally synchronized by
    /// its connection pool); this test pins that contract by running
    /// `confirm_stage` with a merger blocked on a tokio oneshot and proving
    /// an independent operation on the same `Database` completes BEFORE the
    /// merger is released.
    #[tokio::test]
    async fn confirm_stage_does_not_block_concurrent_db_work_during_merge() {
        struct GatedMerger {
            release: tokio::sync::Mutex<Option<tokio::sync::oneshot::Receiver<()>>>,
            entered: tokio::sync::Notify,
        }

        #[async_trait]
        impl BranchMerger for GatedMerger {
            async fn merge_into_task_branch(
                &self,
                _task: &Task,
                _winning_session_id: &str,
                _winning_branch: &str,
            ) -> Result<()> {
                self.entered.notify_one();
                if let Some(rx) = self.release.lock().await.take() {
                    let _ = rx.await;
                }
                Ok(())
            }
        }

        let db = db();
        let task = seed_task(&db, "alpha", Some("main"));

        let prov = FakeProvisioner::new(&db);
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let merger = GatedMerger {
            release: tokio::sync::Mutex::new(Some(rx)),
            entered: tokio::sync::Notify::new(),
        };

        let orch = TaskOrchestrator::new(&db, &prov, &merger, "lucode");
        orch.promote_to_ready(&task.id).unwrap();
        let started = orch
            .start_stage_run(&task.id, TaskStage::Brainstormed, None, &single_agent_shape())
            .unwrap();
        let winner = started.sessions[0].clone();
        let run_id = started.run.id.clone();

        // Drive `confirm_stage` and a parallel DB write off the same `&db`.
        // If `confirm_stage` were holding any global lock that gated
        // database access, the parallel write would not complete until
        // after the merger releases. `Notify::notify_one` stores a permit
        // even when no waiter is registered, so the order between the
        // merger reaching its notify and the parallel future polling
        // `notified().await` does not matter.
        let confirm_fut = async {
            orch.confirm_stage(&run_id, &winner.session_id, &winner.branch, "manual")
                .await
        };

        let parallel_fut = async {
            merger.entered.notified().await;
            seed_task(&db, "beta", Some("main"));
            let _ = tx.send(());
        };

        let (confirm_res, ()) = tokio::join!(confirm_fut, parallel_fut);
        let confirmed = confirm_res.expect("confirm_stage completes after release");
        assert_eq!(confirmed.stage, TaskStage::Brainstormed);

        let beta_present = TaskService::new(&db)
            .list_tasks(Path::new("/repo"))
            .unwrap()
            .into_iter()
            .any(|t| t.name == "beta");
        assert!(
            beta_present,
            "concurrent DB write executed while confirm_stage was mid-merge",
        );
    }

    mod production {
        use super::super::*;
        use crate::domains::merge::service::MergeService;
        use crate::domains::sessions::db_sessions::SessionMethods;
        use crate::domains::sessions::service::SessionManager;
        use crate::domains::tasks::entity::{TaskStage, TaskVariant};
        use crate::domains::tasks::service::{CreateTaskInput, TaskService};
        use crate::infrastructure::database::{Database, TaskMethods};
        use std::path::{Path, PathBuf};
        use std::process::Command;
        use tempfile::TempDir;

        fn run_git(dir: &Path, args: &[&str]) {
            let out = Command::new("git")
                .args(args)
                .current_dir(dir)
                .output()
                .expect("git command");
            assert!(
                out.status.success(),
                "git {:?} failed in {}: stderr={}",
                args,
                dir.display(),
                String::from_utf8_lossy(&out.stderr),
            );
        }

        fn init_repo(path: &Path) {
            std::fs::create_dir_all(path).unwrap();
            run_git(path, &["init"]);
            run_git(path, &["config", "user.email", "test@example.com"]);
            run_git(path, &["config", "user.name", "Test User"]);
            std::fs::write(path.join("README.md"), "seed\n").unwrap();
            run_git(path, &["add", "."]);
            run_git(path, &["commit", "-m", "initial"]);
            run_git(path, &["branch", "-M", "main"]);
        }

        struct ProdFixture {
            _tmp: TempDir,
            repo_path: PathBuf,
            manager: SessionManager,
            db: Database,
        }

        fn fixture() -> ProdFixture {
            let tmp = TempDir::new().unwrap();
            let repo_path = tmp.path().join("repo");
            init_repo(&repo_path);
            let db_path = tmp.path().join("db.sqlite");
            let db = Database::new(Some(db_path)).unwrap();
            let manager = SessionManager::new(db.clone(), repo_path.clone());
            ProdFixture {
                _tmp: tmp,
                repo_path,
                manager,
                db,
            }
        }

        fn seed_task(db: &Database, repo_path: &Path, name: &str) -> Task {
            TaskService::new(db)
                .create_task(CreateTaskInput {
                    name,
                    display_name: None,
                    repository_path: repo_path,
                    repository_name: "repo",
                    request_body: "body",
                    variant: TaskVariant::Regular,
                    epic_id: None,
                    base_branch: Some("main"),
                    source_kind: None,
                    source_url: None,
                    issue_number: None,
                    issue_url: None,
                    pr_number: None,
                    pr_url: None,
                })
                .expect("seed task")
        }

        #[test]
        fn production_provisioner_creates_worktree_session_with_task_lineage() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");
            let provisioner = ProductionProvisioner::new(&fx.manager, &fx.db);

            let provisioned = provisioner
                .provision_task_host(&task, "lucode/alpha", "main")
                .expect("provision task host");

            assert!(
                provisioned.branch.starts_with("lucode/alpha"),
                "branch must descend from the requested task branch, got {}",
                provisioned.branch,
            );

            let session = fx
                .manager
                .get_session_by_id(&provisioned.session_id)
                .expect("session persisted");
            assert_eq!(session.name, "alpha");
            assert_eq!(session.branch, provisioned.branch);
            assert_eq!(session.parent_branch, "main");
            assert!(
                session.worktree_path.exists(),
                "worktree must be realized on disk: {}",
                session.worktree_path.display(),
            );

            let lineage = fx
                .db
                .get_session_task_lineage(&provisioned.session_id)
                .expect("load lineage");
            assert_eq!(lineage.task_id.as_deref(), Some(task.id.as_str()));
            assert_eq!(lineage.run_role.as_deref(), Some("task_host"));
            assert!(
                lineage.task_run_id.is_none(),
                "task_host has no run_id binding"
            );
            assert!(
                lineage.slot_key.is_none(),
                "task_host has no slot_key binding"
            );
            assert_eq!(lineage.task_stage.as_deref(), Some("draft"));
        }

        #[test]
        fn production_provisioner_task_host_prompt_is_briefing_not_raw_request_body() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");
            let provisioner = ProductionProvisioner::new(&fx.manager, &fx.db);

            let provisioned = provisioner
                .provision_task_host(&task, "lucode/alpha", "main")
                .expect("provision task host");

            let session = fx
                .manager
                .get_session_by_id(&provisioned.session_id)
                .expect("session persisted");
            let prompt = session.initial_prompt.expect("task host prompt");

            assert_ne!(
                prompt, task.request_body,
                "task host must not receive the raw request body as its agent prompt",
            );
            assert!(
                prompt.contains("alpha"),
                "task host prompt should name the task; got: {prompt}",
            );
            assert!(
                prompt.contains("Do NOT implement"),
                "task host prompt should forbid implementation in the durable host session; got: {prompt}",
            );
        }

        #[test]
        fn production_provisioner_run_slot_stamps_run_and_role_lineage() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");

            // Promote first so the task_branch exists for slot provisioning.
            let provisioner = ProductionProvisioner::new(&fx.manager, &fx.db);
            let host = provisioner
                .provision_task_host(&task, "lucode/alpha", "main")
                .expect("provision host");
            fx.db
                .set_task_host(
                    &task.id,
                    Some(&host.session_id),
                    Some(&host.branch),
                    Some("main"),
                )
                .unwrap();
            fx.db
                .set_task_stage(&task.id, TaskStage::Ready)
                .unwrap();

            let reloaded = fx.db.get_task_by_id(&task.id).unwrap();

            let run = TaskRunService::new(&fx.db)
                .create_task_run(
                    &task.id,
                    TaskStage::Brainstormed,
                    Some("preset-x"),
                    Some(&host.branch),
                    Some(&host.branch),
                )
                .unwrap();

            let slot = ExpandedRunSlot {
                run_role: RunRole::Candidate,
                slot_key: Some("claude-0".into()),
                agent_type: "claude".into(),
            };
            let branch = format!("lucode/alpha-run-{}-00", &run.id[..8]);

            let provisioned = provisioner
                .provision_run_slot(&reloaded, &run, &slot, &branch, &host.branch)
                .expect("provision slot");

            let session = fx
                .manager
                .get_session_by_id(&provisioned.session_id)
                .unwrap();
            assert_eq!(session.parent_branch, host.branch);

            let lineage = fx
                .db
                .get_session_task_lineage(&provisioned.session_id)
                .unwrap();
            assert_eq!(lineage.task_id.as_deref(), Some(task.id.as_str()));
            assert_eq!(lineage.task_run_id.as_deref(), Some(run.id.as_str()));
            assert_eq!(lineage.run_role.as_deref(), Some("candidate"));
            assert_eq!(lineage.slot_key.as_deref(), Some("claude-0"));
            assert_eq!(lineage.task_stage.as_deref(), Some("brainstormed"));
        }

        #[test]
        fn production_provisioner_run_slot_prompt_is_wrapped_not_raw_request_body() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");

            let provisioner = ProductionProvisioner::new(&fx.manager, &fx.db);
            let host = provisioner
                .provision_task_host(&task, "lucode/alpha", "main")
                .expect("provision host");
            fx.db
                .set_task_host(
                    &task.id,
                    Some(&host.session_id),
                    Some(&host.branch),
                    Some("main"),
                )
                .unwrap();
            fx.db
                .set_task_stage(&task.id, TaskStage::Ready)
                .unwrap();

            let reloaded = fx.db.get_task_by_id(&task.id).unwrap();
            let run = TaskRunService::new(&fx.db)
                .create_task_run(
                    &task.id,
                    TaskStage::Brainstormed,
                    Some("preset-x"),
                    Some(&host.branch),
                    Some(&host.branch),
                )
                .unwrap();

            let slot = ExpandedRunSlot {
                run_role: RunRole::Candidate,
                slot_key: Some("claude-0".into()),
                agent_type: "claude".into(),
            };
            let branch = format!("lucode/alpha-run-{}-00", &run.id[..8]);

            let provisioned = provisioner
                .provision_run_slot(&reloaded, &run, &slot, &branch, &host.branch)
                .expect("provision slot");

            let session = fx
                .manager
                .get_session_by_id(&provisioned.session_id)
                .expect("session persisted");
            let prompt = session.initial_prompt.expect("run slot prompt");

            assert_ne!(
                prompt, task.request_body,
                "run slot must not receive the raw request body as its agent prompt",
            );
            assert!(
                prompt.contains("one of the brainstorm candidates"),
                "run slot prompt should frame the candidate role; got: {prompt}",
            );
        }

        #[tokio::test]
        async fn production_merger_calls_merge_service_with_target_branch() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");

            let provisioner = ProductionProvisioner::new(&fx.manager, &fx.db);
            let host = provisioner
                .provision_task_host(&task, "lucode/alpha", "main")
                .unwrap();
            fx.db
                .set_task_host(
                    &task.id,
                    Some(&host.session_id),
                    Some(&host.branch),
                    Some("main"),
                )
                .unwrap();
            fx.db
                .set_task_stage(&task.id, TaskStage::Ready)
                .unwrap();
            let task = fx.db.get_task_by_id(&task.id).unwrap();

            // Add a commit on the task_host worktree so the task branch has
            // at least one commit we can then branch a slot off of.
            let host_session = fx.manager.get_session_by_id(&host.session_id).unwrap();
            std::fs::write(host_session.worktree_path.join("host.txt"), "host\n")
                .unwrap();
            run_git(&host_session.worktree_path, &["add", "."]);
            run_git(&host_session.worktree_path, &["commit", "-m", "host commit"]);

            let run = TaskRunService::new(&fx.db)
                .create_task_run(
                    &task.id,
                    TaskStage::Brainstormed,
                    None,
                    Some(&host.branch),
                    Some(&host.branch),
                )
                .unwrap();

            let slot = ExpandedRunSlot {
                run_role: RunRole::Single,
                slot_key: Some("claude".into()),
                agent_type: "claude".into(),
            };
            let slot_branch = format!("lucode/alpha-run-{}-00", &run.id[..8]);
            let slot_session = provisioner
                .provision_run_slot(&task, &run, &slot, &slot_branch, &host.branch)
                .unwrap();

            // Slot worktree commits a change we want to merge into the task branch.
            let slot_full = fx.manager.get_session_by_id(&slot_session.session_id).unwrap();
            std::fs::write(slot_full.worktree_path.join("slot.txt"), "slot change\n")
                .unwrap();
            run_git(&slot_full.worktree_path, &["add", "."]);
            run_git(&slot_full.worktree_path, &["commit", "-m", "slot commit"]);

            let merge_service = MergeService::new(fx.db.clone(), fx.repo_path.clone());
            let merger = ProductionMerger::new(&merge_service, &fx.manager);

            merger
                .merge_into_task_branch(&task, &slot_session.session_id, &slot_branch)
                .await
                .expect("merge succeeds");

            // After the merge, the task branch in the bare repo should
            // contain the slot's commit.
            let log = Command::new("git")
                .args(["log", "--oneline", &host.branch])
                .current_dir(&fx.repo_path)
                .output()
                .unwrap();
            let log_out = String::from_utf8_lossy(&log.stdout);
            assert!(
                log_out.contains("slot commit"),
                "task branch must contain the slot's commit after merge: {log_out}",
            );
        }

        #[tokio::test]
        async fn production_merger_errors_when_task_branch_missing() {
            let fx = fixture();
            let task = seed_task(&fx.db, &fx.repo_path, "alpha");
            // task still has no task_branch set (no promotion).
            let merge_service = MergeService::new(fx.db.clone(), fx.repo_path.clone());
            let merger = ProductionMerger::new(&merge_service, &fx.manager);

            let err = merger
                .merge_into_task_branch(&task, "bogus-session", "lucode/alpha")
                .await
                .unwrap_err();
            assert!(
                err.to_string().contains("no task_branch"),
                "unexpected error: {err}"
            );
        }

        /// Regression: `task.task_branch = None` must error explicitly, not
        /// silently merge onto the empty string via `unwrap_or_default()`.
        #[tokio::test]
        async fn production_merger_errors_when_task_branch_none() {
            let fx = fixture();
            let mut task = seed_task(&fx.db, &fx.repo_path, "alpha");
            task.task_branch = None;
            let merge_service = MergeService::new(fx.db.clone(), fx.repo_path.clone());
            let merger = ProductionMerger::new(&merge_service, &fx.manager);

            let err = merger
                .merge_into_task_branch(&task, "bogus-session", "lucode/alpha")
                .await
                .unwrap_err();
            let msg = err.to_string();
            assert!(
                msg.contains("no task_branch"),
                "expected no-task_branch error, got: {msg}"
            );
        }
    }
}
