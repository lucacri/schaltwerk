# Unified Sidebar Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the tabbed filter sidebar (Specs | Running | Reviewed) with a single scrollable column containing 3 collapsible sections — all visible simultaneously.

**Architecture:** Add 3 derived Jotai atoms from `searchedSessionsAtom` to split sessions by state. Create a `SidebarSection` collapsible component. Replace the filter tab bar with 3 `SidebarSection` instances. Persist collapse state to localStorage per project.

**Tech Stack:** React, Jotai atoms, TypeScript, Vitest, localStorage

---

### Task 1: Add derived session atoms

**Files:**
- Modify: `src/store/atoms/sessions.ts:884` (after `filteredSessionsAtom`)
- Test: `src/store/atoms/sessions.test.ts`

**Step 1: Write the failing test**

In `src/store/atoms/sessions.test.ts`, add a test block for the new atoms:

```typescript
import { specSessionsAtom, runningSessionsAtom, reviewedSessionsAtom } from './sessions'

describe('section atoms', () => {
  it('splits sessions by state', () => {
    // Setup store with sessions of mixed states, verify each atom returns correct subset
  })
})
```

The test should create a Jotai store, populate `allSessionsAtom` with sessions in spec/running/reviewed states, then verify `specSessionsAtom` returns only specs, `runningSessionsAtom` returns only running, and `reviewedSessionsAtom` returns only reviewed.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/store/atoms/sessions.test.ts --reporter=verbose`
Expected: FAIL — atoms not exported

**Step 3: Implement the atoms**

Add after `filteredSessionsAtom` (~line 884) in `src/store/atoms/sessions.ts`:

```typescript
export const specSessionsAtom = atom((get) => {
    const sessions = get(searchedSessionsAtom)
    return sortSessionsByCreationDate(sessions.filter(s => mapSessionUiState(s.info) === SessionState.Spec))
})

export const runningSessionsAtom = atom((get) => {
    const sessions = get(searchedSessionsAtom)
    return sortSessionsByCreationDate(sessions.filter(s => {
        const state = mapSessionUiState(s.info)
        return state === SessionState.Running || state === SessionState.Processing
    }))
})

export const reviewedSessionsAtom = atom((get) => {
    const sessions = get(searchedSessionsAtom)
    return sortSessionsByCreationDate(sessions.filter(s => mapSessionUiState(s.info) === SessionState.Reviewed))
})
```

Note: `SessionState` and `mapSessionUiState` imports already exist in sessions.ts. `searchedSessionsAtom` and `sortSessionsByCreationDate` are local to the file.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/store/atoms/sessions.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/store/atoms/sessions.ts src/store/atoms/sessions.test.ts
git commit -m "feat: add derived atoms for spec/running/reviewed session sections"
```

---

### Task 2: Expose section atoms via useSessions hook

**Files:**
- Modify: `src/hooks/useSessions.ts:1-80`
- Modify: `src/store/atoms/sessions.ts` (export list)

**Step 1: Add atoms to useSessions**

In `src/hooks/useSessions.ts`:
1. Import `specSessionsAtom`, `runningSessionsAtom`, `reviewedSessionsAtom` from `../store/atoms/sessions`
2. Add to `UseSessionsResult` interface:
   ```typescript
   specSessions: EnrichedSession[]
   runningSessions: EnrichedSession[]
   reviewedSessions: EnrichedSession[]
   ```
3. Add to `useSessions()` body:
   ```typescript
   const specSessions = useAtomValue(specSessionsAtom)
   const runningSessions = useAtomValue(runningSessionsAtom)
   const reviewedSessions = useAtomValue(reviewedSessionsAtom)
   ```
4. Return them in the result object.

**Step 2: Run test**

Run: `bunx vitest run src/hooks/ --reporter=verbose`
Expected: PASS (no breaking changes)

**Step 3: Commit**

```bash
git add src/hooks/useSessions.ts
git commit -m "feat: expose section atoms via useSessions hook"
```

---

### Task 3: Create SidebarSection component with tests

**Files:**
- Create: `src/components/sidebar/SidebarSection.tsx`
- Create: `src/components/sidebar/SidebarSection.test.tsx`

