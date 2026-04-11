# Remove Restart Terminals Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the manual `Restart terminals` buttons from the session UI while keeping backend and toast-driven restart recovery intact.

**Architecture:** Remove the button render paths in the shared session actions and diff actions components, then delete the now-unused sidebar action plumbing that existed only to feed those buttons. Keep the restart command available for internal recovery flows.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri invoke commands

---

### Task 1: Write the failing UI regression tests

**Files:**
- Modify: `src/components/diff/DiffSessionActions.test.tsx`
- Modify: `src/components/session/__tests__/SessionActions.test.tsx`

**Step 1: Write the failing test**

Change the diff-actions expectations so the restart button is absent, and add a session-actions test that passes `onRestartTerminals` but still expects no restart button.

**Step 2: Run test to verify it fails**

Run: `bun vitest src/components/diff/DiffSessionActions.test.tsx src/components/session/__tests__/SessionActions.test.tsx`

Expected: FAIL because the current UI still renders the restart button.

### Task 2: Remove the manual restart-terminal button surfaces

**Files:**
- Modify: `src/components/diff/DiffSessionActions.tsx`
- Modify: `src/components/session/SessionActions.tsx`

**Step 1: Write minimal implementation**

Delete the restart button render path from both components and remove any now-unused imports or callback code that existed only for the manual buttons.

**Step 2: Run targeted tests to verify they pass**

Run: `bun vitest src/components/diff/DiffSessionActions.test.tsx src/components/session/__tests__/SessionActions.test.tsx`

Expected: PASS

### Task 3: Remove now-unused sidebar action plumbing

**Files:**
- Modify: `src/contexts/SessionCardActionsContext.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/sidebar/SessionCard.tsx`
- Modify: `src/components/sidebar/CompactVersionRow.tsx`
- Modify: `src/components/sidebar/SessionCard.test.tsx`
- Modify: `src/components/sidebar/CompactVersionRow.test.tsx`
- Modify: `src/components/sidebar/__tests__/SessionCard.busy.test.tsx`
- Modify: `src/components/sidebar/SessionVersionGroup.status.test.tsx`

**Step 1: Remove the unused action wiring**

Delete the `onRestartTerminals` action from the shared sidebar context and from the props passed into `SessionActions`.

**Step 2: Update tests and typed mocks**

Remove the obsolete mock action field from the sidebar tests so TypeScript and the test suite stay consistent with the new context shape.

**Step 3: Run focused validation**

Run: `bun vitest src/components/diff/DiffSessionActions.test.tsx src/components/session/__tests__/SessionActions.test.tsx src/components/sidebar/SessionCard.test.tsx src/components/sidebar/CompactVersionRow.test.tsx src/components/sidebar/__tests__/SessionCard.busy.test.tsx src/components/sidebar/SessionVersionGroup.status.test.tsx`

Expected: PASS

### Task 4: Run full verification

**Files:**
- Verify only

**Step 1: Run the full project validation suite**

Run: `just test`

Expected: PASS with exit code 0.

### Task 5: Review and commit

**Files:**
- Review current diff only

**Step 1: Inspect the final diff**

Run: `git diff -- docs/plans/2026-04-11-remove-restart-terminals-button-design.md docs/plans/2026-04-11-remove-restart-terminals-button-plan.md src/components/diff/DiffSessionActions.tsx src/components/diff/DiffSessionActions.test.tsx src/components/session/SessionActions.tsx src/components/session/__tests__/SessionActions.test.tsx src/contexts/SessionCardActionsContext.tsx src/components/sidebar/Sidebar.tsx src/components/sidebar/SessionCard.tsx src/components/sidebar/CompactVersionRow.tsx src/components/sidebar/SessionCard.test.tsx src/components/sidebar/CompactVersionRow.test.tsx src/components/sidebar/__tests__/SessionCard.busy.test.tsx src/components/sidebar/SessionVersionGroup.status.test.tsx`

Expected: Only the planned restart-button UI removals, test updates, and workflow docs are present.

**Step 2: Create a single squashed commit**

Run: `git add <files>` then `git commit -m "refactor: remove restart terminals button"`

Expected: One commit containing the finished change.
