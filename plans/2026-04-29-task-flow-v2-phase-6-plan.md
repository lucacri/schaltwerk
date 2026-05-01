# task-flow v2 — Phase 6 plan: Sidebar.tsx split

**Branch:** `task-flow-v2`
**Design:** [2026-04-29-task-flow-v2-design.md §10](./2026-04-29-task-flow-v2-design.md)
**Status doc:** [2026-04-29-task-flow-v2-status.md](./2026-04-29-task-flow-v2-status.md)
**Reference (v1 task-flow):** `task-flow@b1f38f63`

## Goal

Split `src/components/sidebar/Sidebar.tsx` (currently 2236 lines) into focused
helper, hook, and sub-component modules. Final `Sidebar.tsx` becomes a thin
projection — composes extracted pieces and renders. No behavior change, no UX
change. The full existing sidebar test suite stays green throughout (mechanical
import-path updates only).

This is the final v2 phase. Backend work is done; this closes design §10 and
the v2 DoD line "`Sidebar.tsx` < 500 lines."

## Audit — current Sidebar.tsx structure (line ranges)

### Module-level (lines 1–226)

| Lines | Symbol | Notes |
|---|---|---|
| 1–72 | imports | ~70 imports |
| 75–98 | `SidebarProps`, `EpicVersionGroup`, `EpicGroupingResult`, `SidebarSectionKey`, `SidebarSectionCollapseState` | type defs |
| 100–110 | `flattenVersionGroups` | pure |
| 112–131 | `epicForVersionGroup` | pure |
| 133–160 | `buildConsolidationGroupDetail` | pure, **already exported**, used by `Sidebar.status-actions.test.tsx:4,289` |
| 162–183 | `groupVersionGroupsByEpic` | pure |
| 185–188 | `DEFAULT_SECTION_COLLAPSE_STATE` | const |
| 190–194 | `createSelectionMemoryBuckets` | pure factory |
| 196–206 | `normalizeSectionCollapseState` | pure |
| 208–226 | `splitVersionGroupsBySection` | pure |

### `Sidebar` component body (lines 228–2236)

| Lines | Block | Observations |
|---|---|---|
| 228–313 | hooks + state setup | `useSelection`, `useSessions`, `useSessionManagement`, `useEpics`, `useTranslation`, `useFocus`, atoms (`projectPath`, `sidebarViewMode`, `inlineSidebarDefaultPreference`, `projectForge`), context (`ModalContext`, `GithubIntegration`, `RunContext`, `Toast`, `ForgeIntegration`) |
| 269–274 | `normalizeAgentType` | useCallback, used in 3 places |
| 276–305 | local `useState` block | `sessionsWithNotifications`, `orchestratorBranch`, `editingEpic`, `deleteEpicTarget`, `deleteEpicLoading`, `epicMenuOpenId`, `collapsedEpicIds`, `mergeCommitDrafts` |
| 289–298 | `fetchOrchestratorBranch` | `useEffectEvent` |
| 306–313 | merge-shortcut + parent-update wiring | |
| 316–349 | `prDialogState` + `gitlabMrDialogState` (state declarations) | local complex state |
| 351–411 | modal-open/close handlers (gitlab MR + PR + merge) | useCallback chain |
| 413–470 | `handleConfirmPr` | the PR submission orchestrator |
| 472–474 | `useSessionPrShortcut` wiring | |
| 476–497 | `convertToSpecModal`, `promoteVersionModal` (state) | |
| 498–521 | `updateActiveMergeCommitDraft` | useCallback |
| 523–591 | `handleResolveMergeInAgentSession` | terminal-paste orchestration |
| 593–617 | refs (sidebar/sessionList/scroll/projectSwitching/previousProjectPath/selectionMemory) + `ensureProjectMemory` + storage keys + `collapsedSections` state | |
| 619–676 | localStorage persistence: epic collapse + section collapse load/save | 4 effects |
| 678–698 | `getCollapsedEpicKey`, `toggleEpicCollapsed`, `toggleSectionCollapsed` | useCallback |
| 700–734 | memoized data builders (`versionGroups`, `sectionGroups`, `getVisibleGroupsForSection`, `visibleSpecGroups`, `visibleRunningGroups`, `flattenedSessions`, `selectionScopedSessions`) | the dependency tree the render reads from |
| 736–754 | project-switch effect + ProjectSwitchComplete listener | |
| 756–769 | `createSafeUnlistener` | useCallback |
| 771–879 | 3 effect blocks: `OpenPrModal`, `OpenGitlabMrModal`, `OpenMergeModal` listeners | |
| 882–990 | **selection-memory effect** | the biggest single effect — drives candidate selection on visibility change, post-merge advance, and orchestrator fallback |
| 992–1036 | orchestrator branch fetch effects (initial + ProjectReady + FileChanges) | |
| 1038–1107 | `handleSelectOrchestrator`, `handleSelectSession`, `handleCancelSelectedSession` | session navigation |
| 1109–1137 | `selectPrev`, `selectNext` | keyboard nav |
| 1139–1176 | `handleRenameSession`, `handleLinkPr`, `handleSpecSelectedSession` | session lifecycle |
| 1178–1270 | version-group flow: `handleSelectBestVersion`, `executeVersionPromotion`, `handleTriggerConsolidationJudge`, `handleConfirmConsolidationWinner`, `handlePromoteSelectedVersion` | |
| 1272–1284 | `findSessionById`, `getSelectedSessionState` | useCallback |
| 1286–1368 | keyboard-shortcut handlers + `runRefineSpecFlow` + `improvePlanAction` | |
| 1370–1426 | `useKeyboardShortcuts` call | the shortcut binding |
| 1433–1468 | refs + scroll-into-view layoutEffect + `handleSessionScroll` + scroll-restore effect | |
| 1471–1544 | backend event subscriptions (`SessionRemoved`, `GitOperationCompleted`, `FollowUpMessage`) | |
| 1546–1623 | `sessionCardActions: SessionCardActions` object literal | 17 callbacks: select / cancel / convertToSpec / runDraft / refineSpec / deleteSpec / improvePlanSpec / reset / switchModel / createPullRequest / createGitlabMr / merge / quickMerge / rename / linkPr / postToForge / improvePlanStartingSessionId |
| 1625–2235 | render JSX | `<div>` root → header bar → orchestrator entry → filter row + search → scroll container (collapsed rail OR Kanban OR list view with `renderVersionGroup` + `renderSection` IIFE) → 9-modal trailer |
| 1919–1965 | inline `renderVersionGroup` | wraps `<SessionVersionGroup>` with all callback wiring |
| 1967–2064 | inline `renderSection` | section header + epic-grouped + ungrouped split + `<SidebarSectionHeader>` |
| 2076–2233 | modal trailer | EpicModal, ConfirmModal, ConvertToSpec, PromoteVersion, MergeSession, PrSession, GitlabMr, SwitchOrchestrator, ForgeWriteback |

