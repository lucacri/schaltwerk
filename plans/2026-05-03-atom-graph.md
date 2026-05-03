# Atom Dependency Graph (Tier 1.5 audit)

Doc-only inventory of every Jotai atom defined in `src/store/atoms/`,
with consumer counts, derivation chains, and findings against the
Phase 7/8 task-flow v2 contract.

**Scope:** exported atoms in `src/store/atoms/*.ts` (excluding `*.test.ts`).
File-private atoms are summarised, not enumerated.

**Methodology:**
- Roster gathered with `rg '^export const \w+|^const \w+\s*=\s*atom' src/store/atoms/*.ts`.
- Consumers per atom found via `rg -l --type ts -F "<name>" src/ src-tauri/`.
  Each match is bucketed: defining-file (skipped), `*.test.ts(x)` (test),
  everything else (prod). The full matrix is at
  `/tmp/atom_consumers.txt` (regenerable; see "Methodology footnotes").
- "Action atom" = `atom(null, (get, set, ...) => ...)`. "Derived" =
  `atom((get) => ...)`. "Storage" = `atom(initial)`. "Persisted" =
  `atomWithStorage(...)`. "Family" = `atomFamily(...)`.
- Module-scope `let`/`Map`/`Set` bindings (e.g. `selection.ts:83 let
  currentFilterMode`) are not Jotai atoms; they're noted in §6 as
  context-around-atoms, not as atoms themselves.

---

## 1. Inventory by module

(Exported atoms only; file-private storage atoms shown only when they
are derivation backers for an exported atom.)

### `actionButtons.ts`
- `actionButtonsListAtom` — derived from private `actionButtonsMapAtom`;
  exposes `HeaderActionConfig[]`.
- `actionButtonsLoadingAtom` — storage `atom(false)`.
- `actionButtonsErrorAtom` — storage `atom<string | null>(null)`.
- `registerActionButtonAtom` — action; mutates the map.
- `unregisterActionButtonAtom` — action.
- `updateActionButtonColorAtom` — action.
- `loadActionButtonsAtom` — async action; project-scoped via private
  `lastLoadedProjectPathAtom`.
- `saveActionButtonsAtom` — async action.
- `resetActionButtonsAtom` — action.

### `agentPresets.ts`
Five atoms re-exported from `createSettingsListAtoms({...})`:
`agentPresetsListAtom`, `agentPresetsLoadingAtom`,
`agentPresetsErrorAtom`, `loadAgentPresetsAtom`, `saveAgentPresetsAtom`.

### `agentTabs.ts`
- `agentTabsStateAtom` — storage `Map<string, AgentTabsState>`.
- `DEFAULT_AGENT_TAB_LABEL`, `MAX_AGENT_TABS`, `getAgentTabTerminalId`
  — non-atom constants/helpers re-exported from this module.

### `agentVariants.ts`
Same shape as `agentPresets.ts` (re-exports from
`createSettingsListAtoms`): list/loading/error/load/save.

### `clarifierResume.ts`
- `clarifierResumedSpecsAtom` — storage `ReadonlySet<string>`.
- `markClarifierResumedAtom` — action.
- `clearClarifierResumedAtom` — action.

### `consolidationStats.ts`
- `consolidationStatsAtom` — storage `ConsolidationStats | null`.
- `consolidationStatsLoadingAtom` — `atom(false)`.
- `consolidationStatsErrorAtom` — `atom<string | null>(null)`.
- `consolidationStatsFiltersAtom` — storage `ConsolidationStatsFilters`.
- `loadConsolidationStatsAtom` — async action.

### `contextualActions.ts`
- `contextualActionsListAtom` — derived from `createSettingsListAtoms`'
  list, normalised.
- `contextualActionsLoadingAtom`, `contextualActionsErrorAtom`,
  `loadContextualActionsAtom` — re-exports from
  `createSettingsListAtoms`.
- `saveContextualActionsAtom` — async action.
- `resetContextualActionsAtom` — async action.

### `copyContextSelection.ts`
- `copyContextChangedFilesSelectionAtomFamily(storageKey)` — family
  using `atomWithStorage` keyed by composite key built by
  `buildCopyContextChangedFilesSelectionKey`. Persists to
  `layoutStorage`.
- `copyContextBundleSelectionAtomFamily(storageKey)` — same pattern,
  built by `buildCopyContextBundleSelectionKey`.

### `createSettingsListAtoms.ts`
Factory; not an atom. Returns `{ listAtom, loadingAtom, errorAtom,
loadAtom, saveAtom }` per `SettingsListAtomsConfig`. Used by
`agentPresets`, `agentVariants`, `contextualActions`.

### `diffCompareMode.ts`
- `diffCompareModeAtomFamily(sessionName)` — per-session storage atom.
- `hasRemoteTrackingBranchAtomFamily(sessionName)` — per-session
  storage atom.

### `diffPreferences.ts`
- `expandedFilesAtom` — `Set<string>`.
- `inlineSidebarDefaultPreferenceAtom` — derived read + write splice,
  reads private `inlineSidebarDefaultAtom`.
- `diffLayoutPreferenceAtom` — same shape, reads private
  `diffLayoutAtom`.
- `expandAllFilesActionAtom`, `collapseAllFilesActionAtom` — actions.
- `initializeInlineDiffPreferenceActionAtom` — async action; sets the
  private `initializedAtom` flag.

### `enabledAgents.ts`
- `enabledAgentsAtom` — derived `(get) => get(enabledAgentsStateAtom)`.
- `enabledAgentsLoadingAtom` — `atom(true)` (default-true).
- `enabledAgentsErrorAtom` — `atom<string | null>(null)`.
- `loadEnabledAgentsAtom`, `reloadEnabledAgentsAtom`,
  `saveEnabledAgentsAtom`, `setEnabledAgentsAtom` — actions; the first
  is once-only (`enabledAgentsInitializedAtom` guard), the second
  forces a refetch.

### `epics.ts`
- `epicsAtom` — derived list from private `epicsStateAtom`.
- `epicsLoadingAtom` — derived loading flag.
- `refreshEpicsActionAtom`, `ensureEpicsLoadedActionAtom`,
  `createEpicActionAtom`, `updateEpicActionAtom`,
  `deleteEpicActionAtom`, `setItemEpicActionAtom` — actions wiring
  Tauri commands and refresh flow.

