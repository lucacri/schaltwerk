# Phase 8 — manual smoke checklist (supersedes Phase 7 §B and §A.11)

User-driven verification gate. Phase 8 retired the v1→v2 migration, the
capture-as-task surface, and the kanban toggle, plus added cancel-cascade
UX, confirm-stage trigger, the forge issue badge, the epic picker, and
the TerminalGrid task-shape placeholder. This file pins the deltas;
pre-Phase-8 items in `2026-04-29-task-flow-v2-phase-7-smoke.md` §A still
apply where not contradicted here.

Run against `bun run tauri:dev` with a throwaway project at `/tmp/v2-smoke`.

---

## §A — Phase 8 deltas to the lifecycle smoke

### A.1 Empty-state — sidebar slot order pin

- [ ] Sidebar renders top to bottom: header bar → orchestrator entry →
      search bar → stage sections.
- [ ] No legacy "Sessions" list, no kanban toggle, no capture button.
- [ ] With zero tasks, the empty-state copy reads "No tasks. Create one
      with + New Task." (no other UI in the body).

### A.2 Stage section defaults

- [ ] Cancelled section is collapsed by default.
- [ ] **Done** section is collapsed by default. (NEW in Phase 8 — keeps
      finished work out of the way.)
- [ ] Other six sections (Draft, Ready, Brainstormed, Planned,
      Implemented, Pushed) start expanded.

### A.3 NewTaskModal — epic picker

- [ ] Open "+ New Task". Form has: Name (required), Display name, Base
      branch, Epic, Request body.
- [ ] Epic dropdown defaults to "No epic" and lists existing project
      epics (if any). Selecting "No epic" submits `epicId: null` on the
      wire.
- [ ] Submitting with an epic selected: the task lands in the right
      stage section AND the epic id is reflected in the task's wire
      payload (verify via dev tools or reselect the task).

### A.4 Cancel cascade UX (was bare button in Phase 7)

- [ ] On a non-terminal task row, click Cancel. A confirmation modal
      opens with the body "Cancelling this task will also cancel all of
      its active runs and their slot sessions. Worktrees will be
      removed."
- [ ] When the task has active runs, the modal shows "N active runs
      will be cancelled" (count matches the actually-active runs).
- [ ] When there are zero active runs, that line is omitted.
- [ ] Click "Keep task". Modal closes; nothing is cancelled.
- [ ] Click "Cancel task". The cascade fires. Task moves to Cancelled
      section.

### A.5 Cancel partial-failure retry toast (NEW in Phase 8)

- [ ] If the cascade fails for some sessions (TaskCancelFailed typed
      error), a sticky toast surfaces with the failure detail and a
      "Retry cancel" action button.
- [ ] Toast does NOT auto-dismiss. The user must dismiss or click
      Retry.
- [ ] Clicking "Retry cancel" re-runs the cascade. On success, the
      toast clears and the task moves to Cancelled.

### A.6 Confirm winner + Retry merge toast (NEW in Phase 8)

Prerequisite: a multi-candidate run in `awaiting_selection` state.

- [ ] Click "Confirm winner" on the run. The orchestrator's
      `confirm_stage` fires. On success, the task stage advances and
      the run shows Completed.
- [ ] On `MergeConflict` or `StageAdvanceFailedAfterMerge`, a sticky
      toast surfaces with "Merge failed during confirm" + the failure
      message + a "Retry merge" action button.
- [ ] Toast does NOT auto-dismiss.
- [ ] Clicking "Retry merge" re-attempts the same `confirm_stage`
      call (resolved conflicts will succeed; unresolved ones re-toast).

### A.7 Forge issue badge

- [ ] On a task with `issue_number` set and `issue_url` set: a small
      "#N" badge appears next to the stage badge. It's an anchor; click
      opens the forge URL in a new tab.
- [ ] On a task with `issue_number` set but `issue_url` null: the
      badge renders as a plain (non-link) span.
