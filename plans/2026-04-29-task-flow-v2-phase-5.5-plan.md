# task-flow v2 — Phase 5.5 plan: hydrator wiring-gap interlude

**Status:** draft (audit-first; executing immediately)
**Branch:** `task-flow-v2`
**Phase:** 5.5 of 6 (interlude before Phase 6)
**Design:** [`2026-04-29-task-flow-v2-design.md`](./2026-04-29-task-flow-v2-design.md)
**Status doc:** [`2026-04-29-task-flow-v2-status.md`](./2026-04-29-task-flow-v2-status.md)

## Goal

Close the hydrator wiring gap surfaced in Phase 5: `get_session_by_id`'s
SELECT excludes 6 fact columns, so any caller that hydrates through it
reads `None` for state Phase 5 just started writing. Apply
`feedback_compile_pins_dont_catch_wiring.md` discipline: every fix is
paired with a DB round-trip test that proves the production write path
agrees with the production read path.

Prerequisite of Phase 6 (Sidebar split): rendering layer reads sessions
to draw badges; data-layer drift would surface as wrong UI badges. Fix
the data layer first so Phase 6's debugging stays in the rendering
layer alone.

## Audit results

Grep query: `fn row_to_\|fn .*from_row\|fn hydrate`. Audited 13 hydrators
across 4 modules. Result:

### Broken (Phase 5.5 Wave B–D fixes)

| # | Hydrator | Location | Bug | Affected callers |
|---|---|---|---|---|
| 1 | `get_session_by_id` (inline lambda) | `db_sessions.rs:540` | SELECT excludes 6 fact columns; lambda hardcodes them to `None` | 66 production call sites (counted in Phase 5) |
| 2 | `get_session_by_name` (inline lambda) | `db_sessions.rs:450` | Same pattern | At least 1 production caller (`SessionManager::get_session_by_name`) |
| 3 | `hydrate_session_summaries` | `db_sessions.rs:259` | Builds `Session` from `SessionSummaryRow` and hardcodes 6 facts to `None` | `list_sessions` (704), `list_sessions` cancelled-filter (784), `list_sessions_by_state` (949) |

The 6 missing fact columns: `task_run_id`, `run_role`, `slot_key`,
`exited_at`, `exit_code`, `first_idle_at`. All added in Phase 1 via
`alter_add_column_idempotent`; the ALTER lands but the hydrators were
never updated.

### Clean (no fix needed)

