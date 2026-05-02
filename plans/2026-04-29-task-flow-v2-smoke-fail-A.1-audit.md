# Smoke-fail-A.1 — v1 leakage audit (Wave A)

**Status:** awaiting user sign-off on retire/rebind decisions
**Tag:** [`smoke-fail-A.1`](https://github.com/lucacri/schaltwerk/releases/tag/smoke-fail-A.1) at `5cda1bed`
**Trigger:** §A.1 of the Phase 7 smoke checklist failed — `+ New Task` produced a row in a "Spec" section instead of a "Draft" section. Diagnosis surfaced two real bugs (3A keyboard shortcut routes to legacy spec creation; 3B legacy session list does not filter task-bound sessions) and a question: is there more v1 leakage the existing pins didn't catch?

This audit answers that question by inventorying every v1 task/spec/session-creation pathway still wired in the frontend, in the five categories the user specified.

## How to read

- **retire**: delete; v2 has no equivalent (or the equivalent is the task surface, which already exists).
- **rebind**: keep the surface but route through the task aggregate.
- **keep**: legitimate v2 use case — rationale in the entry.
- **keep+rename**: legitimate but currently misleadingly named.

Where Cat 2's agent and Cat 1's agent disagreed about the keyboard shortcut at `App.tsx:1594`, I sided with the actual code path: `setOpenAsSpec(true) + setNewSessionOpen(true)` causes `handleCreateSession` to call `invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, ...)` at `App.tsx:1958`, which is the v1 path. Cat 2's "keep" rationale ("modal delegates to task creation") was based on a false premise.

## User-stated retire preferences (binding)

> "my preference is ⇧⌘N AND ⌘N both → NewTaskModal, retire KeyboardShortcutAction::NewSpec entirely. If there's a legitimate non-task 'open ad-hoc session' use case in v2, surface it in the audit's keep rows with reasoning; otherwise collapse both shortcuts onto the task path."

Audit answer to the "ad-hoc session" question: **No legitimate generic ad-hoc session creation exists in v2.** The orchestrator is a special-case session with its own start affordance on `OrchestratorEntry` (Phase 7 plan §6 #4). Captured sessions go through `lucode_task_capture_session`. Migrated specs go through `v1_to_v2_specs_to_tasks`. There is no v2 use case for a user-initiated raw `lucode_core_create_session` call. Both shortcuts retire to NewTaskModal.

---

## Category 1 — Keyboard shortcut enum members for v1 concepts

| Surface | File:line | What it does | Decision | Rationale |
|---|---|---|---|---|
| `KeyboardShortcutAction.NewSession` enum member | `src/keyboardShortcuts/config.ts:27` | Default binding `Mod+N`. Handler at `App.tsx:1571–1580` calls `setOpenAsSpec(false) + setNewSessionOpen(true)` → opens NewSessionModal in agent mode → `SchaltwerkCoreCreateSession`. | **rebind** | Per user preference, ⌘N → NewTaskModal. Rebind handler to `setNewTaskOpen(true)`. Keep enum member (the action itself stays — it's just creating a task now). Optionally rename to `NewTask` for clarity (see §6). |
| `KeyboardShortcutAction.NewSpec` enum member | `src/keyboardShortcuts/config.ts:28` | Default binding `Mod+Shift+N`. Handler at `App.tsx:1583–1593` calls `setOpenAsSpec(true) + setNewSessionOpen(true)` → opens NewSessionModal in spec mode → `SchaltwerkCoreCreateSpecSession`. **This is bug 3A.** | **retire** | v2 has no separate "spec" — drafts ARE tasks. Per user preference, ⇧⌘N also routes to NewTaskModal; retire the enum member entirely so the action can't be rebound by accident later. Both shortcut bindings (Mod+N + Mod+Shift+N) collapse onto a single `NewTask` action. |
| `KeyboardShortcutAction.NewSession` metadata | `src/keyboardShortcuts/metadata.ts:70` (label "Create new session") | Settings-screen label | **keep+rename** | Rename label to "Create new task" to match v2 vocabulary. |
| `KeyboardShortcutAction.NewSpec` metadata | `src/keyboardShortcuts/metadata.ts:71` (label "Create new spec") | Settings-screen label | **retire** | Goes with the enum member. |
| Terminal keybinding `TerminalCommand.NewSpec` | `src/components/terminal/terminalKeybindings.ts:10, 22, 38` | Terminal-scope keybinding for `Mod+Shift+N` → emits `UiEvent.NewSpecRequest` from inside terminal focus | **retire** | Mirrors the global `NewSpec` retirement. The terminal must also collapse both Mod+N and Mod+Shift+N onto a single new-task emission. |
| Terminal keybinding emit `UiEvent.NewSpecRequest` | `src/components/terminal/Terminal.tsx:1659` | Emits the v1 spec-create UI event from terminal | **retire** | Goes with the event retirement (Cat 3 below). |
| Terminal keybinding emit `UiEvent.GlobalNewSessionShortcut` | `src/components/terminal/Terminal.tsx:1663-1665` | Emits the v1 agent-session-create UI event | **rebind** | Rename the event to `UiEvent.NewTaskRequest` (or similar) and route the listener to `setNewTaskOpen(true)`. |
| Tests for `TerminalCommand.NewSpec` | `src/components/terminal/terminalKeybindings.test.ts:18-27, 142` | Test asserts `Mod+Shift+N` matches the v1 enum value + skips shell | **retire** | Goes with the enum retirement. Replace with a single `NewTask` test that asserts both Mod+N and Mod+Shift+N route there. |

**Summary Cat 1:** retire `NewSpec` everywhere (enum + metadata + terminal + tests). Rebind `NewSession` to `setNewTaskOpen(true)` and rename to `NewTask`. The two existing keybindings (Mod+N, Mod+Shift+N) collapse onto the single `NewTask` action.

---

## Category 2 — Frontend `SchaltwerkCoreCreate*Session*` / `*Spec*` invocations

| Site | File:line | Trigger | Decision | Rationale |
|---|---|---|---|---|
| `invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, …)` | `src/App.tsx:1958` | NewSessionModal submit when `data.isSpec === true` | **retire** | This IS the v1 spec-creation path. NewSessionModal's spec branch should be deleted; `+ New Task` modal already covers v2 task creation. |
| `invoke(TauriCommands.SchaltwerkCoreCreateSession, …)` | `src/App.tsx:2026` | NewSessionModal submit when `data.isSpec === false` (agent mode, optionally multi-version) | **retire** | v1 raw agent-session creation. Multi-version flow that this used was for stage-run candidates; in v2, candidate sessions are provisioned by `lucode_task_start_stage_run`, not by user-driven session creation. No v2 use case for a user-initiated raw session create. |
| `invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, …)` | `src/hooks/contextualSpecClarify.ts:51` | Right-click on a forge issue → "Auto-clarify" contextual action; creates a v1 spec session prefilled with the issue prompt | **rebind** | The use case (turn an issue into a spec-shape draft) maps cleanly to `lucode_task_create` with the issue prompt as `request_body` (Draft stage by default). Rebind to `LucodeTaskCreate` + `lucode_task_start_clarify_run` if the clarify run should auto-spawn. |
| `setOpenAsSpec(true) + setNewSessionOpen(true)` from contextual handler | `src/App.tsx:2208` (handleContextualSpecCreate) | Right-click on a forge issue → "Create spec" contextual action; opens NewSessionModal in spec mode prefilled with issue context | **rebind** | The use case (create a draft from an issue) is task-create. Rebind to `setNewTaskOpen(true)` with the prefill data adapted to NewTaskModal's request-body shape. |
| `setOpenAsSpec(false) + setNewSessionOpen(true)` from contextual handler | `src/App.tsx:2166` (handleContextualSessionCreate) | Right-click on a forge issue → "Create session" contextual action (agent mode) | **rebind** | Same — create a task from the issue. The "agent type" specifier in the contextual detail can map to a stage-run preset on the resulting task, but at minimum the entry point should land on a Draft task, not a raw agent session. |
| `invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, …)` (atom action) | `src/store/atoms/sessions.ts:2459` (`createDraftActionAtom`) | Exported as part of `useSessions()` hook; never invoked anywhere in production code (verified by Cat 2 agent grep) | **retire** | Dead export. Retire the action atom and remove from `useSessions()` return. |
| Test mocks for `SchaltwerkCoreCreateSession` | `src/App.test.tsx:257, 1152, 1203, 1271, 1344, 1403, 1498, 1596, 1614, 1675, 1800, 1885, 1926, 1960, 2038`; `src/utils/sessionVersions.test.ts:640` | Mock setups in tests that pinned the v1 path | **retire** | Update tests to mock `LucodeTaskCreate` instead. The tests that asserted the v1 command was called become regression guards in reverse: a passing test on the v1 mock means production is still routing through v1. |
| Test mocks for `SchaltwerkCoreCreateSpecSession` | `src/App.test.tsx:2085, 2106`; `src/hooks/contextualSpecClarify.test.ts:36, 133`; `src/store/atoms/sessions.test.ts:1136` | Mock setups in tests | **retire** | Same reasoning. |
| `invoke(TauriCommands.SchaltwerkCoreCreateEpic, …)` | epic-creation paths | Epic management | **keep** | Epics are orthogonal to tasks. v2 keeps epics as a grouping axis for tasks. Cat 2 agent's report flagged this; not in scope for this audit, no change needed. |
| `ConvertToSpecConfirmation` modal | `src/components/modals/ConvertToSpecConfirmation.tsx:35` (calls `invoke(TauriCommands.SchaltwerkCoreUpdateSessionStatus, { name, status: 'spec' })` via `convertSessionToSpecActionAtom`) | Right-click "Convert to spec" on a running session — demotes it back to spec state | **retire** | v2 has no spec state — tasks at Draft stage are the spec-equivalent. Demoting a running session to draft is a task-lifecycle operation (cancel + reopen at Draft). The convert-to-spec flow is v1-only. |
| `optimisticallyConvertSessionToSpecActionAtom` | `src/store/atoms/sessions.ts:2502-2541` | Optimistic-flip helper for convert-to-spec | **retire** | Goes with the modal retirement. |
| `updateSessionStatusActionAtom` setting `status: 'spec'` | `src/store/atoms/sessions.ts:2425` | Backend write for the convert-to-spec flow | **retire** | Goes with the modal retirement. |

**Summary Cat 2:** retire all `SchaltwerkCoreCreateSpecSession` / `SchaltwerkCoreCreateSession` user-driven invocations. Two contextual-action paths (forge issue → create spec/session) rebind to `LucodeTaskCreate` because the use case maps cleanly. ConvertToSpecConfirmation retires entirely. Epic creation is out of scope.

---

## Category 3 — `setOpenAsSpec` / `setNewSessionOpen` / `openAsSpec` / spec-modal flags

| Site | File:line | What it does | Decision | Rationale |
|---|---|---|---|---|
| State declaration `[openAsDraft, setOpenAsSpec] = useState(false)` | `src/App.tsx:544` | Backing state for "open NewSessionModal in spec mode" | **retire** | After NewSpec retirement, spec mode is unreachable. Delete the useState. |
| State declaration `[newSessionOpen, setNewSessionOpen] = useState(false)` | `src/App.tsx:514` | Modal-visibility state for the legacy NewSessionModal | **retire** | NewSessionModal itself retires. Replaced by `newTaskOpen` (already exists at `App.tsx:525`). |
| `setOpenAsSpec(false)` in NewSession shortcut handler | `src/App.tsx:1578` | Guards the agent-mode flag before opening | **retire** | Goes with the state-declaration retirement. |
| `setOpenAsSpec(true)` in NewSpec shortcut handler | `src/App.tsx:1590` | Sets spec mode | **retire** | The handler itself retires. |
| `setOpenAsSpec(false)` in global new-session listener | `src/App.tsx:1635` | Guards agent mode in the `UiEvent.GlobalNewSessionShortcut` handler | **retire** | Goes with the listener retirement once `UiEvent.GlobalNewSessionShortcut` rebinds to NewTask. |
| `UiEvent.NewSpecRequest` listener | `src/App.tsx:1668-1678` | Listens for terminal-emitted spec-create event; calls `setOpenAsSpec(true) + setNewSessionOpen(true)` | **retire** | Goes with the `UiEvent.NewSpecRequest` event retirement. |
| `UiEvent.NewSessionRequest` listener | `src/App.tsx:1752-1762` | Listens for the agent-session create event; calls `setOpenAsSpec(false) + setNewSessionOpen(true)` | **rebind** | Listener rebinds to `setNewTaskOpen(true)`. Event renames to `UiEvent.NewTaskRequest`. |
| `setOpenAsSpec(false)` in handleContextualSessionCreate | `src/App.tsx:2155` | Guards agent mode for forge contextual create | **retire** | Goes with the contextual handler rebind. |
| `setOpenAsSpec(true)` in handleContextualSpecCreate | `src/App.tsx:2197` | Sets spec mode for forge contextual create | **retire** | Same. |
| `setOpenAsSpec(true)` in legacy "Create Spec" home button | `src/App.tsx:2595` | (already removed in `96d887cd` but verify by grep) | **verify-retire** | Cat 1 agent reported the line still exists; double-check whether it's a stale string in a test or actual production code. If production, retire. If test, retire the test. |
| `setOpenAsSpec(false)` in `closeNewSessionModal` | `src/App.tsx:1894` | Cleanup of the spec-mode flag | **retire** | Goes with state-declaration retirement. |
| `initialIsDraft={openAsDraft}` prop on NewSessionModal | `src/App.tsx:2674` | Modal prop | **retire** | NewSessionModal retires. |
| Onboarding step copy "Click **Create Spec**" | `src/components/onboarding/steps.tsx:82` | User-facing onboarding text | **retire** | Update copy to reference `+ New Task`. |
| Onboarding highlight `[data-onboarding="create-spec-button"]` | `src/components/onboarding/steps.tsx:88` | DOM selector for the highlighted button | **retire** | Goes with the home button retirement. The home `+ New Task` button has `data-onboarding="new-task-button"`; rebind the highlight to that selector. |
| `useSpecMode` hook | `src/hooks/useSpecMode.ts:311` (emits `UiEvent.NewSpecRequest`) | Toggle between spec list and "new spec" mode | **retire-or-audit** | Likely retires entirely — v2 doesn't have a spec list mode. If the hook has other uses (open existing specs), audit those individually. The `emitUiEvent(UiEvent.NewSpecRequest)` call retires. |
| `App.test.tsx:844-846` test asserting `initialIsDraft` prop | test file | Pinned the v1 modal prop | **retire** | Modal retires. |
| `UiEvent.NewSpecRequest` enum member | `src/common/uiEvents.ts:24` | UI event for "open new-session modal in spec mode" | **retire** | Goes with the listener retirement. |
| `UiEvent.NewSpecRequest` event-map entry | `src/common/uiEvents.ts:305` | TypeScript event-map registration | **retire** | Same. |
| `UiEvent.GlobalNewSessionShortcut` | `src/common/uiEvents.ts` (location TBD) | Terminal-emitted event for global new-session shortcut | **rebind** | Rename to `UiEvent.NewTaskRequest`. The terminal-side emit and App-side listener both follow. |

**Summary Cat 3:** retire the entire spec-mode flag complex. NewSessionModal itself retires (Cat 2). The `newSessionOpen` state, `openAsSpec/openAsDraft` flags, `initialIsDraft` prop, `UiEvent.NewSpecRequest`, and onboarding copy all collapse. The agent-session shortcut path (`UiEvent.NewSessionRequest` / `GlobalNewSessionShortcut`) rebinds to NewTask.

---

## Category 4 — Legacy `SidebarSessionList` rendering paths

Cat 4's agent answered the critical question: **"Is there a legitimate non-task session surface in v2?"** with a precise yes-but-narrow answer:

> "The only legitimate non-task session surface in v2 is the **'cutover-day standalone running sessions'** — non-task-bound, live sessions awaiting capture. These render via `isStandaloneCaptureCandidate` in `SidebarStageSectionsView` (NOT via `SidebarSessionList`). Once captured, they move to task slots and disappear from this transient surface. Orchestrator is separate (its own `OrchestratorEntry`)."

That means the entire `SidebarSessionList` path is **retire**.

| Surface | File:line | Decision | Rationale |
|---|---|---|---|
| `<SidebarSessionList>` mount | `src/components/sidebar/Sidebar.tsx:431` | **retire** | The sole legitimate v2 surface for non-task sessions (standalone capture candidates) lives in `SidebarStageSectionsView` already. The legacy list is duplicate render. |
| `SidebarSessionList` view | `src/components/sidebar/views/SidebarSessionList.tsx` (entire file) | **retire** | All three render paths (`renderEmpty`, `renderCollapsedRail`, `renderListBody`, `renderKanban`) are legacy session-shaped. |
| `SidebarSectionView` (specs/running headers) | `src/components/sidebar/views/SidebarSectionView.tsx` | **retire** | Section headers tied to v1 lifecycle taxonomy (specs/running). |
| `SidebarVersionGroupRow` wrapper | `src/components/sidebar/views/SidebarVersionGroupRow.tsx` | **retire** | Thin wrapper for `SessionVersionGroup`; goes with the parent. |
| `splitVersionGroupsBySection` helper | `src/components/sidebar/helpers/versionGroupings.ts:72-90` | **retire** | Splits by `aggregate.state === 'spec'`; legacy taxonomy. |
| `groupVersionGroupsByEpic` helper | `src/components/sidebar/helpers/versionGroupings.ts:49-70` | **rebind** | Epic grouping is legitimate but currently consumed only by `SidebarSectionView`. If task surface adds epic grouping later, this helper rebinds; for now, retire its current call sites. |
| `useSidebarSectionedSessions` hook | `src/components/sidebar/hooks/useSidebarSectionedSessions.ts` | **retire** | Only consumed by `SidebarSessionList`. |
| `SessionVersionGroup` | `src/components/sidebar/SessionVersionGroup.tsx` | **retire** | The multi-version + consolidation rendering happens at the task-run-slot level now (`TaskRunSlots`); the standalone version-group surface for sessions has no v2 render path. ⚠️ Cross-check that `TaskRunSlots` covers all the affordances `SessionVersionGroup` provided. |
| `CompactVersionRow` | `src/components/sidebar/CompactVersionRow.tsx` | **retire** | Alternate rendering of the legacy version-group view. |
| `SessionCard` | `src/components/sidebar/SessionCard.tsx` | **keep** with caveats | The `SessionCard` is reused by the standalone-capture-candidate path. Keep the component, but audit its action menu — the right-click affordances meant to operate on v1 sessions need rebinding to task lifecycle. |
| `CollapsedSidebarRail` | `src/components/sidebar/CollapsedSidebarRail.tsx` | **retire-or-rebuild** | Collapsed-state rendering for the legacy list. v2 needs a collapsed-rail rendering for **tasks** (stage badges, attention dots) — that's a different component. Cat 3 agent recommended retire; if a v2 task-rail is needed for the smoke walk, build a small replacement. |
| `useSidebarSelectionMemory` | `src/components/sidebar/hooks/useSidebarSelectionMemory.ts` | **rebind** | Selection memory persistence is legitimate but currently keyed off `kind: 'session'`. With the Wave B.4 discriminated union, this needs to remember task / task-run / task-slot selections too. |
| `SessionCard` right-click "Capture as Task" | `src/components/sidebar/SessionCard.tsx:312-322` | **keep** | This is the per-session affordance for cutover-day standalone candidates. Matches `isStandaloneCaptureCandidate`. Stays. |
| `isStandaloneCaptureCandidate` filter | `src/components/sidebar/views/SidebarStageSectionsView.tsx:23-31` | **keep** | The legitimate v2 non-task session surface, as the user asked. Bounded to cutover-day stragglers. |

**Summary Cat 4:** retire `SidebarSessionList` and all its supporting structure. Keep `SessionCard` (used by standalone-capture path), `isStandaloneCaptureCandidate` (the legitimate surface), and `OrchestratorEntry` (separate, unchanged). `CollapsedSidebarRail` either retires or gets a task-aware replacement.

---

## Category 5 — KanbanView leakage post §A.11 disable

Cat 5's agent recommended **retire entirely** with a clear cost-benefit analysis. I agree.

| Surface | File:line | Decision | Rationale |
|---|---|---|---|
| `KanbanView` component | `src/components/sidebar/KanbanView.tsx` (155 lines) | **retire** | Renders sessions, not tasks. v2.1 task-aware kanban is a fresh build regardless of whether this stays. Delete. |
| `KanbanSessionRow` | `src/components/sidebar/KanbanSessionRow.tsx` (49 lines) | **retire** | Bound to KanbanView; no independent value. |
| `sidebarViewModeAtom` atom | `src/store/atoms/sidebarViewMode.ts` (13 lines) | **retire** | Will always resolve to `'list'` in v2; the persisted toggle is dead infra. Replace any reads with the literal `'list'` and delete the atom. |
| Dead imports in `SidebarSessionList.tsx:5-6, 101-112, 187-190` | various | **retire** | Goes with the SidebarSessionList retirement (Cat 4); kanban-specific dead code in this file dies with it. |
| `sidebarViewMode.test.ts` | `src/store/atoms/sidebarViewMode.test.ts` (40 lines) | **retire** | Toggle behavior never exercised in v2. |
| `KanbanView.test.tsx` | `src/components/sidebar/KanbanView.test.tsx` (191 lines) | **retire** | Tests dead renderer. |
| `SidebarHeaderBar` disabled toggle | `src/components/sidebar/views/SidebarHeaderBar.tsx:34-44` | **rebuild as static** | Replace the `sidebarViewMode`-driven button with a static disabled affordance: `<button disabled title="Kanban view returns in v2.1">List · Board v2.1</button>`. No atom dep, same UX. The "force-list-mode if stale" safeguard logic dies with the atom. |
| `SidebarHeaderBar.test.tsx` board→list migration test | `src/components/sidebar/views/SidebarHeaderBar.test.tsx:23-35` | **retire** | The migration is unnecessary once the atom is gone. The remaining tests (disabled state, tooltip, collapsed-hide) stay. |

**Summary Cat 5:** retire all kanban code (~509 lines including tests). Replace the `sidebarViewMode`-driven toggle in `SidebarHeaderBar` with a static disabled affordance that documents the v2.1 promise. Atom retires.

---

## Cross-cutting follow-ups (not yet pinned)

These don't fit cleanly in any single category but came up in the audit and need attention:

1. **`UiEvent.NewSessionPrefill` / `UiEvent.NewSessionPrefillPending`** — used by contextual create flows (`App.tsx:2206, 2212`) to prefill NewSessionModal. After NewSessionModal retires, these events either rebind to NewTaskModal or retire. Quick check: how does NewTaskModal handle prefill? Currently it just resets state on open (`NewTaskModal.tsx:54-60`). Needs a prefill-accept path if the contextual flows are to keep working.
2. **`useSpecMode` hook (`src/hooks/useSpecMode.ts`)** — Cat 1 agent flagged the `emitUiEvent(UiEvent.NewSpecRequest)` call. If the hook has other consumers (spec list view, etc.), audit those too — there might be a "switch to spec view" surface that's also v1.
3. **Settings screen contextual actions** — `src/components/settings/ContextualActionsSettings.tsx:277-278` registers `'spec'` and `'spec-clarify'` contextual action types. After spec retirement, these become `'task'` and `'task-clarify'` (or just `'task'` with optional clarify-on-create flag). User-facing labels need rewording.
4. **i18n strings** — `src/locales/en.json:746-753` defines `sections.specs`, `sections.running`, etc. After SidebarSessionList retires, these become unused. Knip will flag them. Retire when the SidebarSessionList code drops.
5. **Frontend leak-detection arch test** (Wave C of the user's plan) — the user asked for a grep-based arch test mirroring `arch_*` Rust patterns. Targets: `'spec'`, `setOpenAsSpec`, `openAsSpec` as case-sensitive identifiers. Allowlist: this audit's keep rows (which is a small set). I'll write this as part of Wave C.

---

## Decision summary by count

| Category | retire | rebind | keep | keep+rename | other |
|---|---|---|---|---|---|
| 1. Keyboard shortcuts | 4 | 2 | 0 | 1 | — |
| 2. SchaltwerkCore*Create* invocations | 6 + tests | 3 | 1 (Epic) | 0 | — |
| 3. setOpenAsSpec / openAsSpec / modal flags | 14 | 2 | 0 | 0 | 1 verify |
| 4. Legacy SidebarSessionList | 9 | 1 | 3 | 0 | 1 retire-or-rebuild |
| 5. Kanban | 5 | 0 | 1 | 0 | 1 rebuild-as-static |

**Total findings:** ~50 leakage points. **~85% retire**, ~10% rebind, ~5% keep with explicit rationale.

---

## Verification questions for the user before patch wave

1. **Confirm both shortcuts collapse onto NewTask.** ⌘N (currently bound to NewSession action) and ⇧⌘N (currently bound to NewSpec action) both → NewTaskModal. Two bindings, one action `KeyboardShortcutAction.NewTask`. The `NewSpec` enum member retires; the `NewSession` member renames to `NewTask`. ✅ matches user-stated preference.

2. **Confirm contextual create paths rebind, not retire.** `handleContextualSpecCreate` and `handleContextualSessionCreate` rebind to `setNewTaskOpen(true)` with prefill flowing into NewTaskModal. The "create from forge issue" use case stays; it just creates a Task instead of a v1 spec/session.

3. **Confirm ConvertToSpecConfirmation retires entirely.** No v2 use case for "demote running session to spec" — users who want to demote a running task use cancel+reopen at Draft.

4. **Confirm CollapsedSidebarRail decision.** Cat 3 agent suggested retire. If the smoke walk needs the collapsed-rail rendering to work on tasks, that's a fresh component (not in scope for this audit). Confirm: **retire CollapsedSidebarRail in this patch wave; rebuild the task-collapsed-rail in a separate sub-wave** — or rebuild now if it gates §A.

5. **Confirm `SessionCard` keep status.** The component stays because `isStandaloneCaptureCandidate` renders standalone sessions through it. But its right-click menu has many v1-shape actions (`onConvertToSpec`, `onRunDraft`, `onRefineSpec`, `onDeleteSpec`, `onImprovePlanSpec`). For a standalone capture candidate, only `onCaptureAsTask` and the basic actions (copy name/branch, cancel) are sensible. The other actions need to be hidden when the session is not task-bound (or removed entirely if all relevant work happens via tasks). Confirm: **keep SessionCard; audit and prune its action menu in Wave B**.

6. **Naming.** Once `NewSpec` retires and `NewSession` rebinds, rename to `NewTask` in (a) the enum, (b) the metadata label, (c) the UiEvent, (d) the keyboard-shortcuts settings UI. ✅ blanket rename.

After sign-off, Wave B (patch) lands all retires + rebinds. Wave C (pins) ships the four mandatory pins. Wave D (smoke restart) revises §A.1 + §A.10 and tags `pre-smoke-walk-2`.
