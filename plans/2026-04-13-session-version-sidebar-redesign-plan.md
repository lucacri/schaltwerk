# Session Version Sidebar Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the sidebar version group, compact version rows, and consolidation recommendation UI to match `style-guide.pen`.

**Architecture:** Keep the current component boundaries and behavior in `SessionVersionGroup.tsx` and `CompactVersionRow.tsx`. Change markup and theme-variable styles inside those components, and use tests to lock the new design contract.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind utilities, `react-icons/vsc`, existing theme CSS variables.

---

### Task 1: Compact Version Row Tests

**Files:**
- Modify: `src/components/sidebar/CompactVersionRow.test.tsx`

**Step 1: Write failing tests**

Add tests that assert:

- `data-testid="compact-row-accent"` has width `4px`.
- `data-testid="compact-row-version-index"` contains `v2`.
- `data-testid="compact-row-agent-chip"` contains `claude` without the version prefix.
- `data-testid="compact-row-diff-chip"` contains `2f +42 -3`.
- Selected rows use `var(--color-accent-blue-border)` and a blue background.
- `isDimmedForConsolidation` sets the row opacity to `0.55`.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/sidebar/CompactVersionRow.test.tsx`

Expected: FAIL because the new test IDs/structure or dimming prop are not implemented yet.

### Task 2: Version Group Tests

**Files:**
- Modify: `src/components/sidebar/SessionVersionGroup.status.test.tsx`

**Step 1: Write failing tests**

Add or update tests that assert:

- The header toggle exposes `data-testid="version-group-toggle"` and has a chevron child with `data-expanded`.
- The consolidation lane appears only when `consolidation_recommended_session_id` exists on the latest judge.
- The judge recommendation banner text is `Judge recommends claude v2` for the fixture.
- Clicking the banner confirm button calls `onConfirmConsolidationWinner(roundId, recommendedSessionId)`.
- Source rows receive `isDimmedForConsolidation=false` only if their session IDs are in the recommending judge's `consolidation_sources`, or the active judge's sources before a recommendation exists, or match the recommendation, and `true` otherwise.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/sidebar/SessionVersionGroup.status.test.tsx`

Expected: FAIL because the new test IDs, banner button, and dimming prop are not implemented yet.

### Task 3: Implement CompactVersionRow

**Files:**
- Modify: `src/components/sidebar/CompactVersionRow.tsx`

**Step 1: Add the dimming prop**

Add `isDimmedForConsolidation?: boolean` to the props and apply `opacity: 0.55` to the row container when true.

**Step 2: Restructure the row**

Render:

- Accent bar at 4px wide using the agent color scheme.
- Version index column at 52px wide.
- Body column with agent chip and stats chips.
- Right stack with the existing `statusIndicator` and shortcut chip.

**Step 3: Preserve behavior**

Keep selection, keyboard activation, hover callbacks, metadata badges, source dots, and selected actions.

**Step 4: Run focused test**

Run: `bunx vitest run src/components/sidebar/CompactVersionRow.test.tsx`

Expected: PASS.

### Task 4: Implement SessionVersionGroup

**Files:**
- Modify: `src/components/sidebar/SessionVersionGroup.tsx`

**Step 1: Replace inline SVGs**

Import and use `VscChevronRight`, `VscCheck`, and other standard `react-icons/vsc` icons for header/actions.

**Step 2: Update header layout**

Use a single horizontal clickable row with chevron, title, count badge, and right status badge. Keep click-to-expand/collapse.

**Step 3: Update consolidation lane**

Show the violet lane only when the latest judge has a recommendation. Use `var(--color-accent-violet-bg)` and `var(--color-accent-violet-border)`. Put the judge recommendation banner inside it, including the `VscCheck` confirm action.

**Step 4: Add candidate dimming**

Derive candidate IDs from the recommending judge session's `consolidation_sources`, falling back to the active judge while judging is still in progress. Pass `isDimmedForConsolidation` to rows when a judge/recommendation is active and the row is not a source candidate or recommended winner.

**Step 5: Run focused test**

Run: `bunx vitest run src/components/sidebar/SessionVersionGroup.status.test.tsx`

Expected: PASS.

### Task 5: Verification and Review

**Files:**
- No planned edits unless tests or review find issues.

**Step 1: Run focused tests**

Run:

```bash
bunx vitest run src/components/sidebar/CompactVersionRow.test.tsx src/components/sidebar/SessionVersionGroup.status.test.tsx
```

Expected: PASS.

**Step 2: Run full suite**

Run: `just test`

Expected: PASS.

**Step 3: Request code review**

Use the `requesting-code-review` workflow against the implementation diff.

**Step 4: Create squashed commit**

Run:

```bash
git add plans/2026-04-13-session-version-sidebar-redesign-design.md plans/2026-04-13-session-version-sidebar-redesign-plan.md src/components/sidebar/CompactVersionRow.test.tsx src/components/sidebar/SessionVersionGroup.status.test.tsx src/components/sidebar/CompactVersionRow.tsx src/components/sidebar/SessionVersionGroup.tsx
git commit -m "feat: redesign session version sidebar"
```
