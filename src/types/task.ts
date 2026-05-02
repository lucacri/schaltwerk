// Phase 7 Wave A.1.b: TypeScript types mirroring the v2 task aggregate.
//
// These types match the Rust wire shape produced by `domains::tasks::wire`
// and `domains::tasks::entity` after the Wave A.1.a serialization extensions.
//
// **Key v2 differences from v1's `src/types/task.ts`:**
// - `TaskRunStatus` does NOT include `'queued'` — that variant doesn't exist
//   in v2 (Phase 1 collapsed it; the derived getter only emits the five
//   variants below).
// - There is no `RunRole`. The slot identifier is `slot_key: string | null`
//   (Phase 3 dropped the enum).
// - `Task` carries no `current_spec` / `current_plan` / `current_summary`
//   fields — those are derived getters at the Rust layer (Phase 4 Wave F).
//   Use `TaskWithBodies` (returned by `lucode_task_get`) for the body-bearing
//   shape; list/refresh payloads are body-free.
// - `TaskRun.derived_status` is wire-only and may be `null` in pathological
//   cases (handler regression); use `assertDerivedStatus` to narrow to a
//   non-null value at the consumer boundary and surface backend regressions
//   loudly rather than silently rendering "Running".
// - `TaskStage` does NOT include `'cancelled'` (Phase 3 collapsed cancellation
//   to `Task.cancelled_at`).

export type TaskStage =
  | 'draft'
  | 'ready'
  | 'brainstormed'
  | 'planned'
  | 'implemented'
  | 'pushed'
  | 'done'

export const STAGE_ORDER: readonly TaskStage[] = [
  'draft',
  'ready',
  'brainstormed',
  'planned',
  'implemented',
  'pushed',
  'done',
] as const

export type TaskVariant = 'regular' | 'main'

export type TaskRunStatus =
  | 'running'
  | 'awaiting_selection'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskArtifactKind =
  | 'request'
  | 'spec'
  | 'plan'
  | 'review'
  | 'decision'
  | 'summary'
  | 'attachment'
  | 'link'

export type TaskPrState = 'open' | 'succeeding' | 'failed' | 'mred'

export type SelectionMode = 'auto' | 'manual' | 'evaluator'

/**
 * Mirrors the body-free `Task` JSON returned by `lucode_task_list` and
 * embedded in `TasksRefreshedPayload`. Per Phase 7 plan §0.3, this shape
 * does not carry artifact bodies — see [`TaskWithBodies`] for the
 * get-by-id surface that does.
 */
export interface Task {
  id: string
  name: string
  display_name: string | null
  repository_path: string
  repository_name: string
  variant: TaskVariant
  stage: TaskStage
  request_body: string
  source_kind: string | null
  source_url: string | null
  task_host_session_id: string | null
  task_branch: string | null
  base_branch: string | null
  issue_number: number | null
  issue_url: string | null
  pr_number: number | null
  pr_url: string | null
  pr_state: TaskPrState | null
  failure_flag: boolean
  epic_id: string | null
  attention_required: boolean
  created_at: string
  updated_at: string
  cancelled_at: string | null
  task_runs: TaskRun[]
}

/**
 * Body-bearing wire shape returned by `lucode_task_get` only. The Rust
 * `TaskWithBodies` flattens a base `Task` with three optional artifact
 * bodies populated from the `task.current_*(&db)` derived getters. The
 * frontend keys spec/plan/summary editor state off these fields.
 */
export interface TaskWithBodies extends Task {
  current_spec_body: string | null
  current_plan_body: string | null
  current_summary_body: string | null
}

/**
 * Wire shape for a task run. `derived_status` is populated by the Rust
 * handler via `compute_run_status(run, &session_facts)` before
 * serialization; `null` here means a backend handler skipped enrichment
 * (a regression). Consumers should narrow via [`assertDerivedStatus`]
 * rather than coalescing to a default.
 */
export interface TaskRun {
  id: string
  task_id: string
  stage: TaskStage
  preset_id: string | null
  base_branch: string | null
  target_branch: string | null
  selected_session_id: string | null
  selected_artifact_id: string | null
  selection_mode: SelectionMode | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  confirmed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
  derived_status: TaskRunStatus | null
}

export interface TaskArtifact {
  id: string
  task_id: string
  artifact_kind: TaskArtifactKind
  title: string | null
  content: string | null
  url: string | null
  metadata_json: string | null
  is_current: boolean
  produced_by_run_id: string | null
  produced_by_session_id: string | null
  created_at: string
  updated_at: string
}

export interface TaskArtifactVersion {
  history_id: number | null
  task_id: string
  artifact_kind: TaskArtifactKind
  content: string | null
  produced_by_run_id: string | null
  produced_by_session_id: string | null
  is_current: boolean
  superseded_at: number | null
}

export interface TaskStageConfig {
  task_id: string
  stage: TaskStage
  preset_id: string | null
  auto_chain: boolean
}

export interface ProjectWorkflowDefault {
  repository_path: string
  stage: TaskStage
  preset_id: string | null
  auto_chain: boolean
}

export interface PresetSlot {
  slotKey: string
  agentType: string
}

export interface PresetShape {
  candidates: PresetSlot[]
  synthesize: boolean
  select: boolean
  consolidator: PresetSlot | null
  evaluator: PresetSlot | null
}

export interface ProvisionedRunSession {
  session_id: string
  branch: string
  slot_key: string | null
}

export interface StageRunStarted {
  run: TaskRun
  sessions: ProvisionedRunSession[]
}

export interface ClarifyRunStarted {
  taskId: string
  sessionId: string
  runId: string
  branch: string
  reused: boolean
}

/**
 * Payload shape for `SchaltEvent::TasksRefreshed`. Carries the full task
 * list for the project; runs are embedded under `task.task_runs[]` with
 * `derived_status` populated. Body fields are deliberately absent — see
 * the Phase 7 plan §0.3 split decision.
 */
export interface TasksRefreshedPayload {
  project_path: string
  tasks: Task[]
}

/**
 * Narrow `TaskRun.derived_status` to a non-null value. Throws when the
 * backend handler returned a run without enrichment — a Phase 7 invariant
 * violation. Surface this loudly rather than silently coalescing to
 * `'running'`; the goal is to catch handler regressions at the consumer
 * boundary, not to mask them.
 */
export function assertDerivedStatus(run: TaskRun): TaskRunStatus {
  if (run.derived_status === null) {
    throw new Error(
      `task run ${run.id} (task ${run.task_id}, stage ${run.stage}) has \
null derived_status: backend handler skipped wire enrichment. This is a \
Phase 7 invariant violation; check the lucode_task_* command flow.`,
    )
  }
  return run.derived_status
}

/**
 * Predicate for "this run is in a non-terminal state and may still produce
 * new sessions / artifacts." Used by sidebar predicates to filter active
 * runs from history. The v2 set of active statuses is strictly smaller than
 * v1's — `'queued'` does not exist.
 */
export function isActiveTaskRun(run: TaskRun): boolean {
  return (
    run.derived_status === 'running' || run.derived_status === 'awaiting_selection'
  )
}

/**
 * Predicate for terminal run statuses. Equivalent to `!isActiveTaskRun`
 * for non-null `derived_status`, but explicit so callers don't conflate
 * "terminal" with "successful."
 */
export function isTerminalTaskRunStatus(status: TaskRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
