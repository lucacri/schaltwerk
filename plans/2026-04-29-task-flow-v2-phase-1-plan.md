# task-flow v2 — Phase 1 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the v2 task-runs surface on the `task-flow-v2` branch with `TaskRunStatus` derived from observable session facts — never persisted as a column. Ship a one-shot user-DB migration so a v1 user landing on v2 keeps their task-run history.

**Architecture:** Greenfield port of the v1 runs surface from `task-flow@b1f38f63` into v2 with the v2 design baked in from the start. Two parallel deliverables: (a) v2 schema/entities/services with no `task_runs.status` column; (b) a one-shot migration that translates legacy v1 rows on first v2 launch. The derived getter `compute_run_status` is a pure function over `(TaskRun, Vec<Session>)` — no global registry, no `OnceCell` dispatcher, no async↔sync bridging. Terminal/lifecycle code writes session-row facts (`exited_at`, `exit_code`, `first_idle_at`) directly via project-scoped service handles.

**Tech Stack:** Rust + Tauri (`src-tauri/`), SQLite via `rusqlite`, the existing `apply_*_migrations` pattern in `infrastructure/database/db_schema.rs`, RAII test cleanup, `cargo nextest`.

---

## 0 — Scope clarifications resolved before this plan

The design doc's Phase 1 ("add column → backfill → drop column") was written in user-DB-migration semantics but read like code-evolution semantics. This plan separates the two streams cleanly:

- **Stream A — code evolution.** The v2 schema is born without `task_runs.status`. The `TaskRun` entity has no `status` field. `compute_run_status()` is the only producer of the enum; the enum lives in memory and on the wire to the UI but is never persisted.
- **Stream B — user-DB migration.** A one-shot translation that runs on first launch of v2 against any SQLite DB that still has the legacy `status` column. Its job: populate `cancelled_at` / `confirmed_at` / `failed_at` from legacy `status` rows, archive the original table, then drop `status` via the SQLite table-rebuild dance.

The two streams share a schema target but are otherwise independent. Stream A delivers Phase 1's design intent; Stream B is the legacy carrier.

**Cross-domain wiring approach (per design §9):** No `OnceCell` dispatcher, no `TaskRunFailureRecorder` trait, no `AwaitingSelectionDeps` trait. The terminal layer holds a project-scoped `Arc<SessionFactsRecorder>` and writes session-row facts directly. The "is idle" projection is `session.first_idle_at: Option<i64>` — write-once at the first idle event, never overwritten on later transitions. That gives AwaitingSelection stickiness for free without persisting a sticky status flag, and the column name itself reminds future readers not to introduce a "latest idle" semantic.

**Legacy `failed` rows.** Per your guidance, v2 schema includes `task_runs.failed_at: Option<i64>` specifically as a legacy carrier. Migration populates it for v1 rows where `status='failed'`. v2-native runs derive Failed from session `exit_code`; nothing writes `failed_at` after the migration.

**What we deliberately defer (Phases 2–6):**
- Per-task mutex (Phase 2). Phase 1 uses the existing `Arc<RwLock<SchaltwerkCore>>` pattern that's already on `main`.
- `RunRole` is ported verbatim (it's a column we'll need until Phase 3 collapses it to `slot_key`).
- `SessionState` / `SessionStatus` stay v1-shaped (Phase 3).
- `TaskFlowError` (Phase 4); commands return `anyhow::Result` for now.
- Explicit `lucode_task_run_done` MCP tool (Phase 5).
- `Sidebar.tsx` split (Phase 6); no UI work in Phase 1 at all.

---

## 1 — End-state schema delta (target after Phase 1)

### `task_runs` (new table on v2; **never** has `status`)

```
id                     TEXT PK
task_id                TEXT NOT NULL  FK→tasks(id) ON DELETE CASCADE
stage                  TEXT NOT NULL
preset_id              TEXT NULL
base_branch            TEXT NULL
target_branch          TEXT NULL
selected_session_id    TEXT NULL
selected_artifact_id   TEXT NULL
selection_mode         TEXT NULL
started_at             INTEGER NULL
completed_at           INTEGER NULL
cancelled_at           INTEGER NULL    -- NEW
confirmed_at           INTEGER NULL    -- NEW
failed_at              INTEGER NULL    -- NEW; legacy carrier only
failure_reason         TEXT NULL
created_at             INTEGER NOT NULL
updated_at             INTEGER NOT NULL
```

XOR invariant remains on `(selected_session_id, selected_artifact_id)`.

### `tasks` (port from v1 verbatim — same columns as the baseline doc §1)

We carry every v1 column (including `task_host_session_id`, `task_branch`, `failure_flag`, etc.). Phase 1 doesn't transform tasks; it gives the runs surface a `task_id` to FK against.

### `task_artifacts` (port from v1 verbatim)

