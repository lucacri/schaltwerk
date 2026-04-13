# Relocate Merge Checks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move per-check merge readiness details from the agents sidebar into the diff side panel.

**Architecture:** Extract the readiness list into a small presentational React component, remove sidebar callers from the data path, and expose diff side-panel content from `DiffSessionActions` through the existing render-prop pattern. Keep the backend and i18n strings unchanged.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing theme CSS variables and i18n.

---

### Task 1: Write Failing Relocation Tests

**Files:**
- Modify: `src/components/session/__tests__/SessionActions.test.tsx`
- Modify: `src/components/diff/DiffSessionActions.test.tsx`

**Step 1: Add the sidebar regression test**

Add a test under `SessionActions - Running state` that renders `SessionActions` with `readinessChecks` and asserts `screen.queryByText('Merge checks')` is absent.

**Step 2: Add the diff panel positive test**

Add a test to `DiffSessionActions.test.tsx` that creates a session with `ready_to_merge_checks`, renders the new side-panel render prop, and expects `Merge checks`, `Worktree exists`, and `No uncommitted changes`.

**Step 3: Add the diff panel non-session test**

Add a test to `DiffSessionActions.test.tsx` that renders the same checks with `isSessionSelection={false}` and expects `Merge checks` to be absent.

**Step 4: Run tests to verify red**

Run:

```bash
bun vitest src/components/session/__tests__/SessionActions.test.tsx src/components/diff/DiffSessionActions.test.tsx
```

Expected: tests fail because `SessionActions` still renders the block and `DiffSessionActions` does not yet provide side-panel content.

### Task 2: Extract the Readiness Check Component

**Files:**
- Create: `src/components/session/MergeReadinessChecks.tsx`
- Modify: `src/components/session/SessionActions.tsx`

**Step 1: Create `MergeReadinessChecks`**

Move the existing check label mapping and list UI out of `SessionActions`. The component should accept `checks?: SessionReadyToMergeCheck[]`, return `null` for empty input, and use the existing `sessionActions` i18n keys.

**Step 2: Remove sidebar rendering from `SessionActions`**

Remove the `readinessChecks` prop from `SessionActionsProps`, its destructuring, and the JSX branch that rendered the block.

**Step 3: Run targeted tests**

Run:

```bash
bun vitest src/components/session/__tests__/SessionActions.test.tsx src/components/diff/DiffSessionActions.test.tsx
```

Expected: `SessionActions` regression passes; diff tests still fail until the new location is wired.

### Task 3: Render Checks in the Diff Side Panel

**Files:**
- Modify: `src/components/diff/DiffSessionActions.tsx`
- Modify: `src/components/diff/DiffFileExplorer.tsx`
- Modify: `src/components/diff/UnifiedDiffView.tsx`
- Modify: `src/components/diff/DiffSessionActions.test.tsx`

**Step 1: Extend `DiffSessionActions` render props**

Add a `sidePanelContent: ReactNode` field. Populate it with `MergeReadinessChecks` when `isSessionSelection` is true and `targetSession?.info.ready_to_merge_checks` has content.

**Step 2: Extend `DiffFileExplorer`**

Add an optional `footerContent?: ReactNode` prop and render it in a bottom panel block when provided.

**Step 3: Wire `UnifiedDiffView`**

Pass `sidePanelContent` from `DiffSessionActions` into the session-mode `DiffFileExplorer` only.

**Step 4: Run targeted tests**

Run:

```bash
bun vitest src/components/session/__tests__/SessionActions.test.tsx src/components/diff/DiffSessionActions.test.tsx
```

Expected: both targeted tests pass.

### Task 4: Verify and Review

**Files:**
- All changed files

**Step 1: Run full validation**

Run:

```bash
just test
```

Expected: full validation succeeds.

**Step 2: Request code review**

Use the requesting-code-review workflow against the final diff.

**Step 3: Address review findings**

Fix any Critical or Important findings, rerun the relevant targeted tests and `just test`.

**Step 4: Create a squashed commit**

Stage all intended files and commit once:

```bash
git add plans/2026-04-13-relocate-merge-checks-design.md plans/2026-04-13-relocate-merge-checks-plan.md src/components/session/__tests__/SessionActions.test.tsx src/components/diff/DiffSessionActions.test.tsx src/components/session/MergeReadinessChecks.tsx src/components/session/SessionActions.tsx src/components/diff/DiffSessionActions.tsx src/components/diff/DiffFileExplorer.tsx src/components/diff/UnifiedDiffView.tsx
git commit -m "feat(diff): move merge checks to diff panel"
```
