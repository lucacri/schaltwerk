# Multi-Agent Consolidation Redesign Design

**Context**

The current consolidation flow already has the right base primitives for promotion: consolidation sessions are marked with `is_consolidation`, they point at source versions via `consolidation_sources`, and `lucode_promote` can transplant the winning consolidation onto a chosen source branch. What it lacks is durable reasoning, a way to run more than one consolidation candidate for the same source set, and a durable recommendation/confirmation phase before promotion.

**Approaches**

1. **Keep a single consolidation session and only persist the report**
   Add `consolidation_report` and leave the rest of the flow unchanged.
   Trade-off: fixes the missing audit trail, but does not satisfy the multi-agent or judge requirements.

2. **Add a separate consolidation round model and keep reports on sessions** (recommended)
   Keep `version_group_id`, `is_consolidation`, and `consolidation_sources`, but add session fields that identify the consolidation round, the session's role in that round, its durable report, and any selected base/recommended winner. Add a small `consolidation_rounds` table for round-level confirmation mode and state.
   Trade-off: more moving parts than a pure session-only model, but it keeps round state explicit and avoids overloading a single session with shared mutable state.

3. **Store everything only on sessions without a round table**
   Use `consolidation_round_id` to group sessions and infer round state from the latest judge session.
   Trade-off: fewer schema objects, but confirmation mode, recommendation freshness, and "current round state" become indirect and brittle.

**Decision**

Take approach 2.

The redesign will keep the current source-version and promotion model intact while layering a round abstraction on top:

- Source versions stay grouped by `version_group_id`.
- Every consolidation candidate and judge session still uses `is_consolidation = true` and keeps `consolidation_sources` populated.
- A new `consolidation_round_id` links all sessions that belong to the same consolidation round.
- A new `consolidation_role` distinguishes candidate sessions from judge sessions.
- A new `consolidation_report` persists the candidate or judge reasoning.
- Candidate sessions persist their chosen source-base as `consolidation_base_session_id`.
- Judge sessions persist their recommendation as `consolidation_recommended_session_id`.
- A new `consolidation_rounds` table stores round-level confirmation mode and lifecycle state so the UI and MCP tools do not need to infer it from ad hoc session scans.

**Round Lifecycle**

1. User launches consolidation from a version group.
2. Lucode creates one round row plus `N` candidate consolidation sessions in separate worktrees.
3. Each candidate agent compares the source versions, implements its preferred consolidation in its own worktree, and writes a structured `consolidation_report` plus `consolidation_base_session_id` before it is considered complete.
4. When all candidates have reports, Lucode auto-triggers judge creation by default. The user may also trigger the judge early or re-trigger it later while the round is still unconfirmed.
5. Each judge run creates a new judge session in the same round and writes a judge `consolidation_report` plus `consolidation_recommended_session_id`.
6. In `confirm` mode, the UI surfaces the latest recommendation and lets the user confirm or override the candidate winner.
7. In `auto-promote` mode, the latest judge recommendation is confirmed immediately after the judge files its report.
8. Confirmation promotes the chosen candidate through the existing `lucode_promote` path using the candidate's `consolidation_base_session_id`, then auto-cancels the losing candidate sessions and marks the round confirmed.

**Session And Round Data**

Add to `sessions`:

- `consolidation_round_id TEXT NULL`
- `consolidation_role TEXT NULL` with values `candidate` or `judge`
- `consolidation_report TEXT NULL`
- `consolidation_base_session_id TEXT NULL`
- `consolidation_recommended_session_id TEXT NULL`

Add `consolidation_rounds`:

- `id TEXT PRIMARY KEY`
- `repository_path TEXT NOT NULL`
- `version_group_id TEXT NOT NULL`
- `confirmation_mode TEXT NOT NULL` with values `confirm` or `auto-promote`
- `status TEXT NOT NULL` with values `running`, `awaiting_confirmation`, `promoted`
- `source_session_ids TEXT NOT NULL` as JSON
- `recommended_session_id TEXT NULL`
- `recommended_by_session_id TEXT NULL`
- `confirmed_session_id TEXT NULL`
- `confirmed_by TEXT NULL` with values `judge` or `user`
- timestamps

The round row is the single source of truth for confirmation mode and the current recommendation. The per-session report fields remain the durable audit trail for candidate and judge reasoning.

**Backend Surface**

Add explicit consolidation round APIs instead of overloading `lucode_promote`:

- `create_consolidation_round(...)`
  Creates the round and candidate sessions. Existing single-session `create_session` stays intact.
- `update_consolidation_report(session_name, report, base_session_id?, recommended_session_id?)`
  Persists durable reasoning for candidates and judges.
- `trigger_consolidation_judge(round_id, force=false, early=false)`
  Creates a judge session with a prompt built from the candidate reports and sources.
- `confirm_consolidation_winner(round_id, winner_session_id, override_reason?)`
  Promotes the chosen candidate via the existing promotion logic and cancels losing candidates.

`lucode_promote` remains public and backward-compatible. The new confirmation API becomes the preferred entry point for multi-agent consolidation rounds.

**Frontend Shape**

- Extend `SessionInfo` with the new round/report fields and add a `ConsolidationRoundSummary` type for round-level state.
- Replace the current "only one consolidation session" assumption in `sessionVersions.ts` and `SessionVersionGroup.tsx` with a grouped display:
  - source versions
  - consolidation rounds
  - candidate sessions within each round
  - latest judge recommendation / confirm action
- Extend the consolidation launch flow so the existing new-session modal can launch multi-agent consolidation and choose confirmation mode per round.
- Add group-level actions to trigger judge runs early or re-trigger them.
- Surface durable reports and the latest recommendation in the selected `SessionCard` and in the version-group round summary.

**Prompt And MCP Workflow Changes**

- Candidate consolidation prompts must instruct agents to write `consolidation_report` and `consolidation_base_session_id` instead of calling `lucode_promote` themselves.
- Judge prompts must instruct the judge agent to compare candidate reports/diffs and write a judge report plus `consolidation_recommended_session_id`.
- The shared consolidate skill and MCP tool descriptions must describe the round-based flow and keep the current single-agent promotion path valid as the compatibility fallback.

**Testing**

- Rust schema/db tests for new session and round persistence.
- Rust API tests for round creation, report completion, judge triggering, confirm-mode confirmation, auto-promote confirmation, and loser cancellation.
- TypeScript tests for session/round hydration and sidebar rendering with multiple consolidation rounds.
- UI tests for confirmation-mode controls, judge actions, and recommendation display.
- MCP server tests for the new tool schemas and bridge methods.
