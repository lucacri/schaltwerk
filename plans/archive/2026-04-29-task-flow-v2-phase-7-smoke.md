# Phase 7 — manual smoke checklists

User-driven verification gates. The Rust e2e at
`src-tauri/tests/e2e_task_lifecycle_full.rs` covers the deterministic
state-transition contract; these checklists cover what the test suite
cannot — feature correctness, layout, copy, keyboard nav, terminal
attach, agent integration. Per the user's standing rule:
> "type checking and test suites verify code correctness, not
>  feature correctness"

Run against `bun run tauri:dev` with a throwaway project at
`/tmp/v2-smoke`. Tick each box during the walk; note any deviation
inline so the next session can attribute it to the right wave.

---

## §A — Lifecycle smoke

Run: `bun run tauri:dev`. Open or create the throwaway project.

### A.1 Empty-state

- [ ] Sidebar renders the eight stage section headers (Draft, Ready,
      Brainstormed, Planned, Implemented, Pushed, Done, Cancelled).
- [ ] When zero tasks exist, the empty-state copy reads:
      "No tasks. Create one with + New Task."
- [ ] The home section's primary creation affordance is "+ New Task"
      (not "Start Agent" / "Create Spec").

### A.2 Task creation

- [ ] Click "+ New Task". The NewTaskModal opens.
- [ ] Required-field validation: empty name disables the submit button
      and (if forced via form submit) shows "Task name is required".
- [ ] Submit with name = `smoke-alpha`, request body = "Brief request",
      base branch = `main`. Modal closes on success.
- [ ] The new task appears in the **Draft** stage section in the sidebar
      with name "smoke-alpha".
- [ ] Stage badge reads "Draft"; no failure-flag badge.

### A.3 Promote to Ready

- [ ] On the smoke-alpha row, click "Promote to Ready" (labeled button,
      not icon-only).
- [ ] Task moves from Draft section into Ready section.
- [ ] Stage badge updates to "Ready".

### A.4 Run Brainstorm with multiple candidates

(Note: stage-run launching with a preset picker is wired in a later
wave. For this smoke, you can simulate a brainstorm run via MCP
`lucode_task_start_stage_run` or skip to A.5 if the preset picker
is not yet on this branch.)

- [ ] After a brainstorm run with 2–3 candidates is started, the
      Run history block under the task row shows one TaskRunRow with
      a "Brainstormed" stage badge and "Running" status.
- [ ] Each slot session appears under the run with its slot label,
      a status badge, and a winner highlight when applicable.
- [ ] All-slots-idle (no judge filed yet) shows the amber nudge banner
      with "All candidates idle. Pick a winner or run the synthesis
      judge."
- [ ] Confirm Winner button is visible and labeled (not icon-only).

### A.5 Confirm winner

- [ ] After confirming a winner:
  - [ ] Run derived status flips to "Completed" (green badge).
  - [ ] Task stage advances to Brainstormed.
  - [ ] Winner slot has a green border / highlight.
  - [ ] Nudge banner is gone.

### A.6 Cancel + reopen

- [ ] On a non-terminal task row, the Cancel button is visible and
      labeled.
- [ ] Click Cancel. Task moves to the **Cancelled** section. Reopen
      button replaces Cancel + stage-action buttons on the row.
- [ ] The previously-completed run history is still visible under the
      task (history preserved across cancel).
- [ ] Click Reopen. Task moves to the Draft section. Run history
      remains. Stage badge reads "Draft".

### A.7 Failure flag visibility

- [ ] If a task row has `failure_flag = true`, a red "⚠ Failed" badge
      renders next to the stage badge.
- [ ] The Cancel button is still visible on a live task with
      failure_flag (failure_flag must NOT hide cancel).

### A.8 Done is terminal

- [ ] When a task reaches Done (Pushed → Done transition), no
      progressing action button renders. Cancel button also hides.
- [ ] The row is read-only at Done.

### A.9 Stage section collapse

- [ ] Each stage section header is clickable; clicking toggles
      collapse.
