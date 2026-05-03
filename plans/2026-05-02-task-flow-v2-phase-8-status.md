# task-flow v2 — Phase 8 (legacy purge) close-out

**Branch:** `task-flow-v2`
**Status:** Phase 8 W.1–W.6 complete on 2026-05-02. Pending: W.7 memory + W.8 smoke walk + branch push.
**Authoritative state:** this file. Phase 7 close-out lives in `plans/2026-04-29-task-flow-v2-phase-7-close-out.md`.

## Why Phase 8 was needed

Smoke walk fail-A.1 surfaced the dual-mount bug: `Sidebar.tsx:430` mounted the new task-shaped `<SidebarStageSectionsView />` AND `:431` ALSO mounted the legacy `<SidebarSessionList />`. Slot sessions rendered twice; the user saw the legacy mount and concluded "v2 is just a thin shell over v1." The Phase 7 backbone (TaskRow → TaskRunRow → TaskRunSlots → SessionCard-as-slot-child) was structurally correct; the bug was bolt-on, not foundation.

Phase 8 is the deletion pass that removes every legacy session-shaped surface that survived alongside the v2 task aggregate, plus the gap-wiring needed to make the v2 surface fully functional once it's the only one rendering.

## Sub-wave summary

### W.1 — sidebar legacy mount deletion (commit `c9ee881b`)

73 files deleted, ~14815 lines down, ~136 up. `Sidebar.tsx` 511 → 182 lines. Retired:

- `SidebarSessionList`, `SidebarSectionView`, `SidebarVersionGroupRow`, `SessionVersionGroup`, `CompactVersionRow`, `CollapsedSidebarRail`, `SessionRailCard`, `EpicGroupHeader`.
- `KanbanView`, `KanbanSessionRow`, `sidebarViewMode` atom.
- All session-list hooks (~20 files): `useSidebarSectionedSessions`, `useConsolidationActions`, `useSidebarMergeOrchestration`, `useGitlabMrDialogController`, `useMergeModalListener`, `useVersionPromotionController`, `usePrDialogController`, `useSessionEditCallbacks`, `useRefineSpecFlow`, `useSidebarSelectionActions`, `useSidebarSelectionMemory`, `useSidebarCollapsePersistence`, `useSidebarKeyboardShortcuts`, `useSidebarBackendEvents`, `useSessionScrollIntoView`, `useConvertToSpecController`.
- All legacy helpers: `versionGroupings`, `sectionCollapse`, `selectionMemory`, `consolidationGroupDetail`, `buildSessionCardActions`, `buildSidebarModalSlots`, `modalState`, `routeMergeConflictPrompt`.
- `SidebarModalsTrailer` (most modals it carried were session-shaped retires).

Drive-by Rules-of-Hooks fix: `RightPanelTabs.tsx`'s D.3.b early-return for `taskIdForPane` was BEFORE all hooks; ESLint cache had hidden the violation. Moved after every unconditional hook.

### W.2 — legacy session creation flows collapsed (commit `ca9a8f25`)

`NewSessionModal` + `favoriteOptions` + `buildCreatePayload` + `consolidationPrefill` + `NewSessionAdvancedPanel` deleted. `App.tsx` loses `handleCreateSession` (228 lines) + the consolidate/terminate-version-group + `StartAgentFromSpec` listeners. Spec/new-session shortcuts collapse into a single `KeyboardShortcutAction.NewTask` shortcut and `uiEvents` drops `NewSessionRequest` / `NewSpecRequest` / `GlobalNewSessionShortcut` in favor of `NewTaskRequest`.

`agentDisplayName` extracted from `favoriteOptions` as a leaf utility so forge + style-guide previews keep their agent labels without the dead favorites code.

`App.test.tsx` retired wholesale — the suite covered the retired `handleCreateSession` path. Replacement coverage will land with `NewTaskModal` test extensions in a later wave.

### W.3 — capture-as-task surface deleted (commit `fef562fa`)

Tasks are the only top-level entity in the v2 model — there is no "capture a session as a task" path. Deleted:

- Frontend: `SidebarStageSectionsView`'s bulk-capture button + `isStandaloneCaptureCandidate` filter, `SessionCard`'s "Capture as Task" right-click menuitem, optional `onCaptureAsTask` on `SessionCardActions`, `captureSessionAsTask` / `captureVersionGroupAsTask` service functions, `LucodeTaskCaptureSession` / `LucodeTaskCaptureVersionGroup` Tauri command enum entries.
- Backend: `lucode_task_capture_session` and `lucode_task_capture_version_group` Tauri commands + their helper pyramid (`draft_task_from_session`, `find_task_for_session`, `sync_task_metadata_from_session`, `preserved_content_for_session`).

Tests for the affected surfaces were rewritten (not deleted) to assert the absence of the retired affordance, which is the contract that prevents the dual-mount style regression.

### W.4 — v1→v2 spec-to-task migration deleted (commit `57db1321`)

Per the user's call: "do not migrate them, screw it." There is no v1 data on disk worth migrating into the v2 task aggregate. Deleted `infrastructure/database/migrations/v1_to_v2_specs_to_tasks.rs` (the migration + its 7 tests + the `sessions_v1_specs_to_tasks_archive` forensics table it created), removed the call site in `apply_tasks_migrations()`, and dropped the module declaration.

The other v1→v2 migrations (`run_role`, `session_status`, `task_runs`, `task_cancelled`) stay — they are schema-rebuild migrations needed for the v2 schema itself, not data migrations.

### W.5 — 10 gap items wired (commits `77c40ddf`, `b8c7d181`, `30e3553a`, `3f1057c9`, `60cc0668`, `a98e82c7`)

