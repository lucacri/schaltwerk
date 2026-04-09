# Quick Spec and Custom Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fixed "Spec" card (first) and "Custom" card (last) to the New Session modal favorites row, so spec creation is one click and the parallel-versions dropdown only appears in Custom mode.

**Architecture:** Reuse existing `FavoriteCard` component and `selectedFavoriteId` state. Two sentinel IDs (`__schaltwerk_spec__`, `__schaltwerk_custom__`) participate in the favorite list to represent the two new modes. The version dropdown gets a new visibility check `selectedFavoriteId === CUSTOM_FAVORITE_ID`.

**Tech Stack:** TypeScript + React + Vitest, Jotai for atoms, Tauri commands for persistence.

---

## Reference

- **Design doc:** `docs/plans/2026-04-09-quick-spec-and-custom-mode-design.md`
- **Main file:** `src/components/modals/NewSessionModal.tsx`
- **Test file:** `src/components/modals/NewSessionModal.test.tsx`
- **Card component:** `src/components/shared/FavoriteCard.tsx` (reuse as-is)
- **i18n:** `src/locales/en.json`, `src/locales/zh.json`, `src/common/i18n/types.ts`

---

## Task 1: Add i18n strings

**Files:**
- Modify: `src/common/i18n/types.ts:691-731`
- Modify: `src/locales/en.json:689-733`
- Modify: `src/locales/zh.json` (corresponding `newSessionModal` block)

**Step 1: Add type entries**

In `src/common/i18n/types.ts`, add inside the `newSessionModal:` block (after `noPreset: string`, before `unifiedSearch`):

```ts
quickModeSpec: string
quickModeSpecSummary: string
quickModeCustom: string
quickModeCustomSummary: string
```

**Step 2: Add English strings**

In `src/locales/en.json`, add inside `"newSessionModal"` (after `"noPreset"`, before `"unifiedSearch"`):

```json
"quickModeSpec": "Spec",
"quickModeSpecSummary": "Draft only — no agent runs",
"quickModeCustom": "Custom",
"quickModeCustomSummary": "Full configuration",
```

**Step 3: Add Chinese strings**

In `src/locales/zh.json`, mirror the same four keys with Chinese translations. Use:
- `"quickModeSpec": "草稿"`
- `"quickModeSpecSummary": "仅创建草稿，不启动代理"`
- `"quickModeCustom": "自定义"`
- `"quickModeCustomSummary": "完整配置"`

**Step 4: Verify TypeScript compiles**

Run: `bun run lint`
Expected: no errors related to `newSessionModal` keys.

**Step 5: Commit**

(No commit yet — this lands in the squash commit at the end.)

---

## Task 2: Add quick-mode sentinel constants and helpers

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx` (top of file, near other constants)

**Step 1: Add constants**

After `const SESSION_NAME_ALLOWED_PATTERN = /^[\p{L}\p{M}\p{N}_\- ]+$/u` (line ~54), add:

```ts
export const SPEC_FAVORITE_ID = '__schaltwerk_spec__'
export const CUSTOM_FAVORITE_ID = '__schaltwerk_custom__'

const QUICK_MODE_IDS: ReadonlySet<string> = new Set([SPEC_FAVORITE_ID, CUSTOM_FAVORITE_ID])

function isQuickModeId(id: string | null): boolean {
    return id !== null && QUICK_MODE_IDS.has(id)
}
```

These are exported so tests can reference them without string duplication.

---

## Task 3: TDD — Spec card creates a draft directly (failing test)

**Files:**
- Modify: `src/components/modals/NewSessionModal.test.tsx` (add new `describe('quick mode cards', ...)` block at the end of the existing `describe('NewSessionModal', ...)` block, or as a sibling)

**Step 1: Write the failing test**

```ts
describe('quick mode cards', () => {
    it('selecting the Spec card creates a draft via onCreate', async () => {
        const onClose = vi.fn()
        const onCreate = vi.fn()
        renderWithProviders(
            <NewSessionModal open={true} onClose={onClose} onCreate={onCreate} />
        )

        // The Spec card is always first
        const specCard = await screen.findByRole('button', { name: /^Spec/ })
        fireEvent.click(specCard)

        const editorContainer = await screen.findByTestId('mock-markdown-editor')
        const textarea = editorContainer.querySelector('textarea') as HTMLTextAreaElement
        fireEvent.change(textarea, { target: { value: 'My spec content' } })

        const createButton = await screen.findByTitle(/Create spec/i)
        await waitFor(() => expect((createButton as HTMLButtonElement).disabled).toBe(false))
        fireEvent.click(createButton)

        await waitFor(() => expect(onCreate).toHaveBeenCalled())
        const payload = onCreate.mock.calls.at(-1)![0]
        expect(payload.isSpec).toBe(true)
        expect(payload.draftContent).toBe('My spec content')
        expect(payload.baseBranch).toBe('')
    })
})
```

**Step 2: Run the test**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx -t "selecting the Spec card creates a draft"`
Expected: FAIL — Spec card not found.

