# Consolidation Round Stub Report on Candidate Exit - Design

## Problem

A consolidation round stalls when any candidate session reaches a terminal state
(cancelled, converted-to-spec, etc.) without the agent ever calling
`lucode_consolidation_report`. The `all_candidates_reported()` check never goes
true and the judge is never auto-started.

## Spec vs. reality

The spec proposed a dedicated `consolidation_reports` table with rows keyed on
`(round_id, session_name)` and a new `source` column. That table does not exist
in the codebase — reports are stored as columns directly on the `sessions`
table:

- `consolidation_round_id`
- `consolidation_role` (`"candidate"` / `"judge"`)
- `consolidation_report` (Markdown body)
- `consolidation_base_session_id`
- `consolidation_recommended_session_id`
- `consolidation_confirmation_mode`

`all_candidates_reported()` requires every candidate row to have a non-empty
`consolidation_report` **and** a non-empty `consolidation_base_session_id`. The
design must satisfy both invariants for a stub to count as reported.

## Design

### Storage

Add one nullable column to `sessions`:

```sql
ALTER TABLE sessions ADD COLUMN consolidation_report_source TEXT DEFAULT NULL;
```

Values: `NULL` (no report yet), `'agent'` (filed by an agent via
`lucode_consolidation_report`), `'auto_stub'` (auto-filed on candidate exit).

Existing rows get `NULL` on migration. When the MCP handler writes a real
report it sets `'agent'`. When the auto-stub helper writes it sets
`'auto_stub'`. An agent report that arrives after a stub overwrites both the
body and the source back to `'agent'`, which is exactly the existing update
semantics.

### Stub report body

```
## Auto-filed stub report (session exited without filing)

Session `<name>` transitioned to <terminal state> at <UTC timestamp>
without filing a consolidation report.

### Branch diff (git diff --stat <parent>...HEAD)
<output, truncated to ~4KB>

### Commits (git log --oneline <parent>...HEAD)
<output, capped at 20 lines>

_No agent-authored analysis available._
```

Both `git` commands run inside the candidate's still-intact worktree. Errors
(e.g. missing worktree) are swallowed: the stub still gets written, just with a
note that the git state could not be collected.

### `base_session_id` for stubs

`all_candidates_reported()` requires a non-empty `consolidation_base_session_id`.
The stub sets it to the candidate's own session id. Semantically this is "no
explicit preference" — the candidate has no vote to express. Unlike a real
candidate report, the stub path does **not** call
`record_candidate_report_verdict`, so the round's `recommended_session_id` is
untouched and the judge alone decides the winner.

### Trigger points

Two hooks:

1. **Stub write** — inside `SessionManager::cancel_session` and
   `SessionManager::fast_cancel_session`, before the coordinator runs (worktree
   still exists). This covers every cancellation entry point in the codebase:
   direct UI cancel, MCP `lucode_cancel`, auto-cancel siblings after promotion,
   convert-to-spec.

   Preconditions for writing a stub:
   - `consolidation_round_id.is_some()`
   - `consolidation_role == Some("candidate")`
   - `consolidation_report` is empty / missing
   - the round exists and `status != "promoted"`

   If the round has been promoted the helper short-circuits — cleanup cancels
   after a promotion shouldn't file stubs.

2. **Auto-judge trigger** — inside `schaltwerk_core_cancel_session` (the Tauri
   command), in the background task, **after** `finalize_session_cancellation`
   succeeds. Reads the updated round sessions, reuses the existing
   `all_candidates_reported()` check, starts the judge via
   `create_and_start_judge_session` if appropriate. This mirrors what the
   existing `update_consolidation_report` handler does post-insert.

   Other cancel call sites (post-promotion cleanup) do not need to trigger the
   judge because the round is already settled.

### MCP handler (agent-supersedes-stub)

Add a `source: &str` parameter to `update_session_consolidation_report` (both
the repository method and the mcp_api wrapper). `update_consolidation_report`
(the HTTP handler) always passes `"agent"`. The auto-stub path passes
`"auto_stub"`. SQL becomes:

```sql
UPDATE sessions
SET consolidation_report = ?1,
    consolidation_base_session_id = COALESCE(?2, consolidation_base_session_id),
    consolidation_recommended_session_id = COALESCE(?3, consolidation_recommended_session_id),
    consolidation_report_source = ?4,
    ...
```

An agent write after a stub replaces both body and source with agent values —
no special supersede branch needed.

### Idempotency

The stub helper reads the current session row, then skips the write if a
report already exists. Two concurrent cancels of the same session would race,
but `cancel_session` is already serialized by the core write lock; this is not
a new concern.

### Frontend

- Add `consolidation_report_source?: 'agent' | 'auto_stub' | null` to
  `SessionInfo` and the event payload.
- In the consolidation-round UI (`SessionVersionGroup` / judge prompt area),
  render a small "Auto-filed" badge next to candidates whose source is
  `auto_stub`. The existing hover tooltip for the report body is unchanged.
- Vitest snapshot for a round rendered with one agent + one stub candidate.

### Judge prompt

`build_judge_prompt` is unchanged: the stub's body is a real Markdown report,
so the judge sees exactly the same shape of input. The body makes it obvious
the candidate exited without analyzing — the judge can weight accordingly.

## Non-goals

- Wall-clock timeouts for hung rounds.
- Backfill script for pre-existing stuck rounds (manual "Trigger judge" button
  remains).
- Weighting agent reports over stubs in the judge logic.

## Testing

Rust:

1. `ensure_consolidation_stub_report` writes a row with the correct fields and
   `source = 'auto_stub'` for a candidate with no prior report.
2. Same helper is a no-op when the candidate already has an agent report.
3. Same helper is a no-op when the round's status is `"promoted"`.
4. Calling `lucode_consolidation_report` for a session that has a stub replaces
   the body and flips `source` to `'agent'`.
5. End-to-end: round with two candidates; cancel one without a report, file a
   real report for the other; verify the judge session gets created and the
   auto-filed candidate's row has `source='auto_stub'`.

Frontend (vitest):

6. Round panel renders the `Auto-filed` badge when `source='auto_stub'` and
   hides it otherwise.

No timeout-based tests (CLAUDE.md rule).
