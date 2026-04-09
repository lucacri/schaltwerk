# Quick Spec and Custom Mode in NewSessionModal

**Date:** 2026-04-09
**Status:** Approved (autonomous)

## Problem

The favorites-first redesign (2026-04-07) put a row of variant/preset cards at the top of the New Session modal. Two friction points remain:

1. **Creating a spec still requires the Customize accordion.** Users must expand Customize and toggle "Create as spec" before they can fill in spec content. Spec creation is a frequent workflow and shouldn't be hidden.
2. **The parallel-versions dropdown still appears when a preset is selected.** Presets already define their own slot count (and most are explicitly multi-agent). Letting the user request "3 versions of a 2-agent preset" produces nonsense — and the current UI implies it's a valid combination.

## Design

Reuse the existing favorites row to host two new fixed cards:
- **Spec** — always the first card. Switches the modal into spec-creation mode immediately. No customize, no branch, no agent selection.
- **Custom** — always the last card. Restores the full configuration UI, including the parallel-versions dropdown next to Cancel.

Real user favorites (variants + presets) live between the two fixed cards, in their existing order.

### Mode model

We don't add a parallel state machine. Instead, two sentinel IDs participate in the existing `selectedFavoriteId` state:

```ts
export const SPEC_FAVORITE_ID = '__schaltwerk_spec__'
export const CUSTOM_FAVORITE_ID = '__schaltwerk_custom__'
```

`selectedFavoriteId` always reflects what the user picked:
- `SPEC_FAVORITE_ID` → spec mode
- `CUSTOM_FAVORITE_ID` → custom mode
- a real favorite id → favorite mode (variant or preset applied)

This keeps the FavoriteCard wiring (`selected`, `aria-pressed`, modified-tracking, ⌘1-⌘9 shortcuts) unchanged.

### Card behavior

| Card | onClick effects | Card visual |
|------|-----------------|-------------|
| **Spec** (first) | `setCreateAsDraft(true)`, clear preset/variant, `setSelectedFavoriteId(SPEC_FAVORITE_ID)`, hide customize | amber accent (matches Create-Spec button), title "Spec", summary "Draft only — no agent runs" |
| **Real favorite** | unchanged (existing `selectFavorite`) | unchanged |
| **Custom** (last) | `setCreateAsDraft(false)`, clear preset/variant, restore manual snapshot, `setSelectedFavoriteId(CUSTOM_FAVORITE_ID)`, expand customize | neutral grey accent, title "Custom", summary "Full configuration" |

Selecting Spec or Custom never deselects on second click — they're terminal modes, not toggles. Switching between Spec / Favorite / Custom cycles cleanly.

### Version dropdown gating

The footer dropdown (parallel-versions / configure-agents) is now visible **only** in Custom mode:

```ts
const isCustomMode = selectedFavoriteId === CUSTOM_FAVORITE_ID
const showVersionControls = !createAsDraft && agentType !== 'terminal' && isCustomMode
```

This applies to both `MultiAgentAllocationDropdown` and the `Dropdown`/version selector button.

### Customize accordion gating

- **Spec mode**: hide the entire Customize accordion. (Spec doesn't need branch/agent/preset.)
- **Favorite mode**: collapsed by default (existing behavior).
- **Custom mode**: expanded by default.

The "Create as spec" checkbox inside the accordion is removed — its job is now done by the Spec card.

### Default selection on open

When the modal opens we still auto-select something. The order:
1. If `initialIsDraft` is true → **Spec card**.
2. Else if there's a prefill bringing branch/spec data → **Custom card** (preserves the redundant fields).
3. Else if user has any real favorites → first enabled real favorite (existing behavior).
4. Else → **Custom card** (gives user the full form, matching pre-redesign default).

The previous "no favorites → expand customize" branch becomes "no favorites → select Custom card", which produces an equivalent UI.

### Footer button label

| Mode | Button label | Color |
|------|-------------|-------|
| Spec | "Create Spec" | amber |
| Favorite | "Start Agent" or "Start Agents" | blue |
| Custom | "Start Agent" or `${count}× Start Agents` | blue |

(unchanged from current behavior, since label already follows `createAsDraft`)

### Keyboard shortcuts

`⌘1`–`⌘9` already maps to favorites by index. With Spec prepended, ⌘1 = Spec; the user's first real favorite shifts to ⌘2; Custom takes the next index after the last real favorite (capped at 9). This is consistent with how favorites already work — no special-casing.

## Non-Goals

- No new FavoriteCard variant or new shared component. Reuse `FavoriteCard` with appropriate accent color and text.
- No changes to spec persistence backend.
- No changes to how presets/variants are configured in Settings.
- No "Spec template picker" — the Spec card simply creates an empty draft.

## Files to change

| File | Change |
|------|--------|
| `src/components/modals/NewSessionModal.tsx` | Add sentinel constants, prepend/append fixed cards, update `selectFavorite`, gate version dropdown / multi-agent dropdown / customize accordion, update default-selection effect |
| `src/locales/en.json`, `src/locales/zh.json` | Add `quickModeSpec`, `quickModeSpecSummary`, `quickModeCustom`, `quickModeCustomSummary` |
| `src/common/i18n/types.ts` | Add the four keys to `newSessionModal` |
| `src/components/modals/NewSessionModal.test.tsx` | New tests: Spec card creates draft, Custom card shows version dropdown, favorite hides version dropdown |