**Step 1: Write the failing tests**

Create `src/components/sidebar/SidebarSection.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarSection } from './SidebarSection'

describe('SidebarSection', () => {
    it('renders label and count', () => {
        render(<SidebarSection label="Running" count={3} expanded={true} onToggle={() => {}} />)
        expect(screen.getByText('Running')).toBeTruthy()
        expect(screen.getByText('3')).toBeTruthy()
    })

    it('sets aria-expanded correctly', () => {
        const { rerender } = render(<SidebarSection label="Running" count={3} expanded={true} onToggle={() => {}} />)
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
        rerender(<SidebarSection label="Running" count={3} expanded={false} onToggle={() => {}} />)
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    })

    it('fires onToggle when clicked', () => {
        const onToggle = vi.fn()
        render(<SidebarSection label="Specs" count={1} expanded={true} onToggle={onToggle} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onToggle).toHaveBeenCalledOnce()
    })

    it('hides children when collapsed', () => {
        render(
            <SidebarSection label="Reviewed" count={2} expanded={false} onToggle={() => {}}>
                <div data-testid="child">content</div>
            </SidebarSection>
        )
        expect(screen.queryByTestId('child')).toBeNull()
    })

    it('shows children when expanded', () => {
        render(
            <SidebarSection label="Running" count={1} expanded={true} onToggle={() => {}}>
                <div data-testid="child">content</div>
            </SidebarSection>
        )
        expect(screen.getByTestId('child')).toBeTruthy()
    })

    it('applies empty styling when count is 0', () => {
        render(<SidebarSection label="Reviewed" count={0} expanded={false} onToggle={() => {}} />)
        const button = screen.getByRole('button')
        expect(button.getAttribute('aria-expanded')).toBe('false')
    })
})
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/sidebar/SidebarSection.test.tsx --reporter=verbose`
Expected: FAIL — component doesn't exist

**Step 3: Implement SidebarSection**

Create `src/components/sidebar/SidebarSection.tsx`:

```typescript
import { memo, type ReactNode } from 'react'
import { theme } from '../../common/theme'

interface SidebarSectionProps {
    label: string
    count: number
    expanded: boolean
    onToggle: () => void
    focused?: boolean
    children?: ReactNode
}

export const SidebarSection = memo(function SidebarSection({
    label,
    count,
    expanded,
    onToggle,
    focused = false,
    children,
}: SidebarSectionProps) {
    const isEmpty = count === 0

    return (
        <div data-testid={`sidebar-section-${label.toLowerCase()}`}>
            <button
                onClick={onToggle}
                aria-expanded={expanded}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors"
                style={{
                    color: isEmpty
                        ? 'var(--color-text-muted)'
                        : 'var(--color-text-secondary)',
                    fontSize: theme.fontSize.caption,
                    outline: focused ? '1px solid var(--color-accent-blue)' : 'none',
                    outlineOffset: '-1px',
                }}
            >
                <svg
                    className="w-3 h-3 transition-transform flex-shrink-0"
                    style={{
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                >
                    <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                    />
                </svg>
                <span className="font-medium uppercase tracking-wider">{label}</span>
                <span
                    style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                >
                    {count}
                </span>
            </button>
            {expanded && children}
        </div>
    )
})
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/sidebar/SidebarSection.test.tsx --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/sidebar/SidebarSection.tsx src/components/sidebar/SidebarSection.test.tsx
git commit -m "feat: create SidebarSection collapsible component"
```

---

### Task 4: Replace filter tabs with collapsible sections in Sidebar

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

This is the largest task. It replaces the filter tab bar (lines ~1630-1712) with 3 `SidebarSection` instances, each containing its own version-grouped session list.

**Step 1: Update imports and state**

In Sidebar.tsx:
1. Add import: `import { SidebarSection } from './SidebarSection'`
2. Remove: `FilterMode, FILTER_MODES` from `'../../types/sessionFilters'` import
3. Remove: `calculateFilterCounts` from `'../../utils/sessionFilters'` import
4. From `useSessions()` destructuring: remove `filterMode`, `setFilterMode`; add `specSessions`, `runningSessions`, `reviewedSessions`
5. Remove `keyboardNavigatedFilter` state
6. Add section state:

```typescript
const SECTION_ORDER = ['running', 'specs', 'reviewed'] as const
type SectionKey = (typeof SECTION_ORDER)[number]

const sectionCollapseStorageKey = useMemo(
    () => projectPath ? `lucode:section-collapse:${projectPath}` : null,
    [projectPath],
)

const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>(() => {
    if (!sectionCollapseStorageKey) return { running: false, specs: false, reviewed: true }
    try {
        const raw = localStorage.getItem(sectionCollapseStorageKey)
        if (raw) return JSON.parse(raw) as Record<SectionKey, boolean>
    } catch (e) {
        logger.warn('[Sidebar] Failed to load section collapse state:', e)
    }
    return { running: false, specs: false, reviewed: true }
})

const [focusedSection, setFocusedSection] = useState<SectionKey | null>(null)

const toggleSection = useCallback((key: SectionKey) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))
}, [])

const expandReviewedSection = useCallback(() => {
    setCollapsedSections(prev => ({ ...prev, reviewed: false }))
}, [])
```

**Step 2: Add per-section version groups**

```typescript
const runningVersionGroups = useMemo(() => groupSessionsByVersion(runningSessions), [runningSessions])
const specVersionGroups = useMemo(() => groupSessionsByVersion(specSessions), [specSessions])
const reviewedVersionGroups = useMemo(() => groupSessionsByVersion(reviewedSessions), [reviewedSessions])
```

**Step 3: Add per-section memoized epic groupings**

```typescript
const runningEpicGrouping = useMemo<EpicGroupingResult>(() => {
    if (!hasAnyEpicAssigned) return { epicGroups: [], ungroupedGroups: runningVersionGroups }
    return groupVersionGroupsByEpic(runningVersionGroups)
}, [hasAnyEpicAssigned, runningVersionGroups])

const specEpicGrouping = useMemo<EpicGroupingResult>(() => {
    if (!hasAnyEpicAssigned) return { epicGroups: [], ungroupedGroups: specVersionGroups }
    return groupVersionGroupsByEpic(specVersionGroups)
}, [hasAnyEpicAssigned, specVersionGroups])

const reviewedEpicGrouping = useMemo<EpicGroupingResult>(() => {
    if (!hasAnyEpicAssigned) return { epicGroups: [], ungroupedGroups: reviewedVersionGroups }
    return groupVersionGroupsByEpic(reviewedVersionGroups)
}, [hasAnyEpicAssigned, reviewedVersionGroups])
```

**Step 4: Persist collapse state**

```typescript
useEffect(() => {
    if (!sectionCollapseStorageKey) return
    try {
        localStorage.setItem(sectionCollapseStorageKey, JSON.stringify(collapsedSections))
    } catch (e) {
        logger.warn('[Sidebar] Failed to persist section collapse state:', e)
    }
}, [sectionCollapseStorageKey, collapsedSections])
```

**Step 5: Update keyboard navigation**

Replace `handleNavigateToPrevFilter` / `handleNavigateToNextFilter` with section focus cycling:

```typescript
const handleNavigateToPrevFilter = () => {
    const currentIndex = focusedSection ? SECTION_ORDER.indexOf(focusedSection) : 0
    const prevIndex = currentIndex === 0 ? SECTION_ORDER.length - 1 : currentIndex - 1
    setFocusedSection(SECTION_ORDER[prevIndex])
}

const handleNavigateToNextFilter = () => {
    const currentIndex = focusedSection ? SECTION_ORDER.indexOf(focusedSection) : -1
    const nextIndex = (currentIndex + 1) % SECTION_ORDER.length
    setFocusedSection(SECTION_ORDER[nextIndex])
}
```

**Step 6: Replace filter tab bar JSX**

Remove the entire filter tab bar block (lines ~1630-1712: `data-onboarding="session-filter-row"` div with 3 filter buttons).

Remove the collapsed sidebar filter badge (lines ~1608-1628).