---

## Task 4: TDD — Custom card shows the version dropdown (failing test)

**Files:**
- Modify: `src/components/modals/NewSessionModal.test.tsx` (same `describe('quick mode cards')` block)

**Step 1: Write the failing test**

```ts
it('selecting the Custom card shows the parallel-versions dropdown', async () => {
    renderWithProviders(
        <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
    )

    const customCard = await screen.findByRole('button', { name: /^Custom/ })
    fireEvent.click(customCard)

    await waitFor(() => {
        expect(screen.getByTestId('version-selector')).toBeInTheDocument()
    })
})
```

**Step 2: Run the test**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx -t "Custom card shows"`
Expected: FAIL — Custom card not found.

---

## Task 5: TDD — Selecting a real preset hides the version dropdown (failing test)

**Files:**
- Modify: `src/components/modals/NewSessionModal.test.tsx`

**Step 1: Write the failing test**

```ts
it('selecting a real preset favorite hides the parallel-versions dropdown', async () => {
    mockAgentPresets.mockReturnValue({
        presets: [{
            id: 'preset-pair',
            name: 'Pair',
            slots: [
                { agentType: 'claude' },
                { agentType: 'codex' },
            ],
            isBuiltIn: false,
        }],
        loading: false,
        error: null,
        savePresets: vi.fn().mockResolvedValue(true),
        reloadPresets: vi.fn().mockResolvedValue(undefined),
    })

    renderWithProviders(
        <NewSessionModal open={true} onClose={vi.fn()} onCreate={vi.fn()} />
    )

    const presetCard = await screen.findByRole('button', { name: /Pair/ })
    fireEvent.click(presetCard)

    await waitFor(() => {
        expect(presetCard).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByTestId('version-selector')).not.toBeInTheDocument()
})
```

**Step 2: Run the test**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx -t "selecting a real preset favorite hides"`
Expected: FAIL — version-selector still present after preset selection.

---

## Task 6: Render Spec and Custom cards in the favorites row

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx:1870-1896`

**Step 1: Build a list that includes the quick-mode cards**

Locate the favorites-row JSX (the `<div className="flex flex-col gap-2">` block around line 1870). Replace the body with code that renders Spec, then real favorites, then Custom — all using `FavoriteCard`. The shortcut numbering applies across the whole sequence (Spec is index 0, Custom is the last index, capped at 9).

Inside the component (right after the `favoriteMap` memo), add:

```ts
const quickModeCards = useMemo(() => {
    const specCard = {
        id: SPEC_FAVORITE_ID,
        title: t.newSessionModal.quickModeSpec,
        summary: t.newSessionModal.quickModeSpecSummary,
        accent: 'var(--color-accent-amber)',
    }
    const customCard = {
        id: CUSTOM_FAVORITE_ID,
        title: t.newSessionModal.quickModeCustom,
        summary: t.newSessionModal.quickModeCustomSummary,
        accent: 'var(--color-border-strong)',
    }
    return { specCard, customCard }
}, [t.newSessionModal.quickModeSpec, t.newSessionModal.quickModeSpecSummary, t.newSessionModal.quickModeCustom, t.newSessionModal.quickModeCustomSummary])
```

Then update the favorites JSX block. Replace the existing `{favorites.length > 0 ? (...) : (...)}` block with:

```tsx
<div className="flex flex-col gap-2">
    <div className="overflow-x-auto">
        <div className="flex gap-3 pb-1">
            <FavoriteCard
                key={quickModeCards.specCard.id}
                title={quickModeCards.specCard.title}
                shortcut={favoriteShortcutLabel(0)}
                summary={quickModeCards.specCard.summary}
                accentColor={quickModeCards.specCard.accent}
                selected={selectedFavoriteId === SPEC_FAVORITE_ID}
                onClick={() => selectQuickMode(SPEC_FAVORITE_ID)}
            />
            {favorites.map((favorite, index) => {
                const shortcutIndex = index + 1
                return (
                    <FavoriteCard
                        key={favorite.id}
                        title={favorite.name}
                        shortcut={shortcutIndex < 9 ? favoriteShortcutLabel(shortcutIndex) : ''}
                        summary={favorite.summary}
                        accentColor={favoriteAccentColor(favorite.agentType)}
                        selected={selectedFavoriteId === favorite.id}
                        modified={selectedFavoriteId === favorite.id && favoriteModified}
                        modifiedLabel={t.newSessionModal.modified}
                        disabled={favorite.disabled}
                        tooltip={favoriteTooltip(favorite.agentTypes, favorite.disabled)}
                        onClick={() => selectFavorite(favorite.id)}
                    />
                )
            })}
            <FavoriteCard
                key={quickModeCards.customCard.id}
                title={quickModeCards.customCard.title}
                shortcut={favorites.length + 1 < 9 ? favoriteShortcutLabel(favorites.length + 1) : ''}
                summary={quickModeCards.customCard.summary}
                accentColor={quickModeCards.customCard.accent}
                selected={selectedFavoriteId === CUSTOM_FAVORITE_ID}
                onClick={() => selectQuickMode(CUSTOM_FAVORITE_ID)}
            />
        </div>
    </div>
</div>
```

(Note: the favoritesHint fallback is removed — there's always at least Spec + Custom now.)

**Step 2: Verify the cards render**

Don't run the new tests yet — they need `selectQuickMode` (Task 7) before they can pass. Just run the existing test suite for the file to make sure nothing else broke compile-wise:

Run: `bun run lint` (TypeScript)
Expected: error about `selectQuickMode` not defined — that's fine, Task 7 adds it.

---

## Task 7: Add `selectQuickMode` handler

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx` (near `selectFavorite`, around line 407-446)

**Step 1: Add the handler**

Right after `selectFavorite`'s `useCallback` (line ~446), add:

```ts
const selectQuickMode = useCallback((modeId: typeof SPEC_FAVORITE_ID | typeof CUSTOM_FAVORITE_ID) => {
    if (modeId === SPEC_FAVORITE_ID) {
        if (selectedFavoriteId !== SPEC_FAVORITE_ID && !isQuickModeId(selectedFavoriteId)) {
            manualFavoriteConfigRef.current = currentFavoriteConfig
        }
        setCreateAsDraft(true)
        setSelectedPresetId(null)
        setSelectedVariantId(null)
        setPresetTabActive(false)
        resetMultiAgentSelections()
        setSelectedFavoriteId(SPEC_FAVORITE_ID)
        setFavoriteBaseline(null)
        setCustomizeExpanded(false)
        if (validationError) {
            setValidationError('')
        }
        return
    }

    // Custom mode
    if (selectedFavoriteId !== CUSTOM_FAVORITE_ID) {
        if (manualFavoriteConfigRef.current) {
            applyFavoriteConfigSnapshot(manualFavoriteConfigRef.current)
        }
    }
    setCreateAsDraft(false)
    setSelectedPresetId(null)
    setSelectedVariantId(null)
    setPresetTabActive(false)
    resetMultiAgentSelections()
    setSelectedFavoriteId(CUSTOM_FAVORITE_ID)
    setFavoriteBaseline(null)
    setCustomizeExpanded(true)
}, [
    applyFavoriteConfigSnapshot,
    currentFavoriteConfig,
    resetMultiAgentSelections,
    selectedFavoriteId,
    validationError,
])
```

**Step 2: Update `selectFavorite` to clear the quick-mode sentinel**

Inside the existing `selectFavorite`, where it handles the deselect-current-favorite branch (line ~413-421), make sure that selecting a real favorite when a quick-mode card is currently selected does NOT trigger the "deselect" branch. The check is `if (selectedFavoriteId === favoriteId)` — that's fine because favorite ids never equal the sentinels. No code change needed here, but verify by reading the function.

Also, when the user clicks the same already-selected real favorite (deselect path), instead of leaving `selectedFavoriteId = null` we should fall back to Custom mode so the row never has zero cards selected:

Replace this block in `selectFavorite`:
```ts
if (selectedFavoriteId === favoriteId) {
    setSelectedFavoriteId(null)
    setFavoriteBaseline(null)
    if (manualFavoriteConfigRef.current) {
        applyFavoriteConfigSnapshot(manualFavoriteConfigRef.current)
    }
    setCustomizeExpanded(true)
    return
}
```

with:

```ts
if (selectedFavoriteId === favoriteId) {
    selectQuickMode(CUSTOM_FAVORITE_ID)
    return
}
```

That keeps the deselect behavior identical (apply manual config, expand customize) while ensuring `selectedFavoriteId` lands on the Custom sentinel.

You'll need to forward-declare `selectQuickMode` or move it above `selectFavorite`. Easiest: move `selectQuickMode` right above `selectFavorite`. Note that `selectFavorite`'s deps array should add `selectQuickMode`.

**Step 3: Run the lint**

Run: `bun run lint`
Expected: no errors.

---

## Task 8: Gate version dropdown and customize accordion on quick mode

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx` (footer block ~1697-1748, customize block ~2137-2152)

**Step 1: Add an `isCustomMode` derived value**

Near other derived values (e.g. right before `const footer = (`, ~line 1696), add:

```ts
const isCustomMode = selectedFavoriteId === CUSTOM_FAVORITE_ID
const isSpecMode = selectedFavoriteId === SPEC_FAVORITE_ID
```

**Step 2: Update the version dropdown visibility conditions**

Replace `{!createAsDraft && agentType !== 'terminal' && multiAgentMode && (` (~line 1699) with:

```tsx
{!createAsDraft && agentType !== 'terminal' && isCustomMode && multiAgentMode && (
```

And replace `{!createAsDraft && agentType !== 'terminal' && (` (~line 1711) with:

```tsx
{!createAsDraft && agentType !== 'terminal' && isCustomMode && (
```

**Step 3: Hide the Customize accordion entirely in spec mode**

Wrap the existing `<CustomizeAccordion ...>` block (~line 2137-2352) so it only renders when not in spec mode:

```tsx
{!isSpecMode && (
    <CustomizeAccordion ...>
        ...
    </CustomizeAccordion>
)}
```

**Step 4: Remove the "Create as spec" checkbox**

Inside the customize accordion (~line 2143-2152), delete:

```tsx
<Checkbox
    checked={createAsDraft}
    onChange={checked => {
        setCreateAsDraft(checked)
        if (validationError) {
            setValidationError('')
        }
    }}
    label={t.newSessionModal.createAsSpec}
/>
```

The Spec card now owns this responsibility. (We keep the `createAsSpec` i18n string; another place might still use it. If `bun run test` later flags it as unused via knip or i18n type check, remove it from the locale and types.)

**Step 5: Run lint and the new tests**

Run: `bun run lint`
Expected: no errors.

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx -t "quick mode cards"`
Expected: the three new tests should now pass.

---

## Task 9: Update default-selection effect

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx:1374-1409`

**Step 1: Update the default selection logic**

Replace the body of the favorite-init effect with:

```ts
useEffect(() => {
    if (!open || favoriteSelectionInitializedRef.current) {
        return
    }
    if (!persistedDefaultsLoaded || agentConfigLoading || !favoriteOrderLoaded) {
        return
    }
    if (hasPrefillData && (selectedVariantId || selectedPresetId)) {
        favoriteSelectionInitializedRef.current = true
        selectQuickMode(CUSTOM_FAVORITE_ID)
        return
    }
    favoriteSelectionInitializedRef.current = true

    if (initialIsDraft) {
        selectQuickMode(SPEC_FAVORITE_ID)
        return
    }

    const firstEnabledFavorite = favorites.find(favorite => !favorite.disabled)
    if (firstEnabledFavorite) {
        selectFavorite(firstEnabledFavorite.id)
    } else {
        selectQuickMode(CUSTOM_FAVORITE_ID)
    }
}, [
    agentConfigLoading,
    favorites,
    favoriteOrderLoaded,
    hasPrefillData,
    initialIsDraft,
    open,
    persistedDefaultsLoaded,
    selectFavorite,
    selectQuickMode,
    selectedPresetId,
    selectedVariantId,
])
```

**Step 2: Update the cleanup effect**

Find the existing reset block around line 1342 and 1418 (`setCustomizeExpanded(true)` after a missing favorite). Update those to clear `selectedFavoriteId` to `CUSTOM_FAVORITE_ID` instead of `null`:

In the missing-favorite-cleanup effect (~line 1411-1420), replace:

```ts
useEffect(() => {
    if (!open || !selectedFavoriteId) {
        return
    }
    if (!favoriteMap.has(selectedFavoriteId)) {
        setSelectedFavoriteId(null)
        setFavoriteBaseline(null)
        setCustomizeExpanded(true)
    }
}, [favoriteMap, open, selectedFavoriteId])
```

with:

```ts
useEffect(() => {
    if (!open || !selectedFavoriteId) {
        return
    }
    if (isQuickModeId(selectedFavoriteId)) {
        return
    }
    if (!favoriteMap.has(selectedFavoriteId)) {
        selectQuickMode(CUSTOM_FAVORITE_ID)
    }
}, [favoriteMap, open, selectedFavoriteId, selectQuickMode])
```

**Step 3: Run all NewSessionModal tests**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx`
Expected: all tests pass. Some existing tests may need minor adjustments (see Task 11).

---

## Task 10: Update keyboard shortcut handler

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx:1539-1550`

**Step 1: Make ⌘1-⌘9 walk the [Spec, ...favorites, Custom] sequence**

Inside the `handleKeyDown` function (line ~1539), replace the favorite shortcut branch:

```ts
} else if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault()
    e.stopPropagation()
    if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation()
    }

    const targetIndex = Number.parseInt(e.key, 10) - 1
    if (targetIndex === 0) {
        selectQuickMode(SPEC_FAVORITE_ID)
        return
    }
    const favoriteIndex = targetIndex - 1
    if (favoriteIndex < favorites.length) {
        const favorite = favorites[favoriteIndex]
        if (favorite && !favorite.disabled && selectedFavoriteId !== favorite.id) {
            selectFavorite(favorite.id)
        }
        return
    }
    if (favoriteIndex === favorites.length) {
        selectQuickMode(CUSTOM_FAVORITE_ID)
    }
}
```

Add `selectQuickMode` to the effect dependency array.

**Step 2: Run the test suite**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx`
Expected: all tests pass.

---

## Task 11: Repair pre-existing tests that depended on old defaults

**Files:**
- Modify: `src/components/modals/NewSessionModal.test.tsx`

The default-selection change means: when there are real favorites, the modal still auto-selects the first favorite (existing behavior). When there are no favorites, the modal auto-selects the Custom card (which expands Customize automatically). The behavior visible to existing tests should be unchanged in both cases — the difference is `selectedFavoriteId` is now `CUSTOM_FAVORITE_ID` instead of `null` in the no-favorites case.

**Step 1: Find tests that check `selectedFavoriteId === null` indirectly**

Grep for tests that rely on the absence of any pressed favorite card:

```bash
grep -n "aria-pressed" src/components/modals/NewSessionModal.test.tsx
```

For each one, determine whether the test expects "no card selected" — if so, update it to expect "Custom card selected" or look for the Custom card explicitly.

**Step 2: Run the full file**

Run: `bun run test:run src/components/modals/NewSessionModal.test.tsx`
Expected: PASS. If anything fails, fix the test (not the implementation) unless the failure indicates a real regression.

**Step 3: Run the integration tests**

Run: `bun run test:run src/components/modals/NewSessionModal.integration.test.tsx`
Expected: PASS. Same approach for fixes.

---

## Task 12: Run the full validation suite

**Files:** none

**Step 1: Run `just test`**

Run: `just test`
Expected: all green — TypeScript lint, vitest frontend tests, Rust clippy, cargo shear, knip, cargo nextest.

If knip flags an unused i18n key (e.g. `createAsSpec`), follow the existing pattern (remove it everywhere or move to the i18n knip ignore list).

**Step 2: Fix anything red**

If a test fails, diagnose, fix, re-run.

---

## Task 13: Squash commit

**Files:** none

**Step 1: Stage everything**

```bash
git add docs/plans/2026-04-09-quick-spec-and-custom-mode-design.md \
        docs/plans/2026-04-09-quick-spec-and-custom-mode-plan.md \
        src/components/modals/NewSessionModal.tsx \
        src/components/modals/NewSessionModal.test.tsx \
        src/common/i18n/types.ts \
        src/locales/en.json \
        src/locales/zh.json
```

**Step 2: Commit**

```bash
git commit -m "feat(new-session): quick spec card and custom mode gating"
```

(Body follows conventional-commit pattern; mentions hiding the parallel-versions dropdown when a preset is active.)
