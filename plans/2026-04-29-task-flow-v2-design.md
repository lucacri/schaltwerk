# task-flow v2 — design

**Status:** draft, pre-implementation
**Branch (target):** `task-flow-v2` (off `main`)
**Replaces:** the v1 task-flow surface currently shipping on the `task-flow` branch (~96 commits ahead of `main`)
**Estimated scope:** 4–6 phases, weeks of work

## Why a rewrite

The v1 task-flow surface works but accumulates structural debt at a rate that the recent fix sweep (commits `cf55de1d`..`5ab1a394`) made obvious. The headline observation:

> **The system has three orthogonal state machines that have to stay in sync — `Task.stage`, `TaskRun.status`, and `Session.{status, state}` — and ~70% of the bugs we just fixed are leaks at the seams between them.**

Concrete examples from the recent fix sweep that were *all* state-machine sync failures:

- `TaskRunStatus::Queued → Running` had no production caller; the run lifecycle was wired half-way (commit `cf55de1d`).
- `cancel_task_cascading` left tasks half-cancelled (host `Cancelled`, parent `Ready`); fixed via host-anchored Option B (commit `8942f994`).
- `AwaitingSelection` and `Failed` had no signal source until we wired the dispatcher (commit `5ab1a394`).
- `failure_flag: bool` on Task vs `failure_reason: Option<String>` on TaskRun — two ways to express the same concept that have to agree.
- `auto_advance` doc table was stale because the impl drifted from the documented machine.

Plus orthogonal but cross-cutting issues:

- Single global `RwLock<SchaltwerkCore>` that protects nothing useful (`Database` is internally synchronized; `repo_path` is immutable). Discovered during the lock-release fix; documented in `project_schaltwerkcore_rwlock.md`.
- `Sidebar.tsx` is 3000+ lines because the data model fights the UI model.
- `SchaltError` discipline applied unevenly (~10% of task commands).
- 12 fix-up commits in the last 30 of `task-flow`, concentrated on the same files.

The v2 rewrite is not about adding features. It's about reducing the surface area where these classes of bugs *can* exist.

## Design principles

1. **One state machine per aggregate, not three.** Collapse `TaskRunStatus` into derived state computed from sessions + artifacts.
2. **Lock at the granularity of the work, not globally.** Per-task mutex; concurrent tasks proceed independently.
3. **Stage = artifact production.** Re-running a stage appends a new version, never mutates the previous.
4. **Observe the world; don't duplicate it in DB.** Session liveness, agent activity, and run status are *projections*, not stored fields.
5. **Errors are typed at the boundary or not at all.** One canonical `TaskFlowError`, used everywhere.
6. **Events for UI updates, direct calls for domain coordination.** No more cross-domain state coordination via `SchaltEvent`.

## The 10 changes

### 1. Drop `TaskRunStatus` entirely
- Replace the persisted enum with a derived getter.
- New definition:
  ```
  Running          = at least one bound session is alive AND not idle
  AwaitingSelection = all bound sessions are alive AND idle (WaitingForInput)
  Completed         = task.confirmed_winner_for_run(run_id).is_some()
  Failed            = at least one bound session exited non-zero AND no successful sibling
  Cancelled         = run.cancelled_at.is_some()
  ```
- DB schema: drop `task_runs.status` column. Keep `task_runs.cancelled_at`, add `task_runs.confirmed_at`.
- Migration: derive `cancelled_at` from existing `status = 'cancelled'` rows; drop the column in a phase boundary.
- Eliminates: `mark_running`, `mark_awaiting_selection`, `fail_run` API surface (and all five wires we just landed). The `attention_bridge` listener simplifies to just maintaining its in-memory state — no DB writes from it.

### 2. Per-task mutex
- Replace `Arc<RwLock<SchaltwerkCore>>` with a `DashMap<TaskId, Arc<Mutex<()>>>` (or equivalent).
- Operations on different tasks proceed concurrently.
- Operations on the same task serialize without blocking the rest of the app.
- The `ConfirmStageResources` snapshot pattern goes away — no longer needed.
- The 5s→30s timeout bump goes away too.