### Already-extracted siblings (Phase 6 leaves these alone)

- `SessionCard.tsx`, `SessionCardActions` provider
- `KanbanView.tsx`, `KanbanSessionRow.tsx`
- `SessionVersionGroup.tsx`
- `CollapsedSidebarRail.tsx`, `SessionRailCard.tsx`
- `EpicGroupHeader.tsx`, `SidebarSectionHeader.tsx`
- `CompactVersionRow.tsx`
- `sessionShortcut.ts`, `sessionStatus.ts`, `sessionCardStyles.tsx`

### Discrepancy with the user prompt

The kickoff message references `TaskRow.tsx:8` and `buildStageSections.ts:3`
importing helpers from `Sidebar.tsx`. Those files **do not exist** in the v2
codebase (verified via `find` and `grep`). The mention probably reflects the
v1 mental model carried over from the design doc's §10 ("`TaskRow.tsx` and
`StageSection.tsx` import from sibling helper modules…"), framed as a
forward-looking outcome rather than a current condition.

Current state: the only non-test consumer of Sidebar.tsx is `App.tsx:6`, and
the only Sidebar export besides the `Sidebar` component is
`buildConsolidationGroupDetail`, consumed only by
`Sidebar.status-actions.test.tsx`. So there is no live circular import to
kill — but design §10's spirit (helpers live in siblings, parent stays thin)
still applies, and is what this phase delivers.

## Proposed file layout

```
src/components/sidebar/
├── Sidebar.tsx                              ← thin projection (target ≤ 450 lines)
├── helpers/
│   ├── versionGroupings.ts                  ← flattenVersionGroups, epicForVersionGroup,
│   │                                          groupVersionGroupsByEpic, splitVersionGroupsBySection
│   ├── consolidationGroupDetail.ts          ← buildConsolidationGroupDetail (re-exported from Sidebar.tsx
│   │                                          for back-compat with Sidebar.status-actions.test.tsx)
│   ├── sectionCollapse.ts                   ← SidebarSectionKey, SidebarSectionCollapseState,
│   │                                          DEFAULT_SECTION_COLLAPSE_STATE, normalizeSectionCollapseState
│   ├── selectionMemory.ts                   ← createSelectionMemoryBuckets
│   ├── buildSessionCardActions.ts           ← factory for the 17-callback SessionCardActions object
│   └── routeMergeConflictPrompt.ts          ← pure-ish builder for the resolve-merge-in-agent prompt
│                                              (extracts the prompt construction + terminal-paste call sequence)
├── hooks/
│   ├── useSidebarCollapsePersistence.ts     ← epic + section collapse load/save + toggle callbacks
│   ├── useOrchestratorBranch.ts             ← fetchOrchestratorBranch + ProjectReady + FileChanges listeners
│   ├── usePrDialogController.ts             ← prDialogState + handleOpenPrModal/Close/ConfirmPr
│   │                                          + OpenPrModal listener
│   ├── useGitlabMrDialogController.ts       ← gitlabMrDialogState + open/close + OpenGitlabMrModal listener
│   ├── useMergeModalListener.ts             ← OpenMergeModal listener (writes mergeCommitDrafts +
│   │                                          calls openMergeDialogWithPrefill)
│   ├── useVersionPromotionController.ts     ← promoteVersionModal + handleSelectBestVersion +
│   │                                          executeVersionPromotion + handlePromoteSelectedVersion
│   ├── useConsolidationActions.ts           ← handleTriggerConsolidationJudge + handleConfirmConsolidationWinner
│   ├── useConvertToSpecController.ts        ← convertToSpecModal + handleSpecSelectedSession
│   ├── useSidebarSelectionMemory.ts         ← the big selection-memory effect (882–990) wrapped as a hook
│   │                                          taking (selection, allSessions, selectionScopedSessions,
│   │                                          filterMode, refs); returns nothing (pure side-effect hook)
│   ├── useSidebarBackendEvents.ts           ← SessionRemoved + GitOperationCompleted + FollowUpMessage subs
│   ├── useSessionScrollIntoView.ts          ← layoutEffect that scrolls selected into view + scroll-restore
│   └── useSidebarKeyboardShortcuts.ts       ← assembles all the shortcut callbacks + invokes
│                                              useKeyboardShortcuts (the body of lines 1370–1426)
├── views/
│   ├── SidebarHeaderBar.tsx                 ← top bar: header label + view-mode toggle + collapse btn (≤80 lines)
│   ├── OrchestratorEntry.tsx                ← orchestrator card + actions (≤120 lines)
│   ├── SidebarSearchBar.tsx                 ← filter row + search input (≤140 lines)
│   ├── SidebarSessionList.tsx               ← scroll container + 3-mode dispatch (collapsed / kanban / list)
│   │                                          (≤180 lines; renderVersionGroup + renderSection live inside or
│   │                                          extract to siblings as needed)
│   ├── SidebarVersionGroupRow.tsx           ← extracted from inline renderVersionGroup (the 1919–1965 body)
│   ├── SidebarSectionView.tsx               ← extracted from inline renderSection (the 1967–2064 body) —
│   │                                          renders SidebarSectionHeader + epic groups + ungrouped split
│   └── SidebarModalsTrailer.tsx             ← cluster of 9 modals (≤200 lines)
└── … (existing siblings unchanged)
```

