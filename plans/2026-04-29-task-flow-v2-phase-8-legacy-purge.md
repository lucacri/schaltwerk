# task-flow v2 — Phase 8: legacy purge

**Status:** plan, awaiting user sign-off (no code yet)
**Branch:** `task-flow-v2`
**Trigger:** smoke-fail-A.1 surfaced a structural dual-mount in the sidebar — both `SidebarStageSectionsView` (correct) and `SidebarSessionList` (legacy) render simultaneously, producing duplicate Task / Spec rows for the same underlying work. The Phase 7 backbone (TaskRow → TaskRunRow → TaskRunSlots → SessionCard-as-slot-child) is structurally correct and stays. This phase deletes what shouldn't have shipped alongside it.

**Frame:** Phase 7 stays "complete" in the status doc. Phase 8 is the legacy-purge pass that removes the second (legacy) mount and every component branch reachable only from it. ~80% of the work is deletion; the remaining 20% is wiring the gaps that the dual-mount was masking.

**Estimate:** 8 sub-waves, ~15–25 files touched, ~3000 lines deleted, ~500 lines added (gap wiring + tests). Test-count drop is expected (~50–80 vitest tests retire alongside their components).

---

## §0 What stays from Phase 7 (do not touch)

| Surface | Status |
|---|---|
| `TaskRow` / `TaskRunRow` / `TaskRunSlots` rendering pipeline | Correct. Stays. |
| `useTaskRowActions` / `useTaskRunSlots` / `useSidebarStageSections` hooks | Correct. Stays. |
| `buildStageSections` helper + the 8-section split with cancelled-axis pin | Correct. Stays. |
| `SidebarStageSectionsView` | Correct (after the bulk-capture button retires per W.3). |
| `NewTaskModal` + `+ New Task` button | Correct shell; field set audited in W.5 §5. |
| `TaskArtifactEditor` + `TaskRightPane` + `RightPanelTabs` early-return for task selections | Correct. Stays. |
| Backend task aggregate (Phases 0–6 + 5.5) | Untouched. |
| `arch_app_handle_global_singleton` (Phase 7 close-out) | Stays. |
| `OrchestratorEntry` (already mounted at `Sidebar.tsx:393`, above the stage sections — verified) | Stays. |
| `SessionCard` *as a sub-component rendered inside `TaskRunSlots`* | Stays in that role only. Top-level renderings retire (W.1). |

---

## §1 Sub-wave breakdown

### W.1 — Delete legacy sidebar mount + reachable-only-from-it components

**Goal:** unmount `SidebarSessionList` from `Sidebar.tsx`. Walk the dependency tree. Delete every component, hook, and helper that becomes orphaned.

**Files deleted (verified reachable only from the legacy mount):**
- `src/components/sidebar/views/SidebarSessionList.tsx` + `.test.tsx`
- `src/components/sidebar/views/SidebarSectionView.tsx` + `.test.tsx`
- `src/components/sidebar/views/SidebarVersionGroupRow.tsx` (no separate test; folded into Sidebar tests)
- `src/components/sidebar/SessionVersionGroup.tsx` (top-level renderer) + every `SessionVersionGroup.*.test.tsx` file
  - **Critical**: this includes the 6×7+invariants `SessionVersionGroup.affordances.test.tsx`. The state-table pattern survives, generalized into `TaskRunSlots.affordances.test.tsx` (already shipped in C.3).