### 3. Stage = immutable artifact production
- `TaskArtifact` already exists and is mostly immutable. Make it fully so.
- Each stage execution produces a new artifact (versioned). The "stage pointer" is `task.current_artifact_id_for_stage(stage)`.
- `current_spec` / `current_plan` / `current_summary` denormalized columns become derived getters.
- Re-running a stage = create a new artifact version. Never mutate prior content.

### 4. Drop `RunRole` enum
- Replace 6-variant enum with `slot_key: Option<String>` only.
- The orchestrator sees N parallel sessions; the user picks which one wins.
- "candidate vs consolidator vs evaluator" becomes UI labeling, not domain branching.
- Eliminates ~12 match arms across the codebase.

### 5. Session state is observable
- Drop `SessionState::{Processing, Running}` and `SessionStatus::{Active, Cancelled}`.
- Replace with `cancelled_at: Option<Timestamp>` only.
- Liveness, agent-running, idle-ness are computed from worktree existence + PTY state + attention bridge.
- The reconciler has less work to do (no DB↔runtime drift to detect).

### 6. `TaskStage::Cancelled` becomes `task.cancelled_at`
- `TaskStage` enum no longer has `Cancelled`.
- `task.cancelled_at: Option<Timestamp>` is orthogonal to `task.stage`.
- Sort comparators stop being weird (`STAGE_ORDER` no longer lists `cancelled` after `done`).
- `is_cancelled` becomes `task.cancelled_at.is_some()`.

### 7. One canonical `TaskFlowError`
- Single enum at the boundary, exported from `domains::tasks::errors`.
- All task commands return `Result<_, TaskFlowError>`.
- Frontend gets one exhaustive switch in `getErrorMessage`.
- `SchaltError` continues to exist for non-task surfaces (forge, sessions outside tasks, power) but doesn't leak into task commands.

### 8. Idle detection: explicit MCP tool, not heuristic
- New MCP tool: `lucode_task_run_done { run_id, slot_session_id, artifact_id, status: "ok" | "failed", reason? }`.
- Agents call this when they finish work.
- The 5s OSC-based heuristic stays as a fallback for agents that don't cooperate, but the primary signal is explicit.
- Eliminates flapping risk and the "missed the signal" risk (5s threshold, sticky AwaitingSelection, etc.).

### 9. Direct calls, not event-bus coordination for domain logic
- `attention_bridge` no longer flips `TaskRun` status. It just maintains its in-memory map and calls `task_run_observer.on_session_idle(session_id)` directly.
- The `OnceCell` dispatcher pattern from the recent fix goes away — the listener is constructed at startup and passed by reference.
- `SchaltEvent` is reserved for UI updates only.

### 10. Sidebar.tsx split
- Hard cap on React components: 500 lines.
- Sidebar.tsx becomes a thin projection. Helpers extracted into `src/components/sidebar/helpers/`.
- `TaskRow.tsx` and `StageSection.tsx` import from sibling helper modules, not from `Sidebar.tsx`.
- Kills the parent→child circular import.

## What stays