Same shape as baseline. Phase 4 makes `current_*` derived getters; Phase 1 keeps the denormalized columns on `tasks`.

### `sessions` (ALTER existing table on v2)

Add the task-linkage columns ported from v1 (`task_id`, `task_run_id`, `task_stage`, `task_role`, `run_role`, `slot_key`, `task_branch`) **and** the new fact columns Phase 1 needs:

```
exited_at       INTEGER NULL    -- NEW; when PTY exited (NULL = still alive)
exit_code       INTEGER NULL    -- NEW; PTY exit code (NULL if no code captured)
first_idle_at   INTEGER NULL    -- NEW; FIRST-time-idle stamp (write-once, never overwritten)
```

Why these three columns are sufficient:

| Derived predicate | Computation |
|---|---|
| `is_alive(s)` | `s.exited_at IS NULL` |
| `ever_idle(s)` | `s.first_idle_at IS NOT NULL` |
| `failed_session(s)` | `s.exit_code IS NOT NULL AND s.exit_code <> 0` |

**`first_idle_at` is write-once.** Set the moment a session enters `WaitingForInput` for the first time; **never updated thereafter**, even if the agent emits more output and re-enters idle later. The naming is deliberate (over `first_idle_at`) so future readers don't accidentally introduce updates on subsequent idle transitions. This is the trick that gives AwaitingSelection stickiness for free (per design "AwaitingSelection reversibility currently sticky" — out-of-scope to change). Once a session has been idle once, it stays "ever_idle" forever; `compute_run_status` checks "all bound sessions have ever_idle" and the answer can only flip from false→true, never back. The write-once semantic is enforced at the recorder layer (`SessionFactsRecorder::record_first_idle` is a no-op when the column is already non-NULL) and pinned by a regression test (Wave G3).

### Indexes

```
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_task_run_id ON sessions(task_run_id);
```

---

## 2 — Code evolution: what gets ported, transformed, deleted

**Framing note for this section.** Phase 1 builds on a greenfield branch off `main`; none of these v1 files exist in the working tree. So when this plan says a function is "not ported" it means we never copy it across in the first place — we are not editing existing v2 code to remove it. Commit messages and PR descriptions should reflect that ("we don't port X" rather than "we delete X").

### Ported verbatim (with v1 line references for the executor)

| File on `task-flow@b1f38f63` | Destination on `task-flow-v2` | Changes vs v1 source |
|---|---|---|
| `src-tauri/src/domains/tasks/entity.rs` | same path | `TaskRun` arrives without a `status` field. Add `cancelled_at`, `confirmed_at`, `failed_at`. Keep `TaskRunStatus` enum (used as compute return type + UI wire format). Keep everything else verbatim — `TaskStage`, `RunRole`, `TaskArtifactKind`, etc. |
| `src-tauri/src/domains/tasks/runs.rs` | same path | We **do not port** `mark_running`, `mark_awaiting_selection`, `fail_run`. Port `create_task_run`, `confirm_selection`, `cancel_run`. `confirm_selection` writes `confirmed_at = now()`. `cancel_run` writes `cancelled_at = now()`. |
| `src-tauri/src/domains/tasks/service.rs` | same path | `cancel_task` cascade calls the new `cancel_run` (sets `cancelled_at`) instead of `set_task_run_status`. |
| `src-tauri/src/domains/tasks/mod.rs` | same path | Verbatim minus exports for deleted items. |
| `src-tauri/src/domains/tasks/presets.rs` | same path | Verbatim. |
| `src-tauri/src/domains/tasks/prompts.rs` | same path | Verbatim. |
| `src-tauri/src/domains/tasks/tests.rs` | same path | ~30% rewrite — every assertion against `TaskRunStatus::*` now goes through `compute_run_status` against synthetic session fixtures. |

### Transformed during port (semantics change)

