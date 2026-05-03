# task-flow v2 — Phase 7 plan: Task UI as the unified surface

**Status:** approved-as-edited (review pass complete); Wave A.1 ready to start
**Branch:** `task-flow-v2`
**Design:** [`2026-04-29-task-flow-v2-design.md`](./2026-04-29-task-flow-v2-design.md)
**Status tracker:** [`2026-04-29-task-flow-v2-status.md`](./2026-04-29-task-flow-v2-status.md) — Phases 0–6 + 5.5 complete; backend ships, frontend does not bind.
**Baseline (v1 reference):** [`2026-04-29-task-flow-v2-baseline.md`](./2026-04-29-task-flow-v2-baseline.md), plus the v1 task-flow branch at `b1f38f63` for UI shape references.

## Why this phase

The v2 backend (Phases 0–6) collapsed three orthogonal state machines into one observable derivation, dropped `RunRole`, replaced `RwLock<SchaltwerkCore>` with per-task locks, made artifacts immutable, and split `Sidebar.tsx` from 2236 lines to 494. **None of that is reachable from the UI.** A grep of `src/` for the 25 task-aggregate Tauri commands returns one hit (`LucodeTaskRunDone`, never invoked). The frontend on `task-flow-v2` is byte-identical to `main`: users see "Create new spec," not "Create new task." Every task created from MCP or scripts is invisible in the sidebar.

This was a charter scope gap. The v2 design doc treated Phase 6 as a refactor; it should have been a UX rebuild. The user accepts that and is keeping v2 unmerged until the UI catches up.

Phase 7 fills the gap. The task aggregate replaces *spec* and *session* and *version group* as user-facing entities. They become **states or affordances** within a task, not top-level lists.

## Honest scope check

This is Option B from the kickoff: **rebuild the UI fresh on top of v2's backend**, using the v1 task-flow branch as a *rendering shape* reference but not as a code source. Audit-first: every file in this plan is named because the audit found it, not because the design doc imagined it.

The work is multi-week. **One wave per session, with explicit hand-offs**. Plan is sized to **18–22 sub-waves** grouped under 5 thematic chunks (A–E). Phase 6 sized itself similarly (28+ sub-waves) and shipped clean — underestimating wave count breaks the per-session cadence. The user explicitly chose this over a cutover-and-pray.

The plan does not commit to a wave-per-session pace; it commits to a wave-per-PR-quality-bar pace. A small wave can ship in one session; a large one (typically A.1, C.1, C.3, D.1, D.2) might need two. **Every wave that lands a Tauri command bind, a wire-shape change, or a state-table guard is a candidate for splitting.**

### One backend touchpoint, by exception

This phase is "frontend rebuild." But two concrete backend edits are necessary and in scope:

1. **Wire-shape extensions** (Wave A.1): adding three optional `current_*_body` fields and one `derived_status` field to the JSON serialization of `Task` / `TaskRun`. Pure handler-level change; populated from existing derived getters.
2. **Event emission gap closure** (Wave A.3.b): the OSC-idle-detection path through `session_facts_bridge::record_first_idle_on_db` writes `first_idle_at` but does **not** emit `SchaltEvent::TasksRefreshed`. The explicit MCP `lucode_task_run_done` path does (verified at `commands/tasks.rs:1103, 1129`). This means a slot's derived status can flip from Running → AwaitingSelection without the UI being told. Phase 7 closes this — emit `TasksRefreshed` after a successful first-idle write. ~5 lines, one round-trip test.

These are wire-and-event extensions, **not** domain-logic changes. The §5 out-of-scope item below is phrased to reflect this distinction.

---

## §0 Audit — what exists today

This section is the current frontend v2 surface inventory, as found by parallel read-only agents on disjoint scopes. Every "transform" or "remove" claim in §1–§5 below traces to a line range in §0. The surfaces listed here are the work; the rest of the plan turns them into tasks.

### §0.1 Sidebar surfaces (spec/session/version-group flavored, no task awareness)

| File | Lines | Renders | Reads from | Phase 7 fate |
|---|---|---|---|---|
| `src/components/sidebar/Sidebar.tsx` | 71–494 | Section list (specs/running) + epic groups | `useSessions()` → `EnrichedSession[]` | **Rewrite top-down.** Sections become stage groups; rows become tasks. Helpers/hooks/views composition stays. |
| `src/components/sidebar/hooks/useSidebarSectionedSessions.ts` | 25–68 | Splits sessions into `'specs'` / `'running'` via `aggregate.state === 'spec'` | `EnrichedSession[]` + `SessionVersionGroupType[]` | **Replace** with `useSidebarStageSections` keyed by `Task.stage` (Draft / Ready / Brainstormed / Planned / Implemented / Pushed / Done; Cancelled separate). |
| `src/components/sidebar/helpers/versionGroupings.ts` | 49–90 | `groupVersionGroupsByEpic`, `splitVersionGroupsBySection` | session aggregate | **Demote.** Version groups become an *intra-task-row* concern (multi-candidate slots inside a stage run), not a top-level grouping. Epic grouping survives at the stage level. |
| `src/components/sidebar/views/SidebarSectionView.tsx` | 27–135 | Renders epic groups + ungrouped within a section | `groups: SessionVersionGroupType[]` | **Replace** with `SidebarStageSection` that renders task rows under a stage header. |
| `src/components/sidebar/views/SidebarSessionList.tsx` | 114–185 | Two `<SidebarSectionView>` renders (specs / running) | `sectionGroups.specs`, `sectionGroups.running` | **Replace** — render N stage sections, not 2 lifecycle sections. |
| `src/components/sidebar/views/SidebarVersionGroupRow.tsx` | 25–80 | Wraps `<SessionVersionGroup>` | `SessionVersionGroupType` | **Demote** — used only inside expanded task rows for multi-candidate stage runs (not at top level). |
| `src/components/sidebar/SessionVersionGroup.tsx` | 88–500+ | Consolidation header + candidate list | `is_consolidation`, `consolidation_*` | **Reuse via wrapping** — the labeled-affordance + state-table pattern is the canonical multi-candidate UI. Phase 7 generalizes it from "consolidation only" to "any multi-candidate stage run." |
| `src/components/sidebar/SessionCard.tsx` | 1000+ | Single session inline (status, judge, dirty, agent badges) | `SessionInfo` | **Reuse with task context.** SessionCard stays as-is for individual slot rendering; the *outer* task row is new. |
| `src/components/sidebar/hooks/useConsolidationActions.ts` | 12–58 | Trigger judge + confirm winner | `SchaltwerkCoreTriggerConsolidationJudge`, `SchaltwerkCoreConfirmConsolidationWinner` | **Refactor** — confirm-winner becomes `lucode_task_confirm_stage`. Judge stays for consolidation-stage backward-compat (existing v2 consolidation flow). |
| `src/components/sidebar/helpers/consolidationGroupDetail.ts` | 3–30 | Extracts source versions from a group | `SessionVersionGroupType` | **Reuse**, generalize to "extract candidate slots from a task run." |
| `src/components/sidebar/views/SidebarHeaderBar.tsx` | 14–69 | View mode toggle (list/board) | local | **Keep.** Phase 7 may add a stage-filter toggle here later (out of scope for the initial port). |
| `src/components/sidebar/views/OrchestratorEntry.tsx` | 1–106 | Orchestrator session card at top of sidebar | session lookup | **Keep** — orchestrator is a special-case session that works in main repo; not a task. |

### §0.2 App shell (creation flows + Tauri invocations)