Remove `calculateFilterCounts` call at line 1476.

**Step 7: Replace session list rendering**

In the session list `<div ref={sessionListRef}>`, replace the current rendering with 3 `SidebarSection` components. Each section renders its own version groups using the existing `renderVersionGroup` helper (which already handles epic grouping). The key change is that `renderVersionGroup` is called 3 times with different data sets instead of once.

Create a `renderSectionGroups` helper that takes a version groups array and its epic grouping, and renders the full list (with epic headers if present, ungrouped divider, etc.) — reusing the existing epic rendering pattern.

The 3 sections in order:
1. `<SidebarSection label={t.sidebar.sections.running} count={runningSessions.length} ...>` with `runningVersionGroups` / `runningEpicGrouping`
2. `<SidebarSection label={t.sidebar.sections.specs} count={specSessions.length} ...>` with `specVersionGroups` / `specEpicGrouping`
3. `<SidebarSection label={t.sidebar.sections.reviewed} count={reviewedSessions.length} ...>` with `reviewedVersionGroups` / `reviewedEpicGrouping`

**Step 8: Update flattenedSessions for keyboard nav**

`flattenedSessions` needs to concatenate sessions from all 3 sections (respecting collapsed state and epic collapse):

```typescript
const flattenedSessions = useMemo(() => {
    const result: EnrichedSession[] = []
    const addSection = (groups: SessionVersionGroupType[], epicGrouping: EpicGroupingResult, collapsed: boolean) => {
        if (collapsed) return
        if (!hasAnyEpicAssigned) {
            result.push(...flattenVersionGroups(groups))
            return
        }
        const expandedEpicGroups = epicGrouping.epicGroups.flatMap(g =>
            collapsedEpicIds[g.epic.id] ? [] : g.groups
        )
        result.push(...flattenVersionGroups([...expandedEpicGroups, ...epicGrouping.ungroupedGroups]))
    }
    addSection(runningVersionGroups, runningEpicGrouping, collapsedSections.running)
    addSection(specVersionGroups, specEpicGrouping, collapsedSections.specs)
    addSection(reviewedVersionGroups, reviewedEpicGrouping, collapsedSections.reviewed)
    return result
}, [
    hasAnyEpicAssigned, collapsedEpicIds, collapsedSections,
    runningVersionGroups, runningEpicGrouping,
    specVersionGroups, specEpicGrouping,
    reviewedVersionGroups, reviewedEpicGrouping,
])
```

**Step 9: Simplify selection memory**

Change `selectionMemoryRef` from `Map<string, Record<FilterMode, SelectionMemoryEntry>>` to `Map<string, SelectionMemoryEntry>` (global, not per-filter).

Update `ensureProjectMemory` accordingly:
```typescript
const ensureProjectMemory = useCallback(() => {
    const key = projectPath || '__default__'
    if (!selectionMemoryRef.current.has(key)) {
        selectionMemoryRef.current.set(key, { lastSelection: null, lastSessions: [] })
    }
    return selectionMemoryRef.current.get(key)!
}, [projectPath])
```

In the selection memory effect, change `const entry = memory[filterMode]` to `const entry = ensureProjectMemory()` and change `visibleSessions` from `sessions` to `allSessions` (since all sessions are always visible now).

Remove `previousFilterModeRef`, `shouldPreserveForReviewedRemoval`, `currentSessionMovedToReviewed`, and `filterModeChanged` logic from the selection effect.

**Step 10: Add i18n keys**

Add to `src/locales/en.json` under `sidebar`:
```json
"sections": {
    "running": "Running",
    "specs": "Specs",
    "reviewed": "Reviewed"
}
```

Add same to `src/locales/zh.json` with Chinese translations. Add type to i18n types if needed.

**Step 11: Run tests**

Run: `just test`
Expected: PASS (some existing filter tests may need updates — see Task 5)

**Step 12: Commit**

```bash
git add -A
git commit -m "feat: replace filter tabs with collapsible sidebar sections"
```

---

### Task 5: Update existing tests for unified sections