| File | Transformation |
|---|---|
| `domains/tasks/auto_advance.rs` | `on_pr_state_refreshed` already doesn't read `TaskRunStatus` (verified by the mapping pass; it only touches `task.stage` + `task.failure_flag`). Port verbatim. The "adjusted" mention in your prompt is a no-op for Phase 1. |
| `domains/tasks/run_lifecycle_listener.rs` | We **do not port** the public `resolve_and_fail_run_for_session_*` API. The terminal layer writes `session.exited_at` / `session.exit_code` directly, and the getter derives Failed. The pure helpers `format_failure_reason` + `RunFailureOutcome` are not ported either — no v2 caller needs them. |
| `domains/tasks/orchestration.rs` | Port; the v2 version simply omits the v1 `mark_running` call inside `start_stage_run` / `start_clarify_run`. The "run is now active" fact is implicit (no terminal timestamp set yet → not Cancelled/Completed/Failed → falls through to Running per the getter). |
| `domains/tasks/reconciler.rs` | Port. The `match status` over `(AwaitingSelection \| Failed \| Cancelled \| Queued \| Running) → false; Completed → true` becomes `match compute_run_status(run, sessions)` — same shape, same logic, different source. |
| `domains/tasks/clarify.rs` | Port verbatim if no status writes; otherwise same treatment as orchestration. |
| `domains/tasks/rest_contract.rs` | Port; `TaskRun` wire shape no longer carries persisted `status` but the response struct synthesizes it via `compute_run_status` for the UI. |
| `commands/tasks.rs` | Port the command surface. The v1 `assert_eq!(..., TaskRunStatus::*)` direct-status assertions become assertions against `compute_run_status`. The `ProductionOrchestratorBundle` / `ConfirmStageResources` snapshot pattern is ported as-is — Phase 2 retires it. |
| `commands/forge.rs` | Port `persist_pr_state_refresh` **without** the `task_run_fail` step (and without the corresponding `PrStatePersistOutcome.task_run_fail` field). The CI-red→failure-flag pathway via `task.failure_flag` survives; the run-level Failed signal does not. See §7 risks for the deliberate semantic this enshrines. |

### Not ported from v1

| File on v1 | Why we don't port it |
|---|---|
| `infrastructure/run_lifecycle_notify.rs` | `OnceCell` dispatcher pattern. v2 §9: direct calls. |
| `infrastructure/run_lifecycle_dispatch.rs` | `ActiveProjectDispatcher` async↔sync bridge. v2 §9: direct calls via project-scoped service handle. |
| The DB-write half of `infrastructure/attention_bridge.rs` (`AwaitingSelectionDeps::mark_awaiting_selection` and friends) | The in-memory map for UI badges is ported. The DB-write half is not — the bridge instead calls `session_facts_recorder.record_first_idle(session_id)` on enter-idle (which writes `first_idle_at` on the session row, no-op if already set). The bridge no longer touches task-run rows at all. |

### New code on v2

| Path | Purpose |
|---|---|
| `src-tauri/src/domains/tasks/run_status.rs` | Pure function `compute_run_status(run: &TaskRun, sessions: &[Session]) -> TaskRunStatus`. Defined in §3 below. |
| `src-tauri/src/domains/sessions/facts_recorder.rs` | `SessionFactsRecorder` struct holding `Database` + repo path; methods `record_exit(session_id, exit_code: Option<i32>)`, `record_first_idle(session_id)` (write-once; no-op when `first_idle_at` is already non-NULL). Constructed at startup, passed into terminal layer + attention bridge by reference. No `OnceCell`. |
| `src-tauri/src/infrastructure/database/migrations/v1_to_v2_task_runs.rs` | Stream B migration. Detects legacy `status` column, archives the table, backfills `cancelled_at` / `confirmed_at` / `failed_at`, drops `status` via table-rebuild. Idempotent. |

---

## 3 — `compute_run_status` specification

```rust
// src-tauri/src/domains/tasks/run_status.rs

pub fn compute_run_status(run: &TaskRun, sessions: &[Session]) -> TaskRunStatus {
    if run.cancelled_at.is_some() {
        return TaskRunStatus::Cancelled;
    }
    if run.confirmed_at.is_some() {
        return TaskRunStatus::Completed;
    }
    if run.failed_at.is_some() {
        return TaskRunStatus::Failed; // legacy carrier
    }

    let bound: Vec<&Session> = sessions
        .iter()
        .filter(|s| s.task_run_id.as_deref() == Some(run.id.as_str()))
        .collect();

    let any_session_failed = bound.iter().any(|s| {
        matches!(s.exit_code, Some(code) if code != 0)
    });
    let has_winner = run.selected_session_id.is_some();
    if any_session_failed && !has_winner {
        return TaskRunStatus::Failed;
    }

    let all_bound_ever_idle =
        !bound.is_empty() && bound.iter().all(|s| s.first_idle_at.is_some());
    if all_bound_ever_idle {
        return TaskRunStatus::AwaitingSelection;
    }

    TaskRunStatus::Running
}
```

**Order matters.** Cancelled and Completed are terminal user actions and trump everything. Failed beats AwaitingSelection because a crashed session shouldn't appear "waiting on you to pick it." A bound-empty run (just created, sessions about to spawn) returns Running by default — that matches user mental model better than Queued.

**The `TaskRunStatus` enum stays defined in `entity.rs`** (variants: `Running`, `AwaitingSelection`, `Completed`, `Failed`, `Cancelled` — note: no `Queued`). It is the return type of the getter and the wire format to the UI. It is **never** persisted to SQL after Phase 1. Stream B migration drops the column; Stream A code never references `db.set_task_run_status` again.

### Concurrency / consistency contract

