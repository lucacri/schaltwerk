# task-flow v2 — status

**Branch:** `task-flow-v2`
**Design:** [2026-04-29-task-flow-v2-design.md](./2026-04-29-task-flow-v2-design.md)
**Baseline:** [2026-04-29-task-flow-v2-baseline.md](./2026-04-29-task-flow-v2-baseline.md)

| Phase | Title | Status | PR / Commit |
|---|---|---|---|
| 0 | Backup + branch + reference snapshot | `[x]` | `44fd5370` |
| 1 | Collapse `TaskRunStatus` to derived state | `[x]` | Waves A–K — see below |
| 2 | Per-task mutex; remove global RwLock | `[ ]` | — |
| 3 | Drop `RunRole`, `SessionState`, `SessionStatus` | `[ ]` | — |
| 4 | `TaskFlowError` sweep + derived current_* getters | `[ ]` | — |
| 5 | Explicit `lucode_task_run_done` MCP tool | `[ ]` | — |
| 6 | `Sidebar.tsx` split | `[ ]` | — |

## Phase 1 — wave-by-wave detail

All waves complete. Phase 1 ships the foundation (getter, migration, e2e)
**and** the full v1 task-surface port with v2 transformations applied.

| Wave | Title | Status | Commits |
|---|---|---|---|
| A | Design-doc rewording (two-stream framing) | `[x]` | `66f1bec7` |
| B | Schema port (`task_runs` without `status`, fact columns on `sessions`) | `[x]` | `0f357fc2` |
| (chore) | Latent clippy + workflow drift surfaced by Wave C | `[x]` | `08156639` |
| C | Entity types (`TaskRun` without persisted status, Session fact fields) | `[x]` | `866707c7` |
| D | `compute_run_status` getter (load-bearing) | `[x]` | `5e2de27d` |
| E | DB layer (TaskMethods/TaskRunMethods + session-fact setters) | `[x]` | `d554e9ec` |
| F | Slimmed `TaskRunService` (create / confirm / cancel only) | `[x]` | `a2aa5fbc` |
| G | `SessionFactsRecorder` + cross-domain integration test | `[x]` | `e1878a79` |
| H | One-shot v1→v2 user-DB migration | `[x]` | `d3eb25d7` |
| I.0 | DB layer extensions (rest of TaskMethods + TaskArtifactMethods) | `[x]` | `038d57d0` |
| I.1 | Port `prompts.rs` + `presets.rs` verbatim | `[x]` | `6521e593` |
| I.2 | Port `auto_advance.rs` + `clarify.rs` (PrState::Failed restored) | `[x]` | `05c52580` |
| I.3 | Port `service.rs` (TaskService + cancel cascade) | `[x]` | `128ebb11` |
| I.4 | Port `reconciler.rs` (uses `compute_run_status`) | `[x]` | `d429c4a7` |
| I.5 | Port `orchestration.rs` + `rest_contract.rs` | `[x]` | `6b95fb98` |
| I.6 | Port `commands/tasks.rs` + register Tauri commands | `[x]` | `17a9044f` |
| I.7 | `forge::pr_state_from_details` emits `PrState::Failed` on CI red | `[x]` | `f59c4674` |
| I.8 | Wire `SessionFactsRecorder` via `session_facts_bridge` (G2/G3/G4) | `[x]` | `465e6c83` |
| J | E2E integration tests | `[x]` | `ff2effde` |
| K | Status tracker + memory update | `[x]` | (this commit) |

## Phase 1 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2333 tests passing |
| 0 references to `db.set_task_run_status` in production code | ✅ method never ported |
| 0 references to `TaskRunFailureRecorder` (trait + `OnceCell`) | ✅ never ported |
| 0 references to `AwaitingSelectionDeps::mark_awaiting_selection` | ✅ never ported |
| `task_runs.status` column does not exist on a freshly-initialized v2 DB | ✅ pinned by `apply_tasks_migrations_creates_v2_task_runs_without_status` and a defensive runtime check `task_runs_table_does_not_have_status_column` in `db_tasks::tests` |
| `task_runs.status` is dropped on a migrated v1 DB | ✅ pinned by `status_column_is_dropped_from_task_runs_after_migration` and the e2e `v1_db_migrates_then_yields_correct_derived_status_through_the_v2_read_path` |
| `compute_run_status` test suite covers all 9 cases with two-way binding | ✅ 15 tests in `domains/tasks/run_status::tests`, each derivation case has a sibling test that flips the discriminating input |
| `e2e_legacy_migration_then_read` proves a real v1 DB shape migrates and reads correctly | ✅ `tests/e2e_legacy_migration_then_read.rs` |

## Wave I sub-wave breakdown

Wave I shipped as 9 sub-waves (I.0 through I.8). The mechanical port of
~10k lines from `task-flow@b1f38f63` was applied with the v2 transformations
inline:

- `assert_eq!(..., TaskRunStatus::*)` assertions rewritten through
  `compute_run_status` (or as direct timestamp checks where the test was
  asserting the v1 status flip itself).
- `runs.start_run(...)` → `runs.create_task_run(...)`.
- `runs.mark_running(...)` calls deleted (no v2 status flip; the run is
  Running by virtue of having no terminal timestamp).
- `db.set_task_run_status(_, …)` calls translated to the v2 timestamp
  setters (`set_task_run_cancelled_at`, `set_task_run_confirmed_at`,
  `set_task_run_failed_at`).
- `run.status` field reads → predicates against the timestamp columns.
- v1's `domains/legacy_import` Tauri commands are not ported. The Phase 1
  plan ships only the v1→v2 schema migration; the separate
  "import legacy archived sessions to tasks" pathway is future work.
- The Wave G2/G3/G4 recorder wiring landed in I.8 via
  `infrastructure/session_facts_bridge.rs` — a small seam that reads the
  active project's Database through `PROJECT_MANAGER` and calls the
  recorder. No `OnceCell<dyn …Recorder>` dispatcher; v2 §9 holds.

Notable deliberate semantic changes (each pinned in tests):

- `forge::pr_state_from_details` emits `PrState::Failed` on CI red or
  closed-without-merge (Wave I.7). `auto_advance::on_pr_state_refreshed`
  reads that and flips `task.failure_flag = true`. Run-level Failed in v2
  has exactly one source: a bound session exited non-zero before any
  winner was confirmed. The v1 `task_run_fail` step in
  `forge::persist_pr_state_refresh` is intentionally not ported.
- `find_active_task_run_for_task` queries
  `cancelled_at IS NULL AND confirmed_at IS NULL AND failed_at IS NULL`
  in v2 (the negation of every terminal predicate
  `compute_run_status` checks before the failure path) instead of v1's
  `WHERE status = 'running'`.

What's load-bearing and pinned: the derived getter's contract, the column
shapes, the migration, the recorder API, the write-once `first_idle_at`,
and the deliberate CI-red semantic boundary.

---

Updated when each phase merges to `task-flow-v2`.