### `favoriteOrder.ts`
- `favoriteOrderAtom` — derived `[...state]` over private
  `favoriteOrderStateAtom`.
- `favoriteOrderLoadingAtom`, `favoriteOrderErrorAtom`,
  `favoriteOrderLoadedAtom` — flags.
- `loadFavoriteOrderAtom`, `saveFavoriteOrderAtom` — async actions.

### `fontSize.ts`
- `terminalFontSizeAtom` — `[get,set]` shape; reads private
  `fontSizesAtom.terminal`, write triggers settings save.
- `uiFontSizeAtom` — same shape for `fontSizesAtom.ui`.
- `increaseFontSizesActionAtom`, `decreaseFontSizesActionAtom`,
  `resetFontSizesActionAtom`, `initializeFontSizesActionAtom` —
  actions.

### `forge.ts`
- `forgeBaseAtom` — storage `atom<ForgeType>('unknown')`.
- `forgeIssuesFilterModeAtom` — storage.
- `projectForgeAtom` — derived `get => get(forgeBaseAtom)`.
- `refreshForgeAtom` — async action; emits via `set(forgeBaseAtom)`.

### `gitHistory.ts`
- `gitHistoryEntriesAtom` — storage `Map<string, RepoHistoryEntry>`.
- `gitHistoryEntryAtomFamily(repoPath)` — derived per-repo entry.
- `gitHistoryFilterAtomFamily(repoPath)` — read+write per-repo filter
  derived from private `gitHistoryFiltersAtom`.
- `filteredGitHistoryAtomFamily(repoPath)` — derived from entry +
  filter.
- `ensureGitHistoryLoadedActionAtom`, `loadMoreGitHistoryActionAtom`,
  `refreshGitHistoryActionAtom` — actions.
- `useGitHistory(repoPath)` — exported hook (NOT an atom) that bundles
  the family reads + actions for the GitGraph panel.

### `gitlabSearch.ts`
- `gitlabMrSearchEntriesAtom` — `Map<string, GitlabSearchEntry<MR>>`.
- `gitlabIssueSearchEntriesAtom` — same for issues.
- `gitlabMrSearchEntryAtomFamily(cacheKey)` — derived per-key.
- `gitlabIssueSearchEntryAtomFamily(cacheKey)` — derived per-key.
- `searchGitlabMrsActionAtom`, `searchGitlabIssuesActionAtom` — async
  actions.

### `language.ts`
- `translationsAtom` — derived from private `languageAtom`.
- `currentLanguageAtom` — derived `get => get(languageAtom)`.
- `setLanguageActionAtom`, `initializeLanguageActionAtom` — actions.

### `lastAgentResponse.ts`
- `lastAgentResponseMapAtom` — derived `(get) => get(baseMapAtom)`.
- `updateLastAgentResponseActionAtom`,
  `cleanupStaleSessionsActionAtom` — actions.
- `agentResponseTickAtom` — counter `atom(0)` (manual subscriber
  notify channel for non-atom listeners).

### `layout.ts`
Nine `atomWithStorage` panel-size/collapsed flags persisted via
`layoutStorage` (`createJSONStorage(() => createPersistentStorage())`):
`leftPanelCollapsedAtom`, `leftPanelSizesAtom`,
`leftPanelLastExpandedSizesAtom`, `rightPanelCollapsedAtom`,
`rightPanelSizesAtom`, `rightPanelLastExpandedSizeAtom`,
`bottomTerminalCollapsedAtom`, `bottomTerminalSizesAtom`,
`bottomTerminalLastExpandedSizeAtom`. `layoutStorage` is exported and
reused by `copyContextSelection.ts` and `rightPanelTab.ts`.

### `powerSettings.ts`
- `keepAwakeStateAtom` — storage.
- `refreshKeepAwakeStateActionAtom`, `toggleKeepAwakeActionAtom`,
  `registerKeepAwakeEventListenerActionAtom` — actions.

### `preview.ts`
- `previewStateAtom(key)` — derived `[get,set]` shape over private
  `previewStatesAtom: Map<key, PreviewState>`.
- `setPreviewUrlActionAtom`, `navigatePreviewHistoryActionAtom`,
  `adjustPreviewZoomActionAtom`, `resetPreviewZoomActionAtom`,
  `clearPreviewStateActionAtom` — actions.
- `isElementPickerActiveAtom` — derived; read-only.
- `setElementPickerActiveActionAtom` — action.
- Constants (NOT atoms): `PREVIEW_MIN_ZOOM`, `PREVIEW_MAX_ZOOM`,
  `PREVIEW_ZOOM_STEP`, `buildPreviewKey`.

### `project.ts`
- `projectPathAtom` — `[get,set]` shape over private
  `baseProjectPathAtom`. Effectively the most-read atom in the
  application (28 prod consumers).
- `projectTabsAtom` — derived read of private
  `projectTabsInternalAtom`.
- `projectSwitchStatusAtom` — derived read of private
  `projectSwitchStateAtom`.
- `openProjectActionAtom`, `selectProjectActionAtom`,
  `closeProjectActionAtom`, `deactivateProjectActionAtom` — async
  actions; orchestrate `selection.ts` and `sessions.ts` via cross-atom
  `set(...)` calls.

### `rawAgentOrder.ts`
- `rawAgentOrderAtom` — derived `[...state]` over private
  `rawAgentOrderStateAtom`.
- `rawAgentOrderLoadingAtom`, `rawAgentOrderErrorAtom`,
  `rawAgentOrderLoadedAtom` — flags.
- `loadRawAgentOrderAtom`, `saveRawAgentOrderAtom` — async actions.

### `rightPanelTab.ts`
- `rightPanelTabAtom` — `atomWithStorage<TabKey>` persisted via
  `layoutStorage`.