| # | Hydrator | Note |
|---|---|---|
| 4 | `row_to_session_with_facts` (`db_sessions.rs:1431`) | Pulls all session columns. Used by `get_sessions_by_task_run_id`. The "good" hydrator. |
| 5 | `row_to_epic` | Epic struct is a subset of the table by design (entity doesn't carry `repository_path`/timestamps) |
| 6 | `row_to_spec` | 22 columns ↔ 22-field struct. Complete. |
| 7 | `consolidation_round_from_row` | 12 columns ↔ 12-field struct. Complete. |
| 8 | `row_to_task` | 24 columns (incl. `cancelled_at`) ↔ Task struct. `task_runs: Vec::new()` populated by callers. Complete. |
| 9 | `row_to_task_run` | 17 columns ↔ 17-field struct. Complete. |
| 10 | `row_to_task_stage_config` | 4 columns ↔ 4-field struct. Complete. |
| 11 | `row_to_project_workflow_default` | 4 columns ↔ 4-field struct. Complete. |
| 12 | `row_to_task_artifact` | 12 columns ↔ 12-field struct. Complete. |
| 13 | `row_to_task_artifact_version` | 7 columns; `is_current` intentionally hardcoded `false` with documented rationale ("populated only when joined; the version table itself has no is_current"). Acceptable. |

### Partial reads (intentional, not hydrators)

`get_session_task_content`, `get_session_task_lineage`,
`find_session_for_task_run`, `list_sessions_for_task_run` all return
sub-projections (not full `Session`). Out of scope.

## Fix strategy

**Single source of truth.** The 3 broken sites all build `Session`
objects, and `row_to_session_with_facts` already does this correctly.
The fix is to **delete** the inline lambdas in `get_session_by_id` and
`get_session_by_name`, extend their SELECTs to match
`row_to_session_with_facts`'s column list, and switch to the shared
helper. For `hydrate_session_summaries`, extend `SessionSummaryRow` +
the SELECTs in its 3 callers to include the 6 fact columns, and
populate them in the build block instead of hardcoding `None`.

**Why merge into the shared helper rather than fix the lambdas in
place:** the inline lambdas are exactly how the bug accumulated in the
first place — the column list was duplicated, then drift happened. A
single hydrator function pinned by structural reuse is the right shape.

## Wave plan

### Wave A — plan (this commit)

Already written. Audit + strategy documented above.

### Wave B — `get_session_by_id` uses `row_to_session_with_facts`

**Files:**
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs:527-611` (`get_session_by_id`)
  - Replace SELECT column list to match `row_to_session_with_facts`.
  - Delete the inline lambda; pass `row_to_session_with_facts` as the row-mapper.
- Add 1 DB round-trip test in `db_sessions.rs::tests`:
  - `get_session_by_id_round_trips_fact_columns` — write a session via the production write path with non-default values for `task_run_id` (via `set_session_task_lineage`), `exit_code` (via `set_session_exited_at`), `first_idle_at` (via `set_session_first_idle_at`); read back via `get_session_by_id`; assert each column round-trips.

**Step 1: Red — write the round-trip test against current behavior.**

Expected: FAIL because `get_session_by_id` returns `first_idle_at: None` regardless of what's written.

**Step 2: Green — switch to `row_to_session_with_facts`.**

**Step 3: Run scoped tests.**

```bash
just test-single src-tauri/src/domains/sessions/db_sessions.rs
```

**Step 4: Commit.**

### Wave C — `get_session_by_name` uses `row_to_session_with_facts`

Same shape as Wave B but for the by-name lookup.

**Files:**
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs:438-525` (`get_session_by_name`)
- Add 1 DB round-trip test: `get_session_by_name_round_trips_fact_columns`.

### Wave D — `hydrate_session_summaries` carries facts

**Files:**
- Modify: `SessionSummaryRow` struct (line 212) — add 6 fact fields.
- Modify: `hydrate_session_summaries` (line 259) — populate facts from the row instead of hardcoding `None`.
- Modify: 3 call-site SELECTs to include the 6 fact columns and read them into `SessionSummaryRow`:
  - `list_sessions` (`db_sessions.rs:647`)
  - `list_sessions` cancelled-filter (`db_sessions.rs:727`)
  - `list_sessions_by_state` (`db_sessions.rs:887`)
- Add 1 DB round-trip test: `list_sessions_by_state_round_trips_fact_columns` — covers the most-used path; the other two callers share the same hydrator so this single test is load-bearing for all three.

### Wave E — architecture test for hydrator completeness

**Files:**
- Add: `src-tauri/tests/arch_hydrator_completeness.rs`
  - Approach: per-table runtime check using SQLite `PRAGMA table_info(<table>)` against an in-memory fresh DB.
  - For each known entity table (`sessions`, `tasks`, `task_runs`, `task_artifacts`, `specs`, `epics`, `consolidation_rounds`), assert the column count from the schema matches the hydrator's expected count — encoded as a `const N: usize` next to the hydrator.
  - **If too invasive** (e.g. column-count consts are too brittle, or schema introspection complicates the test): document and skip in the plan + commit message. The key load-bearing protection is the DB round-trip tests added in Waves B–D; the arch test is belt-and-suspenders.

### Wave F — status doc + memory update

- Mark Phase 5.5 complete in status doc.
- Update `feedback_compile_pins_dont_catch_wiring.md` with the Phase 5.5 audit lesson: hydrator inline lambdas duplicate the column list and drift; prefer a single shared hydrator function.

## Definition of done

| Criterion | How verified |
|---|---|
| `just test` green | full validation |
| `get_session_by_id` returns the 6 fact columns | `get_session_by_id_round_trips_fact_columns` |
| `get_session_by_name` returns the 6 fact columns | `get_session_by_name_round_trips_fact_columns` |
| `list_sessions_by_state` returns the 6 fact columns | `list_sessions_by_state_round_trips_fact_columns` |
| 0 inline `\|row\| Ok(Session { … })` blocks in `db_sessions.rs` | grep |
| `arch_domain_isolation` and `arch_layering_database` green | part of `just test` |
| Status doc Phase 5.5 row `[x]` | manual check |

## Out of scope

- Fixing `row_to_task_artifact_version`'s `is_current = false` hardcode (intentional with documented rationale).
- Adding fact columns to `SessionInfo` wire format (Phase 6 may surface them via the new sidebar; out of scope for the data-layer fix).
- Migrating `get_sessions_by_task_run_id`'s SELECT (already correct; left as the canonical reference).
