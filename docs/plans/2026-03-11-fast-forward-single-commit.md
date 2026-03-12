# Fast-Forward for Single-Commit Sessions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the merge dialog opens and a session has only 1 commit ahead, skip the strategy selector and show a single "Fast-forward" action (reapply mode).

**Architecture:** Add `commits_ahead_count` to `MergePreview` (backend) and both `MergePreviewResponse` interfaces (frontend). The modal hides the mode selector when count is 1, auto-selects reapply, and shows a "Fast-forward" description instead.

**Tech Stack:** Rust (git2 revwalk), TypeScript/React (MergeSessionModal component), i18n (en.json, zh.json, types.ts)

---

### Task 1: Backend — count commits ahead

**Files:**
- Modify: `src-tauri/src/domains/merge/service.rs` (fn `commits_ahead`, fn `preview`, fn `preview_with_worktree`)
- Modify: `src-tauri/src/domains/merge/types.rs` (struct `MergePreview`)

**Step 1: Write failing test**

Add a new test `preview_exposes_commits_ahead_count` in `service.rs` that creates a session with 1 commit and asserts `preview.commits_ahead_count == 1`. Also extend `preview_marks_up_to_date_when_no_commits` to assert count == 0.

**Step 2: Run test to verify it fails**

Run: `cargo nextest run -p lucode preview_exposes_commits_ahead_count`
Expected: compile error — field doesn't exist yet.

**Step 3: Implement**

- Change `commits_ahead()` → `count_commits_ahead()` returning `Result<u32>`. Use `revwalk.count()` instead of `.next().is_some()`.
- Add `pub commits_ahead_count: u32` to `MergePreview` struct.
- In `preview()`: call `count_commits_ahead()`, set the new field, use `count > 0` where `commits_ahead()` was used.
- In `preview_with_worktree()`: count commits between session and parent OIDs via `count_commits_ahead()`, set the new field. Note: this path doesn't use `compute_merge_state` so the count must be computed separately.
- In `compute_merge_state()`: update call from `commits_ahead` → `count_commits_ahead`, check `count == 0` for up-to-date.

**Step 4: Run test to verify it passes**

Run: `cargo nextest run -p lucode preview`

**Step 5: Commit**

---

### Task 2: Frontend — add `commitsAheadCount` to preview types and i18n

**Files:**
- Modify: `src/components/modals/MergeSessionModal.tsx` (interface `MergePreviewResponse`)
- Modify: `src/store/atoms/sessions.ts` (interface `MergePreviewResponse`)
- Modify: `src/common/i18n/types.ts` (add `fastForwardDesc` to `mergeSessionModal`)
- Modify: `src/locales/en.json` (add `fastForwardDesc`)
- Modify: `src/locales/zh.json` (add `fastForwardDesc`)

**Step 1: Add field and i18n string**

- Add `commitsAheadCount: number` to both `MergePreviewResponse` interfaces.
- Add `fastForwardDesc: string` to `mergeSessionModal` in i18n types.
- Add `"fastForwardDesc": "Only one commit — fast-forward the parent branch directly."` to en.json.
- Add equivalent Chinese translation to zh.json.

**Step 2: Run lint**

Run: `bun run lint`

---

### Task 3: Frontend — conditional rendering in MergeSessionModal

**Files:**
- Modify: `src/components/modals/MergeSessionModal.tsx`
- Modify: `src/components/modals/MergeSessionModal.test.tsx`

**Step 1: Write failing tests**

Add tests:
- `hides strategy buttons when commitsAheadCount is 1` — render with preview having `commitsAheadCount: 1`, assert strategy buttons are not rendered and commit message input is absent.
- `shows fast-forward description when commitsAheadCount is 1` — assert fast-forward description text is shown.
- `auto-selects reapply mode and confirms without commit message when commitsAheadCount is 1` — click confirm, assert `onConfirm` called with `'reapply'`.
- `shows strategy buttons when commitsAheadCount > 1` — render with `commitsAheadCount: 3`, assert both buttons visible.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/components/modals/MergeSessionModal.test.tsx`

**Step 3: Implement conditional rendering**

In `MergeSessionModal`:
- Derive `isSingleCommit = preview?.commitsAheadCount === 1`.
- When `isSingleCommit`:
  - Force mode to `'reapply'` via the existing `useLayoutEffect` (set mode when preview loads).
  - Hide the strategy selector buttons and squash description.
  - Show `t.mergeSessionModal.fastForwardDesc` instead.
  - Hide the commit message input (already hidden when mode !== 'squash').
- Update `isCommitMessageMissing` to account for single-commit (no message needed).

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/components/modals/MergeSessionModal.test.tsx`

**Step 5: Commit**

---

### Task 4: Full validation

Run: `just test`
Expected: all green.