| Location | Lines | What it does | Phase 7 fate |
|---|---|---|---|
| `src/App.tsx` ~2561–2591 | "Start Agent" button | `setNewSessionOpen(true)` → `handleCreateSession` (1907) | **Replace** with "+ New Task" — primary creation affordance. |
| `src/App.tsx` ~2592–2623 | "Create Spec" button | `setOpenAsSpec(true); setNewSessionOpen(true)` | **Remove.** Spec creation collapses into task-creation (a new task starts at Draft stage with the user's request body). |
| `src/App.tsx:1907–2088` | `handleCreateSession()` | Calls `SchaltwerkCoreCreateSpecSession` (1947) or `SchaltwerkCoreCreateSession` (2026, in a loop for multi-version) | **Split.** "+ New Task" → `lucode_task_create`. Spec/session creation paths kept only for backward-compat with non-task surfaces (orchestrator, ad-hoc sessions). |
| `src/App.tsx` (selection logic + `SelectionContext`) | various | Selection drives right-pane (terminals, diff, spec editor) | **Augment**: selection model gains `kind: 'task' \| 'task-run' \| 'task-slot' \| 'orchestrator' \| 'session'`. Existing session paths keep working for orchestrator + ad-hoc sessions. |
| `src/components/right-panel/RightPanelTabs.tsx:46–150` | Tab dispatch | Reads `currentSession.info.session_state`, `worktree_path`, `pr_number`, `pr_url` | **Refactor.** When selection is task-shaped, derive worktree/spec/diff bindings from the task's slot sessions. When selection is session-shaped (orchestrator), unchanged. |
| `src/components/specs/SpecEditor.tsx:114–125` | Spec editor | Reads `selectedSession.info.spec_stage`, `spec_content`, `specEditorContentAtomFamily(sessionName)` | **Rebind.** Spec editor reads `task.current_spec(&db)` results. Atom keys move from `sessionName` to `taskId + 'spec'`. |
| `src/components/diff/SimpleDiffPanel.tsx:90–95` | Diff viewer | Reads `session.info.worktree_path`, `pr_number`, `session_id` | **Rebind for task selection.** Diff binds to the *winning slot session* of the task's current run, or to the task host session for terminal stages. |
| `src/components/modals/NewSessionModal.tsx` | 50KB | "+ New Spec/Session" modal — preset picker, prompt input, multi-version | **Replace** with `NewTaskModal` (creation form) + `StageRunPresetModal` (per-stage launch). The existing modal can stay temporarily for non-task session creation if needed. |

### §0.3 Backend surface (the contract Phase 7 binds to)

**26 task Tauri commands** are registered in `main.rs:1781–1806`. Only **1** (`LucodeTaskRunDone`) is in the `TauriCommands` enum. Every other call site Phase 7 makes will need an enum entry first, per CLAUDE.md ("ALWAYS use the centralized enum").

Commands the UI binds to (full list is the work of Wave A.2):

- Reads: `lucode_task_list`, `lucode_task_get`, `lucode_task_run_list`, `lucode_task_run_get`, `lucode_task_artifact_history`, `lucode_task_list_stage_configs`, `lucode_project_workflow_defaults_get`.
- Writes (creation/lifecycle): `lucode_task_create`, `lucode_task_update_content`, `lucode_task_advance_stage`, `lucode_task_attach_issue`, `lucode_task_attach_pr`, `lucode_task_delete`, `lucode_task_cancel`, `lucode_task_reopen`, `lucode_task_capture_session`, `lucode_task_capture_version_group`, `lucode_task_set_stage_config`.
- Orchestration: `lucode_task_promote_to_ready`, `lucode_task_start_stage_run`, `lucode_task_start_clarify_run`, `lucode_task_run_cancel`, `lucode_task_confirm_stage`, `lucode_task_run_done`.
- Defaults: `lucode_project_workflow_defaults_set`, `lucode_project_workflow_defaults_delete`.

**Wire-shape gap:** `Task` struct (`entity.rs:257`) has `task_runs: Vec<TaskRun>` embedded but **no `current_spec` / `current_plan` / `current_summary` fields** — those are derived getters that need `&Database`. The wire payload is a `Task` without artifact bodies.

**Decision (post-review): Option A, scoped by command.** The original draft applied Option A uniformly; review pushback flagged the payload bloat: the user has hundreds of archived specs, each spec body can be several KB markdown, and `TasksRefreshedPayload` is broadcast on every mutation. With 100+ active tasks, every refresh would carry ~100× redundant body data the sidebar doesn't render. **Split:**

- `lucode_task_list` and `TasksRefreshedPayload` → **NO body fields** (`current_spec_body` / `current_plan_body` / `current_summary_body` omitted from serialization at this command boundary). Sidebar renders from metadata only: stage, name, run count, derived statuses.
- `lucode_task_get(task_id)` → **bodies included** (the three `current_*_body` fields populated by the handler from the derived getters). Right-pane fetches via this command on selection change.
- `derived_status` on `TaskRun` → **always included** in both list and get. Small (one enum), mandatory for the sidebar's run-status badge rendering.

Trade-off acknowledged: a body-included get adds one Tauri round-trip per selection change. That's the right cost — the alternative (broadcasting bodies on every mutation) is consistently more expensive at scale. Loading-state in the right pane is `~50ms` plus a `<Skeleton />` if needed; the sidebar stays snappy.

Alternative options not chosen:
- **Option B (separate `lucode_task_artifact_history` calls):** more frontend complexity, three commands per artifact-bearing surface.
- **Option C (new `lucode_task_current_artifacts` endpoint):** redundant with the `get_task` extension above.

**TaskRunStatus is derived, not persisted.** `compute_run_status(run, sessions) → TaskRunStatus` returns `Running / AwaitingSelection / Completed / Failed / Cancelled` (no `Queued` — that variant doesn't exist in v2). The frontend either calls a new wire-only field on `TaskRun` (`current_status`) computed by the same handler, or runs `compute_run_status` locally with `SessionFacts` projected onto the wire. Recommendation: **wire-only field `derived_status: TaskRunStatus` on the JSON `TaskRun`** populated by the command. Keeps the derivation logic single-sourced (Rust). Decided in Wave A.1.

**Events:** `SchaltEvent::TasksRefreshed` exists with `TasksRefreshedPayload { project_path, tasks }` (`infrastructure/events/mod.rs:7`, `commands/tasks.rs:109`). The frontend does not subscribe. Phase 7 wires the listener.

### §0.4 v1 reference shape (do not import — read for shape only)

v1 (`task-flow @ b1f38f63`) ships a working task UI in messy form. Read references via `git show task-flow:<path>`:

- `src/types/task.ts` — full TypeScript task types. **Will not port verbatim**: `TaskRunStatus` includes `'queued'` (doesn't exist in v2); `RunRole` is gone in v2; `current_spec/plan/summary` were direct fields, now derived.
- `src/store/atoms/tasks.ts` — `tasksAtom`, `selectedTaskIdAtom`, `taskRunsAtomFamily`, `taskArtifactsAtomFamily`, `upsertTaskAtom`, `removeTaskAtom`, `activeClarifyRunForTaskAtomFamily`. **Port the shape, drop the `'queued'`-aware predicates.**
- `src/hooks/useTasks.ts` — thin `useTasks()` wrapping `tasksAtom`. **Port verbatim.**
- `src/components/sidebar/TaskRow.tsx` (347 lines) — task header with stage-action button + run group nesting + candidate vs. loser sections. **Port the shape; rebuild on v2 atoms; size cap 500 lines (no carrying the architectural debt).**
- `src/components/sidebar/StageSection.tsx` (63 lines) — one section per `TaskStage`. **Port verbatim.**
- `src/components/sidebar/buildStageSections.ts` (27 lines) — `buildStageSections(tasks, sessions): StageSection[]`. **Port, but in v2 the sessions argument shrinks to "task host sessions + slot sessions linked by `task_run_id`."**
- `src/components/sidebar/KanbanView.tsx` (305 lines) — alternate kanban layout. **Port for visual continuity** (the user has a list/board toggle today).
- `src/components/modals/StageRunPresetModal.tsx` (188 lines) — preset picker for "Start Brainstorm/Plan/Implement Run". **Port the form shape; rebind to `lucode_task_start_stage_run`.**

### §0.5 v2 patterns to reuse (already shipped, applied via discipline)

| Pattern | Anchor | How Phase 7 uses it |
|---|---|---|
| Labeled affordances | `SessionVersionGroup.tsx:357–391` `renderHeaderAction` with `label` option; tests at `SessionVersionGroup.affordances.test.tsx:291–388` | Every state-required button on a TaskRow gets a text label. **Mandatory.** |
| Nudge banner | `SessionVersionGroup.tsx:608–661` (`allCandidatesIdleNoJudge` predicate); tests at `SessionVersionGroup.affordances.test.tsx:392–481` | Generalize the "candidates idle, action required" banner to all multi-candidate stage runs (Brainstorm/Plan/Implement). |
| State-table guard | `SessionVersionGroup.affordances.test.tsx:151–286` (6×7 cells, 4 invariants) | New test `TaskRow.affordances.test.tsx`: rows = task stage × run-derived-status × multi-candidate-state; cols = visible affordances. |
| Optimistic + rollback | `optimisticallyConvertSessionToSpecActionAtom` (`store/atoms/sessions.ts:2502–2541`); `runConsolidationAction` race guard (`SessionVersionGroup.tsx:144–162`) | Used for selection flips (selecting a task) and the optimistic stage-advance after a winning slot is confirmed. |
| Hydrator-completeness arch test | `arch_hydrator_completeness` (Phase 5.5) | Any new column read by a Phase 7 wire-shape extension passes through this guard. |
| Component-size ratchet | `arch_component_size.test.ts` 21-entry allowlist | Phase 7 adds **zero** new files to this allowlist. New components ≤ 500 lines or split. |

---

## §1 Wave breakdown

Five thematic chunks, **18–22 sub-waves**:

- **A. Data layer prep** (4 sub-waves: A.1 + A.2 + A.3 + A.3.b): wire-shape extensions (split list/get-by-id), 25-entry TauriCommands sweep, types, atoms, listener service, OSC-emit gap closure with new `app_handle_registry`.
- **B. Sidebar grouping** (4 sub-waves: B.1 + B.2 + B.3 + B.4): stage sections replace lifecycle sections, plus the dedicated **selection-model wave** (discriminated union over five selection kinds).
- **C. Task row rendering** (3 sub-waves: C.1 + C.2 + C.3): row shell + run lifecycle + multi-candidate slots; C.3 covers the merge-failure-mid-confirm row in the affordance state table.
- **D. Creation, migration, secondary surfaces** (3 sub-waves: D.1 + D.2 + D.3): NewTaskModal + capture-session + bulk-capture button, v1→v2 specs migration with paired e2e, right panel rebind with **plan editor write path included**.
- **E. Validation + close-out** (4 sub-waves: E.0 + E.1.lifecycle + E.1.migration + E.2): programmatic full-lifecycle e2e, manual smoke walks split by surface, status doc, memory.

Total floor: 18 sub-waves. Realistic ceiling after mid-flight splits: 22+ sub-waves. See §3.5 for timeline calibration. Sub-wave splits are signposts; if a sub-wave fits cleanly in one session it stays atomic. The intent is to honor "wave-per-PR-quality-bar" rather than predict the exact split point in advance.

Each sub-wave below specifies: **goal, files touched, contracts pinned, verification.** Test scope discipline applies — scoped tests within a sub-wave, full `just test` at sub-wave end if the touched surface crosses domain boundaries (e.g., new Tauri command), pre-commit `just test` always.

---

### Chunk A — Data layer prep

#### Wave A.1 — Wire-shape decisions + Tauri enum entries

**Goal:** Land the wire-shape extensions per the §0.3 split decision, and add the 25 missing `TauriCommands` enum entries so Phase 7 frontend can call typed.

**Files (backend) — wire shape, scoped:**
- `src-tauri/src/domains/tasks/entity.rs` — split the `Task` JSON shape into two serialization contexts using either a serde `skip_serializing_if` predicate (controlled per-handler) **or** a thin wrapper struct `TaskWithBodies(Task) → JSON-with-bodies`. Recommendation: a wrapper struct. It keeps the canonical `Task` serialization body-free (used by list/refresh) and adds an explicit body-bearing variant returned by `lucode_task_get`. This is more readable than per-handler serde acrobatics; pin via tsd in the frontend that `lucode_task_get`'s return type carries `current_spec_body` and `lucode_task_list`'s does not.
- `src-tauri/src/domains/tasks/entity.rs` — extend `TaskRun` serialization with `derived_status: TaskRunStatus` populated by `compute_run_status(run, &session_facts)` in the handler. Always included.
- `src-tauri/src/commands/tasks.rs`:
  - `lucode_task_get` returns `TaskWithBodies` (or `Task` with the optional body fields populated). Body fields populated by calling `task.current_spec(&db)` etc. before serialization.
  - `lucode_task_list` returns `Vec<Task>` with **no** body fields. Each `TaskRun` has `derived_status` populated.
  - `lucode_task_run_list` and `lucode_task_run_get` populate `derived_status` on each run via `compute_run_status`.
  - `TasksRefreshedPayload` builder populates `derived_status` but **not** body fields.
- DB round-trip tests (`feedback_compile_pins_dont_catch_wiring`):
  - `lucode_task_get_round_trip_carries_current_spec_body_when_artifact_exists` (positive + None).
  - `lucode_task_list_round_trip_omits_current_spec_body` (negative — bug-class test; failure on revert).
  - `lucode_task_run_wire_payload_carries_derived_status_through_compute_run_status`.
  - `tasks_refreshed_payload_omits_body_fields_for_each_task` (regression guard against accidentally re-introducing body bloat).

**Files (frontend):**
- `src/common/tauriCommands.ts` — add 25 entries (the §0.3 list).
- `src/types/task.ts` (new file) — full type definitions ported from v1 with v2 corrections:
  - `TaskRunStatus = 'running' | 'awaiting_selection' | 'completed' | 'failed' | 'cancelled'` (no `'queued'`).
  - `Task.current_spec_body / current_plan_body / current_summary_body: string | null`.
  - `TaskRun.derived_status: TaskRunStatus`.
  - No `RunRole`. `slot_key: string | null` is the only slot identifier.
  - `TaskFlowError` is already in `src/types/errors.ts` — re-export through `src/types/task.ts` for ergonomics.
- `src/types/task.test-d.ts` — type-level tests asserting no `'queued'` literal, no `RunRole` re-export, `TaskRun.derived_status` is required.

**Contracts pinned:**
- Backend: `task_wire_payload_carries_current_spec_body_when_artifact_is_current` (round-trip test), `task_run_wire_payload_carries_derived_status` (round-trip test going through `compute_run_status`).
- Frontend: structural tsd assertions on `Task` and `TaskRun` shape.
- arch test (existing `arch_hydrator_completeness`): unchanged — new fields are computed at the handler boundary, not new DB columns.

**Verification:** `just test`. Expected: 2422+ Rust tests + ~3300 vitest tests pass. New tests per the contract list above.

---

#### Wave A.2 — Frontend task atoms + hook

**Goal:** Introduce task-shaped state atoms paralleling v1's `tasks.ts`. Read-only at this stage — no mutations from the UI yet. Atoms get populated by Wave A.3's listener.

**Files:**
- `src/store/atoms/tasks.ts` (new) — port v1 atom shapes with v2 corrections:
  - `tasksAtom: Atom<Task[]>` — initialized to `[]`.
  - `selectedTaskIdAtom: Atom<string | null>`.
  - `selectedTaskAtom: Atom<Task | null>` — derived; uses `tasksAtom` + `selectedTaskIdAtom`.
  - **Source of truth (decided here, not punted):** `tasksAtom` is canonical. `Task.task_runs` (embedded by the backend) IS the run list. **There is no separate `taskRunsAtomFamily`.** All run reads go through a derived selector `taskRunsForTaskAtomFamily(taskId): Atom<TaskRun[]>` that pulls `task.task_runs` from the canonical `tasksAtom`. Mutations write through the `setTasksAtom` upsert path (the `TasksRefreshed` listener replaces the whole task object including its embedded runs). v1's `taskRunsAtomFamily` (a separate write atom) is **not** ported — it would create the dual-write source-of-truth violation CLAUDE.md prohibits.
  - `setTasksAtom`, `upsertTaskAtom`, `removeTaskAtom` write atoms.
  - **No `ACTIVE_RUN_STATUSES` set with `'queued'`** — a v2 predicate `isActiveTaskRun(run: TaskRun): boolean` that reads `run.derived_status === 'running' || run.derived_status === 'awaiting_selection'`.
  - `activeClarifyRunForTaskAtomFamily` ported using v2's clarify session predicate (sessions with `slot_key === 'clarify'` linked by `task_run_id`, run not terminal).
- `src/hooks/useTasks.ts` (new) — thin wrapper paralleling v1.
- `src/store/atoms/tasks.test.ts` — read-side tests: tasksAtom default empty, selector returns null when no selection, upsert is idempotent, isActiveTaskRun correctly excludes terminal runs.

**Contracts pinned:**
- `isActiveTaskRun_excludes_queued_literal_at_typecheck` — tsd assertion that the function does not accept `{ derived_status: 'queued' }` (compiles error).
- `useTasks_returns_empty_when_atom_initialized` — render test.

**Verification:** `bun vitest run src/store/atoms/tasks src/hooks/useTasks` (scoped). Pre-commit `just test`.

---

#### Wave A.3 — TasksRefreshed listener + Tauri service

**Goal:** Subscribe to `SchaltEvent::TasksRefreshed`, dispatch payloads into `tasksAtom`. Add a typed Tauri service for invocation from hooks.

**Files:**
- `src/services/taskService.ts` (new) — typed wrappers around `invoke(TauriCommands.LucodeTaskList, ...)` etc. Each returns `Task | TaskRun | TaskFlowError` typed. One file per logical group (read / write / orchestration) is fine but the size cap means one file is sufficient at this stage (~250 lines).
- `src/hooks/useTaskRefreshListener.ts` (new) — listens for `SchaltEvent::TasksRefreshed`; parses payload; dispatches `setTasksAtom`. Uses `listenEvent` from `src/common/eventSystem.ts` (typed).
- `src/App.tsx` — mount the listener at app shell (one line).
- `src/hooks/useTaskRefreshListener.test.ts` — emits a synthesized event payload, asserts the atom updates.

**Contracts pinned:**
- `tasks_refreshed_payload_dispatches_to_atom` — listener test.
- `task_service_typed_call_signatures` — tsd that taskService method signatures match the Rust command argument shape (mechanical from `commands/tasks.rs` doc-comment).

**Verification:** `bun vitest run src/services src/hooks/useTaskRefreshListener` + manual smoke (run `bun run tauri:dev`, create a task via MCP, check console for atom update). End of A.3 (before A.3.b): scoped tests only.

---

#### Wave A.3.b — Close the OSC-idle emission gap

**Goal:** The audit confirmed that `infrastructure/session_facts_bridge.rs::record_first_idle_on_db` writes `session.first_idle_at` but does NOT emit `SchaltEvent::TasksRefreshed`. The explicit MCP path (`lucode_task_run_done` → `task_run_done_with_context` → `notify_task_mutation_with_db` at `commands/tasks.rs:1103`) does emit. The OSC fallback path doesn't. Result: when an agent goes idle without calling the explicit tool, the run's `derived_status` flips to `AwaitingSelection` in the DB but the UI is stale until the next mutation forces a refresh.

This is the one event-emission edit that's load-bearing for Phase 7's "no polling" rule. The frontend cannot poll, so the bridge must notify.

**Plumbing decision (review-flagged correction):** The original draft handwaved "via the existing `PROJECT_MANAGER` pattern" — but `PROJECT_MANAGER` doesn't carry an `AppHandle`. Verified existing precedent: `infrastructure/pty.rs:26` already holds `RwLock<Option<AppHandle>>` registered at startup for the same reason (infrastructure layer needs to emit Tauri events). Phase 7 follows that pattern.

**Approach:** Add `infrastructure::app_handle_registry` — a `OnceCell<AppHandle>` populated in `main.rs` setup, with a typed `app_handle() -> Option<&'static AppHandle>` accessor. Pin with an arch test `arch_app_handle_global_singleton` that fails CI if a second `OnceCell<AppHandle>` is added (so this doesn't proliferate into a "globals everywhere" anti-pattern). The pty.rs registry stays as-is; the new registry is a sibling, not a duplicate (pty has lifecycle reasons to use `RwLock<Option<…>>`; the task event emit is set-once-at-startup).

**Files (backend):**
- `src-tauri/src/infrastructure/app_handle_registry.rs` (new) — `OnceCell<AppHandle>` + `register(app)` + `app_handle() -> Option<AppHandle>` (returning a clone since `AppHandle` is `Clone + Send + Sync`). 5 unit tests covering register-once, get-when-uninitialized-returns-None, multi-thread access.
- `src-tauri/src/main.rs` setup — register the AppHandle into the new registry at the same call site that initializes `SETTINGS_MANAGER` etc.
- `src-tauri/src/infrastructure/session_facts_bridge.rs::record_first_idle_on_db` — after a successful first-idle write that affected ≥1 row, fetch the AppHandle from the new registry and call `commands::tasks::notify_task_mutation_with_db`. Idempotent — the first-idle write is already write-once-only via the `WHERE first_idle_at IS NULL` guard, so we emit only when the UPDATE row count is 1.
- `tests/arch_app_handle_global_singleton.rs` (new) — fail-build test that grep-fails if `OnceCell<AppHandle>` (or `OnceCell<tauri::AppHandle…>`) appears anywhere outside `infrastructure/app_handle_registry.rs` (the pty.rs registry uses `RwLock<Option<AppHandle>>` so it's distinct and not flagged).
- DB+event round-trip test: write a first-idle through the bridge → assert one `TasksRefreshed` was emitted with the freshly-derived `AwaitingSelection` status carried in the payload's `task.task_runs[].derived_status` (this requires Wave A.1's wire-shape extension to land first; the explicit ordering is enforced).
- A negative test: a no-op call (the row was already `first_idle_at IS NOT NULL`) does NOT emit `TasksRefreshed`.

**Contracts pinned:**
- `record_first_idle_on_db_emits_tasks_refreshed_when_row_was_updated`.
- `record_first_idle_on_db_does_not_emit_when_idempotent_noop`.

**Verification:** `cargo nextest run -p lucode infrastructure::session_facts_bridge`. End of chunk A: full `just test`.

**Why a sub-wave, not a footnote in A.3:** moving event emission across module boundaries is the kind of edit that gets botched if it rides on an unrelated wave's commit. A clean wave with a clean test makes the regression risk visible.

---

### Chunk B — Sidebar grouping (top-down rebuild)

#### Wave B.1 — `useSidebarStageSections` hook + `buildStageSections` helper

**Goal:** Replace the lifecycle-section split (specs/running) with a stage-section split (Draft / Ready / Brainstormed / Planned / Implemented / Pushed / Done; Cancelled separate).

**Files:**
- `src/components/sidebar/helpers/buildStageSections.ts` (new) — pure function `buildStageSections(tasks: Task[]): StageSection[]`. One section per `TaskStage`; cancelled tasks (predicate: `task.cancelled_at !== null`) go in a separate "Cancelled" section regardless of `stage`.
- `src/components/sidebar/hooks/useSidebarStageSections.ts` (new) — wraps `buildStageSections` + the existing collapse-state hook (`useSidebarCollapsePersistence`); persists collapse per stage key.
- `src/components/sidebar/helpers/buildStageSections.test.ts` — exhaustive: empty list → 8 empty sections; one task per stage → 8 sections each with one task; cancelled task → in "Cancelled" section regardless of stage.

**Contracts pinned:**
- `stage_sections_total_count_is_eight` (compile-time exhaustive match over `TaskStage` + Cancelled).
- `cancelled_task_appears_only_in_cancelled_section` — bug-class test (caught the v1 bug where a task with stage=ready and cancelled_at set was duplicated).

**Verification:** scoped `bun vitest run src/components/sidebar/helpers/buildStageSections`.

---

#### Wave B.2 — `SidebarStageSection` view component

**Goal:** Render one stage section: header (stage label, count, collapse toggle) + a list of `TaskRow`s (placeholder until C.1).

**Files:**
- `src/components/sidebar/views/SidebarStageSection.tsx` (new, ≤ 200 lines) — renders header + list. Reuses `SidebarSectionHeader` (existing). Placeholder `TaskRow` is a `<div>{task.name}</div>` until Wave C.1.
- `src/components/sidebar/views/SidebarStageSection.test.tsx` — render with 0/1/3 tasks, asserts collapse toggle works, count badge correct, empty state placeholder.

**Contracts pinned:**
- `stage_section_render_matches_collapse_state_table` — small state table (3 cells: empty collapsed, populated collapsed, populated expanded).

**Verification:** scoped vitest.

---

#### Wave B.3 — Wire `SidebarStageSection` into `Sidebar.tsx`

**Goal:** Switch `Sidebar.tsx` from rendering `SidebarSessionList` (lifecycle sections) to rendering N stage sections. Keep `SidebarSessionList` mounted *underneath* during this wave for ad-hoc session rendering (orchestrator + non-task sessions); remove in Wave D.3.

**Files:**
- `src/components/sidebar/Sidebar.tsx` — add the stage section render above the existing session list. **Hard cap: 500 lines.** Already at 494 — moving the existing session list section behind a condition is the only edit.
- `src/components/sidebar/Sidebar.test.tsx` — render with both task list and session list populated, assert both render; assert the order (tasks above sessions).

**Contracts pinned:**
- `arch_component_size` test passes (Sidebar.tsx ≤ 500 lines).
- `sidebar_renders_stage_sections_when_tasks_present` (render test).

**Verification:** scoped vitest + full `just test` at end of B.3 (Sidebar.tsx is high-traffic). End of B.3: tasks render in stage sections, but selection still drives session-shaped right pane until B.4.

---

#### Wave B.4 — Selection model: discriminated union over selection kinds

**Goal:** Today the selection model in `SelectionContext` is session-shaped (`{ kind: 'session', sessionId }` plus orchestrator special-case). Phase 7 introduces task selections, run selections, and slot selections. Doing this transparently across B.3, C.1, D.3 (as the original draft did) would scatter the change across three waves and make selection bugs hard to attribute. **This wave consolidates the selection-model rewrite into one auditable surface.**

**Files:**
- `src/contexts/SelectionContext.tsx` (or `src/store/atoms/selection.ts` — whichever is the canonical home; audit confirmed `selection.ts` is 44KB, so the discriminated union likely lives there) — extend the `Selection` type to a discriminated union:
  ```ts
  type Selection =
    | { kind: 'orchestrator' }
    | { kind: 'session'; sessionId: string }     // ad-hoc, non-task
    | { kind: 'task'; taskId: string }           // task header selected
    | { kind: 'task-run'; taskId: string; runId: string }
    | { kind: 'task-slot'; taskId: string; runId: string; sessionId: string }
  ```
- All existing call sites that read `selection.sessionId` get migrated to the new shape via a thin selector helper (`selectionToSessionId(selection): string | null` returns the session for slot/session selections, the task-host session for task selections, etc.). Frontend callers never pattern-match the union directly until B.4 completes; they go through helpers.
- Selection-memory persistence (`useSidebarSelectionMemory.ts`) updates its localStorage key shape to be selection-kind-aware. Migrate existing keys on first launch (silently — they're per-project preferences, not user data).
- `src/store/atoms/selection.test.ts` — exhaustive: each selection kind round-trips through the helper API; the union is structurally exhaustive (compile-time, via a `match` helper that fails when a new variant is added without case coverage).

**Contracts pinned:**
- `selection_kind_match_is_compile_time_exhaustive` — the canonical exhaustiveness pattern.
- `selection_to_session_id_returns_correct_session_for_each_kind` — runtime test, one case per kind.
- `selection_memory_migrates_legacy_keys_on_first_launch_idempotent`.

**Verification:** scoped vitest. **No `just test` mid-wave** unless backend types change (none should). End-of-B: full `just test`.

**Why a wave of its own:** without this, "wrong thing renders in right pane" is a 3-way grep across B, C, D. With this, it's one file and one test surface.

---

### Chunk C — Task row + run lifecycle rendering

#### Wave C.1 — `TaskRow` shell with stage-action button

**Goal:** Real `TaskRow` component. Renders task name, current stage badge, current run summary (if any), and the labeled stage-action button (Promote to Ready / Run Brainstorm / Run Plan / Run Implement / Open PR / Reopen / Cancel) gated by `task.stage` + `task.can_advance_to(target_stage)` (port the predicate from v1; verify against v2 backend `domains/tasks/entity.rs:can_advance_to`). Action does **not** wire to a real handler yet — onClick logs to console. Wired in C.2.

**Files:**
- `src/components/sidebar/TaskRow.tsx` (new, ≤ 350 lines) — shell. Header row only. No inline run history yet (that's C.2).
- `src/components/sidebar/TaskRow.test.tsx` — state matrix: one row per `TaskStage`, asserts which action button is visible, label matches, button is keyboard-focusable, aria-label present.
- `src/components/sidebar/TaskRow.affordances.test.tsx` (new — replaces `SessionVersionGroup.affordances.test.tsx` shape, generalized to tasks):
  - Rows: each `TaskStage` × `task.cancelled_at` × `task.failure_flag` (≈ 8 stages × 2 × 2 = 32 rows; collapse to ~14 representative rows that exercise each predicate).
  - Cols: `promote-to-ready-button`, `start-stage-run-button`, `cancel-task-button`, `reopen-task-button`, `open-pr-button`, `clarify-button`.
  - Each cell is a presence/absence + label assertion.
  - 4 invariant tests: every non-terminal task has at least one action; every terminal task has no progressing action; cancelled task always shows reopen; failure_flag never hides the cancel action.

**Contracts pinned:**
- The state-table test itself is the pin — failure on revert is structural.
- `task_row_size_is_at_most_350_lines` (manually maintained at this stage; will be enforced by `arch_component_size` since not on allowlist).
- `task_row_action_button_labels_are_visible` — generalization of `SessionVersionGroup.affordances.test.tsx:291–388`.

**Verification:** scoped vitest. **No** full `just test` mid-wave — affordance test is fast.

---

#### Wave C.2 — Inline run history + run-lifecycle rendering

**Goal:** TaskRow shows run history inline (collapsible list under the header). Each `TaskRun` renders as a card with stage badge + `derived_status` badge + cancel-run button (only when `derived_status === 'awaiting_selection'`). Wires C.1's action button to `taskService.startStageRun` / `taskService.promoteToReady` / etc. Optimistic update + rollback per the §0.5 pattern.

**Files:**
- `src/components/sidebar/TaskRunRow.tsx` (new, ≤ 250 lines) — single run rendering.
- `src/components/sidebar/TaskRow.tsx` — extend to render a list of `TaskRunRow`s under the header.
- `src/components/sidebar/hooks/useTaskRowActions.ts` (new) — encapsulates the optimistic-flip + rollback pattern. Input: `Task`, `TauriCommands.*`. Output: action handlers with built-in rollback via re-fetch on error.
- `src/components/sidebar/TaskRunRow.test.tsx` — state table: each `TaskRunStatus` × `slot_key !== null` × `selected_session_id !== null`. Assert badge text, cancel-run button presence, label.
- `src/components/sidebar/hooks/useTaskRowActions.test.ts` — happy path + rollback path (mock the Tauri call, fail it, assert atom rolls back).

**Contracts pinned:**
- `task_run_row_state_table_pins_all_derived_statuses` — exhaustive over `TaskRunStatus` (5 variants).
- `optimistic_action_rolls_back_on_failure` — the canonical race-guard pattern, generalized.

**Verification:** scoped vitest + full `just test` at end of C.2 (because Tauri commands are hit for the first time).

---

#### Wave C.3 — Multi-candidate slot rendering inside a run

**Goal:** When a `TaskRun` has multiple bound sessions (`slot_key !== null` in N>1 sessions), render each as a slot inside the run row. Generalize `SessionVersionGroup.tsx` from "consolidation only" to "any multi-candidate run" by parameterizing on `slotKindLabel` (currently hardcoded to "Candidate"). The labeled-affordance + nudge-banner + state-table patterns cover this without invention.

**Files:**
- `src/components/sidebar/TaskRunSlots.tsx` (new, ≤ 400 lines) — wraps an enhanced version of `SessionVersionGroup`'s rendering. Each slot is a `SessionCard` with a `slotKind` label.
- `src/components/sidebar/SessionVersionGroup.tsx` — extract the rendering primitives (renderHeaderAction, the nudge banner JSX, the state-table-aware affordance gating) into pure helpers under `src/components/sidebar/helpers/multiCandidateRenderers.ts`. Reuse from `TaskRunSlots`. **Do not duplicate.** This may push `SessionVersionGroup.tsx` further below 500 lines, which is fine.
- `src/components/sidebar/TaskRunSlots.affordances.test.tsx` — full state table (rows = run-derived-status × slot-count × judge-presence; cols = trigger-stage-judge, confirm-winner, terminate-run, nudge-banner, individual-slot-card). Same 6×7+invariants shape as the existing consolidation test, generalized to all stages.
- The Brainstorm / Plan / Implement stages each get a fixture-driven test row that walks: launch → all-slots-running → all-slots-idle → confirm-winner → run-completed. Three identical fixtures with stage swap.
- **Merge-failure-mid-confirm row (advisor-flagged).** Current HEAD `f759cef0` is the "merge before confirm_selection in confirm_stage" fix — order matters because merge can fail. The state table needs a row for "user clicked confirm-winner; backend's merge step failed; what does the UI show?" Per the v2 contract: the run stays in `AwaitingSelection`, the winner is *not* persisted (because `confirm_selection` was never reached), and the user sees an error toast + the affordance state stays "candidates idle, action available." A regression on this is exactly the bug class that bit consolidation. Pin it: `task_run_slots_render_merge_failure_returns_to_awaiting_selection_with_error_banner`.

**Contracts pinned:**
- The big state table covers the surface that was the source of bugs 603f5cf0 and 67411e00 — generalized so it can never regress in any stage.
- `multi_candidate_renderers_export_pure_functions` — tsd that the helper module exports pure functions, no React state, no hooks.

**Verification:** scoped vitest + full `just test` at end of chunk C.

---

### Chunk D — Creation, migration, secondary surfaces

#### Wave D.1 — `NewTaskModal` + "+ New Task" affordance

**Goal:** Replace App.tsx's "Start Agent" / "Create Spec" buttons with a single "+ New Task" button. Open a modal: name, display name, request body (markdown), epic (optional), repository (auto-detected). On submit: `taskService.create()` → atom updates via `TasksRefreshed` → sidebar shows the new task in Draft section.

**Files:**
- `src/components/modals/NewTaskModal.tsx` (new, ≤ 400 lines) — the form. Reuses existing modal scaffolding (`src/components/common/Modal*`).
- `src/App.tsx` — replace the two buttons (~2561–2623) with a single "+ New Task" button. Drop `setOpenAsSpec` plumbing. Spec creation is implicit in task creation. **Orchestrator agent affordance:** the orchestrator card retains its own "Start agent" button on the `OrchestratorEntry` card itself (not a global header button). When orchestrator is selected and no agent is running, the card renders a labeled "Start orchestrator agent" button that calls the existing `lucode_core_start_session_agent` (or equivalent) Tauri command. Out-of-scope nuance: orchestrator agent UX is unchanged from v1; only its entry point moves from "Start Agent" header to "Start orchestrator agent" on the card.
- **Capture-session affordance (advisor-flagged).** Right-click on a non-task running session → `SessionCard` context menu gets a labeled "Capture as Task" entry. Calls `lucode_task_capture_session(session_name)`. Right-click on a session that's part of a version group → "Capture group as Task" calls `lucode_task_capture_version_group(base_name, session_names)`. Without this, users with long-running v1 sessions on cutover day get stranded — their work is invisible in the task-centric sidebar. Specs migrate via Wave D.2; non-spec sessions need on-demand capture.
- **Bulk capture button (review-added).** The user has a non-trivial number of active sessions on cutover day and per-session right-click is a tedious ritual. Add a "Capture all running sessions as draft tasks" button that appears in the sidebar's Draft section empty-state (or in a one-time first-launch banner) when the project DB has ≥ 1 standalone non-task running session. Clicking the button enumerates the standalone sessions and calls `lucode_task_capture_session` for each, with a confirm dialog showing the count. The button auto-hides once the standalone count drops to zero. Failure handling: per-session failures collected and shown in a single error toast; partial success is okay (already-captured sessions stay captured).
- `src/components/modals/NewTaskModal.test.tsx` — submit happy path + validation (required fields) + error path (mock `lucode_task_create` failure → form stays open with error message).
- `src/components/sidebar/SessionCard.test.tsx` — context menu state table: regular running session shows "Capture as Task"; version-group member shows "Capture group as Task"; task-bound session shows neither (already a task).
- `src/App.test.tsx` (touch) — assert the new button text + count.

**Contracts pinned:**
- `new_task_modal_calls_lucode_task_create_with_form_data` — round-trip through the service mock.
- `app_shell_no_longer_renders_create_spec_button` — bug-class test (failure on revert).
- `session_card_context_menu_offers_capture_as_task_for_non_task_session`.
- `orchestrator_entry_renders_start_agent_button_when_no_agent_running`.

**Verification:** scoped vitest + manual smoke (`bun run tauri:dev`, click "+ New Task", create a task, verify it shows in sidebar). End of D.1: full `just test`.

---

#### Wave D.2 — v1→v2 user-DB migration: specs → draft tasks

**Goal:** Existing user DBs have spec sessions (sessions with `is_spec = true`) that pre-date the task aggregate. On first v2 launch, migrate them: each spec becomes a draft `Task` with `request_body` populated from the spec content, `epic_id` carried over, `current_spec` artifact populated from the spec content. Sessions with `task_id` already set (from MCP-created tasks) are not touched.

This is the **second one-shot migration this codebase ships in this phase** — and it's the one that affects users actively cutting over from a v1 DB. Idempotent. Logs a summary.

**Files:**
- `src-tauri/src/infrastructure/database/migrations/v1_to_v2_specs_to_tasks.rs` (new) — implements the migration following the pattern of `v1_to_v2_session_status` (Phase 3 Wave F.7) and the four other Phase 3 migrations. Backup table for forensics: `sessions_v2_specs_to_tasks_archive`.
- `src-tauri/src/infrastructure/database/migrations.rs` — register migration. Sequence guard.
- Migration tests in the same file: noop_on_v2_native_db, idempotent_repeat_run, migrates_three_spec_session_types_correctly, ignores_sessions_with_task_id_already_set, archive_table_carries_pre_migration_state.
- `tests/e2e_v1_specs_migrate_to_draft_tasks.rs` — full end-to-end: set up a v1-shape DB with 3 specs and 1 task-bound session, run all migrations, assert 3 draft tasks exist + the task-bound session unchanged + archive table populated.

**Contracts pinned:**
- 5 migration tests + 1 e2e test (per `feedback_compile_pins_dont_catch_wiring`).
- `arch_hydrator_completeness` unchanged — migration doesn't introduce columns.

**Out of scope:** Standalone non-spec sessions don't auto-promote to tasks. They stay as orchestrator-style ad-hoc sessions and continue to render via the keep-as-is `OrchestratorEntry`. (Sessions with `task_id` set already migrate naturally because the task is what's loaded.) The user accepted this in the kickoff: "Existing standalone sessions become task host sessions on a synthesized parent task" — for v2's non-MCP-created standalones, the synthesis is "no parent, use orchestrator".

**Verification:** `cargo nextest run -p lucode infrastructure::database::migrations::v1_to_v2_specs` + the e2e test. End of D.2: full `just test`.

---

#### Wave D.3 — Right-panel rebind for task selections

**Goal:** When the selection is `kind: 'task' | 'task-run' | 'task-slot'`, the right-panel tabs bind to the task's artifacts:
- **Spec tab:** reads `task.current_spec_body` (Wave A.1 wire field). Editor saves through `lucode_task_update_content(taskId, 'spec', content, …)`.
- **Plan tab (new):** reads `task.current_plan_body`. Save through `update_content(taskId, 'plan', …)`.
- **Diff tab:** binds to the slot session's worktree (the winning slot if confirmed; the most recent slot if not). Falls back to "no diff yet" when no slot exists.
- **Forge tab:** unchanged surface; reads `task.pr_url` instead of `session.pr_url`.

**Files:**
- `src/components/right-panel/RightPanelTabs.tsx` — switch dispatch on selection kind. ≤ 700 lines (already 632; growth tolerated as it's on the allowlist).
- `src/components/specs/SpecEditor.tsx` — refactor the data binding. Atom keys move from `sessionName` to `taskId + 'spec'` (already plumbed through Wave A.2 atoms). The SpecEditor.tsx file is on the allowlist (982 lines) so no size constraint.
- `src/components/right-panel/RightPanelTabs.test.tsx` — selection table: session-shaped vs. task-shaped, assert the right tabs render and bindings resolve.
- `src/components/specs/SpecEditor.test.tsx` — task-bound editor saves via `lucode_task_update_content` (mocked).

**Contracts pinned:**
- `right_panel_tab_dispatch_is_exhaustive_over_selection_kinds` — compile-time exhaustive match.
- `spec_editor_save_routes_to_lucode_task_update_content_when_selection_is_task` — round-trip via mock.

**Plan editor — write path included (review correction).** The original draft punted plan editing as "post-Phase 7 polish." That's a regression: today (v1 + v2 backend) users edit plans through the spec-editor-equivalent surface. Shipping v2 with read-only plan editing strands a workflow on cutover day. **Plan editing is in scope for D.3.** The data path mirrors the spec editor: same atom family (`taskArtifactEditorContentAtomFamily(taskId, kind)`), same save command (`lucode_task_update_content(taskId, 'plan', content, …)`), same dirty-tracking. Adding the save button is a one-screen extension of the spec editor's save flow. Test parity: every spec-editor save test gets a plan-editor sibling.

**Verification:** scoped vitest + full `just test` at end of chunk D.

---

### Chunk E — Validation + close-out

#### Wave E.0 — Programmatic e2e for full task lifecycle

**Goal (review-added):** Manual smoke (E.1) catches regressions on cutover day. A Rust e2e test pinning the full state-transition surface catches regressions every CI run thereafter. Mirrors the existing Phase 1 e2e pattern (`tests/e2e_legacy_migration_then_read.rs`, `tests/e2e_per_task_concurrency.rs`).

**Files:**
- `tests/e2e_task_lifecycle_full.rs` (new) — programmatic walk against an in-memory project:
  1. Create task at Draft → assert `task.stage == Draft`, `current_spec_body == Some("…")` matches the request body or migrated content.
  2. Promote to Ready via `lucode_task_promote_to_ready` → assert stage flip + `task_branch.is_some()`.
  3. Start Brainstorm run with 3 candidates via `lucode_task_start_stage_run` → assert `task_runs[].len() == 1`, run has 3 bound sessions, derived_status `Running`.
  4. Each slot reports first_idle via `lucode_task_run_done(status=ok)` → after all three, `derived_status == AwaitingSelection`.
  5. Confirm winner via `lucode_task_confirm_stage` → run `derived_status == Completed`, task `stage == Brainstormed`, current_spec body persists from winning slot.
  6. Repeat for Plan and Implement stages.
  7. Cancel a Plan-stage run mid-flight → run derived_status flips to `Cancelled`, task stage stays at `Brainstormed` (no auto-rollback).
  8. Reopen the cancelled run's task to Draft via `lucode_task_reopen` → `task.cancelled_at` cleared, `stage == Draft`, branches preserved.
  9. Push, verify Done is terminal (no further `can_advance_to`).
- The test asserts at each step using the `derived_status` getter (no DB-column reads). Failures pinpoint which transition broke.

**Contracts pinned:**
- `e2e_full_lifecycle_walks_draft_to_done_with_consistent_derived_state` — the canonical regression guard.
- `e2e_lifecycle_cancel_then_reopen_preserves_branches`.

**Verification:** `cargo nextest run -p lucode --test e2e_task_lifecycle_full`. Failure here is a Phase 7 blocker, not a smoke-walk note.

---

#### Wave E.1 — Smoke walk + Phase 6-style checklist for tasks

**Goal:** Reproduce Phase 6's manual smoke checklist, reframed for tasks. Walk every section:
- A. Sidebar structure (stage sections + cancelled separate, epic grouping intact, task counts correct).
- B. Views (list + kanban + collapsed rail render task rows).
- C. Selection + keyboard nav (J/K through tasks; selection drives right pane).
- D. Task lifecycle (create → promote-to-ready → start brainstorm with 3 candidates → confirm winner → start plan → confirm winner → start implement → push → done; cancel mid-flight; reopen).
- E. Forge integration (PR linked to task, CI red flips `failure_flag`, banner shows).
- F. Migration (v1 DB with 3 specs migrates, draft tasks populated correctly, content preserved).
- G. Multi-candidate (Brainstorm with 3 slots: all idle → nudge banner → trigger judge → confirm winner; same flow on Plan and Implement).
- H. State table fuzzing (cancel a task with an awaiting_selection run → run is cancelled too; reopen a cancelled task → goes to draft regardless of prior stage).

The checklist itself is the deliverable — mark each item with [x] or note issues.

**Files:**
- `plans/2026-04-29-task-flow-v2-phase-7-smoke.md` (new) — the checklist.

**Verification:** Run against `/tmp/v2-smoke` (a throwaway repo). Tick each box. Issues found here are bug fixes, not plan changes.

---

#### Wave E.2 — Status doc + memory + Phase 7 close-out

**Files:**
- `plans/2026-04-29-task-flow-v2-status.md` — Phase 7 row + wave detail tables.
- `~/.claude/projects/-Users-lucacri-Sites-dev-tools-schaltwerk/memory/project_taskflow_v2_charter.md` — update from "rewrite COMPLETE on task-flow-v2 branch (Phases 0–6 + 5.5)" to "v2 charter complete (Phases 0–7); ready to merge to main."
- `plans/2026-04-29-task-flow-v2-design.md` — close-out paragraph noting Phase 7 supplemented the original 7 changes with the user-facing rebuild.

**Verification:** `just test` green; smoke checklist all green; all DoD criteria below check off.

---

## §2 Discipline (mandatory, mirrors prior phases)

| Rule | Source | Phase 7 application |
|---|---|---|
| TDD red-green-refactor | CLAUDE.md | Every observable behavior change has a failing test first. |
| Component size cap | `arch_component_size` | New components ≤ 500 lines. **Zero new entries** to the 21-file allowlist. |
| Hydrator-completeness | `arch_hydrator_completeness` | Wire-shape extensions in A.1 don't add DB columns; arch test stays green. |
| State-table guards | Phase 6 + this plan §0.5 | TaskRow, TaskRunRow, TaskRunSlots each get a state table covering stage × derived-status × multi-candidate. |
| Labeled affordances | commit 67411e00 | Every action button on a task row carries a text label + aria-label. Icon-only is rejected. |
| DB round-trip tests | `feedback_compile_pins_dont_catch_wiring` | Wave A.1 wire-shape extensions and Wave D.2 migration both ship round-trip tests. |
| Test scope discipline | `feedback_test_scope_discipline` | Inner loop: scoped tests (`bun vitest run <path>` / `cargo nextest run -p lucode <module>`). Sub-wave boundary: full `just test`. Pre-commit: full `just test`. |
| Parallel agents on disjoint files | `feedback_parallel_agents_disjoint_files` | Sweep-style waves (the 25 enum entries in A.1, the multi-file SessionVersionGroup → multiCandidateRenderers extraction in C.3) dispatch parallel agents on disjoint files; coordinator commits per wave. |
| No "pre-existing bug" deflection | `feedback_no_preexisting_excuse_taskflow` | Bugs surfaced in Phase 7 smoke testing get fixed in Phase 7. |
| Stamp completion AFTER side effect | `feedback_stamp_after_side_effect` | The optimistic-flip + rollback pattern in C.2 stamps `setSelectedTaskId` on success, not on issue. |
| No setTimeout / polling | CLAUDE.md | Event-driven (`SchaltEvent::TasksRefreshed` listener, atom-driven re-render). |
| No empty catch blocks | CLAUDE.md | Every Tauri call has typed error handling via `TaskFlowError`. |
| Type-safe events | CLAUDE.md | `SchaltEvent::TasksRefreshed` listener uses `listenEvent(SchaltEvent.TasksRefreshed, …)`. |
| Type-safe Tauri commands | CLAUDE.md | Wave A.1 adds 25 enum entries. Zero raw string `invoke('lucode_task_…')` calls. |
| Theme system | CLAUDE.md | Stage badges, status colors, candidate-idle banner all use CSS vars (`var(--color-accent-amber-bg)` etc.). |

---

## §3 Process

This is a multi-week phase. **Do NOT execute end-to-end in one session.**

1. **This plan is reviewed first** (the deliverable of this turn). User reads, aligns or pushes back, the plan changes accordingly. **No code is touched** until this plan is signed off.
2. After approval, execute one wave per session. End each session with status doc updated, tests green, working tree clean. Next session picks up cold from the status doc.
3. Wave dispatch pattern from Phase 6 applies: parallel agents on disjoint files where useful (A.1 enum sweep, C.3 helper extraction, D.2 migration tests can fan out by category), scoped tests between sub-waves, full `just test` at sub-wave boundaries and pre-commit.
4. **Surface unexpected scope creep immediately.** If a wave reveals an audit miss (e.g., a 26th Tauri command we didn't list), update §0.3 and §1 in the same commit. Plans drift if they don't update.

---

## §3.5 Realistic timeline (calibration, not gating)

This phase is sized at **18–22 sub-waves** post-review. At one wave per session and roughly one session per workday with normal scoped tests + commit + status-doc updates, that's **4–6 weeks of active work**. Reality runs longer because:

- Wave splits happen mid-flight. Phase 6 estimated 28+ sub-waves and shipped as 28+ — the count was honest. Phase 7 reviewers (advisor + user) already grew the count from 14 to 20 before code; expect another 1–3 mid-flight splits surfacing real complexity. **Likely-to-split waves:** A.1 (wire-shape backend + 25 enum entries + types file + tsd tests + DB round-trips is genuinely two waves), B.4 (selection model is structural and may want its localStorage-migration as a separate landing), C.3 (multi-candidate generalization extracts helpers from `SessionVersionGroup.tsx` — that extraction may want its own commit), D.2 (migration tests typically split off their e2e fixture).

- Smoke testing surfaces bugs. E.1's manual checklist is the gate that catches "we wired the affordance to the wrong command" mistakes. Each finding either (a) fits in the wave it's attributed to as a fix-up, or (b) needs its own micro-wave. Budget ~3–5 fix-up waves on top of the planned count.

**Realistic ship estimate: 6–8 weeks of active development time.** This is not the user's calendar time — wall-clock drift (other priorities, breaks between sessions) is normal for a multi-week phase. The status-doc cadence keeps hand-offs cheap; the wave granularity keeps any individual session bounded.

**What to do if a wave is taking too long:** the rule from `feedback_test_scope_discipline` applies — if the inner-loop iteration on a wave exceeds ~2 hours of test churn, that's a signal the wave is two waves. Stop, split it, surface the split in the status doc, and continue. The plan accommodates this.

---

## §4 Definition of done

Phase 7 ships when:

- [ ] **"+ New Task" is the primary creation affordance** in the sidebar; "+ New Spec" / "Start Agent" no longer exist.
- [ ] **Sidebar renders tasks grouped by stage**, with run history visible inline per task.
- [ ] **All multi-candidate stage runs** (Brainstorm/Plan/Implement, not just Consolidation) use the labeled-affordance + nudge-banner + state-table-pinned pattern.
- [ ] **Diff view, Spec editor, Plan editor read from task artifacts** (`current_spec_body` etc.) when selection is task-shaped; from session worktrees when selection is orchestrator-shaped.
- [ ] **Sessions are not top-level sidebar entities** (orchestrator excluded — it stays as a special-case session at the top).
- [ ] **v1→v2 migration code** converts existing user DBs (specs → draft tasks) on first launch; round-trip tested + e2e tested.
- [ ] **`arch_component_size`, `arch_hydrator_completeness`, `arch_domain_isolation`, `arch_layering_database`** all green. The `arch_consolidation_affordances` test referenced earlier is `SessionVersionGroup.affordances.test.tsx` (a vitest, not an arch test); generalized in C.3 to `TaskRunSlots.affordances.test.tsx` covering all multi-candidate stages.
- [ ] **State-table guards** for TaskRow × stage × multi-candidate-state pin every observable affordance.
- [ ] **`just test` green**: 2422+ Rust tests + ~3300 vitest tests + lint + knip + cargo shear all pass.
- [ ] **Smoke test** against `/tmp/v2-smoke` walks all 8 sections (A–H) of the Phase 7 smoke checklist.

After Phase 7, v2 is ready to merge to main and replace v1 production lucode entirely.

---

## §5 Out of scope (explicit)

- **Backend domain-logic changes.** Task domain logic, schema, and lifecycle are complete and pinned. **In scope, by exception:** the Wave A.1 wire-shape serialization extensions (`current_*_body`, `derived_status` JSON fields), the Wave A.3.b OSC-emit gap closure, and any Phase 7-surfaced bug fixes (per `feedback_no_preexisting_excuse_taskflow`). These are wire-and-event extensions, not domain rewrites.
- **The vestigial `sessions.stage` column** (Phase 5.5 follow-up). Stays for separate post-charter cleanup.
- **The 21-entry `arch_component_size` allowlist.** Ratchet protects it; Phase 7 does not widen-then-fix.
- ~~Plan editor write path.~~ **Resolved per review pushback #3:** plan editing is in scope in Wave D.3, parity with spec editor.
- **Standalone non-spec session migration.** Such sessions stay as orchestrator-style ad-hoc until the user invokes capture (per-session right-click or D.1's bulk-capture button); the user accepted this trade-off in kickoff and confirmed the bulk-capture mitigation in review.
- **Kanban view (review correction):** Kanban is **explicitly disabled** during the v2 cutover. The list view is canonical. The kanban toggle in the sidebar header renders an inline message: "Kanban view returns in v2.1 — the v2 list view is the recommended task surface." This is an honest scope cut, not a soft "preserved in shape" commitment that breaks under task data. Re-enabling kanban is a post-Phase 7 standalone effort with its own state-table tests; punting "preserved" code into v2 invites a kanban-specific bug class.
- **MCP server task tools.** Phase 7 calls Tauri commands directly. Adding MCP tool wrappers for task creation / lifecycle is post-Phase 7 if the MCP user surface needs them; today MCP creates tasks via the existing REST + Tauri-bridge pattern and that continues to work.
- **The `just archive-prod-specs` exporter.** Stays functional for users cutting over from main with v1 spec data; document but don't refactor.
- **Renaming "Mred" → "Merged".** Cosmetic; do separately. (Per design doc out-of-scope.)

---

## §6 Decisions log (post-review)

User-review pass resolved every open question. The full list, for traceability:

1. **Wire-shape Option A — APPROVED with split.** `lucode_task_get` carries body fields; `lucode_task_list` and `TasksRefreshedPayload` do not. `derived_status` on `TaskRun` always present. Pin in tsd that get-by-id and list have differently-shaped `Task` returns. (§0.3, A.1.)
2. **Spec editor atom keying — APPROVED.** Discriminated union by selection kind in `src/store/atoms/specEditor.ts`. (D.3.)
3. **Empty-state UX — APPROVED.** "Create one with + New Task" copy in the Draft section's empty state. (B.2.)
4. **Orchestrator role — APPROVED.** Orchestrator stays a non-task surface; "Start orchestrator agent" button on the card itself. (D.1.)
5. **`lucode_task_capture_session` — RESOLVED.** Right-click "Capture as Task" on `SessionCard`; "Capture group as Task" on version groups. (D.1.)
6. **Bulk capture button — RESOLVED (review-added).** Sidebar surfaces a one-click "Capture all running sessions as draft tasks" affordance during cutover. Auto-hides once standalone count is 0. (D.1.)
7. **OSC-emit gap — RESOLVED.** New `infrastructure::app_handle_registry` (`OnceCell<AppHandle>`) registered in `main.rs:setup`, accessed by `session_facts_bridge::record_first_idle_on_db` to call `notify_task_mutation_with_db` after a successful first-idle write. Pin via `arch_app_handle_global_singleton`. (A.3.b.)
8. **`task_runs` source of truth — RESOLVED.** `tasksAtom` canonical; `Task.task_runs` is the run list; read-only derived selector for run access. (A.2.)
9. **Plan editor write path — RESOLVED (review correction).** Plan editing in scope for D.3, parity with spec editor.
10. **Programmatic e2e — RESOLVED (review-added).** Wave E.0 ships `tests/e2e_task_lifecycle_full.rs`.
11. **Kanban view — RESOLVED (review correction).** Explicitly disabled during cutover; honest scope cut documented in §5.
12. **Realistic timeline — RESOLVED.** §3.5 calibration: 6–8 weeks active dev. Mid-flight splits expected.

No remaining gates. Plan is approved-as-edited.