- `src/components/sidebar/CompactVersionRow.tsx` + `.test.tsx`
- `src/components/sidebar/CollapsedSidebarRail.tsx` (legacy session-rail rendering)
- `src/components/sidebar/SessionRailCard.tsx` (children of the collapsed rail; only consumed by `CollapsedSidebarRail`)
- `src/components/sidebar/EpicGroupHeader.tsx` (only consumed by `SidebarSectionView`)
- `src/components/sidebar/SidebarSectionHeader.tsx` — **verify** before delete: shared with `SidebarStageSection`. If shared → keep. (Quick grep confirms it's used by `SidebarStageSection`; **keep**.)
- `src/components/sidebar/KanbanView.tsx` + `.test.tsx` + `KanbanSessionRow.tsx`
- `src/components/sidebar/sessionStatus.ts` — verify usage; if only consumed by retired components, delete; if `SessionCard` (which we keep) reads it, keep.
- `src/store/atoms/sidebarViewMode.ts` + `.test.ts`

**Hooks deleted:**
- `src/components/sidebar/hooks/useSidebarSectionedSessions.ts` + `.test.ts`
- `src/components/sidebar/hooks/useSidebarSelectionActions.ts`
- `src/components/sidebar/hooks/useSidebarSelectionMemory.ts` (if it's session-only; if the 100-line effect can be salvaged for task selection memory, **rebind** instead)
- `src/components/sidebar/hooks/useConsolidationActions.ts` (top-level consolidation; the same pattern lives inside `TaskRunSlots` now)
- `src/components/sidebar/hooks/useGitlabMrDialogController.ts` — verify task-level use; if a task version of GitLab MR creation is needed, keep+rebind, else retire
- `src/components/sidebar/hooks/useMergeModalListener.ts`, `useVersionPromotionController.ts`, `usePrDialogController.ts`, `useSidebarMergeOrchestration.ts`, `useSidebarSectionedSessions.ts`, `useSessionEditCallbacks.ts`, `useRefineSpecFlow.ts` — audit per-hook in W.1; if a hook is task-aware (e.g. merge a task), **rebind**; if it's session-shaped legacy plumbing, retire.

**Helpers deleted:**
- `src/components/sidebar/helpers/versionGroupings.ts` (`groupSessionsByVersion`, `splitVersionGroupsBySection`, `groupVersionGroupsByEpic`, `SidebarSectionKey`)
- `src/components/sidebar/helpers/sectionCollapse.ts` (`SidebarSectionCollapseState` etc.)
- `src/components/sidebar/helpers/selectionMemory.ts` (if scoped to the legacy selection model)
- `src/components/sidebar/helpers/consolidationGroupDetail.ts`
- `src/components/sidebar/helpers/buildSessionCardActions.ts`
- `src/components/sidebar/utils/sessionVersions.ts` (if any) + `.test.ts`

**Sidebar.tsx rewrite:**
The file's job collapses to: `<OrchestratorEntry />` + `<SidebarSearchBar />` (kept; usable as task search) + `<SidebarStageSectionsView />` + the modals trailer. Drop ~half of its current imports (the legacy hooks/helpers/views), drop the giant `buildSessionCardActions(...)` block. Target post-purge size: **≤ 250 lines** (currently 496). The drop drives Sidebar far below the cap; remove from `arch_component_size` allowlist if it's there (check; I added stage sections to it without bumping the cap, so it should already be off the list).

**Pinning:**
- After the delete, `bun run knip` should produce a wave of "unused export" warnings for atoms/hooks I missed. Each one gets either a delete commit or a justification line in this plan.
- `arch_component_size` test runs green at every commit boundary inside W.1 (sub-commits per major file group: views first, then hooks, then helpers).

**Estimate:** ~3 commits in W.1, ~12–15 files deleted, ~2000 lines removed.

---

### W.2 — Delete legacy modal flows + creation paths

**Goal:** retire `NewSessionModal` and the entire spec-creation entry-point complex.

**Files deleted:**
- `src/components/modals/NewSessionModal.tsx` + `.test.tsx`
- `src/components/modals/newSession/` directory (NewSessionAdvancedPanel, buildCreatePayload, etc.) — each file checked: if a piece is reusable for `NewTaskModal` (per W.5 audit), **rebind**; the rest retire.
- `src/components/modals/ConvertToSpecConfirmation.tsx` + `.test.tsx` + the trailer slot

**App.tsx edits:**
- Delete `[openAsDraft, setOpenAsSpec]` state (App.tsx:544).
- Delete `[newSessionOpen, setNewSessionOpen]` state (App.tsx:514) — `newTaskOpen` already replaces it.
- Delete `closeNewSessionModal` (App.tsx:1894).
- Delete the `<NewSessionModal>` mount (App.tsx:2674).
- Delete the `KeyboardShortcutAction.NewSession` and `.NewSpec` handlers; add a single `KeyboardShortcutAction.NewTask` handler that opens NewTaskModal. Both bindings (Mod+N, Mod+Shift+N) point at it.
- Delete the `UiEvent.NewSpecRequest` listener (App.tsx:1668-1678).
- Delete the `UiEvent.GlobalNewSessionShortcut` and `UiEvent.NewSessionRequest` listeners; replace with `UiEvent.NewTaskRequest` listener that calls `setNewTaskOpen(true)`.
- Delete `handleContextualSpecCreate` (App.tsx:2208) and `handleContextualSessionCreate` (App.tsx:2166); replace with a single `handleContextualTaskCreate` that prefills NewTaskModal with the contextual detail (issue number, body, etc.).
- Delete `handleCreateSession` (App.tsx:1907–2088) — the giant create-session function with both spec and agent-mode branches. NewTaskModal calls `createTask` from `taskService` directly; no equivalent on App.tsx is needed.

**Files edited (small):**
- `src/keyboardShortcuts/config.ts` — retire `NewSpec` enum member, rename `NewSession` → `NewTask`. Both bindings collapse onto `NewTask`.
- `src/keyboardShortcuts/metadata.ts` — same enum rename, label "Create new task".
- `src/components/terminal/terminalKeybindings.ts` — retire `TerminalCommand.NewSpec`. Rename `TerminalCommand.NewSession` → `NewTask`. Update the keybinding match table.
- `src/components/terminal/Terminal.tsx` — retire `emitUiEvent(UiEvent.NewSpecRequest)`; rename `UiEvent.GlobalNewSessionShortcut` → `UiEvent.NewTaskRequest`.
- `src/common/uiEvents.ts` — retire `UiEvent.NewSpecRequest`, `UiEvent.GlobalNewSessionShortcut`, `UiEvent.NewSessionRequest`; add `UiEvent.NewTaskRequest`. Update the event-map.
- `src/locales/en.json` + `zh.json` — retire `sections.specs`, `sections.running`, `sections.collapseSpecs`, `sections.expandSpecs`, etc. (they're only consumed by retired components). Retire `home.createSpec`, `home.startAgent`. Add `home.newTask` if not already present.
- `src/components/onboarding/steps.tsx` — rewrite step copy: "Click **+ New Task** or press ⌘N" (drop the spec mention).
- `src/components/settings/ContextualActionsSettings.tsx` — retire `'spec'` and `'spec-clarify'` action types; replace with `'task'` and `'task-clarify'`.

**Frontend retirement of `SchaltwerkCoreCreateSession` / `SchaltwerkCoreCreateSpecSession` invocations:**
- `src/App.tsx:1958` (`SchaltwerkCoreCreateSpecSession`) — deleted with `handleCreateSession`.
- `src/App.tsx:2026` (`SchaltwerkCoreCreateSession`) — deleted with `handleCreateSession`.
- `src/hooks/contextualSpecClarify.ts:51` — retire the helper or rebind to `lucode_task_create + lucode_task_start_clarify_run`. The contextual "Auto-clarify" use case maps to creating a task with the issue prompt and immediately spawning a clarify run on it.
- `src/store/atoms/sessions.ts:2459` (`createDraftActionAtom`) — retire (dead export).
- `src/store/atoms/sessions.ts:2502-2541` (`optimisticallyConvertSessionToSpecActionAtom`) — retire.
- `src/store/atoms/sessions.ts:2425` (`updateSessionStatusActionAtom` with `status: 'spec'`) — retire the status-flip path; the atom itself may stay if other status flips remain (e.g., `'cancelled'` for live sessions selected through orchestrator).

**Backend question (verify, don't change):** does `lucode_core_create_session` get called by anything orchestrator-side internally (e.g., orchestrator startup)? If yes, the Tauri command stays for that internal use. If only the frontend called it, retire the command too. **Default: keep the backend command; verify in W.2.**

**Pinning:**
- Compile-pin: `KeyboardShortcutAction.NewSpec` deleted. `UiEvent.NewSpecRequest` deleted. Future drift can't accidentally re-introduce them (TypeScript fails).
- Update test mocks across `src/App.test.tsx`, `src/utils/sessionVersions.test.ts`, `src/hooks/contextualSpecClarify.test.ts`, `src/store/atoms/sessions.test.ts` — every `mockInvoke(SchaltwerkCoreCreateSession|SchaltwerkCoreCreateSpecSession)` becomes `mockInvoke(LucodeTaskCreate)`.

**Estimate:** ~2 commits, ~10 files edited, ~600 lines removed, ~150 lines added (the rebound contextual handler + listener).

---

### W.3 — Delete capture-as-task surface

**Goal:** retire the entire capture path. User confirmation: no standalone sessions exist in v2 except orchestrator (which is its own surface), so there is nothing to capture.

**Frontend deletions:**
- `src/components/sidebar/views/SidebarStageSectionsView.tsx` — delete the `bulkCapturePill`, `handleBulkCapture`, `standaloneCandidates`, `isStandaloneCaptureCandidate` blocks. The empty-state placeholder ("No tasks. Create one with + New Task") stays.
- `src/components/sidebar/views/SidebarStageSectionsView.test.tsx` — delete the bulk-capture tests (4 of them).
- `src/components/sidebar/SessionCard.tsx:312-322` — delete the "Capture as Task" right-click menu entry. Drop `onCaptureAsTask` from the destructuring.
- `src/components/sidebar/SessionCard.test.tsx` — delete the 5 capture-as-task tests added in D.1.b.
- `src/contexts/SessionCardActionsContext.tsx` — drop `onCaptureAsTask?` from `SessionCardActions` interface and from the proxy memo.
- `src/components/sidebar/helpers/buildSessionCardActions.ts` — **deleted entirely in W.1** (legacy session list dependency); the `handleCaptureAsTask` plumbing dies with it.
- `src/components/sidebar/Sidebar.tsx` — drop `import { captureSessionAsTask }` and the `handleCaptureAsTask` callback (already deleted with `buildSessionCardActions` reference removal in W.1).
- `src/services/taskService.ts` — retire `captureSessionAsTask` and `captureVersionGroupAsTask` exports.
- `src/common/tauriCommands.ts` — retire `LucodeTaskCaptureSession` and `LucodeTaskCaptureVersionGroup` enum entries.

**Backend deletions:**
- `src-tauri/src/commands/tasks.rs` — retire `lucode_task_capture_session` and `lucode_task_capture_version_group` Tauri commands.
- `src-tauri/src/main.rs` — drop the two from the invoke handler list.
- `src-tauri/src/domains/tasks/service.rs` — retire `capture_session_as_task` and `capture_version_group_as_task` if they exist as service methods.
- Their tests retire alongside.

**Pinning:**
- Compile-pin: `LucodeTaskCaptureSession` and `LucodeTaskCaptureVersionGroup` deleted from the enum. Frontend can't accidentally re-invoke.

**Estimate:** ~1 commit, ~8 files edited (5 frontend, 3 backend), ~250 lines deleted.

---

### W.4 — Delete v1→v2 migration code

**Goal:** retire the spec-to-task migration. User confirmed: no v1 data migration. v2 ignores any v1 sessions table that happens to exist on disk.

**Files deleted:**
- `src-tauri/src/infrastructure/database/migrations/v1_to_v2_specs_to_tasks.rs` (all 7 tests retire with it)
- `src-tauri/tests/e2e_v1_specs_migrate_to_draft_tasks.rs` (if present)

**Files edited:**
- `src-tauri/src/infrastructure/database/migrations/mod.rs` — drop the `pub mod v1_to_v2_specs_to_tasks;` line.
- `src-tauri/src/infrastructure/database/db_schema.rs` — drop the `super::migrations::v1_to_v2_specs_to_tasks::run(conn)?;` call from the migration chain.
- The other v1→v2 migrations (`v1_to_v2_run_role`, `v1_to_v2_session_status`, `v1_to_v2_task_cancelled`, `v1_to_v2_task_runs`) **stay** — they're not about specs-to-tasks; they're schema migrations for the task domain that would need to run on a v2-native DB anyway.

**Pinning:**
- No new pin. The existing arch tests catch any stray reference to the deleted migration.

**Estimate:** ~1 commit, ~3 files edited, ~470 lines deleted.

---

### W.5 — Wire the gaps

**Goal:** address the 10 wiring gaps the user surfaced. Each gets its own pin or test.

#### 5.1 — Orchestrator placement

Already correct: `OrchestratorEntry` mounts at `Sidebar.tsx:393` between `SidebarHeaderBar` and `SidebarSearchBar`, above `SidebarStageSectionsView` at line 430. After W.1's Sidebar.tsx rewrite, verify the order stays:

```
<SidebarHeaderBar />
<OrchestratorEntry />
<SidebarSearchBar />
<SidebarStageSectionsView />
<SidebarModalsTrailer />
```

**Pin:** add a render test `Sidebar.structure.test.tsx` that asserts the DOM order: `[orchestrator, search, stage-sections, ...nothing else]`. Failing on any insertion of a fifth top-level child or on reordering. Per user spec: "regression test that no slot session appears at top-level in the rendered sidebar — render a task with 3 slots, assert sidebar root has exactly 1 (orchestrator) + N(stage section headers) + 1(task row) children."

#### 5.2 — Right-pane render per selection kind

Already mostly wired. Gaps:
- `kind: 'task'` → `TaskRightPane` (DONE — D.3.b).
- `kind: 'task-run'` → **NEW**: render a run summary (stage, status, started_at, slot count, winner if confirmed) + diff vs base branch. Component: `TaskRunRightPane` (small, ~150 lines). Mounts when `selection.kind === 'task-run'`. Diff binds to `task.task_branch` (the base) vs the run's slot branches.
- `kind: 'task-slot'` → **NEW**: slot-specific surface — the slot's diff against the run's selected branch (or the task's base if no winner) + a terminal pane bound to the slot session. Component: `TaskSlotRightPane`.
- `kind: 'orchestrator'` → unchanged from v1; existing orchestrator surface (terminals + diff) stays.
- `kind: 'session'` → **DELETED** (no top-level session selection in v2).

`RightPanelTabs` early-return logic extends from the current single check to a 4-way dispatch:
```ts
if (effectiveSelection.kind === 'task') return <TaskRightPane taskId={...} />
if (effectiveSelection.kind === 'task-run') return <TaskRunRightPane runId={...} />
if (effectiveSelection.kind === 'task-slot') return <TaskSlotRightPane sessionId={...} />
// orchestrator falls through to the existing render
```

**Pin:** `RightPanelTabs.test.tsx` exhaustive selection-kind dispatch — one test per kind.

#### 5.3 — Terminal binding

When a slot is selected:
- **Top terminal**: binds to the slot's agent in the slot's sub-worktree. Already the v2 backend behavior for slot sessions; frontend just needs to use the slot's session_id for terminal id derivation.
- **Bottom terminal**: user shell in the slot's sub-worktree.

When a task is selected (no slot):
- **Top terminal**: nothing. No agent runs at the task level — agents run *inside* runs/slots. Empty pane with placeholder text "Select a slot to view its agent terminal."
- **Bottom terminal**: shell in the task's base worktree (`task.task_branch`'s worktree). Useful for the user to inspect the base before launching a run.

When a task-run is selected:
- **Top terminal**: nothing (same rationale — agents run in slots, not at the run level).
- **Bottom terminal**: shell in the task's base worktree (same as task selection).

**Rationale**: agents are slot-scoped. The task is just an envelope. Spawning an agent at the task level would either duplicate run-launching (which has its own UX via the stage-action button) or create a sneaky un-tracked agent. Better to make the user explicit: pick a slot, get the slot's agent.

**Pin:** terminal-binding integration test in `TaskRightPane.test.tsx` extension — when a task is selected, the terminal grid shows the placeholder; when a slot is selected, the terminal grid mounts the slot's agent terminal.

#### 5.4 — v1 DB on disk

User chose option (a): **v2 ignores v1 sessions table entirely. Leaves it on disk. Never reads or writes.**

This is implicit in the current code — v2 reads the `sessions` table with the v2 schema; if a v1-shape DB has extra columns, SQLite tolerates them; if it lacks columns, the schema-init migrations add them. The `v1_to_v2_*` migrations that previously ran (run_role, session_status, task_cancelled, task_runs) still run — they're column-shape adjustments, not data migrations.

**Documented decision:** v2 reads sessions for its own internal purposes (orchestrator session, slot sessions). Pre-existing v1 sessions that are not orchestrator/slot are simply not surfaced anywhere in the v2 UI. They sit in the DB. If the user wants them gone, they delete the DB file manually.

**Pin:** add a documented decision row in this plan section. No code or test work — just a decision-log entry so future agents don't add a "migration" thinking it's missing.

#### 5.5 — NewTaskModal field set

Audited NewSessionModal field-by-field:

| Field | Belongs in NewTaskModal? | Rationale |
|---|---|---|
| name | Yes (already present) | Required |
| displayName | Yes (already present) | Optional |
| requestBody / prompt | Yes (already present, named `requestBody`) | Seeds the spec artifact |
| baseBranch | Yes (already present) | Sets `task.base_branch` |
| customBranch / useExistingBranch / syncWithOrigin | **No** — deferred to `lucode_task_promote_to_ready` | Branch provisioning is a stage transition, not task creation |
| isSpec | **Drop** | No specs in v2 |
| draftContent | **Drop** | `requestBody` covers it |
| versionCount | **Drop** | Multi-candidate is run-time (set in `StageRunPresetModal`) |
| agentType / agentTypes / agentSlots | **Drop** | Agents are slot-scoped, picked at run launch via `StageRunPresetModal` |
| autonomyEnabled | **Drop** | Per-agent setting, lives at slot level |
| epicId | Yes — **add to NewTaskModal** | Tasks belong to epics |
| issueNumber / issueUrl | Yes — **add to NewTaskModal** (optional, hidden until "Link to issue" clicked) | Forge linkage at creation time |
| userEditedName | Yes — implicit (already in NewTaskModal logic) | Sanitization signal |

**Adds** (small): epic dropdown (using existing `useEpics` hook), optional "Link to forge issue" expandable section with issue number + url inputs.

**Drops** (already absent from NewTaskModal): everything in the "Drop" rows above.

**Pin:** `NewTaskModal.test.tsx` — assert the form has exactly 5 visible fields (name, displayName, baseBranch, requestBody, epic) by default, with the optional "Link to issue" expandable section. ts-expect-error witness that `agentType` is not a prop on `NewTaskModalProps`.

#### 5.6 — Stage transition UX

**Verified against design doc**: design doc §"What stays" line 120 says "Pure `decide_next_stage` state machine (the only state machine that's well-shaped — pure function over (stage, failure, pr_state))". The backend's `confirm_stage` (verified at `orchestration.rs::confirm_stage`) already advances the task stage as part of the confirm-winner flow.

**Decision: option (a) — auto-promote on winner-confirm.** When the user confirms a winner for a Brainstorm run, the backend advances `task.stage` from `Ready` → `Brainstormed` automatically. The TaskRow's stage badge updates via the `TasksRefreshed` listener. No separate "Promote to Plan" button.

The **one** manual transition: Draft → Ready (via the existing "Promote to Ready" button on the Draft TaskRow). This is the moment `task.task_branch` is provisioned, so it's a deliberate user action.

After Ready, every subsequent stage flip is auto-promoted on confirm-stage success. No further manual transition buttons.

**Pin:** `TaskRow.affordances.test.tsx` already has the state table; verify the Brainstormed/Planned/Implemented rows show "Run [next stage]" buttons but NOT "Promote to [next stage]" buttons. (Quick check: my current code maps these stages to "Run Plan" / "Run Implement" — so this is already the design. Good.)

#### 5.7 — Forge issue linkage on Task

Backend already has it: `task.issue_number`, `task.issue_url`, `db.set_task_issue`, `lucode_task_attach_issue` Tauri command. Currently no frontend surface.

**Adds:**
- `TaskRow` header: small forge issue badge when `task.issue_number != null`. Click navigates to the issue URL in the user's browser.
- `TaskRightPane`: in the right pane, a "Forge" tab showing issue body / state / link affordances. Reuses existing forge UI components (`ForgeIssuesTab` etc.) but bound to `task.issue_*` fields, not `session.issue_*`.

**Pin:** `TaskRow.test.tsx` — render a task with `issue_number: 42`, assert the forge badge renders + has correct href.

If forge is more involved than this (e.g., the existing forge surface is heavily session-shaped), defer the deeper integration to a follow-up phase and ship just the badge + URL link in this wave. Flagged for the user.

#### 5.8 — Done / Cancelled section visibility

Current code: Cancelled is collapsed by default (correct), Done is expanded (incorrect). Flip Done to collapsed by default. Both keep their counts visible in the section header even when collapsed.

```ts
// useSidebarStageSections.ts
const DEFAULT_COLLAPSE: Record<StageSectionKey, boolean> = {
  draft: false,
  ready: false,
  brainstormed: false,
  planned: false,
  implemented: false,
  pushed: false,
  done: true,        // ← was false; flip
  cancelled: true,
}
```

**Pin:** `useSidebarStageSections.test.tsx` extension — assert both `done` and `cancelled` start collapsed.

#### 5.9 — Cancel cascade UX

Backend already has cascade cancellation (`cancel_task_cascading` in `domains/tasks/service.rs`). Frontend wires:

- TaskRow's Cancel button → confirmation modal showing the count of runs, slot sub-worktrees, and the base worktree being destroyed.
- Modal text: "Cancel `<task name>`? This will cancel <N> run(s), <M> slot worktree(s), and remove the base worktree `<task_branch>`."
- On confirm: call `lucode_task_cancel(taskId)`. The backend handles the cascade.

**Component:** new `CancelTaskConfirmation.tsx` modal (~80 lines). Mounted in the modals trailer.

**Pin:** modal render test asserting the count strings match the task's run/slot count.

#### 5.10 — Failure mid-confirm at task level

C.3's `TaskRunSlots.affordances.test.tsx` covers slot-level merge-failed-mid-confirm. **Add a task-level row**:
- State: confirm-stage was attempted, merge failed, run stays in `awaiting_selection`, task stage stays at the pre-confirm value.
- Affordance: a banner on the TaskRow header surfacing the failure reason + a "Retry confirm" button.

`TaskRow` extension: ~30 lines. The banner reads from a new `task.last_confirm_failure_reason: Option<String>` field on the wire — backend already emits this via `StageAdvanceFailedAfterMerge` (`TaskFlowError` variant). The frontend needs to capture this error from the failed `confirmStage` call and store it in a local state-keyed-by-task for banner display, since the backend doesn't persist the failure reason on the task.

**Decision point**: do we persist the last-failure-reason on the task row, or keep it transient (modal toast on failure, no persistent banner)? Toast is simpler, matches v1 patterns, and avoids a backend schema add. **Recommend: toast on failure, no persistent banner.** The retry happens by clicking confirm-winner again on the slot.

**Pin:** `TaskRunSlots.affordances.test.tsx` extension — when `confirmStage` rejects with a merge-failure error, the toast is shown and the affordance state stays in "awaiting_selection" (the merge-failed banner inside `TaskRunSlots` already exists from C.3 — verify it surfaces from the new error path).

---

### W.6 — Architecture pins

Three pins, mandatory:

#### 6.1 — Frontend grep arch test for v1-leakage

New file: `src/__tests__/arch_no_v1_session_leakage.test.ts` (vitest). Walks `src/components/` and `src/store/` for case-sensitive identifier-shaped occurrences of:
- `setOpenAsSpec`
- `openAsSpec`
- `KeyboardShortcutAction.NewSpec` / `NewSession`
- `UiEvent.NewSpecRequest` / `UiEvent.NewSessionRequest` / `UiEvent.GlobalNewSessionShortcut`
- `SchaltwerkCoreCreateSession` / `SchaltwerkCoreCreateSpecSession`
- `LucodeTaskCaptureSession` / `LucodeTaskCaptureVersionGroup`
- `'Spec'` / `'Specs'` / `'spec'` (as identifier-shaped tokens — i.e., not inside a string that's a `current_spec_body`-style task field accessor)

Allowlist (explicit):
- `src/types/task.ts` (the `TaskArtifactKind = 'spec' | …` literal stays)
- `src/components/right-panel/TaskArtifactEditor.tsx` (kind dispatch: `kind === 'spec'`)
- `src/components/right-panel/TaskRightPane.tsx` (tab labels)
- `src/types/session.ts` (`SpecStage` and related types — Phase 4 retired the v1 enums but left compat types; verify none are dead in W.1)
- Generated bindings if any (Tauri-generated TS, etc.)

Same shape as `arch_app_handle_global_singleton.rs` but for the frontend.

**Pin:** the test itself. Failure on revert.

#### 6.2 — Sidebar top-level structure pin

`Sidebar.structure.test.tsx`: render Sidebar with a populated `tasksAtom` (one task with 3 slots) and assert the DOM root has exactly:
- 1 `<OrchestratorEntry>`
- 1 `<SidebarHeaderBar>`
- 1 `<SidebarSearchBar>`
- 1 `<SidebarStageSectionsView>` (with its 8 stage section children)
- 1 `<SidebarModalsTrailer>`

And NO `<SessionCard>` rendered as a direct child of the sidebar root. The slot sessions render only inside `TaskRunSlots` inside `TaskRunRow` inside `TaskRow` inside `SidebarStageSection`.

#### 6.3 — Compile-pins for retired enum members

- `KeyboardShortcutAction.NewSpec` deleted from the enum → any stray reference fails to compile.
- `UiEvent.NewSpecRequest` deleted → same.
- `LucodeTaskCaptureSession` / `LucodeTaskCaptureVersionGroup` deleted from `TauriCommands` → frontend can't accidentally re-invoke.
- `lucode_task_capture_session` / `lucode_task_capture_version_group` deleted from backend → `cargo check` fails on any stray Tauri handler reference.

These are passive pins (deletion enforces them via the type system). No separate test code needed.

---

### W.7 — Status doc + memory update

- `plans/2026-04-29-task-flow-v2-status.md` — Phase 7 row stays "complete." Add Phase 8 row "Legacy purge: dual-mount removed; v1 leakage retired." Add the eight W.x sub-wave commit hashes.
- Auto-memory `project_taskflow_v2_charter.md` — add a Phase 8 note: *"Phase 7 backbone (TaskRow → TaskRunRow → TaskRunSlots → SessionCard-as-slot-child) was correct; Phase 8 deletes the legacy SidebarSessionList that was mounted alongside it. The structural fix was dual-mount removal, not backbone rewrite. ~3000 lines deleted, ~500 added (gap wiring)."*
- Auto-memory new entry: `feedback_dual_mount_is_a_smell.md` — *"When a v2 surface ships alongside a v1 surface (both mounted), the v1 surface will leak through and confuse smoke walks. The dual-mount is the smell. Default to deletion when adding a v2 surface that supersedes a v1 one — additive landings invite this exact bug class."*

---

### W.8 — Tag + smoke restart

- `git tag pre-smoke-walk-3` at the W.7 commit.
- `git push origin pre-smoke-walk-3`.
- Smoke checklist updates: every §A.x item from §A.1 through §A.11 is freshly invalid (the prior smoke walks exercised v1 surfaces). Update the checklist:
  - **§A.1** — pin BOTH invocation paths (button click AND keyboard shortcut) — both must land in the Draft section with a task-shaped `TaskRow`. Drop "the word 'Spec' must not appear" — the SPECS section is gone in v2.
  - **§A.10** — pin that the right pane is `TaskRightPane`, not the legacy SpecEditor. Add a `data-testid="task-right-pane"` assertion in the smoke walk: if the testid is absent, the legacy fallback is somehow alive.
  - **§A.11** — kanban is now genuinely deleted (W.1), not just disabled. Update the section to assert: no Board toggle visible at all, only the disabled "Board v2.1" affordance (per W.1's static-affordance rebuild).
  - **§B.1–B.6** — migration smoke: **delete entirely**. v2 doesn't migrate. Replace with a single check: "Open project against an existing v1 DB; v2 launches without errors; legacy v1 sessions are not surfaced anywhere in the UI."
  - **§B.7** — capture-session smoke: **delete entirely**. No capture in v2.
  - **§C** — keep C.1, C.2, C.3 (general cross-cutting). Drop C.4 (task_id field across surfaces — the surfaces it tested are gone).

The user restarts smoke from §A.1 against the new build.

---

## §2 Discipline (mandatory)

| Rule | Phase 8 application |
|---|---|
| TDD | Every gap-wire test (W.5) lands red first; W.6's arch tests likewise. Deletions don't need TDD; their pin is the type-system or the missing test file. |
| `arch_component_size` | Sidebar.tsx target ≤ 250 lines post-W.1. Other allowlisted files should drop too as their callers retire; remove from allowlist when they go below the cap. |
| `arch_no_v1_session_leakage` | New (W.6.1). |
| `arch_app_handle_global_singleton` | Stays green. |
| Frontend test scope discipline | Scoped vitest for inner-loop, full `just test` at sub-wave boundary. |
| Parallel agent dispatch | W.1 deletion sweep is parallelizable: one agent per file group (views / hooks / helpers). Each does the delete, runs scoped tests, no commit. Coordinator commits per group. |
| No setTimeout / polling | Untouched. |
| Type-safe events | `UiEvent.NewTaskRequest` replaces three retired events (NewSpec, NewSession, GlobalNewSession). |
| Type-safe Tauri commands | `LucodeTaskCapture*` retired; ⌘N + ⇧⌘N → `LucodeTaskCreate` only. |
| Theme system | No new colors needed. |

---

## §3 Process

This phase is roughly the same shape as Phases 0–6: one wave per session, status doc updated per merge, tag at the end. Estimated 5–8 sessions of active work.

W.1 is the largest single wave (~2000 lines deleted). Will likely split mid-flight per `feedback_test_scope_discipline` guidance.

W.5's gap-wiring is the only "additive" work (~500 lines added). Each of the 10 gaps gets its own sub-commit.

W.6's arch tests land last so they don't fail on intermediate states during the deletion sweep.

---

## §4 Definition of done

Phase 8 ships when:

- [ ] `Sidebar.tsx` ≤ 250 lines.
- [ ] `bun run knip` reports no unused exports in `src/components/sidebar/` (excluding the explicit test-utility allowlist).
- [ ] Render test pinning the sidebar's top-level structure passes.
- [ ] `arch_no_v1_session_leakage` passes (new test).
- [ ] `arch_app_handle_global_singleton` passes (existing).
- [ ] `arch_component_size` passes; the 21-entry allowlist is reduced by every now-retired file.
- [ ] All 10 wiring gaps from W.5 are pinned with their respective tests.
- [ ] `KeyboardShortcutAction.NewSpec`, `UiEvent.NewSpecRequest`, `LucodeTaskCaptureSession`, `LucodeTaskCaptureVersionGroup` are deleted (compile-pins).
- [ ] `just test` green. Test count drops are expected and documented in the W.7 status update.
- [ ] Smoke walk against `pre-smoke-walk-3` passes through the revised §A.1 → §C checklist.

After smoke green-lights, the branch is mergeable to `main`.

---

## §5 Out of scope (explicit)

- Backend changes beyond the W.3 capture-command retirement and W.4 migration-file retirement. Task domain logic is untouched.
- Kanban v2.1 rebuild. The disabled affordance documents that it returns; no scope here.
- A task-aware `CollapsedSidebarRail` rebuild. The rail retires in W.1; if collapsed-state task rendering is needed for §A walking, that's a follow-up phase.
- Migrating v1 user data into v2 tasks. User-confirmed: no migration. v1 DB sessions sit on disk, ignored by v2.

---

## §6 Open questions for user sign-off

Three decisions in W.5 the user should confirm before W.5 starts:

1. **5.3 terminal binding**: when a task (no slot) is selected, top terminal is empty with placeholder text and bottom terminal is a shell in the base worktree. Does that match your model, or should the top terminal also bind to base-worktree shell?
2. **5.7 forge issue**: scope for this phase is just "badge on TaskRow + URL link." Deeper forge integration (issue body in right-pane, link/unlink affordances) deferred. OK?
3. **5.10 task-level mid-confirm failure**: toast-on-failure (no persistent banner) vs persisting `last_confirm_failure_reason` on the task. Recommendation: toast. OK?

After sign-off, W.1 starts.