- Tauri + React + Rust + xterm.js + tmux + per-session worktrees.
- Phase 0 schema-backup-then-mutate migration model (`backup_sessions_to_legacy_archive`).
- `alter_add_column_idempotent` helper.
- Pure `decide_next_stage` state machine (the only state machine that's well-shaped — pure function over (stage, failure, pr_state)).
- `failure_flag` mechanic on Task (because PR state can fail post-merge — that's a Task-level concern, not a TaskRun-level one).
- Phase 0 backup model.
- `SchaltEvent` for UI updates (just stop using it for cross-domain coordination).
- MCP REST server pattern.
- `TauriCommands` enum (no string-literal `invoke` calls).
- CLAUDE.md discipline (no setTimeout, theme system, type-safe events, RAII test cleanup, knip, cargo shear, `#![deny(dead_code)]`).
- Forge integration shape.

## Phase plan

### Phase 0 — backup + branch
- Branch from `main`, not `task-flow`.
- Snapshot the current `task_runs`, `tasks`, `task_artifacts`, `sessions` shape into a frozen reference doc (so reviewers can see the delta).
- Set up `plans/task-flow-v2-status.md` for phase tracking.

### Phase 1 — collapse `TaskRunStatus`
- Add `task_runs.cancelled_at` and `task_runs.confirmed_at` columns.
- Backfill from existing `status` values.
- Replace all `run.status` reads with derived getters.
- Drop `task_runs.status` column.
- Frontend: replace `run.status` reads with the new getter.
- Run `just test` after each step; fix what breaks.

### Phase 2 — per-task mutex
- Replace `Arc<RwLock<SchaltwerkCore>>` callers with `Arc<TaskLockManager>` that hands out per-task locks.
- For non-task surfaces (e.g. `lucode_core_*` commands), use a singleton mutex or accept that those serialize globally.
- Delete `ConfirmStageResources` and the snapshot pattern.

### Phase 3 — drop `RunRole`, drop `SessionState`/`SessionStatus`
- Migrate sessions to `cancelled_at: Option<Timestamp>`.
- Backfill from `status = 'cancelled'`.
- Replace 6-variant `RunRole` with `slot_key`.
- Update sidebar/UI to render N parallel slots without role-specific badges.
- Frontend: drop `run_role` switch statements; use `slot_key` for display.

### Phase 4 — `TaskFlowError` + observable session
- Define `TaskFlowError`. Sweep all task commands.
- Drop `failure_flag` and `failure_reason` from the Run; keep on Task only.
- Make `current_spec`/`current_plan`/`current_summary` derived getters over `TaskArtifact`.

### Phase 5 — explicit `lucode_task_run_done` + listener cleanup
- Add the MCP tool.
- Update built-in agents (Claude, Codex) to call it on completion (where possible).
- Keep the OSC heuristic as fallback.
- Drop the `OnceCell` dispatcher pattern; pass listeners by reference.

### Phase 6 — Sidebar refactor
- Extract helpers into `src/components/sidebar/helpers/`.
- Cap each file at 500 lines.
- Kill the parent→child import circle.
- Verify the sidebar's behavior is unchanged via the existing test suite + manual smoke test.

## Migration / data compatibility

- Existing user data MUST migrate cleanly. Two approaches:
  1. **In-place migration on first launch of v2.** Phase 0 backup pattern; backfill new columns from old; drop old columns.
  2. **Fresh DB.** Lucode is a personal app; users have a small number of in-flight tasks. A migration tool that exports v1 sessions, then imports them into v2's schema, is acceptable.
- Default to (1). (2) is a fallback if (1) becomes too fragile.

## Risks

| Risk | Mitigation |
|---|---|
| Rewrite drags on for months | Phase boundaries are firm; each phase merges to `task-flow-v2` branch independently. No "all or nothing" merge. |
| Loses tests we just wrote | Most tests pin v1 shape (e.g. `mark_running` regression test). Expect ~30% rewrite. The Phase 13 cancel-cascade tests stay because cancel semantics don't change. |
| Tmux delayed-detection gap remains | Out of scope for v2. Track separately; unrelated to the state-machine collapse. |
| Reconciler value disappears | Add explicit append-only event log (`task_events` table) for audit/debugging, not for state computation. Replaces what the reconciler implicitly provided. |
| Breaking change for MCP clients | Document `lucode_task_run_done` tool; existing tools (`lucode_task_*`) keep their signatures. |

## Definition of done

- All v1 task-flow user-visible features still work in v2 with no regression.
- 0 references to `TaskRunStatus` in production code (the enum may stay defined for the migration; never read or written).
- 0 references to `RunRole` in production code.
- 0 references to `SessionState::Processing` or `SessionStatus::Active` in production code.
- `Sidebar.tsx` < 500 lines.
- `just test` green.
- Two-way binding test for each phase boundary (per `feedback_regression_test_per_fix.md`).
- Architecture tests still pass (`arch_domain_isolation`, `arch_layering_database`).
- Manual smoke test: create task, run all stages, confirm winners, observe lifecycle badges, cancel + reopen.

## Out of scope for v2

- Tmux pane-died live detection.
- AwaitingSelection reversibility (currently sticky; design choice — not a v2 deliverable).
- Multi-project task coordination.
- Cloud sync / multi-machine task continuity.
- Renaming `Mred` → `Merged` (cosmetic; do separately).

## Tracking

- `plans/2026-04-29-task-flow-v2-design.md` — this file. The durable design source.
- `plans/2026-04-29-task-flow-v2-status.md` — phase tracker, updated per merge.
- `task_events` table (Phase 5) — append-only event log; audit/timeline.
- Auto-memory `project_taskflow_v2_charter.md` — pointer for future sessions to find this doc.
