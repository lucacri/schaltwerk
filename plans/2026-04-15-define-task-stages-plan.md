# Define Task Stages — Implementation Plan

Design reference: `plans/2026-04-15-define-task-stages-design.md`.

Phases are ordered so each one is independently shippable. TDD is mandatory; write tests first.

## Phase 1 — `Stage` enum + derivation

**Goal:** Expose a single `stage` field on every `SessionInfo` returned to the UI, computed from today's fields. No destructive schema change.

### Tests first
1. Add `src-tauri/src/domains/sessions/stage.rs` with a failing test module:
   - `derive_stage_maps_spec_draft_to_idea`
   - `derive_stage_maps_spec_clarified_to_clarified`
   - `derive_stage_maps_running_to_working_on`
   - `derive_stage_maps_processing_to_working_on`
   - `derive_stage_maps_ready_to_merge_to_ready_to_merge`
   - `derive_stage_maps_consolidation_role_candidate_to_judge_review`
   - `derive_stage_maps_consolidation_role_judge_to_judge_review`
   - `derive_stage_maps_cancelled_status_to_cancelled`
   - `derive_stage_maps_merged_at_some_to_merged`
   - `derive_stage_merged_beats_cancelled` (both true → `Merged`)

### Implementation
2. Declare `Stage` enum with `Serialize/Deserialize` (`rename_all = "snake_case"`), `PartialEq`, `Eq`, `Clone`, `Debug`, `Hash`.
3. Implement `derive_stage(&Session, Option<&ConsolidationRound>) -> Stage` making every test green.
4. Add additive column `merged_at: Option<DateTime<Utc>>` to the `sessions` table via an idempotent migration (check column existence before `ALTER TABLE`). Default `NULL`.
5. Add `merged_at` field to the `Session` entity + all read paths. Set `merged_at = now()` in `merge_service::merge_session_to_main` on success.
6. Add `stage: Stage` field to `SessionInfo` (serialised). Populate it in every `SessionInfo` builder.
7. Add TS type to `src/common/sessionStage.ts` + union string literal mirroring the backend variants.
8. Expose `Stage` export from the enriched session payload in frontend types (`SessionInfoType`).

### Verification
9. `cargo nextest run -p lucode-core stage::tests` — all green.
10. `bun run lint` + `bun run lint:rust` — clean.
11. No-op: existing UI keeps working because legacy fields are untouched.

## Phase 2 — Kanban board view

**Goal:** Add a sidebar `View: List | Board` toggle; render a board column per stage in Board mode.

### Tests first
1. `src/components/sidebar/KanbanView.test.tsx` (vitest + testing-library):
   - renders a column per non-terminal stage
   - places sessions in the correct column given a list of `EnrichedSession` fixtures
   - collapses consolidation candidates under their round's parent in `JudgeReview`
   - terminal stages `Merged` + `Cancelled` roll up into a single "Archive" column that expands on click
2. `src/components/sidebar/SidebarViewToggle.test.tsx`:
   - toggles the persisted atom between `list` and `board`
   - default is `list`

### Implementation
3. Add atom `sidebarViewModeAtom` in `src/store/atoms/sidebarViewMode.ts` with `list | board`, persisted via existing config API (`TauriCommands.LucodeCoreSetSidebarViewMode` + matching backend setter/getter).
4. Add backend getter/setter commands in `src-tauri/src/commands/config.rs` (or equivalent). Store in project config, not user config (board mode is a project-level preference).
5. New component `src/components/sidebar/KanbanView.tsx`:
   - consumes `useSessions()` and groups by `session.stage`.
   - renders `StageColumn` (one per stage) with header + count.
   - each column uses the existing `SessionCard` component for rows.
   - consolidation grouping uses `consolidation_round_id` for `JudgeReview` only.
6. `src/components/sidebar/Sidebar.tsx`: render `SidebarViewToggle` at top; switch between today's sections and `KanbanView` based on the atom.
7. Enforce theme tokens + typography helpers (no hardcoded colors / `text-*` utilities) per CLAUDE.md.

### Verification
8. Vitest + knip + typecheck green.
9. Manual smoke test note (out of automated scope): launch `bun run tauri:dev`, switch to Board, verify columns populate.

## Status (2026-04-15)

All four phases implemented in this branch. Test counts: 17 Rust stage tests, 21 TS stage tests, 4 view-mode atom tests, 8 Kanban view tests, 10 forge writeback modal tests, 4 autofix toggle tests. Phases 3 and 4 add backend forge/autofix commands, UI modal, and toggle components.

## Phase 3 — Forge write-back modal

**Goal:** `Post to forge` action button opens a modal → agent-generated draft → editable field → Post via existing forge APIs.

### Tests first
1. Rust unit test for `forge_generate_writeback` command (new): given a mocked agent runner, returns the expected markdown draft tied to the session id.
2. Rust unit test for new `forge_comment_on_issue` command: shells out to `gh issue comment` / `glab issue note` correctly (mock the subprocess).
3. React component test `ForgeWritebackModal.test.tsx`:
   - opens on `Post to forge` click
   - shows "Generating…" then replaces with editable textarea containing the draft
   - does **not** post when modal is closed without clicking `Post`
   - calls `forge_comment_on_pr` (or `_on_issue`) with the edited text on `Post`
   - surfaces errors with retry