`compute_run_status` is **eventually consistent** with the session-row writes that drive it. We **do not** wrap status reads in a transaction with the writes from `SessionFactsRecorder`. SQLite's WAL mode gives statement-level atomicity (a row write either commits or doesn't), and the `Database` connection pool already runs with `synchronous=NORMAL` per CLAUDE.md. That gives us the contract:

- **Bound on staleness:** any `compute_run_status` call observes the result of every write that committed before the call's first SELECT. After a session-fact write commits, the next render-tick read sees it. There is no "snapshot isolation across the run + sessions read"; if a session's `exited_at` is being written between the run-row read and the sessions-row read, the read may observe pre-write run state and post-write session state.
- **Why this is fine:** Phase 1 has no compound invariant that crosses run + session writes. Run-row mutations (`cancelled_at`, `confirmed_at`) are independent of session-row mutations (`exited_at`, `first_idle_at`). The five derived states are all idempotent monotone functions of their inputs — observing a "more recent" session fact alongside a "less recent" run fact still produces a coherent (just slightly stale) status. Worst case the UI badge re-renders on the next event tick.
- **What this rules out:** any caller that needs "atomic status semantics" (e.g. "decide-and-act based on derived status") must take the per-task lock that arrives in Phase 2. Phase 1 callers read for display only.

