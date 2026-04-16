# Define Task Stages — Design

## Purpose

Replace the four parallel lifecycle representations (`SpecStage`, `SessionState`, `SessionStatus`, `ready_to_merge`) with a single authoritative `Stage` enum. Surface stages as a Kanban board in the UI. Layer two new workflow capabilities on top: a user-initiated forge write-back modal and an autonomous CI auto-fix loop.

## Non-goals

- Mass / batch merge.
- Recursive "judge the judge" consolidation rounds.
- Inbound forge webhook subscriptions.
- Auto-generated forge comments triggered by stage transitions.

## Terminology

| Today                             | New                                           |
| --------------------------------- | --------------------------------------------- |
| `SpecStage::Draft`                | `Stage::Idea`                                 |
| `SpecStage::Clarified`            | `Stage::Clarified`                            |
| `SessionState::Processing`        | `Stage::WorkingOn` (folded in)                |
| `SessionState::Running`           | `Stage::WorkingOn`                            |
| `ready_to_merge = true`           | `Stage::ReadyToMerge`                         |
| `consolidation_role = candidate`/`judge` | rendered under `Stage::JudgeReview`     |
| merged (implicit after merge)     | `Stage::Merged` (persisted, distinct column)  |
| cancelled                         | `Stage::Cancelled` (terminal)                 |

`Archived` remains a separate user-triggered action layered after `Merged`.

## Stage values (ordered)

```rust
pub enum Stage {
    Idea,
    Clarified,
    WorkingOn,
    JudgeReview,
    ReadyToMerge,
    Merged,     // terminal
    Cancelled,  // terminal
}
```

Valid transitions (enforced at the service layer):

```
Idea → Clarified → WorkingOn → JudgeReview → ReadyToMerge → Merged
              ↘                                       ↗
               → WorkingOn                           /
Any non-terminal → Cancelled
WorkingOn ↔ Idea (convert to spec)
```

`JudgeReview` is entered automatically when consolidation is triggered. `ReadyToMerge` is entered via the existing `mark_reviewed` action or via consolidation confirm/auto-promote. `Merged` is written by the merge service on a successful merge. `Cancelled` is set by explicit user cancel.

## Architecture

### Storage strategy (reversible during rollout)

This iteration treats `stage` as a **derived, computed field** on the session DTO rather than a destructive schema rewrite. Existing columns (`status`, `session_state`, `ready_to_merge`, `spec_stage`, `consolidation_role`, `consolidation_round_id`) remain authoritative. A single pure function `derive_stage(session, consolidation_round?) → Stage` is the source of truth, called from:

- `EnrichedSession` / `SessionInfo` builders.
- Any new `stage_of(session_name)` Tauri query.

This choice:

- Eliminates migration risk. No destructive schema change during this phase.
- Keeps the transition reversible: deleting the `stage` derivation removes the feature.
- Lets the Kanban UI consume a single stable field without forcing cross-cutting backend rewrites.

A future phase can collapse the underlying columns into a persisted `stage` column once the taxonomy is field-tested. This is called out explicitly in the plan.

### Derivation function (single source of truth)

```rust
// domains/sessions/stage.rs
pub fn derive_stage(
    s: &Session,
    round: Option<&ConsolidationRound>,
) -> Stage {
    if s.status == SessionStatus::Cancelled { return Stage::Cancelled; }
    if s.merged_at.is_some() { return Stage::Merged; }
    if s.status == SessionStatus::Spec {
        return match s.spec_stage.as_deref() {
            Some("clarified") => Stage::Clarified,
            _ => Stage::Idea,
        };
    }
    if round.map_or(false, |r| r.status == "pending" || s.consolidation_role.is_some()) {
        return Stage::JudgeReview;
    }
    if s.ready_to_merge { return Stage::ReadyToMerge; }
    Stage::WorkingOn
}
```

*Merged* requires a `merged_at` signal — today the session is typically cancelled on merge. A new nullable `merged_at` timestamp is added to the session row to distinguish merged-terminal from cancelled-terminal. Sessions without `merged_at` that are in `SessionStatus::Cancelled` remain `Stage::Cancelled`. This is the one small additive schema change in this phase (additive-only, no destructive rewrite).

### Tauri surface