- [ ] On a task with `issue_number` null: NO badge renders. Confirm
      with the dev tools that `data-testid="task-row-issue-badge"`
      is absent from the row.

### A.8 TerminalGrid task-shape placeholder

- [ ] Click a task header row (kind: 'task' selection). Top pane
      renders a placeholder "No agent running for this task" with copy
      "Start a stage run to spawn agent slots, or click an existing
      slot in the sidebar to view its terminal." Confirm via dev
      tools that `data-testid="task-empty-agent-placeholder"` is
      present.
- [ ] Click a task-run row (kind: 'task-run'). Same placeholder
      renders.
- [ ] Click a slot session under a run (kind: 'task-slot'). The
      session-shape terminal binds to the slot's terminals — top is
      the agent terminal, bottom is the slot's shell. NO
      placeholder.
- [ ] Note: the bottom pane for task / task-run selections is NOT
      yet bound to the task's base-worktree shell — that's a deferred
      item documented in W.5 GAP 3. The placeholder is correct
      behavior for this smoke.

### A.9 v1-only sessions are invisible

Prerequisite: a project that has v1-shape running session rows in
`sessions.db` (e.g. an older project DB that never had the v2
migration applied to it, or a manually inserted row with `task_id =
NULL`, `is_spec = 0`, `is_consolidation = 0`).

- [ ] Open the project. The sidebar renders task stage sections. The
      v1-only session row is **invisible** — no card anywhere on the
      v2 sidebar.
- [ ] Confirm it's still on the wire (dev tools: `allSessionsAtom`
      contains it). The sidebar reads `tasksAtom` exclusively, so the
      v1 leak is structurally invisible.

---

## §B — Sections retired in Phase 8 (do NOT run)

These were specific to Phase 7's cutover-day path. Phase 8 W.3 + W.4
deleted the underlying surfaces.

- ~~§A.11 (Phase 7) — Kanban-disabled UX.~~ Phase 8 W.1 retired the
  toggle entirely. Sidebar has only a list view; there is no Board
  button to test.
- ~~§B (Phase 7) — Migration smoke (v1 → v2).~~ Phase 8 W.4 deleted
  `v1_to_v2_specs_to_tasks` migration. v1 specs are no longer promoted;
  per the user's call, they're left in place and ignored by the v2
  surface. There's nothing to walk.
- ~~§B.7 (Phase 7) — Capture-session.~~ Phase 8 W.3 deleted the right-
  click menuitem AND the bulk-capture button. The `lucode_task_capture_*`
  Tauri commands are gone. There's nothing to walk.

---

## §C — Cross-cutting (Phase 8 invariants)

- [ ] **C.1**: No console errors during the §A walk.
- [ ] **C.2**: No retired symbol references in any rendered DOM. Grep
      dev-tools output for "SidebarSessionList", "EpicGroupHeader",
      "CompactVersionRow", "Capture as Task" — none should appear.
      (Mechanically pinned by `arch_no_v1_session_leakage.test.ts` but
      the smoke walk is the runtime version.)
- [ ] **C.3**: tsc cache discipline: this file is meaningless if the
      build was green via stale cache. Before the user-facing smoke
      walk, verify `rm -f node_modules/.cache/tsconfig.tsbuildinfo &&
      bun run lint:ts` is clean. (Captured in
      `feedback_tsc_incremental_cache_lies.md`.)

---

## On smoke-fail handling

If any §A item fails, file a fail report following the same format as
`2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md`. The Phase 8 close-out
inherits Phase 7's process:

1. Identify the smallest reproducible cause (line + symbol).
2. Determine whether it's a missed gap (W.5 should-have-wired-but-didn't)
   or a fresh regression (something W.6 retire missed).
3. Land a fix + a regression test that fails on revert.
4. Update this checklist row to reflect the fix.

Smoke walk passing is the merge gate. Phase 8 does not auto-merge.