If we ever add a writer that needs the run-row + session-rows to commit atomically (we shouldn't — that's the whole point of v2's "observe, don't store"), put it behind the Phase 2 per-task mutex. Don't reach for an explicit transaction wrapping `compute_run_status`.

---

## 4 — Stream B: v1→v2 user-DB migration

Lives at `src-tauri/src/infrastructure/database/migrations/v1_to_v2_task_runs.rs`. Called from `db_schema::initialize_schema` after the `task_runs` `CREATE TABLE IF NOT EXISTS` block. Idempotent (running on a v2-native DB is a no-op).

### Detection

```sql
SELECT COUNT(*) FROM pragma_table_info('task_runs') WHERE name = 'status';
```

If 0 → v2-native, skip the migration. If 1 → run it.

### Steps

1. **Archive.** `CREATE TABLE IF NOT EXISTS task_runs_v1_archive AS SELECT * FROM task_runs;` (per Phase 0 backup-then-mutate convention; the `_v1_archive` suffix marks it permanent for safety, not transient).
2. **Add new columns idempotently.** Three `ALTER TABLE task_runs ADD COLUMN ... INTEGER NULL` calls with `let _ = ...` per existing pattern (`db_schema.rs:464-476`).
3. **Backfill.**
   ```sql
   UPDATE task_runs SET cancelled_at = updated_at  WHERE status = 'cancelled' AND cancelled_at IS NULL;
   UPDATE task_runs SET confirmed_at = COALESCE(completed_at, updated_at) WHERE status = 'completed' AND confirmed_at IS NULL;
   UPDATE task_runs SET failed_at    = updated_at  WHERE status = 'failed'    AND failed_at    IS NULL;
   ```
   Rows where status was `queued`/`running`/`awaiting_selection` get no terminal timestamp — the getter will recompute their derived status from sessions on first read. (For long-abandoned `running` rows where sessions are gone, this resolves to "Running with empty bound set" = Running. That's acceptable; the user can cancel them manually.)
4. **Drop `status` via table-rebuild dance** (SQLite has no native DROP COLUMN on this version). Inside one transaction:
   ```sql
   CREATE TABLE task_runs_new (... v2 schema ...);
   INSERT INTO task_runs_new (id, task_id, stage, preset_id, base_branch, target_branch,
                              selected_session_id, selected_artifact_id, selection_mode,
                              started_at, completed_at, cancelled_at, confirmed_at, failed_at,
                              failure_reason, created_at, updated_at)
   SELECT id, task_id, stage, preset_id, base_branch, target_branch,
          selected_session_id, selected_artifact_id, selection_mode,
          started_at, completed_at, cancelled_at, confirmed_at, failed_at,
          failure_reason, created_at, updated_at
   FROM task_runs;
   DROP TABLE task_runs;
   ALTER TABLE task_runs_new RENAME TO task_runs;
   ```
5. **Re-create indexes.**

### Compatibility shim strategy

**None.** This is a hard cut. Lucode is a personal app (per memory `user_solo_macos.md`); the dataset is small; the migration runs once on first v2 launch. We do not maintain dual-mode reads. Stream A code can assume `status` does not exist.

---

## 5 — Test strategy

Every Phase 1 task follows red/green/refactor TDD. Two-way binding tests per the `feedback_regression_test_per_fix.md` rule: each derived-status case has a test that fails on revert (i.e. flipping the input that caused the case must produce a different status).

### Unit — `compute_run_status` (synthetic inputs)

`src-tauri/src/domains/tasks/run_status.rs` (inline `#[cfg(test)] mod tests`):

| Test | Input | Expected |
|---|---|---|
| `cancelled_trumps_all` | run.cancelled_at=Some, sessions=any | Cancelled |
| `confirmed_trumps_failures` | run.confirmed_at=Some, session with exit_code=1 | Completed |
| `legacy_failed_at_carrier` | run.failed_at=Some | Failed |
| `nonzero_exit_no_winner` | 1 session exit_code=1, run.selected_session_id=None | Failed |
| `nonzero_exit_with_winner` | 1 session exit_code=1, run.selected_session_id=Some | Running |
| `all_bound_ever_idle` | 2 sessions both with first_idle_at=Some | AwaitingSelection |
| `mixed_idle_falls_back_to_running` | 2 sessions, one with first_idle_at=None | Running |
| `empty_bound_is_running` | sessions=[], no terminal timestamps | Running |
| `unbound_session_ignored` | session with task_run_id mismatching run.id | Running (the foreign session doesn't count) |

Two-way binding: each case has a sibling test that flips the discriminating input and asserts the status moves.

### Migration — Stream B unit tests

`src-tauri/src/infrastructure/database/migrations/v1_to_v2_task_runs.rs`:

| Test | Setup | Assertion |
|---|---|---|
| `noop_on_v2_native_db` | run migration twice | second call is no-op |
| `backfills_cancelled_at` | v1 row with status='cancelled', updated_at=1000 | row.cancelled_at == 1000 after migration |
| `backfills_confirmed_at_prefers_completed_at` | v1 row status='completed', completed_at=900, updated_at=1000 | row.confirmed_at == 900 |
| `backfills_confirmed_at_falls_back_to_updated_at` | v1 row status='completed', completed_at=NULL, updated_at=1000 | row.confirmed_at == 1000 |
| `backfills_failed_at` | v1 row status='failed' | row.failed_at populated |
| `non_terminal_rows_get_no_timestamps` | v1 rows status='running' / 'queued' / 'awaiting_selection' | all three terminal-timestamp columns NULL |
| `archive_table_created` | any v1 → v2 migration | `task_runs_v1_archive` row count == original task_runs count |
| `status_column_dropped` | post-migration | `pragma_table_info('task_runs')` does not include `status` |
| `idempotent_run` | run migration twice on v1 DB | second call is no-op (status column already gone) |

### Session-fact recorder tests (`SessionFactsRecorder`)

`src-tauri/src/domains/sessions/facts_recorder.rs`:

| Test | Setup | Assertion |
|---|---|---|
| `record_exit_sets_columns` | session with NULL exited_at | row.exited_at = ts, row.exit_code = code after call |
| `first_idle_writes_when_null` | session with first_idle_at=NULL | row.first_idle_at = ts after call |
| `first_idle_is_write_once` | session with first_idle_at=1000; recorder called again at ts=2000 | row.first_idle_at remains 1000 (the second call must not overwrite) |
| `first_idle_two_sessions_independent` | sessions A and B; record A at 1000, then B at 2000 | A=1000, B=2000 (per-session, not global) |

### Service-layer tests

Per ported file (`runs.rs`, `service.rs`):

- `create_task_run` inserts a row with no terminal timestamps (cancelled_at=NULL, confirmed_at=NULL, failed_at=NULL) → derived status = Running.
- `cancel_run` sets `cancelled_at = now()` → derived = Cancelled.
- `confirm_selection` sets `selected_session_id` + `confirmed_at = now()` → derived = Completed.
- Cancel cascade test (port from v1's cancel-cascade tests): cancelling a task fans out to active runs via the new path.

### Integration / end-to-end (Rust integration tests under `src-tauri/tests/`)

- **e2e_run_lifecycle**: create task → start run → spawn 1 session → record idle → assert getter = AwaitingSelection → record exit code 0 → still AwaitingSelection → confirm_selection → Completed.
- **e2e_run_failure**: create task → start run → spawn 2 sessions → one exits non-zero, no winner → Failed → simulate confirm of the other → Completed (winner masks the sibling failure).
- **e2e_legacy_migration_then_read**: seed a SQLite DB matching v1 schema with mixed-status rows → run startup migration → load runs via the v2 service → assert each derived status matches the legacy intent.

### Architecture tests

`arch_domain_isolation` and `arch_layering_database` already exist. They must still pass; the new modules go under the right domain layer (no `commands/` reaching into `infrastructure/`, etc.).

---

## 6 — Wave breakdown

Each wave is a coherent commit boundary. After each wave, run `just test` and verify green before starting the next. Per `feedback_parallel_agents_disjoint_files.md`, waves with disjoint-file tasks are dispatched as parallel subagents and the coordinator commits.

### Wave A — design-doc alignment + scope commit (sequential)

**A1.** Update `plans/2026-04-29-task-flow-v2-design.md` Phase 1 wording: replace the migration-sounding bullets with the two-stream framing. Add a paragraph cross-referencing this plan.
- Files: modify `plans/2026-04-29-task-flow-v2-design.md` (the Phase 1 block under `## Phase plan`).
- No tests.
- Commit: `docs(plans): clarify Phase 1 as two-stream (code + user-DB migration)`.

### Wave B — schema port (parallelizable)

**B1.** Add `tasks` table CREATE block to `db_schema.rs`. Verbatim from baseline §1.
**B2.** Add `task_runs` table CREATE block (v2 shape; no `status` column).
**B3.** Add `task_artifacts` table CREATE block. Verbatim.
**B4.** Add session ALTERs for task-linkage columns (`task_id`, `task_run_id`, `task_stage`, `task_role`, `run_role`, `slot_key`, `task_branch`) and the new fact columns (`exited_at`, `exit_code`, `first_idle_at`) inside `apply_sessions_migrations`.
**B5.** Add indexes (`idx_task_runs_task_id`, `idx_sessions_task_run_id`).
**B6.** Idempotency tests: each new CREATE / ALTER survives `initialize_schema` running twice.

Files all in `src-tauri/src/infrastructure/database/db_schema.rs` — **same file, so B1–B5 sequence in one task** (single edit), then B6 is a separate test-only commit.

Commits:
- `feat(db): add v2 task-runs schema (tasks, task_runs without status, task_artifacts) + session fact columns`
- `test(db): idempotency for v2 task schema`

### Wave C — entities + enums (parallelizable across files)

**C1.** New file `src-tauri/src/domains/tasks/entity.rs` — port v1 entity.rs with `TaskRun` arriving without a `status` field, plus the new `cancelled_at`, `confirmed_at`, `failed_at` fields. `TaskRunStatus` enum kept (variants: Running, AwaitingSelection, Completed, Failed, Cancelled — **no Queued**).
**C2.** New `src-tauri/src/domains/tasks/mod.rs`.
**C3.** Add `exited_at`, `exit_code`, `first_idle_at` fields to `Session` entity in `domains/sessions/entity.rs`. Add `task_id`, `task_run_id`, `task_stage`, `task_role`, `run_role`, `slot_key`, `task_branch` (the v1 task-linkage columns).
**C4.** Round-trip serialization tests for `TaskRunStatus`, `TaskStage`, `RunRole`, `TaskArtifactKind` (verbatim from v1's `tests.rs`).

Commit: `feat(tasks): port v2 entity types (TaskRun without persisted status)`.

### Wave D — `compute_run_status` (TDD; sequential within file)

**D1–D9.** Each table row in §5's "Unit — compute_run_status" table is one TDD task:
1. Write the failing test in `run_status.rs`.
2. Run `cargo nextest run -p schaltwerk_app run_status::tests::<name>` → expect FAIL.
3. Add the minimum branch in `compute_run_status` to make it pass.
4. Run again → expect PASS.
5. Commit.

After all 9 cases land, refactor pass: collapse duplicated session-filtering, extract `bound_sessions` helper, ensure the function reads top-to-bottom in the order documented in §3.

Commits per case (small): `test(tasks): cancelled trumps all / impl: cancelled branch / ...`. Squash before merge if the sequence is noisy.

### Wave E — DB layer for new columns (parallelizable)

**E1.** `db_tasks.rs` — port v1's task/run/artifact insert/update/get methods with `status` column absent and `cancelled_at`/`confirmed_at`/`failed_at` present. The v1 `set_task_run_status` is replaced (not ported through) by three setters: `set_task_run_cancelled_at`, `set_task_run_confirmed_at`, `set_task_run_failed_at`. (The third exists for the migration only; v2-native code never calls it.)
**E2.** `db_sessions.rs` — add setters `set_session_exited_at(id, ts, code: Option<i32>)` and `set_session_first_idle_at(id, ts)` (write-once: `WHERE first_idle_at IS NULL`). Add reader `get_sessions_by_task_run_id(run_id)`.
**E3.** Tests for each new method against `Database::new_in_memory()`, including the write-once guard on `set_session_first_idle_at`.

Commit: `feat(db): repository methods for v2 task-runs and session facts`.

### Wave F — Slimmed `TaskRunService` (TDD; sequential within file)

**F1.** `runs.rs::create_task_run` — port; assert no terminal timestamps set on creation.
**F2.** `runs.rs::confirm_selection` — port with new semantics (writes `confirmed_at = now()`, sets `selected_session_id` or `selected_artifact_id`).
**F3.** `runs.rs::cancel_run` — port with new semantics (writes `cancelled_at = now()`).
**F4.** `service.rs::cancel_task` cascade — port; cascading hits the new `cancel_run`.

`mark_running`, `mark_awaiting_selection`, `fail_run` are not ported. The v1 tests for those have no v2 analog and are not ported either.

Commit: `feat(tasks): slimmed TaskRunService (create / confirm / cancel only)`.

### Wave G — `SessionFactsRecorder` + terminal/attention wiring (sequential)

**G1.** New `domains/sessions/facts_recorder.rs` with `SessionFactsRecorder { db: Database, repo_path: PathBuf }` and methods `record_exit(session_id, exit_code: Option<i32>)`, `record_first_idle(session_id)` (write-once at the SQL `WHERE first_idle_at IS NULL` level — second call commits a 0-row update). Unit tests with `Database::new_in_memory`, including the four cases listed in §5's "Session-fact recorder tests" table — particularly `first_idle_is_write_once`, which is the regression test that pins the design intent.
**G2.** Wire `record_exit` into `domains/terminal/lifecycle.rs::handle_agent_crash` directly (the v2 path that replaces v1's `notify_agent_exit` + `OnceCell` dispatcher). Pass the recorder by reference, constructed at startup. Test: PTY exit → session row's `exited_at` and `exit_code` populated.
**G3.** Wire `record_first_idle` into the attention bridge's session-idle path (the v2 path that replaces v1's `mark_awaiting_selection` DB write). Test: enter-idle event → session row's `first_idle_at` populated. Then a second enter-idle event for the same session at a later timestamp must NOT overwrite the original — assert the column still equals the first timestamp. This regression test is the load-bearing one for the stickiness invariant.
**G4.** Tmux dead-pane reattach path (`commands/schaltwerk_core.rs::emit_agent_crashed_for_dead_pane`): also calls `record_exit(name, None)`.

Commit: `feat(tasks): direct session-facts recording, no OnceCell dispatcher`.

### Wave H — Stream B migration (TDD; sequential)

**H1.** `migrations/v1_to_v2_task_runs.rs` skeleton + detection logic + `noop_on_v2_native_db` test.
**H2.** Archive step + `archive_table_created` test.
**H3.** Backfill step + `backfills_*` tests (one per row in §5's migration table).
**H4.** Drop-column dance + `status_column_dropped` test.
**H5.** Idempotency end-to-end test: run migration twice on a v1 DB, assert second call no-ops.
**H6.** Wire migration into `db_schema::initialize_schema` after `task_runs` CREATE.

Commit: `feat(db): one-shot v1→v2 task_runs migration`.

### Wave I — Port command surface + auto_advance + reconciler + clarify (parallelizable)

**I1.** `domains/tasks/auto_advance.rs` — port verbatim.
**I2.** `domains/tasks/reconciler.rs` — port; the status match becomes a `compute_run_status` call.
**I3.** `domains/tasks/orchestration.rs` — port without the v1 `mark_running` calls.
**I4.** `domains/tasks/clarify.rs` — port.
**I5.** `domains/tasks/rest_contract.rs` — port; wire `compute_run_status` into the response builder.
**I6.** `commands/tasks.rs` — port; the v1 `assert_eq!(..., TaskRunStatus::*)` cases become assertions against the getter.
**I7.** `commands/forge.rs` — port `persist_pr_state_refresh` without the `task_run_fail` step (and without the `PrStatePersistOutcome.task_run_fail` field). The deliberate semantic: post-merge CI red flips `task.failure_flag`, not run status. See §7.

Commit per file (or per closely related pair) for clean review.

### Wave J — Integration tests + final validation

**J1.** `src-tauri/tests/e2e_run_lifecycle.rs`.
**J2.** `src-tauri/tests/e2e_run_failure.rs`.
**J3.** `src-tauri/tests/e2e_legacy_migration_then_read.rs`.
**J4.** `just test` green; verify `arch_domain_isolation` + `arch_layering_database` still pass.
**J5.** `knip` and `cargo shear` clean.
**J6.** Manual smoke test (per CLAUDE.md "for UI or frontend changes" — Phase 1 ships no UI, so this is skipped).

Commit: `test(tasks): e2e coverage for v2 derived run status`.

### Wave K — Status tracker + memory update

**K1.** Mark Phase 1 done in `plans/2026-04-29-task-flow-v2-status.md`, link to merge commit.
**K2.** Update auto-memory `project_taskflow_v2_charter.md` to reflect Phase 1 complete.

Commit: `docs(plans): Phase 1 complete`.

---

## 7 — Deliberate semantic changes & risks

### Deliberate semantic changes (call these out in commit messages and PR body)

**1. CI-red on a merged task no longer fails the producing TaskRun.** v1 had `forge::persist_pr_state_refresh::task_run_fail` flip the run's status to `Failed` when CI went red on the linked PR. v2 does not. The semantic is now:

- `TaskRun` Failed = the agent-and-selection workflow itself failed (a session exited non-zero before any winner was chosen, and the run was never confirmed).
- `Task.failure_flag = true` = there's a downstream problem with the task — possibly post-merge CI regression, possibly a follow-up bug. The `auto_advance` machine reads this and reacts; the run that produced the merge stays Completed (because it did, in fact, complete).

The producing TaskRun stays Completed even if the post-merge PR breaks because the run *did* succeed at its job (agent worked, user selected a winner, branch merged). A future reviewer asking "why doesn't CI red fail my run anymore" gets this answer: by design — Failed is reserved for agent/selection failure, not post-merge regression. The `task.failure_flag` channel is the existing surface for downstream problems, and Phase 1 preserves it untouched. Document in the `commands/forge.rs` port commit.

**2. Run-level Failed has exactly one source: session exit_code.** Not CI, not consolidation, not orchestrator decisions. If a session bound to the run exits non-zero AND no winner was selected, the derived status is Failed. Otherwise it isn't. This is the only signal `compute_run_status` consults for the Failed branch (besides the legacy `failed_at` carrier from the migration).

### Risks

| Risk | Mitigation |
|---|---|
| Wave I is large (~10k lines being ported across 6 files) | Each file is its own commit. If a file's port reveals deeper coupling than expected, scope-cut to "port the minimum that compiles + leave a TODO" and follow-up in Phase 2. |
| `compute_run_status` getting called per-row in tight loops (N+1 over sessions) | Add a batched variant `compute_run_statuses(runs: &[TaskRun], sessions: &[Session]) -> HashMap<RunId, TaskRunStatus>` once Wave D lands. Defer micro-optimization until profiling. |
| Legacy `running` / `queued` / `awaiting_selection` v1 rows lose information in the migration | Acceptable per design (those states were rarely persisted in production — see baseline §2 note: "Pre-rewrite-sweep, only Queued, Completed, Cancelled were ever observed in production"). The archive table preserves the originals if forensics need them. |
| `first_idle_at` write-once stickiness deviates from "currently idle" if the user ever wants UI to flap between Running and AwaitingSelection | Out of scope per design "AwaitingSelection reversibility — out of v2 scope". If we ever want flap, the schema change is to drop `first_idle_at` and replace with `is_idle: BOOLEAN` + a transition log. The Wave G3 regression test pins the current intent. |
| Eventual-consistency staleness window (per §3 contract) is misinterpreted as a snapshot read | The §3 contract paragraph is explicit. PR description should also surface it for reviewers. Phase 2 introduces the per-task lock for any caller that needs decide-and-act semantics. |
| The migration's table-rebuild dance is non-trivial and has no precedent in this repo (db_schema.rs only does DROP-and-recreate elsewhere) | TDD this aggressively in Wave H — migration tests run against in-memory SQLite with explicit pre/post pragma checks. The dance is small (~30 lines) and well-documented in SQLite docs. |

**Open question deferred to Phase 5:** Does `attention_bridge` need to keep its in-memory map at all, or can the UI read attention state directly from `session.first_idle_at`? Phase 1 keeps the bridge for UI badges (the in-memory map is needed for sub-second responsiveness; DB writes are throttled). The decision waits until Phase 5 with real telemetry.

---

## 8 — Definition of done for Phase 1

- v2 branch compiles, `just test` green, `knip` + `cargo shear` clean.
- 0 references to `db.set_task_run_status` in production code.
- 0 references to `TaskRunFailureRecorder` (the trait + `OnceCell`) in production code.
- 0 references to `AwaitingSelectionDeps::mark_awaiting_selection` in production code.
- `task_runs.status` column does not exist on a freshly-initialized v2 DB and is dropped on a migrated v1 DB.
- `compute_run_status` test suite covers all 9 cases in §5 with two-way binding for each.
- `e2e_legacy_migration_then_read` proves a real v1 DB shape migrates and reads correctly.
- `plans/2026-04-29-task-flow-v2-status.md` Phase 1 row marked `[x]` with merge commit hash.
- Auto-memory updated.

---

## 9 — Execution handoff

Plan complete. Two execution options per the writing-plans skill:

1. **Subagent-driven (this session).** I dispatch fresh subagents per wave (or per task within a wave for the disjoint-file ones), review between, fast iteration. Best for Waves D / F / H where TDD discipline matters most.
2. **Parallel session.** New session with `superpowers:executing-plans`, batch through with checkpoints.

Recommended: subagent-driven for this phase — Phase 1 has many small TDD tasks (Wave D's 9 cases especially) and the per-task review caught early is cheap. Wave I (the file-port wave) parallelizes cleanly across disjoint files; that one specifically benefits from parallel subagents per `feedback_parallel_agents_disjoint_files.md`.

Awaiting your review of this plan before starting code.
