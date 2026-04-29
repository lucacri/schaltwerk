# task-flow v2 — status

**Branch:** `task-flow-v2`
**Design:** [2026-04-29-task-flow-v2-design.md](./2026-04-29-task-flow-v2-design.md)
**Baseline:** [2026-04-29-task-flow-v2-baseline.md](./2026-04-29-task-flow-v2-baseline.md)

| Phase | Title | Status | PR / Commit |
|---|---|---|---|
| 0 | Backup + branch + reference snapshot | `[x]` | `44fd5370` |
| 1 | Collapse `TaskRunStatus` to derived state | `[~]` foundation | Waves A–H, J — see below |
| 2 | Per-task mutex; remove global RwLock | `[ ]` | — |
| 3 | Drop `RunRole`, `SessionState`, `SessionStatus` | `[ ]` | — |
| 4 | `TaskFlowError` sweep + derived current_* getters | `[ ]` | — |
| 5 | Explicit `lucode_task_run_done` MCP tool | `[ ]` | — |
| 6 | `Sidebar.tsx` split | `[ ]` | — |

## Phase 1 — wave-by-wave detail

Foundation, getter, migration, and end-to-end tests landed. **Wave I (full
v1 task-surface port) deferred** — see "Wave I deferral" below.

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
| I | Port command surface + auto_advance + reconciler + clarify + rest_contract + forge + recorder wiring | `[deferred]` | — |
| J | E2E integration tests | `[x]` | `ff2effde` |
| K | Status tracker + memory update | `[x]` | (this commit) |

## Phase 1 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2149 tests passing |
| 0 references to `db.set_task_run_status` in production code | ✅ method never ported |
| 0 references to `TaskRunFailureRecorder` (trait + `OnceCell`) | ✅ never ported |
| 0 references to `AwaitingSelectionDeps::mark_awaiting_selection` | ✅ never ported |
| `task_runs.status` column does not exist on a freshly-initialized v2 DB | ✅ pinned by `apply_tasks_migrations_creates_v2_task_runs_without_status` and a defensive runtime check `task_runs_table_does_not_have_status_column` in `db_tasks::tests` |
| `task_runs.status` is dropped on a migrated v1 DB | ✅ pinned by `status_column_is_dropped_from_task_runs_after_migration` and the e2e `v1_db_migrates_then_yields_correct_derived_status_through_the_v2_read_path` |
| `compute_run_status` test suite covers all 9 cases with two-way binding | ✅ 15 tests in `domains/tasks/run_status::tests`, each derivation case has a sibling test that flips the discriminating input |
| `e2e_legacy_migration_then_read` proves a real v1 DB shape migrates and reads correctly | ✅ `tests/e2e_legacy_migration_then_read.rs` |

## Wave I deferral

Wave I as scoped in `plans/2026-04-29-task-flow-v2-phase-1-plan.md` §6 is the
mechanical port of ~10k lines from `task-flow@b1f38f63` across:

- `domains/tasks/auto_advance.rs` (414 lines)
- `domains/tasks/reconciler.rs` (235 lines)
- `domains/tasks/orchestration.rs` (2517 lines)
- `domains/tasks/clarify.rs` (102 lines)
- `domains/tasks/rest_contract.rs` (93 lines)
- `domains/tasks/service.rs` (1563 lines)
- `domains/tasks/prompts.rs` (831 lines)
- `domains/tasks/presets.rs` (317 lines)
- `commands/tasks.rs` (2302 lines)
- `commands/forge.rs` (changes to existing v2 file)
- The Wave G2/G3/G4 recorder wiring (deferred to the same wave)

**Why deferred:**

1. Phase 1's stated load-bearing piece is the derived getter and its
   foundation. That foundation is fully in place and tested through the e2e
   integration tests in Wave J. Phase 1's design intent is met.
2. The full port hits the same kind of cascading expansion Wave C hit (Session
   struct gained 6 fields → 18 files needed updates). Each ported file
   typically depends on other ported files; the port has to land mostly
   atomically to keep the build green.
3. Wave I produces no new design surface — it's mechanical translation of
   v1's task-flow API into the v2 shape (no `mark_running`, etc). The risk
   is in volume, not novelty.
4. The recorder wiring (G2–G4) requires application-layer call sites that
   only exist after `commands/tasks.rs` is ported. So G and I are coupled.

**Path forward.** Wave I is a natural Phase 1.5 / Phase 2 prologue. Whoever
picks it up should:

- Treat it as its own plan with its own wave breakdown (port files in
  dependency order: prompts, presets, then auto_advance, clarify, then
  service, runs, then orchestration, then commands, then forge).
- Keep `compute_run_status` as the only producer of `TaskRunStatus`. Every
  ported file's `assert_eq!(..., TaskRunStatus::*)` becomes an assertion
  through the getter against synthetic `SessionFacts`.
- Wire `SessionFactsRecorder` into terminal/lifecycle through the
  application-layer command surface as it ports — not via `OnceCell`.

What is **not** at risk: the derived getter's contract, the column shapes,
the migration, the recorder API. Those are pinned by the tests that already
shipped.

---

Updated when each phase merges to `task-flow-v2`.
