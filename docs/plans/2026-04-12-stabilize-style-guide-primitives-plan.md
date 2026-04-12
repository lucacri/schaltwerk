# Stabilize Style Guide Primitives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Converge the standalone style guide, the live shared primitives, and the Pencil asset around one stable primitive contract for sidebar and new-session modal work.

**Architecture:** Add a dedicated session-oriented primitive-contract section to the standalone style guide using the real shared React components, tighten focused regression tests around anatomy and overlay behavior, and only touch primitive implementations where token or typography usage needs alignment with the documented contract.

**Tech Stack:** React, Jotai, Vitest, Testing Library, Tailwind theme tokens, Pencil `.pen` asset regression tests.

---

### Task 1: Write failing contract tests

**Files:**
- Modify: `src/style-guide/StyleGuide.test.tsx`
- Modify: `src/components/shared/FavoriteCard.test.tsx`
- Create: `src/components/sidebar/EpicGroupHeader.test.tsx`
- Modify: `src/components/inputs/Dropdown.test.tsx`

**Step 1: Write the failing style-guide shell assertions**

Add expectations that the standalone style guide renders a dedicated session/shared primitive contract section and exposes:
- `FavoriteCard`
- `SectionHeader`
- `EpicGroupHeader`
- `SessionCard`
- `CompactVersionRow`
- an explicit overlay menu preview

**Step 2: Run the narrow style-guide test and verify RED**

Run: `bunx vitest run src/style-guide/StyleGuide.test.tsx`

Expected: fail because the contract section does not exist yet.

**Step 3: Tighten primitive contract tests**

- Extend `FavoriteCard` coverage for selected and modified presentation.
- Add `EpicGroupHeader` coverage for count label, collapse toggle, and anchored menu behavior.
- Extend `Dropdown` coverage to prove the backdrop/menu render through `document.body` as an overlay primitive.

**Step 4: Run the focused primitive tests and verify RED**

Run: `bunx vitest run src/components/shared/FavoriteCard.test.tsx src/components/sidebar/EpicGroupHeader.test.tsx src/components/inputs/Dropdown.test.tsx`

Expected: at least the new assertions fail for the missing contract coverage.

### Task 2: Add the standalone contract section

**Files:**
- Create: `src/style-guide/sections/SessionPrimitivesSection.tsx`
- Modify: `src/style-guide/StyleGuide.tsx`

**Step 1: Build a session/shared primitive showcase**

Render the real shared components with stable mock data:
- `FavoriteCard`
- `SectionHeader`
- `EpicGroupHeader`
- `SessionCard`
- `CompactVersionRow`
- dropdown / popup overlay triggers

**Step 2: Keep the contract scoped**

The section should explain that these are shared building blocks for sidebar and new-session composition, not redesigned surfaces.

**Step 3: Re-run the style-guide shell test and verify GREEN**

Run: `bunx vitest run src/style-guide/StyleGuide.test.tsx`

Expected: pass.

### Task 3: Align primitive styling and behavior details where needed

**Files:**
- Modify: `src/components/shared/FavoriteCard.tsx`
- Modify: `src/components/sidebar/EpicGroupHeader.tsx`
- Modify: `src/components/inputs/Dropdown.tsx` if test-driven changes require it

**Step 1: Keep token and typography usage consistent**

Replace any primitive-local typography or color styling that bypasses the shared helpers with the existing token-based helpers already used elsewhere in the app.

**Step 2: Preserve overlay behavior**

Keep dropdown and popup menus as anchored overlays rendered through portals, not inline expansion rows.

**Step 3: Run the focused primitive suite and verify GREEN**

Run: `bunx vitest run src/components/shared/FavoriteCard.test.tsx src/components/sidebar/EpicGroupHeader.test.tsx src/components/inputs/Dropdown.test.tsx`

Expected: pass.

### Task 4: Refresh the parity guard between the browser guide and Pencil guide

**Files:**
- Modify: `src/style-guide.pen.test.ts`
- Modify: `design/style-guide.pen` only if the existing asset no longer matches the agreed contract

**Step 1: Compare the agreed contract against the current `.pen` asset**

Only change the asset if there is a real contract mismatch. Do not redesign the composed views.

**Step 2: Add or adjust the narrow regression checks**

Guard the primitive names or anatomy markers that now define the stabilized contract.

**Step 3: Run the `.pen` regression test**

Run: `bunx vitest run src/style-guide.pen.test.ts`

Expected: pass.

### Task 5: Verify, review, and commit once

**Files:**
- Modify only the files touched above
- Create: `docs/plans/2026-04-12-stabilize-style-guide-primitives-design.md`
- Create: `docs/plans/2026-04-12-stabilize-style-guide-primitives-plan.md`

**Step 1: Run the targeted style-guide and primitive tests**

Run: `bunx vitest run src/style-guide/StyleGuide.test.tsx src/components/shared/FavoriteCard.test.tsx src/components/sidebar/EpicGroupHeader.test.tsx src/components/inputs/Dropdown.test.tsx src/style-guide.pen.test.ts`

Expected: pass.

**Step 2: Run the full repo verification suite**

Run: `just test`

Expected: pass.

**Step 3: Request code review**

Use the review workflow on the final diff before committing.

**Step 4: Create one squashed commit**

Run a single `git commit -m "feat: stabilize style guide primitives"` after verification and review are complete.