- [ ] The Cancelled section starts collapsed by default.
- [ ] Other stage sections start expanded by default.
- [ ] Collapse state persists locally during the session (no
      cross-session persistence yet — that's a future polish).

### A.10 Selection drives the right pane

- [ ] Click a task row. The right pane's Spec tab shows the task's
      `current_spec_body` (the request_body for a freshly-created
      task seeds it).
- [ ] Edit the spec body. Click Save. The spec content persists; a
      subsequent click on a different task and back preserves the
      edit.
- [ ] Plan tab edit + save round-trips identically.
- [ ] Summary tab is read-only (no Save button).

### A.11 Kanban-disabled UX (v2 cutover scope cut)

The Board view doesn't render task rows yet — kanban is intentionally
disabled until v2.1. Smoke pins the disabled affordance so a future
agent doesn't silently re-enable it.

- [ ] **A.11.1**: Sidebar header shows the List/Board toggle. Button
      label reads "List · Board v2.1". Hover surfaces a tooltip
      containing the v2.1 message ("Kanban view returns in v2.1 …").
      The button is rendered with disabled state (reduced opacity,
      `aria-disabled="true"`, no hover feedback).
- [ ] **A.11.2**: Click the Board button. Sidebar stays in list mode;
      no kanban surface renders. If the persisted preference was a
      stale `'board'` value, the click forces it back to `'list'`.
- [ ] **A.11.3**: Reload the app (Cmd-R or quit + relaunch). The
      sidebar comes back in list mode regardless of any pre-Phase-7
      `localStorage` value the user might have for `sidebarViewMode`.
      The toggle remains disabled with the same v2.1 tooltip.

---

## §B — Migration smoke (v1 → v2 cutover)

Prerequisites: a backup copy of a v1-shape DB (a `sessions.db` from a
v1-era project that has at least one spec session). Don't run this
against your real production DB — copy it first.

### B.1 Pre-migration check

- [ ] On the v1 DB copy, confirm at least one session exists with
      `is_spec = 1` (or the legacy equivalent), `task_id IS NULL`, and
      non-empty `spec_content`.

### B.2 First-launch migration

- [ ] Open the project in v2. The migration runs invisibly during
      project load.
- [ ] Sidebar Draft section now contains a row for each pre-migration
      spec session. Stage badge reads "Draft".
- [ ] Selecting a migrated task shows the Spec tab populated with the
      original spec content (no truncation, no escape-mangling).
- [ ] The original spec session (if not deleted) is bound to the task —
      its `task_id` column points at the new task id.

### B.3 Idempotency

- [ ] Restart v2 against the same DB. No duplicate tasks appear in the
      Draft section. The migration is a no-op on subsequent launches.

### B.4 Forensics archive

- [ ] Inspect the SQLite DB directly:
      `SELECT COUNT(*) FROM sessions_v1_specs_to_tasks_archive`.
      The count matches the number of migrated specs.
- [ ] Each archive row has `session_id`, `promoted_task_id`,
      `spec_content_was_empty` filled in correctly.

### B.5 Bound-session safety

- [ ] If any session had `task_id` already set before the migration
      (MCP-created tasks, etc.), confirm it's NOT promoted again — no
      duplicate task in the Draft section for that session.

### B.6 Empty-spec edge case

- [ ] If any pre-migration spec had `spec_content = NULL` or empty
      string, the migrated task has no current Spec artifact:
      `SELECT COUNT(*) FROM task_artifacts WHERE task_id = <id>`
      returns 0. The task itself still exists in Draft.

### B.7 Capture-session (cutover-day stragglers)

The migration only promotes spec sessions; standalone non-spec
sessions stay in the legacy session list until the user captures
them. D.1.b ships the per-session and bulk affordances. Smoke pins
both surfaces.

Prerequisites: a project (real or throwaway) with at least one
v1-style standalone session (`is_spec = 0`, `task_id IS NULL`,
`cancelled_at IS NULL`). For B.7.4, a project with **3+** such
sessions.

- [ ] **B.7.1**: Open the project in v2. The standalone session
      renders as a `SessionCard` somewhere in the legacy session list
      (not in any task stage section yet). Confirm the card is
      visible and labeled with the session's display_name (or name).
- [ ] **B.7.2**: Right-click the SessionCard. Context menu opens.
      "Capture as Task" entry appears. Click it. The session
      disappears from the legacy session list and a new Task row
      appears in the appropriate stage section per the captured
      session's run-status (typically Draft for a fresh session;
      verify against `lucode_task_capture_session`'s stage logic for
      a session that already has run history).
- [ ] **B.7.3**: After capture, open dev tools (or wait for the next
      `TasksRefreshed` payload) and confirm the captured session's
      `SessionInfo.task_id` field is now populated with the new
      task's id. (Quickest check: select the captured task; the
      right pane mounts; observe the network/event payload OR
      inspect via `console.log(useAtomValue(allSessionsAtom))` if
      dev tools are wired.)
- [ ] **B.7.4**: With **3+** standalone sessions present, the
      sidebar shows a labeled "Capture N running sessions as tasks"
      button at the top of the stage sections (count reflects the
      actual standalone-session count). Click it. All sessions
      promote sequentially; each appears in the correct stage
      section per its run-status. The button auto-hides once the
      standalone count reaches 0.
- [ ] **B.7.5**: With **zero** eligible standalone sessions
      (everything is task-bound or a spec), the bulk-capture button
      is **not rendered** — neither visible nor disabled-but-present.
      Confirm by reloading the app in a clean state and checking the
      sidebar header area; no error toast, no console warning.

---

## §C — Cross-cutting

- [ ] **C.1**: No console errors during any of the §A or §B walks.
- [ ] **C.2**: Theme switching (light / dark / etc.): all task
      surfaces use CSS vars; no hardcoded colors visible.
- [ ] **C.3**: Empty state, populated state, and migration paths all
      keep `arch_component_size` green (Sidebar.tsx ≤ 500 lines after
      this phase).
- [ ] **C.4**: Bound-session `task_id` field — across every surface
      that shows a session payload (sidebar list, version groups,
      MCP REST debug, network refresh payload), confirm:
      - Sessions captured by D.1.b carry `SessionInfo.task_id` set
        to the new task id.
      - Sessions migrated by D.2 carry `SessionInfo.task_id` set to
        the migrated task id.
      - Standalone sessions still in the legacy list have
        `SessionInfo.task_id` either `null` or omitted (per the
        `#[serde(skip_serializing_if = "Option::is_none")]` on the
        wire shape).
      - The "Capture as Task" right-click affordance is hidden on
        any session whose `task_id` is set (D.1.b eligibility guard).

---

## How to use this checklist

1. Walk every box in order. Do not skip.
2. Mark `[x]` for pass, `[FAIL]` for fail with a one-line note.
3. Any FAIL is a Phase 7 bug — fix before close-out, not "post-phase
   polish" (per `feedback_no_preexisting_excuse_taskflow.md`).
4. When all boxes pass, Phase 7 is shippable. Update the status doc.