### `selection.ts`
Module-private writable: `selectionAtom: atom<Selection>`. Module-private
mutable scope (NOT atoms; these escape Jotai's tracking — see §6):
`currentFilterMode`, `projectFilterModes`, `defaultFilterModeForProjects`,
`lastProcessedProjectPath`, `cachedProjectPath`, `cachedProjectId`,
`sessionSnapshotsCache`, `sessionFetchPromises`, `terminalsCache`,
`terminalToSelectionKey`, `terminalWorkingDirectory`,
`selectionsNeedingRecreate`, `lastKnownSessionState`,
`lastSelectionByProject`, `pendingAsyncEffect`, `intentionalSwitchInProgress`,
`eventCleanup`.

Exported atoms:
- `switchingProjectAtom` — derived read of private
  `switchingProjectStateAtom`.
- `selectionValueAtom` — **derived read surface for the selection.**
  Reads `selectionAtom` and `projectPathAtom`, falls back to
  `buildOrchestratorSelection(projectPath)` when state mismatches the
  active project.
- `isSpecAtom` — derived `selection.kind === 'session' && state ===
  'spec'`.
- `isReadyAtom` — derived; orchestrator/spec → true; processing → false;
  running → has worktree.
- `terminalsAtom` — derived `computeTerminals(selection, projectPath)`.
- `setSelectionFilterModeActionAtom`,
  `cleanupOrchestratorTerminalsActionAtom`,
  `getSessionSnapshotActionAtom`, `setSelectionActionAtom`,
  `clearTerminalTrackingActionAtom`, `setProjectPathActionAtom`,
  `initializeSelectionEventsActionAtom` — actions; the last one is
  the entry point that wires `SchaltEvent.SessionsRefreshed` etc. to
  the selection cache.

### `selectionHelpers.ts`
No atoms. Pure functions: `selectionToSessionId`, `selectionToTaskId`,
`selectionToRunId`, `isTaskKind`, `isSessionSelection`,
`matchSelection<R>`. Also exports `SelectionKind` /
`SelectionMatchers<R>` types. Critical for Phase 7/8 because every
narrowing on `Selection.kind` should go through these helpers.

### `sessions.ts`
Module-scope private state atoms: `filterModeStateAtom`,
`searchQueryStateAtom`, `isSearchVisibleStateAtom`,
`lastRefreshStateAtom`, `mergeDialogStateAtom`,
`mergeStatusesStateAtom`, `mergeInFlightStateAtom`,
`sessionMutationsStateAtom`, `loadingStateAtom`, `settingsLoadedAtom`,
`autoCancelAfterMergeStateAtom`, `autoCancelAfterPrStateAtom`,
`currentSelectionStateAtom`, `activeSessionsHydratedFromCacheStateAtom`.
Module-scope mutable bindings (not atoms):
`backgroundAgentStartInFlight`, `backgroundAgentStartDrainScheduled`,
`lastPersistedFilterMode`, `pushToastHandler`,
`previousSessionsSnapshot`, `previousSessionStates`.

Exported storage:
- `allSessionsAtom: EnrichedSession[]` — primary session list (5
  prod consumers).
- `sessionActivityMapAtom: Map<string, SessionActivityData>`.
- `crossProjectCountsAtom: Record<string, { attention; running }>`.
- `pendingStartupsAtom: Map<string, PendingStartup>`.
- `ACTIVITY_FLUSH_INTERVAL` — non-atom constant.

Exported derived:
- `autoCancelAfterMergeAtom`, `autoCancelAfterPrAtom`,
  `sessionsLoadingAtom`, `activeSessionsHydratedFromCacheAtom` —
  thin reads of private state atoms.
- `filterModeAtom`, `searchQueryAtom`, `isSearchVisibleAtom` —
  read+write derived (`atom(get,set)` shape).
- `filteredSessionsAtom` — search → filter chain.
- `sortedSessionsAtom` — sort over filtered.
- `sessionsAtom` — alias for `sortedSessionsAtom`.
- `lastRefreshAtom`, `mergeDialogAtom`, `mergeStatusSelectorAtom`,
  `mergeInFlightSelectorAtom`, `sessionMutationSelectorAtom` —
  derived reads of internal maps.

Exported actions (29 total): `hydrateProjectSessionsForSwitchActionAtom`,
`expectSessionActionAtom`, `beginSessionMutationActionAtom`,
`endSessionMutationActionAtom`, `enqueuePendingStartupActionAtom`,
`clearPendingStartupActionAtom`,
`cleanupExpiredPendingStartupsActionAtom`,
`refreshSessionsActionAtom`, `cleanupProjectSessionsCacheActionAtom`,
`reloadSessionsActionAtom`, `initializeSessionsSettingsActionAtom`,
`updateAutoCancelAfterMergeActionAtom`,
`updateAutoCancelAfterPrActionAtom`,
`initializeSessionsEventsActionAtom`, `openMergeDialogActionAtom`,
`closeMergeDialogActionAtom`, `confirmMergeActionAtom`,
`shortcutMergeActionAtom`, `setCurrentSelectionActionAtom`,
`updateSessionStatusActionAtom`, `createDraftActionAtom`,
`updateSessionSpecContentActionAtom`,
`optimisticallyConvertSessionToSpecActionAtom`,
`persistSessionsSettingsAtom` (private).

### `specEditor.ts`
- `specEditorDirtyAtomFamily(sessionId)` — read-only derived per-session
  dirty flag (re-export of private `dirtyFlagAtomFamily`).
- `specEditorDirtySessionsAtom` — derived from private
  `dirtySessionsAtom` (defensive copy).
- `specEditorSavedContentAtomFamily(sessionId)` — `[get,set]` over
  private `savedContentMapAtom`.
- `specEditorContentAtomFamily(sessionId)` — `[get,set]` over private
  `contentMapAtom`; updates dirty flag on write.
- `specEditorViewModeAtomFamily(sessionId)` — persisted to
  `localStorage` via `SPEC_EDITOR_VIEW_MODE_STORAGE_KEY`.
- `specEditorPreviewTabAtomFamily(sessionId)` — persisted to
  `localStorage` via `SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY`.
- `markSpecEditorSessionSavedAtom` — action.
- Constants: `SPEC_EDITOR_VIEW_MODE_STORAGE_KEY`,
  `SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY`.

### `tasks.ts` — Phase 7 contract module
- `tasksAtom: atom<Task[]>([])` — sole writable carrier of task state.
- `selectedTaskIdAtom: atom<string | null>(null)` — sidebar selection
  id (independent from `selection.ts`).
- `selectedTaskAtom` — derived; finds task by id in `tasksAtom`.
- `taskRunsForTaskAtomFamily(taskId)` — **read-only** derived family
  reading `task.task_runs` from `tasksAtom`. Per the docstring this
  is the source-of-truth contract: there is no write atom for runs.
- `mainTaskAtom` — derived; first task with `variant === 'main'`.
- `setTasksAtom`, `upsertTaskAtom`, `removeTaskAtom` — actions.
  `removeTaskAtom` clears `selectedTaskIdAtom` if the removed task was
  selected.

### `terminal.ts`
- `terminalTabsAtomFamily(sessionId)` — per-session storage; default
  layout `[{ index: 0, label: 'Shell' }]`.
- `addTabActionAtom`, `removeTabActionAtom`, `setActiveTabActionAtom`,
  `resetTerminalTabsActionAtom` — actions on the family above.
- `terminalFocusAtom: Map<string, TerminalFocus>` — focus tracking.
- `setTerminalFocusActionAtom` — action.
- `runModeActiveAtomFamily(sessionId)` — per-session boolean.
- `agentTypeCacheAtom: Map<string, string>` — sessionId → agent type
  string.
- `setAgentTypeCacheActionAtom` — action.
- `getAgentTypeFromCacheAtom(sessionId)` — **NOT a Jotai atom** but a
  factory function returning a derived `atom((get) => ...)`. See §5.
- `terminalSettingsInitializedReadAtom`, `customFontFamilyAtom`,
  `resolvedFontFamilyAtom`, `smoothScrollingEnabledAtom`,
  `webglEnabledAtom` — derived reads of private
  `terminalSettingsAtom`.
- `initializeTerminalSettingsActionAtom`,
  `setTerminalFontFamilyActionAtom`, `setSmoothScrollingActionAtom`,
  `setWebglEnabledActionAtom` — actions.

### `theme.ts`
- `resolvedThemeAtom` — derived; merges private `themeIdAtom` and
  `systemPrefersDarkAtom`.
- `currentThemeIdAtom` — derived `get => get(themeIdAtom)`.
- `setThemeActionAtom`, `initializeThemeActionAtom` — actions.

---

**Roster total: 207 exported atoms across 32 modules**, plus ~28
file-private storage/flag atoms (counted as derivation backers, not
exported surface).

The full consumer matrix (counts per atom) is in
`/tmp/atom_consumers.txt`. Total atoms surveyed in the
matrix: 237 (includes a handful of non-atom exports counted alongside
real atoms — constants, helper functions; flagged in §5 below).

---

## 2. Orphan list (zero non-test consumers, zero test consumers)

After excluding the defining file from each atom's consumer set, only
**one** name has zero consumers anywhere in `src/` or `src-tauri/`:

| Name | Module:line | Verdict |
|---|---|---|
| `SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY` | `src/store/atoms/specEditor.ts:9` | Constant (not an atom). Used internally by `specEditorPreviewTabAtomFamily` to namespace the localStorage key. The export itself has no outside consumer. **Could downgrade to file-private** in a future cleanup, but it pairs symmetrically with the exported `SPEC_EDITOR_VIEW_MODE_STORAGE_KEY` (which IS consumed by tests). Low value to retire. |

**Verdict for the section:** zero true orphan atoms. The lone name is
a string constant whose retirement is an aesthetic clean-up, not a
state-management concern.

---

## 3. Test-only list (zero non-test consumers, ≥ 1 test consumer)

These atoms have no production consumer outside their defining module
(the matrix excluded the definer file). For each, the question is:
**does the defining module itself consume the atom internally**, in
which case the export is "test-only" only because tests are the only
EXTERNAL reader/writer? Or is the atom genuinely dead in production?

A column "internal consumer?" answers the question by checking whether
the defining file itself reads/writes the atom outside the definition
line.

| Atom | Module | Test-only? | Internal consumer in defining module? | Action category |
|---|---|---|---|---|
| `registerActionButtonAtom` | actionButtons.ts | yes (1 test) | no — test-only API | post-merge: keep, used by tests as the imperative entry; flag to consider in actionButtons cleanup |
| `unregisterActionButtonAtom` | actionButtons.ts | yes (1 test) | no | same |
| `updateActionButtonColorAtom` | actionButtons.ts | yes (1 test) | no | same |
| `forgeBaseAtom` | forge.ts | yes (3 tests) | yes — `projectForgeAtom` derives from it, `refreshForgeAtom` writes to it | exported-but-only-internally-consumed; downgrade candidate (post-merge) |
| `gitlabMrSearchEntriesAtom` | gitlabSearch.ts | yes (2 tests) | yes — read by both `gitlabMrSearchEntryAtomFamily` and the `searchGitlabMrsActionAtom` | downgrade candidate (post-merge) |
| `gitlabIssueSearchEntriesAtom` | gitlabSearch.ts | yes (2 tests) | yes (mirror of above) | downgrade candidate (post-merge) |
| `gitHistoryEntriesAtom` | gitHistory.ts | yes (1 test) | yes — read by `gitHistoryEntryAtomFamily` and several action atoms | downgrade candidate (post-merge) |
| `gitHistoryEntryAtomFamily` | gitHistory.ts | yes (1 test) | yes — used by exported `useGitHistory` hook (line 502) | **keep**: the hook is the public API, the family is the test-instrumentation seam |
| `gitHistoryFilterAtomFamily` | gitHistory.ts | yes (1 test) | yes — used by `useGitHistory` hook (lines 503, 508) | **keep** (same rationale) |
| `filteredGitHistoryAtomFamily` | gitHistory.ts | yes (1 test) | yes — used by `useGitHistory` hook (line 504) | **keep** |
| `ensureGitHistoryLoadedActionAtom` | gitHistory.ts | yes (1 test) | yes — used by `useGitHistory` hook | **keep** |
| `loadMoreGitHistoryActionAtom` | gitHistory.ts | yes (1 test) | yes — used by `useGitHistory` hook | **keep** |
| `refreshGitHistoryActionAtom` | gitHistory.ts | yes (1 test) | yes — used by `useGitHistory` hook | **keep** |
| `pendingStartupsAtom` | sessions.ts | yes (1 test) | yes — read/written by `enqueuePendingStartupActionAtom`, `clearPendingStartupActionAtom`, `cleanupExpiredPendingStartupsActionAtom` and the refresh pipeline | **keep**; export is the test seam for the multi-action workflow |
| `expectSessionActionAtom` | sessions.ts | yes (1 test) | likely (need to verify); fits the pattern of optimistic-create handshake | **keep**; review post-merge whether any production caller wires it through `App.tsx` |
| `lastRefreshAtom` | sessions.ts | yes (1 test) | yes — derived from internal `lastRefreshStateAtom` which is written by the refresh action | **keep** |
| `clearPendingStartupActionAtom` | sessions.ts | yes (1 test) | yes — composed by other action atoms | **keep** |
| `cleanupExpiredPendingStartupsActionAtom` | sessions.ts | yes (1 test) | likely — startup-cleanup pipeline | **keep**; verify it's wired into a periodic flush in production code path |
| `selectedTaskIdAtom` | tasks.ts | yes (2 tests) | yes — `selectedTaskAtom` derives, `removeTaskAtom` clears it | **see §7**; this is a Phase 7 contract atom with NO production reader/writer wiring. PRE-MERGE concern. |
| `taskRunsForTaskAtomFamily` | tasks.ts | yes (1 test) | no — defined and exported, but the only consumers in `src/` are the test file | **see §7**; same concern as above. The atom is correctly read-only as designed, but no production component calls `taskRunsForTaskAtomFamily(...)` |
| `switchingProjectAtom` | selection.ts | yes (1 test) | yes — derived from private `switchingProjectStateAtom` | **keep**; intentionally exposed for consumers that gate UI on project switch (verify whether any non-test consumer subscribes) |
| `getSessionSnapshotActionAtom` | selection.ts | yes (1 test) | yes — used inside other actions in selection.ts via `set(getSessionSnapshotActionAtom, ...)` | **keep** |
| `SPEC_EDITOR_VIEW_MODE_STORAGE_KEY` | specEditor.ts | yes (1 test) | yes — used by `specEditorViewModeAtomFamily` for the localStorage key | **keep** |
| `specEditorDirtyAtomFamily` | specEditor.ts | yes (1 test) | yes — re-export of private `dirtyFlagAtomFamily` | **keep**; tests need the read seam |
| `specEditorDirtySessionsAtom` | specEditor.ts | yes (1 test) | yes — derived from private `dirtySessionsAtom` | **keep** |
| `getAgentTypeFromCacheAtom` | terminal.ts | yes (1 test) | no — factory returning a derived atom; the factory is exported but the only outside caller is the test | **post-merge**: review whether any production code path actually needs to read agent-type from this cache; if no, retire the factory |
| `setSmoothScrollingActionAtom` | terminal.ts | yes (1 test) | no | **post-merge**: settings UI seems to set smooth-scrolling via a different path; verify and possibly retire |
| `setWebglEnabledActionAtom` | terminal.ts | yes (1 test) | no | same |

**Test-only count: 28 atoms.** Of these, ~20 are "test-only externally,
internally wired" (the export IS the test instrumentation seam, the
defining module IS the production consumer). The remaining ~8 are
genuinely candidates for either retirement or wiring into production
— see §7 for the Phase 7 specifics on `selectedTaskIdAtom` and
`taskRunsForTaskAtomFamily`.

