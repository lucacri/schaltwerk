# Task Lifecycle Overhaul Design

## Context

Lucode currently splits one unit of work across two durable records (`specs` and `sessions`) and derives lifecycle from multiple overlapping fields (`SpecStage`, `SessionState`, `SessionStatus`, `ready_to_merge`, and the newer derived `Stage`). That model can say whether a row is draft-ish, running, or mergeable, but it cannot say which production step the row belongs to or express a sequenced pipeline rooted in one task.

The new model is task-first and intentionally replaces the shipped taxonomy. A regular Task owns its durable problem statement, its stage progression (`draft -> ready -> brainstormed -> planned -> implemented -> pushed -> done`), the ready-stage parent branch, the per-stage workflow configuration, and the child execution sessions created for each multi-agent stage. The old orchestrator remains only as a special task variant that runs in `main` without a worktree or stage pipeline.

## Decision

Implement the overhaul in three layers:

1. Persist Tasks directly.
   Replace the `specs` table with a `tasks` table and add a `task_stage_workflows` table plus task-stage execution metadata on `sessions`. Keep the MCP `/api/specs/*` and Lucode spec commands working by treating them as compatibility aliases over task rows in the `draft` and `ready` phases.

2. Reuse sessions for executable work.
   Keep `sessions` as the worktree-bearing execution record, but make every running row belong to a task and a task stage. The `ready` transition creates the task root worktree/branch. `brainstormed`, `planned`, and `implemented` stages create child sessions branched from that root branch, not from `main`. Existing consolidation rounds generalize to per-stage candidate/judge rounds instead of being implementation-only.

3. Project tasks into the existing UI surfaces.
   Sidebar/session APIs continue returning enriched rows, but draft/ready tasks are projected from the task table and execution rows carry the task stage explicitly rather than via `ready_to_merge`/legacy derivation. The Kanban board, spec editor, and creation flows are rewired around the new stage names and workflow bindings.

## Data Model

### Task row

- `id`
- `name`
- `display_name`
- `repository_path`
- `repository_name`
- `variant` (`regular` | `main`)
- `stage` (`draft` | `ready` | `brainstormed` | `planned` | `implemented` | `pushed` | `done` | `cancelled`)
- `content`
- `implementation_plan`
- `ready_session_id`
- `ready_branch`
- `base_branch`
- `issue_*` / `pr_*`
- `epic_id`
- `attention_required`
- `clarification_started`
- timestamps

### Task workflow row

One row per `(task_id, stage)` for `brainstormed`, `planned`, `implemented`, and `pushed`:

- `preset_id`
- `judge_preset_id`
- `auto_chain`

The create flow seeds all rows from the selected workflow template. The user can override any stage later without changing the task identity.

### Session row extensions

- `task_id`
- `task_stage`
- `task_role` (`ready_root` | `candidate` | `judge` | `main_host`)

Existing branch/worktree metadata stays on sessions. Merge service continues targeting `parent_branch`.

### Consolidation rounds

Keep the round table, but make `round_type` equal the task stage (`brainstormed`, `planned`, `implemented`) rather than the old implementation/plan split. Round confirmation merges the chosen candidate back into the task's ready/root branch through the existing merge service.

## Flow

1. `draft`
   Task exists without a worktree. MCP draft/spec commands mutate the task row.

2. `ready`
   Starting a draft creates exactly one ready-root session and worktree on `lucode/<task-name>`. That session becomes the parent branch for later stage executions.

3. `brainstormed` / `planned` / `implemented`
   Starting a stage creates one or more candidate sessions from the ready-root branch using stage-specific branch names like `lucode/<task-name>_<stage>_v2`. If multiple candidates exist, a judge is required. Confirming the winner merges it into the ready-root branch and advances the task stage.

4. `pushed`
   If the project has forge support and `uses_forge_ci` enabled, pushing/PR creation moves the task to `pushed`. CI refreshes and autofix continue to use the existing forge hooks; green CI advances the task to `done`.

5. `done` / `cancelled`
   Terminal states live on the task row. Child sessions can still be archived/cancelled as execution artifacts, but the task stage is authoritative.

## Compatibility

- Tauri commands and MCP routes named around `spec` continue to work as aliases over tasks.
- Existing session creation APIs remain for raw execution sessions, but task-driven stage APIs become the main path.
- Orchestrator commands become wrappers over a `main`-variant task host so terminal spawning goes through the same session/task launch machinery.

## Testing

- Rust schema/repository tests for tasks, workflow rows, and session lineage.
- Rust service tests for `draft -> ready`, stage candidate creation, judge confirmation, and direct `implemented -> done` when forge/CI is disabled.
- TypeScript tests for the new task stage mapping, task projection into sidebar rows, and create-payload workflow bindings.
- MCP tests proving `/api/specs/*` compatibility over tasks.