**Files:**
- Modify: `src/components/sidebar/Sidebar.filter.test.tsx`
- Modify: `src/components/sidebar/Sidebar.persistence.test.tsx`
- Modify: `src/components/sidebar/Sidebar.selection-transition.test.tsx`
- Modify: `src/store/atoms/selection.test.ts`
- Modify: `src/hooks/useSpecMode.test.ts`
- Modify: `src/hooks/useSessionMergeShortcut.test.tsx`

**Step 1: Fix test failures**

Run `just test` and fix each failing test:

- **Sidebar.filter.test.tsx**: Most tests about switching filter modes should be removed or rewritten to test section collapse/expand. The filter tab buttons no longer exist.
- **Sidebar.persistence.test.tsx**: May reference filterMode persistence — update to test section collapse persistence.
- **selection.test.ts**: Remove references to `getFilterModeForProjectForTest`, `setSelectionFilterModeActionAtom` if they're no longer used.
- **useSpecMode.test.ts**: Remove references to `setFilterMode` if useSpecMode no longer takes it.
- **useSessionMergeShortcut.test.tsx**: Update if `enableFilterPivot` / `setFilterMode` logic is removed.

**Step 2: Run tests**

Run: `just test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "test: update existing tests for unified sidebar sections"
```

---

### Task 6: Dead code removal — selection.ts

**Files:**
- Modify: `src/store/atoms/selection.ts`
- Modify: `src/store/atoms/selection.test.ts`

**Step 1: Remove dead code**

1. **Remove `selectionMatchesCurrentFilter`** (lines 185-201): It's called only at line 842. Replace `selectionMatchesCurrentFilter(nextSelection)` with `true` (then simplify the surrounding logic since it's always true — the `if (!matchesFilter)` block becomes dead code).

2. **Remove `setSelectionFilterModeActionAtom`** (lines 205-216): It's a no-op since all sessions are visible. Remove all call sites (check `sessions.ts` import).

3. **Remove `currentFilterMode`**, `projectFilterModes`, `defaultFilterModeForProjects` module-level variables — they tracked filter state.

4. **Remove `getFilterModeForProjectForTest`** (lines 1123-1128).

5. **Clean up `resetSelectionAtomsForTest`**: Remove references to filter mode variables.

6. **Simplify `setProjectPathActionAtom`**: Remove the `currentFilterMode = ...` line and the `selectionMatchesCurrentFilter` call.

**Step 2: Run tests**

Run: `just test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/store/atoms/selection.ts src/store/atoms/selection.test.ts
git commit -m "refactor: remove dead filter mode code from selection atoms"
```

---

### Task 7: Dead code removal — shouldPreserveForReviewedRemoval

**Files:**
- Modify: `src/utils/selectionPostMerge.ts`
- Modify: `src/utils/selectionPostMerge.test.ts`
- Modify: `src/components/sidebar/Sidebar.tsx` (call site)

**Step 1: Remove parameter**

1. Remove `shouldPreserveForReviewedRemoval` from `SelectionCandidateInput` interface
2. Remove the `if (shouldPreserveForReviewedRemoval)` block (lines 79-84) from `computeSelectionCandidate`
3. Remove from all call sites in `Sidebar.tsx`
4. Update tests in `selectionPostMerge.test.ts`

**Step 2: Run tests**

Run: `just test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/utils/selectionPostMerge.ts src/utils/selectionPostMerge.test.ts src/components/sidebar/Sidebar.tsx
git commit -m "refactor: remove shouldPreserveForReviewedRemoval dead code"
```

---

### Task 8: Dead code removal — FilterMode from useSessions & useSpecMode

**Files:**
- Modify: `src/hooks/useSpecMode.ts`
- Modify: `src/hooks/useSessionMergeShortcut.ts`
- Modify: `src/components/sidebar/Sidebar.tsx` (call sites)

**Step 1: Simplify useSpecMode**

Remove `setFilterMode` and `currentFilterMode` from `UseSpecModeProps`. The hook no longer needs to switch filter modes since all sections are always visible. Simplify:
- `enterSpecMode`: Remove `setFilterMode(FilterMode.Spec)` call
- `handleExitSpecMode`: Remove filter mode restore logic
- Remove `previousFilterMode` state entirely