**Why this shape:**

- **Helpers** are pure modules: zero React. Trivially testable and
  zero-risk to move.
- **Hooks** bundle co-located useState + useEffect + useCallback that
  share a closure. Each hook returns the surface its caller (Sidebar.tsx)
  needs to wire into render — typically state values, action callbacks, or
  nothing at all (side-effect-only hooks).
- **Views** are sub-components that take their inputs as props and have
  no internal state of their own (any state they need is hoisted into a
  hook). This keeps them shallow and stateless.
- The split is **siblings under sidebar/**, no parent→child imports.
  `views/Sidebar*.tsx` import from `helpers/` and `hooks/`, not from
  `../Sidebar.tsx`.

## Sub-wave breakdown

Each sub-wave is a single logical move. Tests stay green between sub-waves
(scoped `just test-single src/components/sidebar/` after each; full
`just test` at sub-wave-batch boundaries). Commits per sub-wave.

### Wave A — pure helper extraction (zero-risk)

Move already-module-level pure functions out of Sidebar.tsx into
`helpers/`. No closure capture; no semantic change.

- **A.1** `helpers/versionGroupings.ts`: move `flattenVersionGroups`,
  `epicForVersionGroup`, `groupVersionGroupsByEpic`,
  `splitVersionGroupsBySection`, plus the type defs `EpicVersionGroup`
  and `EpicGroupingResult`. Sidebar.tsx imports them back.
- **A.2** `helpers/sectionCollapse.ts`: move `SidebarSectionKey`,
  `SidebarSectionCollapseState`, `DEFAULT_SECTION_COLLAPSE_STATE`,
  `normalizeSectionCollapseState`.
- **A.3** `helpers/selectionMemory.ts`: move `createSelectionMemoryBuckets`.
- **A.4** `helpers/consolidationGroupDetail.ts`: move
  `buildConsolidationGroupDetail`. **Keep a re-export from Sidebar.tsx**
  so `Sidebar.status-actions.test.tsx:4` keeps working without test
  modification — `export { buildConsolidationGroupDetail } from './helpers/consolidationGroupDetail'`.

**Validation:** `bun vitest run src/components/sidebar/` (~30s vs full
`just test`).

### Wave B — leaf sub-components from JSX trailer (low-risk)

These read state already living in Sidebar.tsx and call setters back. No
new state, no new closures. Pure JSX moves.

- **B.1** `views/SidebarModalsTrailer.tsx`: lines 2076–2233. Takes ~25
  props (modal open flags, prefills, handlers, state setters). Sidebar.tsx
  calls `<SidebarModalsTrailer {...modalProps} />`.
- **B.2** `views/SidebarHeaderBar.tsx`: lines 1635–1678. Props:
  `isCollapsed`, `sidebarViewMode`, `setSidebarViewMode`,
  `leftSidebarShortcut`, `onToggleSidebar`.
- **B.3** `views/OrchestratorEntry.tsx`: lines 1680–1768. Props:
  `isCollapsed`, `selection`, `orchestratorRunning`, `orchestratorResetting`,
  `orchestratorBranch`, `orchestratorShortcut`, callback set
  (`handleSelectOrchestrator`, `setSwitchModelSessionId`,
  `setSwitchOrchestratorModal`, `getOrchestratorAgentType`,
  `normalizeAgentType`, `resetSession`, `terminals`, `t`).
- **B.4** `views/SidebarSearchBar.tsx`: lines 1770–1880. Props:
  `selection`, `searchQuery`, `setSearchQuery`, `isSearchVisible`,
  `setIsSearchVisible`, `sessionCount`, `t`. Embeds the four
  resize-emit blocks unchanged.

### Wave C — list-view sub-components

The renderVersionGroup and renderSection inline functions get hoisted
into siblings. The IIFE in the render block goes away.

- **C.1** `views/SidebarVersionGroupRow.tsx`: lifts the body of
  `renderVersionGroup` (1919–1965). Props: `group`, `selection`,
  `startIndex`, `hasFollowUpMessage`, `onSelectBestVersion`,
  `resettingSelection`, `isSessionRunning`, `isSessionMerging`,
  `getMergeStatus`, `isSessionMutating`, `onConsolidate`,
  `onTriggerConsolidationJudge`, `onConfirmConsolidationWinner`,
  `onTerminateAll`. Stateless.
- **C.2** `views/SidebarSectionView.tsx`: lifts the body of
  `renderSection` (1967–2064). Props: `sectionKey`, `title`, `groups`,
  `collapsed`, `collapsedEpicIds`, `getCollapsedEpicKey`,
  `epicMenuOpenId`, `setEpicMenuOpenId`, `setEditingEpic`,
  `setDeleteEpicTarget`, `toggleEpicCollapsed`, `toggleSectionCollapsed`,
  `renderVersionGroup`. Stateless.
- **C.3** `views/SidebarSessionList.tsx`: lifts the scroll container
  body (1881–2074) — the empty/collapsed/kanban/list mode dispatch.
  Sidebar.tsx renders `<SidebarSessionList sessions={…} … />`.

After C, Sidebar.tsx render is reduced to header + orchestrator entry +
search bar + session list + modal trailer + provider wrappers. Render
JSX should fit in ~80 lines.

### Wave D — pure factory: SessionCardActions

- **D.1** `helpers/buildSessionCardActions.ts`: pure factory that takes
  `(deps) => SessionCardActions` where `deps` is `{ sessions, selection,
  setConvertToDraftModal, projectPathRef, runRefineSpecFlow,
  improvePlanAction, resetSession, terminals, setSwitchModelSessionId,
  setSwitchOrchestratorModal, normalizeAgentType, handlePrShortcut,
  handleOpenGitlabMrModal, handleMergeSession, handleMergeShortcut,
  handleRenameSession, handleLinkPr, setForgeWritebackSessionId }`.
  Sidebar.tsx calls
  `const sessionCardActions = useMemo(() => buildSessionCardActions(deps), [deps…])`.

The 17-callback object disappears from Sidebar.tsx body.

### Wave E — small orchestrators as hooks (state + useCallback bundles)

These pull blocks of co-located state + callbacks out of Sidebar.tsx into
custom hooks. Each hook returns `{ state-or-flag, action-callbacks }`.

- **E.1** `hooks/useSidebarCollapsePersistence.ts`: epic + section
  collapse load/save effects (619–676) + toggles (678–698).
  Returns `{ collapsedEpicIds, collapsedSections, toggleEpicCollapsed,
  toggleSectionCollapsed, getCollapsedEpicKey }`.
- **E.2** `hooks/useConsolidationActions.ts`: handleTriggerConsolidationJudge
  + handleConfirmConsolidationWinner (1213–1253). Returns
  `{ triggerJudge, confirmWinner }`.
- **E.3** `hooks/useConvertToSpecController.ts`: convertToSpecModal state
  + handleSpecSelectedSession + onConvertToSpec wiring. Returns
  `{ modalState, openForSession, close, openFromShortcut }`.
- **E.4** `hooks/useGitlabMrDialogController.ts`:
  gitlabMrDialogState + handleOpenGitlabMrModal + handleCloseGitlabMrModal
  + the OpenGitlabMrModal listener. Returns `{ state, open, close }`.
- **E.5** `hooks/useMergeModalListener.ts`: the OpenMergeModal listener
  block. Takes `{ setMergeCommitDrafts, openMergeDialogWithPrefill,
  pushToast, t }`. Returns nothing (side-effect-only).
- **E.6** `hooks/useVersionPromotionController.ts`: promoteVersionModal
  state + handleSelectBestVersion + executeVersionPromotion +
  handlePromoteSelectedVersion (489–497, 1178–1211, 1255–1270). Returns
  `{ modalState, selectBestVersion, promoteSelected, executePromotion,
  closeModal }`.

### Wave F — bigger orchestrators

These are larger hooks that bundle bigger effect logic. Done in F not E
because they have more cross-deps and need careful threading.

- **F.1** `hooks/useOrchestratorBranch.ts`: `orchestratorBranch` state +
  `fetchOrchestratorBranch` + the 3 effects (initial fetch + ProjectReady
  + FileChanges) (289–298, 992–1036). Returns `{ orchestratorBranch }`.
- **F.2** `hooks/usePrDialogController.ts`: `prDialogState` +
  `handleOpenPrModal` + `handleClosePrModal` + `handleConfirmPr` +
  `useSessionPrShortcut` + the OpenPrModal listener (316–474, 771–810).
  Returns `{ state, open, close, confirm, handlePrShortcut }`.
- **F.3** `hooks/useSidebarBackendEvents.ts`: SessionRemoved +
  GitOperationCompleted + FollowUpMessage listeners (1471–1544).
  Takes refs + selection setter + setFocusForSession + setSessionsWithNotifications.
  Returns nothing.
- **F.4** `hooks/useSessionScrollIntoView.ts`: layoutEffect for
  scrollIntoView + handleSessionScroll + scroll restore on collapse change
  (1440–1468). Takes refs + selection + isCollapsed. Returns
  `{ handleSessionScroll }`.
- **F.5** `helpers/routeMergeConflictPrompt.ts` + thin wrapper in
  Sidebar.tsx: extract the prompt builder + terminal-paste sequence from
  `handleResolveMergeInAgentSession` (523–591). The wrapper stays as a
  callback in Sidebar that calls into `routeMergeConflictPrompt` for the
  pure pieces.

### Wave G — the big one: selection memory

- **G.1** `hooks/useSidebarSelectionMemory.ts`: the 100-line selection-memory
  effect (882–990). Takes `{ selection, allSessions, selectionScopedSessions,
  filterMode, ensureProjectMemory, setSelection, lastRemovedSessionRef,
  lastMergedReadySessionRef, isProjectSwitching, latestSessionsRef }`.
  Returns nothing.

This is its own wave because it's the most complex single chunk of logic
and has the highest risk of subtle regression. Done late so other moves
have already proven the pattern stable.

### Wave H — keyboard shortcuts

- **H.1** `hooks/useSidebarKeyboardShortcuts.ts`: assembles the
  shortcut callback bundle (1286–1426) and invokes
  `useKeyboardShortcuts`. Takes the dep set
  `{ selection, sessions, terminals, isResetting, isAnyModalOpen,
  resetSession, getSelectedSessionState, normalizeAgentType,
  setSwitchModelSessionId, setSwitchOrchestratorModal,
  getOrchestratorAgentType, runRefineSpecFlow, handlePrShortcut,
  handleOpenGitlabMrModal, handleMergeShortcut,
  updateAllSessionsFromParent, github.canCreatePr, forge,
  flattenedSessions.length, openTabs.length, onSwitchToProject,
  onCycleNextProject, onCyclePrevProject, isDiffViewerOpen,
  inlineDiffDefault, sidebarRef, setCurrentFocus, setFocusForSession }`.

### Wave I — architecture test + Sidebar.tsx final shape

- **I.1** Architecture test (vitest):
  `src/components/__tests__/arch_component_size.test.ts`
  - Walks `src/components/**/*.tsx` (excludes `*.test.tsx`).
  - Asserts no file exceeds **500 lines**, with an explicit allowlist
    of currently-oversized files (the 23 components listed in §"Existing
    oversized components" below).
  - `Sidebar.tsx` MUST NOT be on the allowlist after Phase 6.
  - Test surfaces a clear failure message naming the file + line count
    + the cap.
  - Doc comment in the test: "This is a ratchet — when you split a file
    on the allowlist below the cap, remove it from the allowlist. New
    files must stay under the cap."
- **I.2** Final Sidebar.tsx audit: confirm < 500 lines. Body of the
  component should now be: hook calls + useMemo'd builders + render JSX
  (header + orchestrator + search + list + modals + providers).
- **I.3** Verify `grep "from.*['\"]./Sidebar['\"]" src/components/sidebar/`
  in non-test code returns zero hits (siblings only import from siblings,
  not from Sidebar).
- **I.4** `just test` — full validation suite green.

### Wave J — manual smoke + status doc + memory

- **J.1** Manual smoke test. Open `bun run tauri:dev` against a project
  that has, or is set up to have, **all of**: at least one spec, at
  least one running session not in a version group, at least one
  multi-version run (the multi-candidate / consolidation flow), and at
  least one cancelled task. Walk through every item in
  §"Manual smoke-test checklist" below and tick each box in the Wave J
  commit message (or in a checkbox-table block in the commit body).
  Per the kickoff prompt: this catches "test suite green / user sees
  something subtly broken" gaps, so the entire list runs. Compare any
  visual oddity against `task-flow@b1f38f63` (v1 reference) before
  attributing it to Phase 6.
- **J.2** Update `plans/2026-04-29-task-flow-v2-status.md` Phase 6 row
  with sub-wave commit hashes; add the v2 charter complete note; add
  the 23-file legacy oversized component visibility list (per user ask
  during plan approval — known debt, future cleanup can pull entries
  off one at a time).
- **J.3** Update auto-memory `project_taskflow_v2_charter.md` to mark
  v2 complete.
- **J.4** Final commit.

## Architecture test design

**File:** `src/components/__tests__/arch_component_size.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const COMPONENTS_DIR = new URL('..', import.meta.url).pathname
const REPO_ROOT = new URL('../../..', import.meta.url).pathname
const HARD_CAP_LINES = 500