| # | Gap | Outcome |
|---|-----|---------|
| 1 | Orchestrator placement pin | `Sidebar.test.tsx` pins DOM order: orchestrator entry → search bar → stage sections, plus "exactly one" assertions. `OrchestratorEntry` gained `data-testid="orchestrator-entry"`. |
| 2 | Right-pane dispatch test coverage | `RightPanelTabs.test.tsx` covers task / task-run / task-slot selection dispatch to `TaskRightPane`, plus session-shape fallthrough. |
| 3 | Terminal binding for empty agent slot | `TerminalGrid` short-circuits `kind: 'task'` and `kind: 'task-run'` selections to a placeholder div with `data-testid="task-empty-agent-placeholder"`. `kind: 'task-slot'` falls through to session-shape branches. Bottom-pane base-worktree shell binding deferred (the wire `Task` type carries `task_branch` but not the worktree path). |
| 4 | v1 DB ignore | The v2 sidebar reads `tasksAtom` exclusively, so v1-only sessions never reach the surface — pinned with explicit `Sidebar.test.tsx` case seeding `allSessionsAtom` with v1-only sessions and asserting they don't render. The intended backend wire-level filter at `list_enriched_sessions_base` was reverted because it broke 17 unrelated tests; the structural pin is sufficient since no v2 component consumes raw session lists. |
| 5 | NewTaskModal field audit | Added optional epic picker (`Dropdown` over `epicsAtom`, defaults to "No epic"). Form is now: name (req'd), display name, base branch, epic, request body. |
| 6 | Stage transition auto-promote | Verified — `confirm_stage` already auto-advances atomically (`orchestration.rs:477-483`). Existing test `confirm_stage_merges_winning_branch_and_advances_task_stage` pins it. |
| 7 | Forge issue badge with null guard | `TaskRow` renders an issue badge when `task.issue_number` is non-null. With `issue_url`: anchor that opens forge in new tab. Without: plain span fallback. Pinned by 4 tests covering null absence, both-present anchor, url-null span. |
| 8 | Done section collapsed by default | `useSidebarStageSections` `DEFAULT_COLLAPSE.done` flipped to `true` (joining `cancelled`). Test pin extended to all 8 sections. |
| 9 | Cancel cascade UX | `TaskRow.handleCancelClick` opens a `ConfirmModal` showing the active-run count before firing the cascade. On `TaskCancelFailed` typed error, sticky toast surfaces with a "Retry cancel" action. 6 tests pin the flow. |
| 10 | Confirm-stage trigger + Retry merge toast | New `useConfirmStage()` hook wraps the Tauri call: looks up the winning slot's branch from `allSessionsAtom`, dispatches confirm, surfaces a sticky "Retry merge" toast on `MergeConflict` / `StageAdvanceFailedAfterMerge` typed errors. Wired through `TaskRunRow` → `TaskRunSlots.onConfirmWinner`. 5 tests. |

### W.6 — three arch pins + the type bugs they uncovered (commit `3ce26c39`)

`arch_no_v1_session_leakage.test.ts` greps the production frontend tree for references to symbols retired in W.1–W.4. Comments are stripped before scanning; tests are allowed to reference the symbols to pin their absence.

Adding the pin uncovered a fresh class of regressions: tsc's incremental `.tsbuildinfo` cache had been hiding broken types behind a stale "All checks passed" green light. Clearing the cache surfaces 21 type errors. All fixed in this commit:

- **Retired-enum leaks** (the arch pin caught these): `Terminal.tsx` and `useSpecMode.ts` still emitted `UiEvent.NewSpecRequest` / `.GlobalNewSessionShortcut`. Routed through `NewTaskRequest`.
- **Renamed enum**: `KeyboardShortcutAction.ToggleLeftPanel` → `ToggleLeftSidebar`.
- **Wrong prop**: `SwitchOrchestratorModal.onConfirm` → `onSwitch`.
- **App.tsx `<Sidebar>`**: dropped extra props the post-W.1 shell no longer accepts; removed the now-orphaned `switchProject` / `switchToProject` / `handleSwitchToProject` wrappers.
- **Missing tokens**: `theme.lineHeight.normal` → `.body`. `typography.bodyText` → dropped (textarea has explicit style props). Button variant `"secondary"` → `"default"`.
- **Inverted type assertion**: `task.test.ts` had `AssertExtends` generic param order backwards — checking `keyof TaskRun extends <small union>` (false by construction) instead of `<small union> extends keyof TaskRun`.
- **Selection union widening**: `Selection` gains optional `slotKey`. `SelectionChangedDetail.kind` widened to all 5 variants (was `'session' | 'orchestrator'`).
- **Boundary helper**: `selectionHelpers.ts` adds `isSessionSelection(s): s is { kind: 'orchestrator' | 'session' }` for code that hasn't been updated for task selections.
- **JSX namespace**: `useConfirmStage.test.tsx` `JSX.Element` → `ReactElement`.

The arch pin is the structural pin against this regression class. tsc strict + cleared cache is the load-bearing discriminator.

## Final test count

- **Rust:** 2438 tests (down from 2448 pre-Phase 8 — three capture-helper tests + seven specs-to-tasks tests deleted with their code).
- **Frontend (vitest):** ~3500+ across the suite.
- All green at W.6 boundary.

## Pending

- **W.7:** memory updates (this commit) + status doc (this file).
- **W.8:** push branch, tag `pre-smoke-walk-3`, smoke checklist updates. User-driven smoke walk gate before merge.

## Phase 8 contracts pinned (load-bearing)

- **No retired session-shape symbols in production source.** Enforced by `arch_no_v1_session_leakage.test.ts`. New retirements add a row; new code can't accidentally re-import a retired type.
- **Sidebar slot order is fixed**: orchestrator → search → stage sections. Pinned by `Sidebar.test.tsx`.
- **v2 sidebar is task-driven, not session-driven**: it reads `tasksAtom` exclusively. v1-only sessions on `allSessionsAtom` are invisible. Pinned.
- **Cancel cascade UX**: confirmation modal before firing, "Retry cancel" toast on partial failure.
- **Confirm-stage trigger exists**: `useConfirmStage` wires `TaskRunSlots.onConfirmWinner` to the backend, with a "Retry merge" toast for typed merge-failure errors.
- **TerminalGrid placeholders for task headers**: `data-testid="task-empty-agent-placeholder"` for `kind: 'task' | 'task-run'`. Slot selections fall through to session-shape branches.
- **TypeScript validation requires a clear cache**: tsc's incremental cache has been observed to hide errors. Run `rm -f node_modules/.cache/tsconfig.tsbuildinfo && bun run lint:ts` before any validation pass that needs to be load-bearing.

## What does not change

The Phase 7 backbone (TaskRow → TaskRunRow → TaskRunSlots → SessionCard-as-slot-child) is intact. Phase 8 deleted the parallel session-shaped mount that was rendering alongside it; the structural backbone was correct. No Phase 7 contracts were rolled back.

The Phase 1–6 backend contracts (no `task_runs.status`, derived run status, no global `RwLock<SchaltwerkCore>`, no `RunRole`, `TaskFlowError` at the command surface, etc.) are unchanged.