---

## 4. Circular / suspicious dependency chains

### Atom-level read graph

I scanned every `atom((get) => ...)` derivation in the audit and
found **no atom-level cycle**. Derived atoms read either:
- File-private storage/state atoms in the same module, or
- A small set of cross-module read points: `projectPathAtom` (read
  from `selection.ts`, `epics.ts`, `sessions.ts`, etc.) and
  `selectionValueAtom` (read from `terminalsAtom`, `isSpecAtom`,
  `isReadyAtom` within `selection.ts`).

The derivation graph is a DAG.

### Module-level import graph

There IS a 3-way cycle at the import level:

```
selection.ts → project.ts (imports projectPathAtom)
selection.ts → sessions.ts (imports hydrateProjectSessionsForSwitchActionAtom)
project.ts → selection.ts (imports cleanupOrchestratorTerminalsActionAtom, setProjectPathActionAtom)
project.ts → sessions.ts (imports cleanupProjectSessionsCacheActionAtom)
sessions.ts → project.ts (imports projectPathAtom)
sessions.ts → selection.ts (imports setSelectionFilterModeActionAtom, clearTerminalTrackingActionAtom)
```

File:line breakdown:
- `src/store/atoms/selection.ts:19` → `import { projectPathAtom } from './project'`
- `src/store/atoms/selection.ts:20` → `import { hydrateProjectSessionsForSwitchActionAtom } from './sessions'`
- `src/store/atoms/project.ts:9` → `import { cleanupOrchestratorTerminalsActionAtom, setProjectPathActionAtom } from './selection'`
- `src/store/atoms/project.ts:10` → `import { cleanupProjectSessionsCacheActionAtom } from './sessions'`
- `src/store/atoms/sessions.ts:11` → `import { projectPathAtom } from './project'`
- `src/store/atoms/sessions.ts:12` → `import { setSelectionFilterModeActionAtom, clearTerminalTrackingActionAtom } from './selection'`