// Ratchet allowlist: components that currently exceed the cap. New
// additions are PROHIBITED. When a file on this list is split below
// the cap, REMOVE it from the list — the test will then enforce the
// cap on it permanently. Sidebar.tsx came off this list in Phase 6.
const LEGACY_OVERSIZED_ALLOWLIST: ReadonlySet<string> = new Set([
    'diff/UnifiedDiffView.tsx',
    'modals/SettingsModal.tsx',
    'terminal/Terminal.tsx',
    'terminal/TerminalGrid.tsx',
    'diff/DiffFileList.tsx',
    'specs/SpecEditor.tsx',
    'diff/PierreDiffViewer.tsx',
    'git-graph/GitGraphPanel.tsx',
    'sidebar/SessionCard.tsx',
    'forge/ForgePrDetail.tsx',
    'home/AsciiBuilderLogo.tsx',
    'sidebar/SessionVersionGroup.tsx',
    'shared/SessionConfigurationPanel.tsx',
    'modals/UnifiedSearchModal.tsx',
    'right-panel/CopyContextBar.tsx',
    'right-panel/RightPanelTabs.tsx',
    'sidebar/CompactVersionRow.tsx',
    'modals/NewSessionModal.tsx',
    'modals/MergeSessionModal.tsx',
    'diff/SimpleDiffPanel.tsx',
    'modals/GitHubPrPromptSection.tsx',
    'modals/PrSessionModal.tsx',
    // … any others discovered during Phase 6 that aren't in scope
])

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue
            yield* walk(full)
        } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
            yield full
        }
    }
}