- New type: `Stage` on `SessionInfo` + serialized as lowercase string (`idea`, `clarified`, `working_on`, `judge_review`, `ready_to_merge`, `merged`, `cancelled`).
- New Tauri command: `schaltwerk_core_list_sessions_by_stage() → Map<Stage, Vec<SessionInfo>>` (convenience for the board view).
- Existing commands continue to return legacy fields — the derived stage is additional.

### UI

**Sidebar `view mode` toggle** at the top of the sidebar (persisted in user settings): `List` (today's behavior) | `Board` (new Kanban).

Board view renders one column per non-terminal stage (`Idea`, `Clarified`, `WorkingOn`, `JudgeReview`, `ReadyToMerge`). `Merged` and `Cancelled` are collapsed into a single "Archive" column at the end, expand on click. Consolidation candidates in `JudgeReview` are grouped visually under their `consolidation_round_id`.

Drag-and-drop is out of scope for this phase. Card clicks continue to select the session.

### Forge write-back modal

Entry point: a new `Post to forge` action button in `SessionActions`. Visible only when the session has an `issue_number`/`issue_url` or a `pr_number`/`pr_url`.

Flow:

1. User clicks `Post to forge`.
2. Modal opens, showing session context (links, branch, summary) and a read-only progress panel: "Generating summary…".
3. Backend command `forge_generate_writeback(session_name) → WritebackDraft` runs: spawns the session's primary agent once with a bounded instruction ("Summarize the change you just made in a short markdown comment suitable for the linked issue/PR. Plain prose, no signatures."). Returns a markdown string.
4. Modal replaces the progress panel with an **editable textarea** prefilled with the draft, plus target selector (issue vs PR when both are present) and a `Post` button.
5. On `Post`, call `forge_comment_on_pr` (for PRs) or a new `forge_comment_on_issue` command (for issues) and close the modal on success.

No auto-posting. No batch posting. Every outbound comment requires an explicit `Post` click.

### CI auto-fix loop

Entry point: a per-session toggle `Auto-fix on CI failure` on the session card's menu. Persisted on the session row as `ci_autofix_enabled: bool`.

Driver: an event-driven watch loop implemented in the backend as a Tauri task spawned per enabled session. The task subscribes to the existing `ForgePrDetailsRefreshed` event (emitted whenever the app fetches PR details — including the existing periodic refresh triggered by the forge tab). No new polling loop is introduced; the watch piggy-backs on existing refresh pathways.

On each refresh, the task compares the pipeline status and session fingerprint (last commit SHA + last restart ID). When a failure is detected:

1. The task checks that no agent is currently processing in the session (quiescent state).
2. It builds a failure-context suffix: `"\n\n---\nCI failed on commit <sha>. Failing jobs: <job-names>. Please inspect and fix."`.
3. It calls `schaltwerk_core_start_session_agent_with_restart` with the suffix appended to the initial prompt.
4. The restart ID is stored to prevent re-triggering on the same failure.

The loop terminates when: CI turns green; the user disables the toggle; the session moves to a terminal stage.

**No automatic forge comment is posted at any point in this loop.** Any outbound comment must go through the manual write-back flow.

## Error handling

- `derive_stage` is total — every legacy state maps to exactly one stage. Unit-tested exhaustively.
- Forge write-back: generation failures surface in the modal with a retry button. Post failures leave the draft intact so the user can edit and retry.
- CI auto-fix: on restart failure, the toggle is left enabled, an error is logged, and the next refresh event retries. After three consecutive restart failures, the toggle auto-disables and a sidebar notice is shown.

## Testing strategy

- `derive_stage`: table-driven unit tests covering every combination of `status`, `session_state`, `spec_stage`, `ready_to_merge`, `consolidation_role`, `merged_at`.
- Board view: component tests using `@testing-library/react` verifying that sessions land in the correct column given an `EnrichedSession[]`.
- Forge write-back: mock `forge_comment_on_pr` + `forge_comment_on_issue`; verify the draft → edit → post flow; verify no post without explicit click.
- CI auto-fix: unit test the watcher against a scripted sequence of pipeline refresh events; verify a single restart per failure, no restart on green, auto-disable after three failures.

## Open questions (deferred)

- Persisting `stage` as a column and dropping the four legacy columns: deferred to a follow-up. The current design ensures the legacy columns stay authoritative during this phase so rollback is trivial.
- Drag-to-reorder stages in the board: deferred.
- Per-epic Kanban filtering: deferred (board initially shows all sessions).
