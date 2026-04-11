# Style Guide Composed Views Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reusable design molecules plus composed New Session Modal and Agents Sidebar mockups to `design/style-guide.pen`, backed by a regression test that proves those guide assets exist.

**Architecture:** Start with a failing Vitest that parses the `.pen` document. Then add the missing reusable molecules and a new `Composed Views` section in the worktree copy of `design/style-guide.pen` using Pencil operations, verify the output with screenshots, and finally run the full repo validation suite.

**Tech Stack:** Vitest, TypeScript, Pencil MCP `.pen` editing tools, JSON design assets.

---

### Task 1: Add failing regression coverage for the style-guide asset

**Files:**
- Create: `src/style-guide.pen.test.ts`

**Step 1: Write the failing test**

Parse `design/style-guide.pen` and assert:
- reusable nodes named `component/FavoriteCard`, `component/SidebarSectionHeader`, `component/EpicGroupHeader`, and `component/CompactVersionRow` exist
- a top-level frame named `Composed Views` exists
- that section contains visible examples for `New Session Modal` and `Agents Sidebar`

**Step 2: Run the narrow test and watch it fail**

Run:

```bash
bun test src/style-guide.pen.test.ts
```

Expected: the test fails because the new reusable components and composed views are not yet in the asset.

### Task 2: Add the missing reusable design molecules

**Files:**
- Modify: `design/style-guide.pen`

**Step 1: Create placeholder frames for the new reusable components**

Place the new reusable molecules in the component rail below the existing dropdown menu component.

**Step 2: Build the reusable molecules**

Create reusable frames for:
- `component/FavoriteCard`
- `component/SidebarSectionHeader`
- `component/EpicGroupHeader`
- `component/CompactVersionRow`

Use the existing color, typography, badge, button, input, session-card, and dropdown patterns instead of introducing new visual rules.

### Task 3: Build the composed views section

**Files:**
- Modify: `design/style-guide.pen`

**Step 1: Create the top-level placeholder section**

Add a new top-level frame named `Composed Views` below `Cards & Overlays`.

**Step 2: Compose the New Session Modal view**

Use the existing and newly-added reusable components to show the primary flow only:
- name + epic row
- favorite card carousel
- prompt/editor area with `Start From`
- footer with version selector and primary create action

**Step 3: Compose the Agents Sidebar view**

Use the existing and newly-added reusable components to show:
- `Specs` and `Running` headers with counts
- epic grouping
- version grouping
- running, idle, blocked, ready, and spec states
- card metadata and the open context menu
- the top utility bar and orchestrator entry
- the active search rail and results row
- the ungrouped divider
- the epic overflow menu
- the version-group header, action cluster, and consolidation lane

**Step 4: Refresh the session card primitive and examples**

Update `component/SessionCard` and the `SessionCard States` showcase to match the current `SessionCard.tsx` anatomy:
- inline stage/status text instead of the removed reviewed badge
- shortcut badge
- task line
- dirty/ahead/diff chips
- agent + branch metadata row

Remove any exact `Reviewed` label from the style-guide asset.

### Task 4: Verify the design output visually

**Files:**
- Modify: `design/style-guide.pen` if visual fixes are needed

**Step 1: Capture screenshots**

Use Pencil screenshots for the new `Composed Views` section and inspect for clipping, spacing errors, and color mismatches.

**Step 2: Apply any cleanup**

Fix any layout issues discovered in the screenshots, then re-run the screenshots until the section is stable.

### Task 5: Run verification, review, and create one squashed commit

**Files:**
- Modify: `design/style-guide.pen`
- Create: `src/style-guide.pen.test.ts`
- Create: `plans/2026-04-11-style-guide-composed-views-design.md`
- Create: `plans/2026-04-11-style-guide-composed-views-plan.md`

**Step 1: Run the targeted test**

Run:

```bash
bun test src/style-guide.pen.test.ts
```

Expected: pass.

**Step 2: Run the full validation suite**

Run:

```bash
just test
```

Expected: full suite passes.

**Step 3: Review the final diff**

Confirm the asset only adds the intended molecules and composed views, that the regression test is narrow, and that no unrelated files changed.

**Step 4: Create one squashed commit**

Commit the result as a single commit in this worktree.