describe('component file size cap', () => {
    it(`no .tsx component exceeds ${HARD_CAP_LINES} lines (with grandfathered allowlist)`, () => {
        const violations: Array<{ file: string; lines: number }> = []
        for (const path of walk(COMPONENTS_DIR)) {
            const lineCount = readFileSync(path, 'utf8').split('\n').length
            const relPath = relative(COMPONENTS_DIR, path)
            if (lineCount > HARD_CAP_LINES && !LEGACY_OVERSIZED_ALLOWLIST.has(relPath)) {
                violations.push({ file: relPath, lines: lineCount })
            }
        }
        expect(violations, [
            `Found ${violations.length} .tsx component(s) exceeding ${HARD_CAP_LINES} lines.`,
            `Either split the file or, if legitimately needed, add to LEGACY_OVERSIZED_ALLOWLIST with a justification comment.`,
            ...violations.map(v => `  ${v.file}: ${v.lines} lines`),
        ].join('\n')).toEqual([])
    })

    it('Sidebar.tsx is below the cap (Phase 6 DoD)', () => {
        const path = join(COMPONENTS_DIR, 'sidebar/Sidebar.tsx')
        const lineCount = readFileSync(path, 'utf8').split('\n').length
        expect(lineCount).toBeLessThanOrEqual(HARD_CAP_LINES)
    })

    it('LEGACY_OVERSIZED_ALLOWLIST does not contain stale entries', () => {
        const stale: string[] = []
        for (const relPath of LEGACY_OVERSIZED_ALLOWLIST) {
            const full = join(COMPONENTS_DIR, relPath)
            const lineCount = readFileSync(full, 'utf8').split('\n').length
            if (lineCount <= HARD_CAP_LINES) {
                stale.push(`${relPath}: ${lineCount} lines (now under cap; remove from allowlist)`)
            }
        }
        expect(stale, [
            'Found allowlist entries that are now under the cap. Remove them.',
            ...stale,
        ].join('\n')).toEqual([])
    })
})
```

The third test is the **ratchet enforcer** — once a file drops below the
cap, the allowlist must shrink. This prevents the allowlist from bit-rotting
into permanent grandfather status.

### Existing oversized components (the allowlist baseline)

23 components in `src/components/` currently exceed 500 lines. Inventory
captured from `find … -exec wc -l +`:

| Lines | File | In Phase 6 scope? |
|---|---|---|
| 4035 | diff/UnifiedDiffView.tsx | no |
| 3556 | modals/SettingsModal.tsx | no |
| 2424 | terminal/Terminal.tsx | no |
| **2236** | **sidebar/Sidebar.tsx** | **YES — must be removed from allowlist by end of phase** |
| 1949 | terminal/TerminalGrid.tsx | no |
| 1382 | diff/DiffFileList.tsx | no |
| 1279 | specs/SpecEditor.tsx | no |
| 982 | diff/PierreDiffViewer.tsx | no |
| 903 | git-graph/GitGraphPanel.tsx | no |
| 890 | sidebar/SessionCard.tsx | no (already extracted; lives separately) |
| 811 | forge/ForgePrDetail.tsx | no |
| 764 | home/AsciiBuilderLogo.tsx | no |
| 704 | sidebar/SessionVersionGroup.tsx | no |
| 700 | shared/SessionConfigurationPanel.tsx | no |
| 643 | modals/UnifiedSearchModal.tsx | no |
| 642 | right-panel/CopyContextBar.tsx | no |
| 632 | right-panel/RightPanelTabs.tsx | no |
| 600 | sidebar/CompactVersionRow.tsx | no |
| 577 | modals/NewSessionModal.tsx | no |
| 543 | modals/MergeSessionModal.tsx | no |
| 516 | diff/SimpleDiffPanel.tsx | no |
| 509 | modals/GitHubPrPromptSection.tsx | no |
| 500 | modals/PrSessionModal.tsx | exactly at cap; no |

Sidebar.tsx leaves the list this phase. The other 22 stay on the
allowlist with TODO comments deferring to future cleanup phases (out of
scope for v2; they're not v2 task-flow surface).

## Manual smoke-test checklist

After all waves are committed and `just test` is green, run
`bun run tauri:dev` and exercise the sidebar against a project with
representative state. Compare side-by-side with `task-flow@b1f38f63` if
visual diffs surface.

**Pre-flight setup**: load a project that has, or create:
- at least 2 specs (one in an epic group, one ungrouped)
- at least 2 running sessions ungrouped
- at least 1 multi-version run with 2+ candidates (so promote-version
  + consolidation-judge surfaces appear)
- at least 1 cancelled task (so reopen-task surface appears)
- at least 1 task that has progressed through stages (so stage-advance
  visual is exercised)

### A. Section structure

- [ ] **Empty project**: empty state copy renders.
- [ ] **Specs section + Running section**: both render with correct
  counts (matches `sectionGroups.specs.length` / `.running.length`).
- [ ] **Section collapse**: click each section header to collapse;
  reload → collapse state persists. Click to re-expand.
- [ ] **Epic groups**: epics render as labeled groups inside their
  section with the colored left-rule per `getEpicAccentScheme`.
  Collapse/expand individual epics; reload → state persists.
- [ ] **Ungrouped header**: the "Ungrouped" divider renders only when
  a section has both epic-grouped and non-epic sessions.

### B. Views + collapsed rail

- [ ] **Board view**: toggle to "Board"; Kanban columns render the
  same sessions; toggle back to "List".
- [ ] **Collapsed rail**: hide the sidebar; rail shows session
  shortcuts; expanding restores the previous list scroll position.
- [ ] **Search**: open search; type to filter; result count updates;
  close restores full list.

### C. Selection + keyboard nav

- [ ] Click a session → top terminal swaps to that agent.
- [ ] ⌘1 → orchestrator.
- [ ] ⌘2..⌘9 → first 8 sessions in flatten order.
- [ ] ↑/↓ keyboard nav cycles flat list (and falls through to
  orchestrator at the top).
- [ ] **Selection memory**: switch projects (open a second tab if
  needed); switch back; the previously selected session is restored
  if it's still visible. If not visible, fallback advances to a
  reasonable neighbor, not silently to orchestrator unless the section
  is empty.

### D. Task lifecycle: promote / cancel / reopen / switch stages

- [ ] **Promote version (multi-candidate run)**: in a version group,
  click "select best version" on a candidate → `PromoteVersionConfirmation`
  modal opens (unless localStorage opt-out for that base name).
  Confirm → losing siblings cancel; promoted version stays in the
  group. The version-group header reflects the new state.
- [ ] **Cancel session**: click cancel on a running session → confirm
  modal opens; cancel → session moves out of running, into cancelled
  / removed depending on type. The cancel-immediate variant
  (configurable per `selectedSession.info.has_uncommitted_changes`)
  skips the modal.
- [ ] **Reopen cancelled task**: locate a task with `cancelled_at` set
  (cancelled in the current session or pre-existing). Use whatever
  surface v1 used for reopen (row action menu / context); confirm
  the task moves back into Running. If v2 surfaces no reopen path,
  document that explicitly so the gap is captured.
- [ ] **Switch stages (auto-advance)**: confirm a winner on a stage
  that auto-advances (per `auto_advance` table); the task's section
  membership / stage badge moves to the next stage without a manual
  refresh. Switching stages should not blow away selection.
- [ ] **Convert to spec**: select a running session → ⌘⇧S (or row
  action) → `ConvertToSpecConfirmation` opens; confirm → session
  re-appears under Specs.
- [ ] **Spec deletion**: deleting a spec always shows the modal
  (no immediate variant, per kickoff prompt's expected behavior).
- [ ] **Consolidation**: from a multi-candidate run that has
  completed candidates, trigger judge → "Consolidation judge started"
  toast appears. Once the judge finishes, confirm winner → "Consolidation
  winner confirmed" toast appears.

### E. Forge integration

- [ ] **PR flow (GitHub)**: when forge=github, ⌘⇧P → preview loads →
  `PrSessionModal` opens → submit creates PR → success toast with
  link. Link the session to the PR via `SchaltwerkCoreLinkSessionToPr`
  (verify by re-opening the session row → PR # shows).
- [ ] **GitLab MR flow**: when forge=gitlab, ⌘⇧P → `GitlabMrSessionModal`
  opens.
- [ ] **Merge flow**: ⌘⇧M → `MergeSessionModal` → confirm → success
  toast → selection advances to the post-merge candidate (per
  `lastMergedReadySessionRef` flow).
- [ ] **Resolve merge in agent**: in the merge modal, click "resolve
  in session" → top terminal receives the prompt + paste-and-submit
  fires + focus jumps to claude pane.
- [ ] **Forge writeback**: row action → `ForgeWritebackModal` opens.

### F. Agents + spec workflows

- [ ] **Switch model (running session)**: ⌘P on a running session →
  `SwitchOrchestratorModal` opens → choose a different agent →
  terminal restarts with the new agent in the same worktree.
- [ ] **Switch model (orchestrator)**: ⌘P on orchestrator → modal opens
  scoped to orchestrator → switch persists.
- [ ] **Refine spec**: select a spec → ⌘⇧E → focus jumps to the spec's
  Claude pane.
- [ ] **Improve plan**: row action on a spec → improve-plan flow runs;
  during the run, `improvePlanStartingSessionId` is set so the row
  reflects "starting" state.

### G. Epics

- [ ] **Edit epic** from epic header menu → `EpicModal` (edit mode)
  opens; submit → header reflects new name/color.
- [ ] **Delete epic** → `ConfirmModal` → confirm → epic deleted, its
  sessions move to the Ungrouped tier within their section.

### H. Notifications + cross-cutting

- [ ] **Follow-up message notification**: trigger a follow-up message
  event from the backend; the session shows a notification dot until
  selected; selecting clears it.
- [ ] **Project switch**: switch tabs → sidebar scope updates;
  notifications scoped per project (don't bleed across).
- [ ] **Scroll**: scroll the session list; click around in the same
  session list region; the scroll position is preserved across
  expand/collapse of the sidebar.
- [ ] **No console errors** in dev tools across the full run.

### Tick-off in commit

The Wave J commit message includes a checkbox table mirroring sections
A–H above with each item ticked. Items that are inapplicable to the
test project (e.g. no GitLab forge configured) are explicitly marked
"N/A — reason".

## Validation gates

- **Inner loop:** `bun vitest run src/components/sidebar/` after each
  edit (per `feedback_test_scope_discipline.md`).
- **Sub-wave boundary:** `just test-single src/components/sidebar/Sidebar.tsx`
  (routes to scoped sidebar tests).
- **Wave boundary** (after a wave's sub-waves all land): `just test` —
  catches knip dead-code, cargo shear, arch tests, type drift outside
  sidebar.
- **Pre-commit:** `just test` — full validation suite, must be green.
- **Test-count baseline:** Phase 5.5 ended at 2404 tests. After Phase 6,
  expect 2404 + N where N counts the new arch tests (3) + any tests
  added for new pure helpers (most won't need new tests since the
  existing sidebar tests cover their behavior end-to-end).
- **Test modifications:** allowed for `import` paths only. If a test
  body needs to change to keep passing, that's a signal of semantic
  drift — back out the wave.

## Risks

| Risk | Mitigation |
|---|---|
| Selection-memory effect (Wave G) regresses subtle post-merge selection logic | Wave G is its own wave; do it last; verify against `Sidebar.selection-transition.test.tsx` and the post-merge smoke checklist item |
| Hook extractions accidentally re-run effects (unstable deps) | Each new hook closes over refs and stable callbacks; Sidebar.tsx passes refs+stable values into hooks; no `[fontSize]`-style instability |
| 17-callback `sessionCardActions` factory adds a useMemo that wasn't there | The current code re-creates the object literal every render; switching to `useMemo` is strictly equal-or-better. Verify SessionCard's `memo` boundary still effective with React DevTools profiler check during smoke. |
| Architecture test allowlist diverges from reality | The third sub-test (LEGACY_OVERSIZED_ALLOWLIST does not contain stale entries) ratchets the list automatically — if something drops below the cap, the test fails until removed. |
| `buildConsolidationGroupDetail` import in tests breaks | Wave A.4 keeps the re-export from Sidebar.tsx via `export { … } from './helpers/…'`. Tests untouched. |
| Forward circular import (sibling → parent Sidebar) sneaks in via auto-import suggestions | Wave I.3's grep verification catches it before commit. |

## Out of scope

- Splitting the other 22 oversized components (UnifiedDiffView,
  SettingsModal, Terminal, etc.). Tracked via the allowlist; future
  cleanup phases.
- Dropping the vestigial `sessions.stage` column from Phase 5.5
  (separate Phase 6.5 / cleanup item).
- Any data-layer change. If a data bug surfaces during smoke testing,
  file as a follow-up.
- Any new functionality, prop, or visual change.

## Definition of done

- [ ] `Sidebar.tsx` line count ≤ 500.
- [ ] All sibling files in `src/components/sidebar/` (excluding
  `Sidebar.tsx` and the allowlist) ≤ 500 lines.
- [ ] Architecture test `arch_component_size.test.ts` passes.
- [ ] Ratchet test (third sub-test) confirms no stale allowlist entries.
- [ ] `grep "from.*['\"]\\.\\./Sidebar['\"]" src/components/sidebar/` and
  `grep "from.*['\"]\\./Sidebar['\"]" src/components/sidebar/` return
  zero non-test hits.
- [ ] All 271+ existing sidebar tests pass with at most mechanical
  import-path edits — no test body changes.
- [ ] `just test` green (TS lint, MCP, vitest, clippy, cargo shear,
  knip, nextest).
- [ ] Manual smoke checklist all checked.
- [ ] `plans/2026-04-29-task-flow-v2-status.md` Phase 6 row marked
  `[x]` with sub-wave commit hashes.
- [ ] Auto-memory updated.