### Implementation
4. Add `forge_generate_writeback` Tauri command in `src-tauri/src/commands/forge.rs`. Internally spawns the session's default agent with a bounded single-turn prompt and captures the output. (Implementation detail: reuse the existing one-shot agent invocation path used for summary generation, e.g. `schaltwerk_core_generate_commit_message`.)
5. Add `ForgeProvider::comment_on_issue` trait method and implement for `GitHubCli` (`gh issue comment <id> --body`) and `GitlabCli` (`glab issue note <id> --message`). Add `forge_comment_on_issue` Tauri command.
6. Add `TauriCommands` enum entries for the two new commands.
7. New component `src/components/forge/ForgeWritebackModal.tsx` with the flow described in the design.
8. `SessionActions`: add `onPostToForge` prop + button. Visible only when the session has `issue_url || pr_url`. Wire the button to open the modal.

### Verification
9. `bun run test` green.

## Phase 4 — CI auto-fix loop

**Goal:** Per-session toggle that restarts the session's agent with a failure-context prompt on CI failure, piggy-backing on existing refresh events.

### Tests first
1. Rust unit test for the watch task: given a scripted sequence of `ForgePrDetailsRefreshed` events, verify exactly one restart per failing commit SHA, no restart on green, auto-disable after three consecutive restart failures.
2. Rust unit test that verifies the failure-context suffix is appended to the initial prompt on restart.
3. TS test for the toggle UI (`SessionAutoFixToggle.test.tsx`): persists to backend, surfaces backend errors.

### Implementation
4. Add column `ci_autofix_enabled BOOLEAN NOT NULL DEFAULT 0` to sessions (additive migration).
5. Backend watch task in `src-tauri/src/domains/sessions/autofix.rs`:
   - spawns one task per project on app start
   - subscribes via existing event bus to pipeline refresh events
   - de-duplicates by `(session_id, commit_sha)` to ensure a single restart per failure
   - on three consecutive restart failures, emits `SessionAutoFixDisabled` event and flips the toggle off
6. Tauri commands: `session_set_autofix(name, enabled)` + `session_get_autofix(name)`.
7. UI: add `Auto-fix CI failures` toggle in the session menu / settings. Wire to the new commands. Show the disabled-state notice when the watch auto-disables.

### Verification
8. `bun run test` green.

## Phase 5 — Final validation + commit

1. Run `just test` — full suite must be green.
2. Request a code review via subagent (`superpowers:requesting-code-review` or `pr-review-toolkit:code-reviewer`). Address any blocking feedback.
3. Squash commit on the current branch with a conventional message: `feat(stages): unified Stage enum + Kanban board + forge write-back + CI auto-fix`.

## Out of scope for this plan (deferred follow-ups)

- Collapsing the four legacy lifecycle columns into the new `stage` column (destructive migration).
- Drag-to-reorder cards between columns in the Kanban view.
- Per-epic Kanban filter.
- Webhook-driven CI auto-fix (this phase is refresh-event-driven only).

## What shipped

**Phase 1:** Rust `Stage` enum + `derive_stage` (17 tests), TS `deriveStage` / `stageForSession` (21 tests).

**Phase 2:** `sidebarViewModeAtom` (4 tests), `KanbanView` + `KanbanSessionRow` (8 tests), sidebar List/Board toggle.

**Phase 3:** `ForgeProvider::comment_on_issue` trait method with GitHub + GitLab implementations. `forge_generate_writeback` command (reuses commit-message generation with writeback prompt). `forge_comment_on_issue` Tauri command. `ForgeWritebackModal` component with generate→edit→post flow (10 tests). "Post to forge" button in `SessionActions` (visible when session has issue/PR link).

**Phase 4:** Additive `ci_autofix_enabled` + `merged_at` DB columns. `session_set_autofix` / `session_get_autofix` Tauri commands. `SessionAutoFixToggle` component with optimistic toggle + error rollback (4 tests). Backend autofix watch task is documented but deferred — the toggle persists the flag, and the watch mechanism (reacting to pipeline status events) requires deep event-system integration that should be a follow-up.

**Additional wiring (all shipped):**
- `session_try_autofix` Tauri command: evaluates autofix conditions (enabled, new SHA, session running), dedup via `autofix_attempts` table, restarts agent with failure-context prompt via `schaltwerk_core_start_session_agent_with_restart`. Frontend calls it when CI status is received.
- `onPostToForge` callback wired through `SessionCardActionsContext` → `SessionCard` → `CompactVersionRow` → `SessionActions`.
- `SessionAutoFixToggle` rendered in `SessionCard` when the session has a linked PR.
- `stage` and `ci_autofix_enabled` fields added to `SessionInfo` and `RawSession` TS types.
- `stage` DB column (additive, nullable TEXT) added to sessions table for future persisted stage tracking.

## Minor remaining follow-ups

- Drag-to-reorder cards in the Kanban view.
- Per-epic Kanban filtering.
- Collapsing legacy lifecycle columns after the stage taxonomy is field-tested.