**Step 2: Simplify useSessionMergeShortcut**

Remove `enableFilterPivot`, `filterMode`, `setFilterMode` from the hook. The `shouldPivotFilter` logic (switching to Reviewed tab after merge) is replaced by `expandReviewedSection` callback. Add `onExpandReviewedSection?: () => void` to the options and call it when a merge auto-marks reviewed.

**Step 3: Update Sidebar.tsx call sites**

Remove `filterMode` and `setFilterMode` from `useSessions()` destructuring in Sidebar.tsx. Update `useSpecMode` and `useSessionMergeShortcut` calls to match new signatures.

**Step 4: Run tests**

Run: `just test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/useSpecMode.ts src/hooks/useSessionMergeShortcut.ts src/components/sidebar/Sidebar.tsx
git commit -m "refactor: remove FilterMode from useSpecMode and useSessionMergeShortcut"
```

---

### Task 9: Audit remaining FilterMode references

**Files:**
- Various (determined by grep)

**Step 1: Grep for remaining FilterMode usage**

```bash
grep -rn "FilterMode\|FILTER_MODES\|filterMode" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".test."
```

For each remaining reference:
- If it's the `filterModeAtom` in sessions.ts that persists to backend settings — keep it (backend may still expect `filter_mode` field). But make the atom a no-op write (writes are ignored, reads always return `Running`).
- If it's dead import — remove.

**Step 2: Run tests**

Run: `just test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: audit and clean remaining FilterMode references"
```

---

### Task 10: Add localStorage persistence tests

**Files:**
- Modify: `src/components/sidebar/SidebarSection.test.tsx` or create `src/components/sidebar/Sidebar.section-persistence.test.tsx`

**Step 1: Write persistence test**

```typescript
describe('section collapse persistence', () => {
    it('loads collapse state from localStorage on mount', () => {
        const key = 'lucode:section-collapse:/test/project'
        localStorage.setItem(key, JSON.stringify({ running: false, specs: true, reviewed: false }))
        // render Sidebar with projectPath="/test/project"
        // verify specs section is collapsed, running and reviewed are expanded
    })

    it('persists collapse state to localStorage on toggle', () => {
        // render Sidebar, click a section header to collapse
        // verify localStorage was updated
    })

    it('uses smart defaults when no localStorage entry exists', () => {
        // render Sidebar without localStorage entry
        // verify Running and Specs are expanded, Reviewed is collapsed
    })
})
```

**Step 2: Run tests**

Run: `bunx vitest run src/components/sidebar/Sidebar.section-persistence.test.tsx --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/sidebar/Sidebar.section-persistence.test.tsx
git commit -m "test: add localStorage persistence tests for section collapse"
```

---

### Task 11: Add keyboard section navigation tests

**Files:**
- Modify or create: `src/components/sidebar/Sidebar.keyboard.test.tsx`

**Step 1: Write tests**

```typescript
describe('section keyboard navigation', () => {
    it('Shift+L cycles focus: Running -> Specs -> Reviewed -> Running', () => {
        // render Sidebar, simulate Shift+L keypress 3 times
        // verify focusedSection cycles through the order
    })

    it('Shift+H cycles focus in reverse', () => {
        // render Sidebar, simulate Shift+H
        // verify reverse cycling
    })
})
```

**Step 2: Run tests**

Run: `bunx vitest run src/components/sidebar/Sidebar.keyboard.test.tsx --reporter=verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/sidebar/Sidebar.keyboard.test.tsx
git commit -m "test: add keyboard section navigation tests"
```

---

### Task 12: Final validation

**Step 1: Run full test suite**

Run: `just test`
Expected: ALL PASS — TypeScript lint, Rust clippy, cargo shear, knip, vitest, Rust tests, Rust build

**Step 2: Verify knip reports no new unused exports**

If knip reports unused `FilterMode`, `FILTER_MODES`, `calculateFilterCounts` — remove them (unless backend still uses).

**Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for unified sidebar sections"
```