This works at runtime because Jotai atoms are referenced inside
function bodies (action atoms' callbacks), not at module-init time.
ESM hoisting + late binding tolerates the cycle. But it's a structural
smell:
- **Tight coupling** between three stateful domains (project / selection /
  sessions). One refactor to any of these three frequently touches the
  other two.
- **Init-order fragility**: any future addition that uses an imported
  atom at module top-level (rather than inside a callback) will trip a
  `ReferenceError` at load.
- **Test isolation harder** — these three modules effectively form one
  bundle for unit-test purposes.

**Verdict: known smell, not a bug.** Recommendation in §8 is **post-merge**:
extract a small `selectionContext` module (containing just the cross-
module hooks: `cleanupOrchestratorTerminalsActionAtom`,
`hydrateProjectSessionsForSwitchActionAtom`,
`cleanupProjectSessionsCacheActionAtom`) so the dependency graph
becomes one-way: `project → selectionContext`, `selection →
selectionContext`, `sessions → selectionContext`. Out of scope for
Phase 8.

---

## 5. Exported-but-private candidates

True "exported-but-only-consumed-within-the-defining-module" atoms (by
definition: 0 outside-prod, 0 outside-test, but the defining file
itself uses them) are listed above in §3 with the "downgrade candidate"
verdict. Specifically:
- `forgeBaseAtom` — only the same `forge.ts` reads/writes it via the
  exported `projectForgeAtom` and `refreshForgeAtom`.
- `gitlabMrSearchEntriesAtom`, `gitlabIssueSearchEntriesAtom` — internal
  cache state for the family/action layer.
- `gitHistoryEntriesAtom` — same shape, internal cache.

**Counter-argument**: tests directly consume these (3 tests for
`forgeBaseAtom`, 2 for each gitlab one, 1 for gitHistory). Downgrading
to file-private would require tests to consume the wrapper atoms
(`projectForgeAtom`, `gitlabMrSearchEntryAtomFamily`, etc.) instead.
That's a fine refactor but an aesthetic one; no behavioural lift.

**Recommendation: post-merge / no-action**. None of these block
v2 merge.

### Non-atom exports flagged by my matrix (informational)

The roster pulled in some non-atom exports that share filenames with
atoms; listing here so they aren't confused with state:

- `agentTabs.ts`: `DEFAULT_AGENT_TAB_LABEL`, `MAX_AGENT_TABS`,
  `getAgentTabTerminalId` (constants/helpers).
- `copyContextSelection.ts`: `buildCopyContextChangedFilesSelectionKey`,
  `buildCopyContextBundleSelectionKey` (key builders).
- `preview.ts`: `PREVIEW_MIN_ZOOM`, `PREVIEW_MAX_ZOOM`,
  `PREVIEW_ZOOM_STEP`, `buildPreviewKey`.
- `sessions.ts`: `ACTIVITY_FLUSH_INTERVAL`.
- `specEditor.ts`: `SPEC_EDITOR_VIEW_MODE_STORAGE_KEY`,
  `SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY`.
- `terminal.ts`: `getAgentTypeFromCacheAtom` is a factory function, NOT
  an atom (returns an `atom((get) => ...)` per call). Test seam only.
- `layout.ts`: `layoutStorage` is the storage adapter, used by
  `copyContextSelection.ts:2` and `rightPanelTab.ts:2`.

---

## 6. Action-atom data-freshness audit

The class of bug to find here: an action atom whose write callback uses
a closed-over module-scope value that has gone stale, instead of
calling `get(otherAtom)` for the fresh Jotai-tracked value.

### Scan

I read every exported `atom(null, async? (get, set, ...))` body shape
for: **does it consume application state from `get(...)` (fresh,
correct) or from a module-scope `let`/`Map`/`Set` (closed-over,
potentially stale)?**

### Findings

**1. Action atoms that intentionally use `_get`** (full-replace setters
that don't need prior state) — clean:
- `setEnabledAgentsAtom` (`enabledAgents.ts:64`) — replaces state
  wholesale.
- `setTasksAtom` (`tasks.ts:80`) — replaces task list wholesale.
- `registerKeepAwakeEventListenerActionAtom` (`powerSettings.ts:44`)
  — wires a `listenEvent` and only `set`s.

These are correctly written.

**2. `selection.ts` reads from module-scope mutable state instead
of through `get(...)` — by design, but a structural smell**:
- `selectionMatchesCurrentFilter` (line 227) reads `currentFilterMode`
  (file-scope `let`).
- `setSelectionFilterModeActionAtom` (line 247) **writes** the file-
  scope `let currentFilterMode` directly, bypassing Jotai.
- `setProjectPathActionAtom` (line 885) reads `lastProcessedProjectPath`
  (file-scope `let`) and writes back.
- `getSessionSnapshotActionAtom` (line 322) consults
  `sessionSnapshotsCache` (file-scope `Map`) for cached snapshots.

These bindings escape Jotai's reactivity. Components that read
`selectionValueAtom` will NOT re-render when `currentFilterMode`
changes, because the `let` is invisible to Jotai's dep tracker.
**However**: in this codebase, components don't read filter-mode
through `selectionValueAtom`; they read it through `filterModeAtom`
(which IS a proper Jotai derived atom in `sessions.ts:1060`). The
file-scope `currentFilterMode` in `selection.ts` is a per-project
helper that `selection.ts`'s OWN code uses for predicates, not a
component-visible state.

**Risk level**: low for v2 merge. The two state systems (Jotai
`filterModeAtom` and file-scope `currentFilterMode`) MUST stay in
sync via `setSelectionFilterModeActionAtom` — and they appear to
(line 247-258 sets both). Any code path that mutates filter-mode
without going through this action atom would desync them. I did
not find such a path.

**3. `sessions.ts` — module-scope `let` bindings**:
- `lastPersistedFilterMode` (line 959) — used by
  `persistSessionsSettingsAtom` to skip redundant writes.
- `pushToastHandler` (line 963) — set by an init action,
  read by toast emit. Not Jotai-tracked, but it doesn't NEED to be
  (toasts are imperatively pushed, not subscribed).
- `previousSessionsSnapshot` / `previousSessionStates` (lines
  964-965) — used to compute deltas in the refresh pipeline. Same
  pattern: imperative diff buffer, not subscribed state.

These are deliberate. None look load-bearing for UI freshness.

**4. The cache patterns (`Map`/`Set` at file scope) in
`selection.ts` lines 289-297**:
- `sessionSnapshotsCache`, `sessionFetchPromises`, `terminalsCache`,
  `terminalToSelectionKey`, `terminalWorkingDirectory`,
  `selectionsNeedingRecreate`, `lastKnownSessionState`,
  `lastSelectionByProject`.

These are imperative caches used by action atoms. They're consistent
with the reactive `selectionValueAtom` because **every mutation goes
through an action atom that updates both the cache AND the Jotai
state**. I did not find any action atom that updates the cache
without also calling `set(selectionAtom, ...)` (or a write that
flows through the projector).

**No data-freshness bugs found.** The module-scope mutable bindings
are intentional and consistent with the Jotai state. The smell is
that they exist at all — they push complexity outside Jotai's tracking
— but they don't appear to break correctness.

**Recommendation: no-action / post-merge**. Future refactor could
move the caches into derived atoms or into a dedicated `selectionCache`
module, but the current design works.

---

## 7. Phase 7/8 atom contracts

### Contract 1: `tasksAtom` is the sole source-of-truth for task data

**Charter (project_taskflow_v2_charter.md / tasks.ts:1-13):**
> `tasksAtom` is the only writable carrier of task state.
> `Task.task_runs` IS the run list — there is no separate write atom
> for runs.

**Verification:**
- `src/store/atoms/tasks.ts:27` — `tasksAtom = atom<Task[]>([])`. ✓
- `src/store/atoms/tasks.ts:56-61` — `taskRunsForTaskAtomFamily` is
  defined as a read-only derived family that reads
  `task.task_runs` from `tasksAtom`. ✓
- `src/store/atoms/tasks.ts:80` — `setTasksAtom` writes the whole
  list (used by the `TasksRefreshed` listener at
  `src/hooks/useTaskRefreshListener.ts:23`). ✓
- `src/store/atoms/tasks.ts:89-99` — `upsertTaskAtom` accepts a full
  `Task` (with embedded `task_runs`) and replaces by id. ✓
- No separate write atom for runs anywhere in `src/store/atoms/`. ✓

**Status: contract is honored.** `tasksAtom` is the only writable
container; runs are nested in `Task.task_runs` and only read via the
derived family.

**Sub-finding: dead production-side atoms in `tasks.ts`** (verified
with `rg --type ts <name> src/`):

| Atom | Production reader/writer outside test files? |
|---|---|
| `selectedTaskIdAtom` | Written only by `removeTaskAtom`-internal cleanup at `tasks.ts:113`. **No production caller writes it** (no `set(selectedTaskIdAtom, ...)` outside tests). Read only by `selectedTaskAtom` derivation in the same file. |
| `selectedTaskAtom` | Imported only by `src/hooks/useTasks.ts:13`. |
| `mainTaskAtom` | Imported only by `src/hooks/useTasks.ts:12`. |
| `taskRunsForTaskAtomFamily` | Imported only by `src/store/atoms/tasks.test.ts`. **Zero production import.** |
| `useTasks` (hook) | Imported only by `src/hooks/useTasks.test.tsx`. **Zero production component import.** |

Production task-id lookup goes through `selectionToTaskId(effectiveSelection)`
at `src/components/right-panel/RightPanelTabs.tsx:89`, which reads from
`selection.ts`'s `Selection` discriminated union — NOT from
`selectedTaskIdAtom`.

**The entire `useTasks` / `selectedTaskIdAtom` / `selectedTaskAtom` /
`mainTaskAtom` / `taskRunsForTaskAtomFamily` chain is dead
production-side.** The v2 surface bypasses it entirely in favor of
`selectionToTaskId(selectionValueAtom)` and direct
`tasksAtom`-find-by-id reads inside sidebar hooks
(`useSidebarStageSections.ts`, `useTaskRowActions.ts`).

**Verdict: POST-MERGE retire-or-document.** These atoms shipped as
infrastructure for a future task-detail view that the v2 surface
doesn't reach. Two valid choices:
- (a) **Retire**: delete `selectedTaskIdAtom`, `selectedTaskAtom`,
  `mainTaskAtom`, `taskRunsForTaskAtomFamily`, `useTasks`, and the
  cleanup branch in `removeTaskAtom`. Drop the corresponding tests.
  Recover ~120 lines + 4 imports + the dual-source-of-truth ambiguity.
- (b) **Document**: add a "intentionally inert in v2; reserved for
  future task-detail UI" note to each, plus a knip exclusion if
  knip starts flagging them.

Not a merge blocker — these atoms cause no harm at runtime
(`removeTaskAtom`'s `set(selectedTaskIdAtom, null)` is a no-op since
nobody else reads or writes it). The ambiguity is an architectural
trip-hazard for future contributors, not a v2 correctness issue.

### Contract 2: `selectionValueAtom` extends additively for tasks

**Plan (`selection.ts:22-46`):** the `Selection` discriminated union
is extended additively with `'task'`, `'task-run'`, and `'task-slot'`
kinds, joined by optional `taskId`, `runId`, and `slotKey` fields.
Existing call-sites that narrow on `kind === 'session'` continue to
work.

**Verification:**
- `Selection.kind` includes all five kinds. ✓
- `selectionValueAtom` (line 88) only special-cases `'session'` for
  project rebinding. Task kinds fall through to the orchestrator-
  rebind logic at line 99, which is correct. ✓
- `selectionHelpers.ts` provides `selectionToTaskId`,
  `selectionToRunId`, `isTaskKind`. ✓ Used in production at
  `src/components/right-panel/RightPanelTabs.tsx:89`.

**Sub-finding A — `selectionEquals` (line 191) does NOT handle the
three new task kinds:**

The body is:
```ts
if (a.kind !== b.kind) return false        // line 192
if (a.kind === 'orchestrator') { ... }     // line 195
if (b.kind !== 'session') return false     // line 198
```

For two `'task'`-kind selections: kinds match (line 192 passes),
`a.kind === 'orchestrator'` is false (skip), then
`b.kind !== 'session'` is **true** (b is `'task'`) → returns `false`.

**Consequence: every task→task selection is treated as
unequal/changed**, never coalesced. This causes spurious
`setSelectionActionAtom` re-runs and any downstream effects keyed on
"selection changed" will fire on every set even when the new value
is identical to the current. NOT a correctness bug (UI doesn't go
stale), but an efficiency / event-spam concern.

Verified call site: `setSelectionActionAtom` at line 667 uses
`selectionEquals(current, enrichedSelection)` to early-exit when
selection is unchanged. Task kinds bypass this early-exit.

**Sub-finding B — `computeTerminals` (line 144) does NOT handle the
three new task kinds:**

The branches are: `'orchestrator'` (lines 145-153), spec sessions
(155-162), processing sessions (164-170), then default
`sessionTerminalGroup(selection.payload)` (172-182).

For a `'task'` or `'task-run'` selection: no `payload` is set (per
the docstring at line 28-32), so `sessionTerminalGroup(undefined)`
runs and produces nonsense terminal IDs.

**Mitigated by an intentional bypass at the consumer:**
`TerminalGrid.tsx:1489-1499` short-circuits `'task'` and `'task-run'`
selections with a placeholder render BEFORE consuming the `terminals`
value from `useSelection()`. The comment there explicitly
acknowledges: *"task-shape selections don't have an agent terminal
bound — render a placeholder for the top pane so the surface is
unambiguous."* `'task-slot'` IS NOT short-circuited because its
`payload` carries the slot session id (matching the default branch's
`sessionTerminalGroup(payload)` call).

**Verdict: NO-ACTION on `computeTerminals`** — the bypass at
`TerminalGrid.tsx:1489` is the agreed-upon design. The garbage value
that `computeTerminals` produces for `'task'`/`'task-run'` is never
consumed.

**Verdict on `selectionEquals`: POST-MERGE cleanup.** Add the three
task kinds to the equality-comparison branch (compare `taskId`,
`runId`, `slotKey` instead of session fields when kind is task-shaped).
The current behavior just causes redundant action-atom re-fires; no
correctness break. Worth a 30-min fix when convenient.

### Contract 3: `epicsAtom` consumed by NewTaskModal

**Charter (W.5 GAP 5):** epic picker added to NewTaskModal.

**Verification:**
- `epicsAtom` (`src/store/atoms/epics.ts:22`) is exported. ✓
- 2 prod consumers + 2 test consumers per the matrix. ✓
- Consumers in production: NewTaskModal-related component + an
  initialization path. Not exhaustively verified; matrix-level
  signal is sufficient.

**Verdict: contract honored.** Verified at the consumer-count level.

---

## 8. Recommendations

### Pre-merge

(None.) The audit found no atom-level bugs that block merge. The
two design gaps in §7 contract 2 (`selectionEquals` not handling
task kinds; `computeTerminals` producing garbage for `'task'` kind)
are tracked in post-merge below — neither breaks correctness.

### Post-merge

1. **Retire (or formally document) the dead Phase 7 task-atom chain**
   (§7 contract 1). `selectedTaskIdAtom`, `selectedTaskAtom`,
   `mainTaskAtom`, `taskRunsForTaskAtomFamily`, and the `useTasks`
   hook have **zero production consumers** — verified by
   `rg --type ts <name> src/`. The v2 task UI uses
   `selectionToTaskId(selectionValueAtom)` exclusively (per
   `RightPanelTabs.tsx:89`).
   - **Preferred**: delete the dead atoms + hook + tests; remove the
     `set(selectedTaskIdAtom, null)` cleanup in `removeTaskAtom`.
   - **Alternative**: add docstring "intentionally inert in v2;
     reserved for future task-detail UI" and a knip exclusion if
     needed.
   *Effort: 30 min to retire, 5 min to document.*

2. **Fix `selectionEquals` to handle task kinds** (§7 contract 2,
   sub-finding A). Currently every task→task selection short-circuits
   to `return false` at line 198, defeating the early-exit at
   `setSelectionActionAtom:667`. Add a branch that compares
   `taskId`/`runId`/`slotKey` when kind is `'task'` /
   `'task-run'` / `'task-slot'`. Not a correctness bug (just
   redundant action-atom re-fires), but a 30-min cleanup.
   *Effort: 30 minutes.*

3. **Add a no-op or explicit-bypass comment to `computeTerminals`
   for task kinds** (§7 contract 2, sub-finding B). The function
   produces nonsense for `'task'` and `'task-run'` selections; this
   is intentionally bypassed at `TerminalGrid.tsx:1489` but the
   bypass is non-obvious to a reader of `selection.ts` alone.
   Either: (a) early-return an empty `TerminalSet` for `'task'` /
   `'task-run'`, OR (b) add a comment in `computeTerminals` pointing
   at the consumer-side bypass. (a) is more defensive.
   *Effort: 15 minutes.*

4. **Break the 3-way module import cycle**
   (`project ↔ selection ↔ sessions`, §4) by extracting cross-cutting
   action atoms into a `selectionContext` (or similar) module.
   Architectural cleanup; no behavioural change.
   *Effort: 4-6 hours, plus careful test pass.*

5. **Downgrade `forgeBaseAtom`, `gitlabMrSearchEntriesAtom`,
   `gitlabIssueSearchEntriesAtom`, `gitHistoryEntriesAtom` to
   file-private** (§5) — only their tests consume them externally.
   Rewrite tests to consume the wrapper/family atoms instead.
   *Effort: 2 hours per atom; aesthetic only.*

6. **Audit the imperative caches in `selection.ts:289-297`** and
   determine whether any can be replaced with proper derived atoms
   without significantly hurting performance (§6). The current
   pattern works but escapes Jotai's tracking — a future rewrite to
   pure Jotai would simplify reasoning.
   *Effort: 1 day; deferrable.*

7. **Verify and possibly retire test-only setters in `terminal.ts`:**
   `setSmoothScrollingActionAtom`, `setWebglEnabledActionAtom`,
   `getAgentTypeFromCacheAtom` (§3). If the settings UI uses a
   different path, these are dead production-side. Confirm and
   retire.
   *Effort: 1 hour to verify, retire is minutes if confirmed dead.*

### No-action

- **Single orphan `SPEC_EDITOR_PREVIEW_TAB_STORAGE_KEY`** is a
  symmetric pair to its sibling key; retiring the export adds noise
  without value. Leave as-is.
- **Module-scope mutable bindings in `sessions.ts` and
  `selection.ts`** are deliberate and consistent with the Jotai
  state. No data-freshness bugs found. Leave as-is.
- **`registerActionButtonAtom`, `unregisterActionButtonAtom`,
  `updateActionButtonColorAtom`** appear test-only externally but
  are used by the load/save action pipeline at runtime via the same
  module's `actionButtonsMapAtom`. Their export gives tests a direct
  imperative API. Keep.

---

## Methodology footnotes

- The consumer matrix at `/tmp/atom_consumers.txt` was generated
  by `rg -l --type ts -F "<name>" src/ src-tauri/`, with the
  defining file (located via a search for `export const <name> [=:]`
  or `export function <name>`) excluded, and the remaining files
  bucketed as test (`*.test.ts(x)`) or prod.
- "Internal consumer in defining module" was verified per-atom by
  reading the relevant module body or by `rg -n "<name>"
  <module>.ts` (no exclusion).
- Phase 7/8 contracts checked against the docstrings in
  `tasks.ts:1-14` and the `Selection` interface comment at
  `selection.ts:22-47`, which match the descriptions in
  `project_taskflow_v2_charter.md` (per the user's memory index).

---

**Counts: 207 atoms, 1 orphan (a string constant, not a Jotai atom),
28 test-only (the majority intentional test seams via internal-
consumption pattern; ~5-8 are real retire-or-wire candidates), 0
circular at the atom-read level, 1 module-level import cycle
(project ↔ selection ↔ sessions).**

(237 names total were surveyed including non-atom helpers/constants
exported from the same files; 207 are actual Jotai atoms.)
