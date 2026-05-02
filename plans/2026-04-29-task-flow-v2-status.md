# task-flow v2 — status

**Branch:** `task-flow-v2`
**Design:** [2026-04-29-task-flow-v2-design.md](./2026-04-29-task-flow-v2-design.md)
**Baseline:** [2026-04-29-task-flow-v2-baseline.md](./2026-04-29-task-flow-v2-baseline.md)

| Phase | Title | Status | PR / Commit |
|---|---|---|---|
| 0 | Backup + branch + reference snapshot | `[x]` | `44fd5370` |
| 1 | Collapse `TaskRunStatus` to derived state | `[x]` | Waves A–K — see below |
| 2 | Per-task mutex; remove global RwLock | `[x]` | Waves A–I — see below |
| 3 | Drop `RunRole`; collapse `TaskStage::Cancelled`; introduce orthogonal session axes (additive) | `[x]` | Waves A–H — see below |
| 4 | `TaskFlowError` sweep + derived current_* getters + retire legacy session enums | `[x]` | Waves A–H — see below |
| 5 | Explicit `lucode_task_run_done` MCP tool | `[x]` | Waves A–E — see below |
| 5.5 | Hydrator wiring-gap interlude (`get_session_by_id` + 2 siblings) | `[x]` | Waves A–F — see below |
| 6 | `Sidebar.tsx` split | `[x]` | Waves A–J — see below |
| 7 | Task UI as the unified surface (frontend rebuild on v2 backend) | `[ ]` | Plan: [`2026-04-29-task-flow-v2-phase-7-plan.md`](./2026-04-29-task-flow-v2-phase-7-plan.md) — Chunk A + B.1–B.3 done; B.4 next |

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

## Phase 2 — wave-by-wave detail

All waves complete. Phase 2 replaces the per-project
`Arc<RwLock<SchaltwerkCore>>` with per-task `Arc<Mutex<()>>` plus a
lock-free `CoreHandle` accessor for non-task callers. Operations on
different tasks proceed concurrently; same-task ops serialize.

| Wave | Title | Status | Commits |
|---|---|---|---|
| A | Phase 2 implementation plan | `[x]` | `5076840a` |
| B | `TaskLockManager` + 5 unit tests | `[x]` | `bf34ea9e` |
| C | Lock-free `CoreHandle` accessor (additive) | `[x]` | `8d4cf06e` |
| D.1+D.3 | Per-task lock in `commands/tasks.rs`; delete bundle/snapshot | `[x]` | `3158fe0a` |
| D.2 | Consolidate `with_read_db`/`with_write_db` → `with_core_handle` | `[x]` | `c89a06b6` |
| E.0 | Cat-D audit: zero multi-write sites; doc-only commit | `[x]` | `09ad3b66` |
| (parity) | `CoreHandle::database()` for migration parity | `[x]` | `ffca692d` |
| E.1 | `commands/schaltwerk_core.rs` + `codex_model_commands.rs` (76 sites) | `[x]` | `abaca337` |
| E.2 | `mcp_api.rs` (39 sites) | `[x]` | `fc370aea` |
| E.3 | `diff_commands.rs` + `sessions_refresh.rs` + `settings.rs` (10 sites) | `[x]` | `0d813090` |
| E.4 | Restore v1 error message strings on `get_core_handle*` | `[x]` | `b4be03b1` |
| F (bridge) | `session_facts_bridge.rs` no read guard | `[x]` | `330b4e7a` |
| F.1 | `commands/settings.rs` + `commands/github.rs` direct lock callers (25 sites) | `[x]` | `faf0e987` |
| F.2 | `commands/gitlab.rs` + `commands/forge.rs` direct lock callers (9 sites) | `[x]` | `a12881ad` |
| F.3 | `diff_commands.rs` + `mcp_api.rs` + `services/terminals.rs` + `project_manager.rs` (5 sites) | `[x]` | `6cbf8b57` |
| G | Drop `RwLock` from `Project`; delete `get_core_read/write*` + `LAST_CORE_WRITE` | `[x]` | `d28ee005` |
| H | E2E per-task concurrency proof | `[x]` | `e76954d4` |
| I | Status tracker + memory update | `[x]` | (this commit) |

## Phase 2 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2344 tests passing (TypeScript lint, MCP tests, frontend vitest, Rust clippy, cargo shear, knip, Rust nextest) |
| 0 references to `Arc<RwLock<SchaltwerkCore>>` in production code | ✅ pinned by `project_schaltwerk_core_field_is_lock_free` (compile-time fn-pointer assertion) |
| 0 references to `get_core_read`, `get_core_read_for_project_path`, `get_core_write`, `get_core_write_for_project_path` | ✅ deleted from `main.rs`; `grep -rn 'get_core_read\|get_core_write' src-tauri/src/` returns only doc-comment references |
| 0 references to `LAST_CORE_WRITE` | ✅ deleted |
| 0 references to `ProductionOrchestratorBundle`, `ConfirmStageResources`, `snapshot_from_core`, `confirm_stage_against_snapshot`, `with_production_orchestrator` | ✅ deleted in `3158fe0a` |
| `Project::schaltwerk_core` field is `Arc<SchaltwerkCore>` (not `Arc<RwLock<…>>`) | ✅ pinned structurally |
| `TaskLockManager` exists at `src-tauri/src/infrastructure/task_lock_manager.rs` with 5 unit tests | ✅ |
| `e2e_per_task_concurrency` proves cross-task parallelism + same-task serialization + per-project scoping | ✅ 3 tests in `tests/e2e_per_task_concurrency.rs` |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |

## Wave E sub-wave breakdown

The Wave E sweep dispatched three parallel agents on disjoint files
per `feedback_parallel_agents_disjoint_files.md`. Each agent made
mechanical `get_core_read/write* → get_core_handle*` substitutions
and ran `cargo check` against its scope; the coordinator collected
diffs and committed per sub-wave. ~125 call sites swept across 6
files. Wave F repeated the pattern for the 40 callers that bypassed
the entry points and acquired `project.schaltwerk_core.read/write()`
directly.

Notable mid-flight discovery: 6 sites in `mcp_api.rs` used
`core.database()` (a method on `SchaltwerkCore` that `CoreHandle`
initially lacked). Adding `CoreHandle::database()` for parity
(`ffca692d`) made all subsequent migrations pure name-change edits.

## Wave E.0 audit result

The plan's §0 enumeration flagged ~10 candidate Cat-D
multi-statement-without-explicit-transaction sites. The audit pass
(grep + body inspection) confirmed **zero** genuine Cat-D sites:
each candidate resolves to Cat A (read-only), Cat B (single
`db.set_*`), or Cat C (manager method that wraps
`conn.transaction(...)` internally). The lock removal does not
change the synchronization contract for any non-task surface.

## Phase 3 — wave-by-wave detail

Phase 3 ships in **additive scope**: the new orthogonal axes
(`Session.is_spec`, `Session.cancelled_at`, `Task.cancelled_at`),
the `SessionLifecycleState` derived getter, and the `SlotKind`
runtime-only enum land alongside the v1 shape. The legacy enums
`SessionStatus` and `SessionState` and the `Session.status` /
`Session.session_state` columns are **retained** for the
~173 production call sites that still read them. Phase 4 (or a
dedicated Phase 3.5) will sweep those callers to the new shape and
drop the legacy columns. `RunRole`, `TaskStage::Cancelled`, and
`Session.task_role` are fully removed in this phase per plan §10.

| Wave | Title | Status | Commit |
|---|---|---|---|
| A | Phase 3 implementation plan + design-doc updates | `[x]` | `755875af` |
| B | `Task.cancelled_at` field + `is_cancelled` accessor | `[x]` | `dc8c568a` |
| C | Schema columns (sessions.is_spec, sessions.cancelled_at, tasks.cancelled_at) | `[x]` | `0e67632d` |
| D.1 | `SlotKind` runtime-only enum (RunRole successor) | `[x]` | `37b217e9` |
| D.2.a | orchestration.rs: SlotKind sweep | `[x]` | `1b80f14f` |
| D.2.b | prompts.rs: SlotKind sweep | `[x]` | `c83c35c0` |
| D.2.c | presets/clarify/service/commands: SlotKind sweep | `[x]` | `0843826a` |
| D.3 | drop RunRole enum; drop Session.task_role field | `[x]` | `49e476ea` |
| D.4 | one-shot v1→v2 task_role column drop migration | `[x]` | `abe45d9a` |
| E.1+E.2 | drop TaskStage::Cancelled; collapse to task.cancelled_at | `[x]` | `13371910` |
| E.3 | one-shot v1→v2 task_cancelled migration | `[x]` | `343f6872` |
| F.1 | Session.is_spec + cancelled_at + SessionLifecycleState (additive) | `[x]` | `287c52f2` |
| F.7 | one-shot v1→v2 session_status backfill migration | `[x]` | `38af5813` |
| G | full validation (just test green at 2366 tests) | `[x]` | (this commit's predecessor) |
| H | status tracker + memory update | `[x]` | (this commit) |

**Deferred to Phase 4 (or follow-up Phase 3.5):**
- Wave F.2–F.6: the ~173-site call-site sweep that migrates every
  consumer of `Session.status` / `Session.session_state` to read
  `Session.is_spec` / `Session.cancelled_at` / `lifecycle_state()`.
- The drop of `Session.status` / `Session.session_state` columns
  via the SQLite table-rebuild dance (depends on the sweep
  completing first).
- Wire-format adapter for `info.session_state` / `info.status`
  strings synthesized from the derived getter (the existing
  serialization paths still read the legacy enum fields).

These deferrals do not weaken Phase 3's design intent: the new
orthogonal axes are populated and authoritative for any code that
reads them; the legacy enums coexist as compatibility shims
populated by the same writes.

## Phase 3 — definition of done check (additive scope)

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2366 tests passing across TS lint, MCP, vitest, clippy, cargo shear, knip, nextest |
| 0 references to `pub enum RunRole` in production code | ✅ deleted in `49e476ea`; pinned by absence + 0 grep hits |
| 0 references to `TaskStage::Cancelled` in production code | ✅ pinned by `task_stage_has_seven_variants_not_eight` (compile-time exhaustive match without wildcard) |
| 0 references to `Session.task_role` field in production code | ✅ deleted in `49e476ea` |
| `Task.cancelled_at: Option<DateTime<Utc>>` field exists | ✅ pinned by `task_cancelled_at_field_is_option_datetime` (compile-time fn-pointer assertion) |
| `Session.is_spec: bool` field exists | ✅ pinned by `session_is_spec_field_is_bool` |
| `Session.cancelled_at: Option<DateTime<Utc>>` field exists | ✅ pinned by `session_cancelled_at_field_is_option_datetime` |
| `SessionLifecycleState` runtime-only enum with 4 variants | ✅ pinned by `session_lifecycle_state_has_four_variants` (exhaustive match) |
| `SlotKind` runtime-only enum, NOT serializable | ✅ defined without `Serialize`/`Deserialize`/`FromStr` derives |
| All four one-shot migrations idempotent with archive forensics | ✅ `v1_to_v2_run_role` (D.4), `v1_to_v2_task_cancelled` (E.3), `v1_to_v2_session_status` (F.7) — each has `noop_on_v2_native_db` + `idempotent_repeat_run` tests |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |
| `plans/2026-04-29-task-flow-v2-status.md` Phase 3 row marked `[x]` | ✅ |
| Auto-memory updated | (next commit) |

---

## Phase 4 — wave-by-wave detail (in progress; B+C complete, D–H pending)

Phase 4's full scope per the plan is large enough that the work is
landing in two pushes. The first push (this status update) ships
**Waves B and C**: rewire every production writer of the legacy
`Session.status` / `Session.session_state` columns to the orthogonal
axes (`is_spec` / `cancelled_at`), and migrate every production reader
likewise. The second push (next session) will ship Wave D (delete the
enums, drop the columns), Wave E (TaskFlowError + 23-command sweep),
Wave F (derived `current_*` getters), Wave G (validation), and Wave H
(memory + status-doc finalize).

| Wave | Title | Status | Commit |
|---|---|---|---|
| A | Phase 4 plan + audit (incl. Phase-3 wiring-gap discovery) | `[x]` | `f559d20b` (in same commit as B.0) |
| B.0 | Wire `is_spec` / `cancelled_at` through INSERT, SELECT, hydrators | `[x]` | `f559d20b` |
| B.1 | `service.rs::finalize_session_cancellation` stamps `cancelled_at` synchronously | `[x]` | `a59b9cd7` |
| B.2 | `lifecycle/cancellation.rs::finalize_cancellation` rewire + cascading filter & test fixes | `[x]` | `b2665575` |
| B.3 | Delete dead `finalize_state_transition` | `[x]` | `3a03e452` |
| B.4 | Delete dead public `update_session_state` service method | `[x]` | `45545695` |
| B.5 | Delete `schaltwerk_core_update_session_state` Tauri command | `[x]` | `bb2cd8fb` |
| B.6 | Delete `normalize_spec_state` + dead repository wrappers | `[x]` | `0b76e8d6` |
| C.1 | Read sweep: stage/activity/action_prompts/facts_recorder/consolidation_stub + commands/schaltwerk_core/tasks + lifecycle/cancellation/finalizer + tasks/service/auto_advance + utils.rs | `[x]` | `4818fc99` + `89503a07` |
| C.2 | Read sweep: domains/sessions/service.rs + mcp_api.rs + mcp_api/diff_api.rs (27 sites incl. consolidation 3-arm) | `[x]` | `42da5d10` |
| C.3 | Read sweep: domains/merge/service.rs + commands/github.rs spec guards | `[x]` | `c665f03c` |
| D.0 | SessionInfo wire-format string conversion + ready_to_merge sig change | `[x]` | `7de87b5a` |
| D.1+D.2+D.3 | Delete `SessionStatus` + `SessionState` enums + struct fields + DB SQL bindings (atomic — splitting across commits would leave the build red) | `[x]` | `4548291d` |
| D.4+D.5 | `v2_drop_session_legacy_columns` migration + structural pins + DB round-trip test | `[x]` | `ac705306` |
| E.1 | Define `TaskFlowError` canonical error type | `[x]` | `5343478d` |
| E.2 | Migrate 23 task commands to `Result<_, TaskFlowError>` | `[x]` | `9e799305` |
| E.3+E.4 | Frontend handler + delete legacy `SchaltError::TaskNotFound`/`TaskCancelFailed`/`StageAdvanceFailedAfterMerge` | `[x]` | `00295926` |
| F | Derived `current_spec` / `current_plan` / `current_summary` getters + `v2_drop_task_current_columns` migration + DB round-trip tests | `[x]` | `2dbe0f3e` |
| G | Final validation (grep verification, cargo clippy, just test green at 2391) | `[x]` | (this commit) |
| H | Status doc + memory update | `[x]` | (this commit) |

### Phase 4 — what landed in waves B + C

**Audit findings (from §0 of the Phase 4 plan):**
- Six production writers of `Session.status` / `Session.session_state`
  identified and rewired; the original Phase 3 framing of "read-only
  compat shims" was incorrect.
- Critical Phase 3 wiring gap discovered: the `is_spec` and
  `cancelled_at` columns existed in the SQLite schema and on the
  `Session` struct, but the SELECT/INSERT/hydrator path never bound
  them. Every Session loaded from DB returned `is_spec=false,
  cancelled_at=None` regardless of what was stored. This made
  `Session::lifecycle_state(...)` return wrong projections — but
  no production code currently called the getter, so the bug was
  dormant. Closed in Wave B.0.

**Two-way binding contract held throughout:** every writer rewire
shipped with a regression test that fails on revert. Existing tests
that pinned the v1 contract (`assert_eq!(session.status,
SessionStatus::Cancelled)`) were bulk-updated to the v2 contract
(`assert!(session.cancelled_at.is_some())`).

**~250 production read sites collapsed to ~40.** Most "sites" in the
audit count were in test code (which Wave D handles when the enums get
deleted) or in the `SessionInfoBuilder` wire-format adapter (which Wave
D reworks to compute its outputs from the orthogonal axes). The actual
production read migrations across waves C.1–C.3 numbered ~40, all
behind structural assertions.

**Tests at end of Wave C: 2371 / 2371 passing.** No mid-wave red trees.

### Phase 4 — what landed in waves D + E + F + G + H (second push)

**Wave D (sessions enum collapse — atomic):**
- `SessionInfoBuilder` reworked to synthesize wire-format strings from
  `Session::lifecycle_state(...)` instead of reading the legacy enum
  fields directly.
- `SessionInfo.session_state: SessionState` → `String`. Both legacy
  enums used `#[serde(rename_all = "lowercase")]` so the JSON wire
  bytes are unchanged for the frontend.
- `build_ready_to_merge_state` and `compute_ready_to_merge_for_event`
  signatures changed from `&SessionState` to `is_running: bool`.
- `SessionStatus` and `SessionState` enums deleted (~80 lines).
- `Session.status` and `Session.session_state` struct fields removed.
- 69 fixture sites across 20 files migrated to drop the legacy field
  initializers (resurvey: bigger than the plan's "30+" estimate;
  the long tail was test-only sites).
- DB layer: legacy columns dropped from CREATE TABLE; INSERT/SELECT
  bindings removed; row.get(N) indices shifted; trait setters
  retired (`update_session_status` / `update_session_state`).
- `list_sessions_by_state(state: SessionState)` signature changed
  to `is_spec: bool`.
- `idx_sessions_status` / `idx_sessions_status_order` indexes dropped.
- New migration `v2_drop_session_legacy_columns` performs the
  SQLite table-rebuild dance with archive table
  `sessions_v2_status_archive` for forensics. 7 migration tests
  including the **end-to-end v1-shape DB test** that sets up three
  representative rows (Active, Cancelled, Spec), runs the full
  migration chain, and asserts the orthogonal axes match what the
  v1 enum projection would have said.
- Structural pins: `Session::lifecycle_state` signature pinned via
  fn-pointer coercion. `to_wire_string` return type pinned. **DB
  round-trip test for `lifecycle_state` (Wave D.5)** that goes
  through the actual write path (`db.create_session(...) →
  db.get_session_by_id(...).lifecycle_state(...)`) — per
  `feedback_compile_pins_dont_catch_wiring.md`, compile pins prove
  the field exists; only the round-trip proves the SELECT/INSERT
  path serves it.

**Wave E (TaskFlowError sweep):**
- New `domains/tasks/errors.rs` module with `TaskFlowError`
  tagged-enum (10 variants).
- 23 task commands in `commands/tasks.rs` migrated from
  `Result<_, String>` (or `Result<_, SchaltError>`) to
  `Result<_, TaskFlowError>`.
- Frontend `src/types/errors.ts` gains `TaskFlowError` discriminator
  + `formatTaskFlowError` mapper. `getErrorMessage` checks
  `TaskFlowError` first (it can wrap a `SchaltError` via the
  `Schalt(...)` variant), then SchaltError, then string fallback.
- `SchaltError` sheds the 3 task variants
  (`TaskNotFound`, `TaskCancelFailed`,
  `StageAdvanceFailedAfterMerge`); they live in TaskFlowError
  natively now.
- `From<SchaltError> for TaskFlowError` impl collapsed to the
  uniform `Self::Schalt(other)` arm.

**Wave F (derived `current_*` getters):**
- `Task::current_spec(&db)` / `current_plan(&db)` / `current_summary(&db)`
  derived getters added. They wrap `Database::get_current_task_artifact(task_id, kind)`,
  filtering `task_artifacts` by `is_current = true` and matching
  `artifact_kind`.
- `current_spec` / `current_plan` / `current_summary` fields removed
  from the `Task` struct.
- Denormalized-column mirror block in `service.rs::update_content`
  deleted; the artifact's `is_current = true` flag is the canonical
  source of truth.
- `prompts.rs::build_stage_run_prompt` signature gains
  `current_spec: Option<&str>` and `current_plan: Option<&str>`
  parameters; callers pre-resolve via the derived getters.
- DB layer: setters retired, INSERT/SELECT bindings removed, row.get
  indices shifted -3, `from_row` updated.
- New migration `v2_drop_task_current_columns` drops the columns via
  the table-rebuild dance with `PRAGMA foreign_keys = OFF` (the FK
  on `task_runs.task_id` is `ON DELETE CASCADE` which would
  cascade-delete the runs during the rebuild's DROP TABLE step).
  Archive table `tasks_v2_drop_current_archive` for forensics.
  5 migration tests.
- Structural pin: `Task::current_*` method signatures fn-pointer
  coerced.
- **DB round-trip tests for the derived getters** going through the
  actual write path (`mark_task_artifact_current` → re-read via
  `task.current_spec(&db)`). Pins both initial-None and
  after-replacement-returns-revised cases. Plus a test that verifies
  the kind dispatch picks the right artifact_kind through the query
  (a Spec artifact must NOT show up under current_plan).

**Wave G (final validation):**
- `just test` green at 2391 / 2391 tests.
- `cargo clippy -p lucode --tests`: 0 errors (only pre-existing warnings).
- Wave G grep verification: `pub enum SessionStatus`, `pub enum SessionState`,
  `task.current_spec` field reads, `SchaltError::TaskNotFound|TaskCancelFailed|StageAdvanceFailedAfterMerge`
  all return zero hits in production code.

**Wave H (status doc + memory update):**
- This file's Phase 4 row marked `[x]`.
- Sub-wave commit hashes captured in the table above.

### Phase 4 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2391 / 2391 passing |
| 0 references to `pub enum SessionStatus` in production code | ✅ deleted in `4548291d` |
| 0 references to `pub enum SessionState` in production code | ✅ deleted in `4548291d` |
| 0 references to `Session.status` / `Session.session_state` field reads in production code | ✅ Wave G grep clean |
| 0 references to `Task.current_spec` / `current_plan` / `current_summary` field reads in production code | ✅ Wave G grep clean |
| 0 task command return signatures of `Result<_, String>` or `Result<_, SchaltError>` in `commands/tasks.rs` | ✅ all migrated to `Result<_, TaskFlowError>` |
| `SchaltError` no longer has `TaskNotFound`, `TaskCancelFailed`, `StageAdvanceFailedAfterMerge` | ✅ deleted in `00295926` |
| `domains/tasks/errors.rs::TaskFlowError` exists with tagged-enum format | ✅ pinned by `task_flow_error_serializes_with_tagged_enum_format` |
| `Task::current_spec(&db)` / `current_plan(&db)` / `current_summary(&db)` derived getters exist | ✅ pinned by `task_current_artifact_methods_are_pinned` |
| `v2_drop_session_legacy_columns` migration idempotent + has end-to-end v1-shape test | ✅ 7 tests in the migration module |
| `v2_drop_task_current_columns` migration idempotent + archive table | ✅ 5 tests in the migration module |
| `Session::lifecycle_state` DB round-trip test goes through the actual production write/read paths | ✅ `lifecycle_state_round_trips_through_production_write_and_read_paths` (per `feedback_compile_pins_dont_catch_wiring.md`) |
| `Task::current_spec` DB round-trip test goes through the actual production write/read paths | ✅ `current_spec_round_trips_through_write_and_read_paths` and `current_plan_round_trips_independent_of_other_kinds` |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |

---

## Phase 5 — wave-by-wave detail

Phase 5's plan: [`2026-04-29-task-flow-v2-phase-5-plan.md`](./2026-04-29-task-flow-v2-phase-5-plan.md).

All waves complete. Phase 5 ships the explicit `lucode_task_run_done`
MCP tool (per design §8). The tool is the canonical primary signal for
run completion; the OSC/idle heuristic stays as a fallback for agents
that don't cooperate. `status: "ok"` writes `session.first_idle_at`
(strict superset of the OSC heuristic — both paths write the same
column). `status: "failed"` writes `task_runs.failed_at` +
`failure_reason` (authoritative source for agent self-reported failure;
distinct from PTY-exit failure observed via `session.exit_code`).

| Wave | Title | Status | Commit |
|---|---|---|---|
| A | Phase 5 plan + status row | `[x]` | `76bb0591` |
| B | `TaskRunService::report_failure` + `lucode_task_run_done` Tauri command + tests + service re-exports | `[x]` | `247477b6` |
| C | REST handler `POST /api/task-runs/{id}/done` + path-extractor tests | `[x]` | `cfe02c14` |
| D | MCP server tool registration (bridge + schema + tool description) | `[x]` | `fcd49d26` |
| E | TauriCommands enum + design-doc §8 update + Phase 5 DoD check | `[x]` | (this commit) |

## Phase 5 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2400 tests passing across TS lint, MCP, vitest, clippy, cargo shear, knip, nextest |
| `lucode_task_run_done` Tauri command registered | ✅ `commands::tasks::lucode_task_run_done` in `main.rs` invoke handler list |
| `POST /api/task-runs/{id}/done` REST route exists | ✅ dispatch case in `mcp_api.rs:486-491`; `extract_run_id_for_action` helper + 2 unit tests |
| `lucode_task_run_done` MCP tool registered | ✅ tool entry, `LucodeTaskRunDoneArgs`, switch case in `mcp-server/src/lucode-mcp-server.ts`; `LucodeBridge.taskRunDone` in `lucode-bridge.ts`; output schema in `schemas.ts` |
| `TauriCommands.LucodeTaskRunDone` exists | ✅ `src/common/tauriCommands.ts:131` |
| `TaskRunService::report_failure` exists with round-trip test | ✅ `domains::tasks::runs::tests::report_failure_round_trips_through_compute_run_status` (per `feedback_compile_pins_dont_catch_wiring.md`) |
| `set_task_run_failed_at` doc rewritten to drop "Migration-only" framing | ✅ `db_tasks.rs:109-117` |
| `status: "ok"` writes `first_idle_at`, NOT `confirmed_at` | ✅ pinned by `lucode_task_run_done_with_status_ok_records_first_idle` (positive: first_idle_at landed; negative: confirmed_at stayed None) |
| `status: "failed"` writes `failed_at`, NOT `session.exit_code` | ✅ pinned by `lucode_task_run_done_with_status_failed_marks_run_failed` (positive: failed_at + failure_reason landed; negative: exit_code stayed None) |
| Lineage check rejects sessions not bound to the run | ✅ `lucode_task_run_done_rejects_session_not_bound_to_run` |
| Idempotency: second `status: "ok"` call does not overwrite `first_idle_at` | ✅ `lucode_task_run_done_status_ok_is_idempotent` |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |
| Design doc §8 reflects landed tool shape | ✅ updated in this commit |

### Phase 5 — known limitation (closed by Phase 5.5)

`get_session_by_id` had a pre-existing wiring gap (6 fact columns
missing). Phase 5 deferred the fix; **Phase 5.5 closed it.** See the
Phase 5.5 wave detail below for the full audit and fix.

---

## Phase 5.5 — wave-by-wave detail

Phase 5.5's plan: [`2026-04-29-task-flow-v2-phase-5.5-plan.md`](./2026-04-29-task-flow-v2-phase-5.5-plan.md).

All waves complete. Phase 5.5 closed three hydrator wiring gaps that
the Phase 5 audit surfaced (`get_session_by_id`, `get_session_by_name`,
and `hydrate_session_summaries`) and added an architecture test that
guards against the same class of bug recurring.

| Wave | Title | Status | Commit |
|---|---|---|---|
| A | Phase 5.5 plan + audit (13 hydrators across 4 modules) | `[x]` | `8a898082` |
| B+C | `get_session_by_id` + `get_session_by_name` use shared `row_to_session_with_facts` (twin-fix) | `[x]` | `df52f83f` |
| D | `list_sessions*` hydrators carry fact columns via shared SELECT const + `row_to_session_summary` helper | `[x]` | `d29fd503` |
| E | `arch_hydrator_completeness.rs` — pinned column counts for 6 entity tables | `[x]` | `cceb999e` |
| F | Status doc + memory update | `[x]` | (this commit) |

## Phase 5.5 — definition of done check

| Criterion | Status |
|---|---|
| `just test` green | ✅ 2404 tests passing |
| `get_session_by_id` returns the 6 fact columns | ✅ pinned by `get_session_by_id_round_trips_fact_columns` |
| `get_session_by_name` returns the 6 fact columns | ✅ pinned by `get_session_by_name_round_trips_fact_columns` |
| `list_sessions_by_state` returns the 6 fact columns | ✅ pinned by `list_sessions_by_state_round_trips_fact_columns` |
| 0 inline `\|row\| Ok(Session { … })` blocks in `db_sessions.rs` for full-Session lookups | ✅ all 3 lookups now share `row_to_session_with_facts`; the 3 list_* hydrators share `row_to_session_summary` |
| `arch_hydrator_completeness` test passes for 6 entity tables (sessions, tasks, task_runs, task_artifacts, specs, epics) | ✅ |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |

### Phase 5.5 — known follow-up surfaced

The `arch_hydrator_completeness` audit revealed a **vestigial column**
on the `sessions` table: `stage TEXT` (added in `db_schema.rs:575`).
No hydrator reads it; the active column for task-stage projection is
`task_stage`. The test currently expects 52 columns to acknowledge
this column exists; a future cleanup should drop `stage` via the
SQLite table-rebuild dance and bump the expected count to 51.
Out of scope for Phase 5.5 — closing one wiring gap and surfacing the
next is the right scope for the interlude.

---

## Phase 6 — wave-by-wave detail

Phase 6's plan: [`2026-04-29-task-flow-v2-phase-6-plan.md`](./2026-04-29-task-flow-v2-phase-6-plan.md).

All waves complete. Phase 6 splits the 2236-line `Sidebar.tsx` monolith
into focused helper, hook, and view modules under
`src/components/sidebar/{helpers,hooks,views}/`. Final `Sidebar.tsx` is
**494 lines** — a thin projection that composes hook returns and
renders five sub-components (`SidebarHeaderBar`, `OrchestratorEntry`,
`SidebarSearchBar`, `SidebarSessionList`, `SidebarModalsTrailer`).

| Wave | Title | Status | Commit |
|---|---|---|---|
| (plan) | Phase 6 plan | `[x]` | `8c0d9573` |
| A.1 | Extract `versionGroupings` helpers | `[x]` | `ac1d97b3` |
| A.2 | Extract `sectionCollapse` helpers | `[x]` | `37b70a59` |
| A.3 | Extract `selectionMemory` helper | `[x]` | `d0d04840` |
| A.4 | Extract `buildConsolidationGroupDetail` | `[x]` | `daba3805` |
| B.1 | Extract `SidebarModalsTrailer` view | `[x]` | `c8d2aceb` |
| B.2 | Extract `SidebarHeaderBar` view | `[x]` | `4c90ed35` |
| B.3 | Extract `OrchestratorEntry` view | `[x]` | `8aac8236` |
| B.4 | Extract `SidebarSearchBar` view | `[x]` | `d480ecc9` |
| C.1 | Extract `SidebarVersionGroupRow` view | `[x]` | `4f2a35ef` |
| C.2 | Extract `SidebarSectionView` | `[x]` | `d484418e` |
| C.3 | Extract `SidebarSessionList` view | `[x]` | `9016c767` |
| D | Extract `buildSessionCardActions` factory | `[x]` | `28b1f3a6` |
| E.1 | Extract `useSidebarCollapsePersistence` | `[x]` | `8194fbbd` |
| E.2 | Extract `useConsolidationActions` | `[x]` | `43cc5da3` |
| E.3 | Extract `useConvertToSpecController` | `[x]` | `ac27b1ed` |
| E.4 | Extract `useGitlabMrDialogController` (+ `createSafeUnlistener` helper) | `[x]` | `8d3c407f` |
| E.5 | Extract `useMergeModalListener` | `[x]` | `bec2c696` |
| E.6 | Extract `useVersionPromotionController` | `[x]` | `92bf64d5` |
| F.1 | Extract `useOrchestratorBranch` | `[x]` | `817428c3` |
| F.2 | Extract `usePrDialogController` | `[x]` | `d60f6659` |
| F.3 | Extract `useSidebarBackendEvents` | `[x]` | `a2afc339` |
| F.4 | Extract `useSessionScrollIntoView` | `[x]` | `4b673df4` |
| F.5 | Extract `routeMergeConflictPrompt` helper | `[x]` | `ec45fa22` |
| G | Extract `useSidebarSelectionMemory` (the 100-line effect) | `[x]` | `48b81e74` |
| H | Extract `useSidebarKeyboardShortcuts` | `[x]` | `b71fab19` |
| I.0 | Extract `buildSidebarModalSlots` factory | `[x]` | `39cbab8d` |
| I.* | 5 final extraction passes (selection actions, orchestrator entry actions, merge orchestration, sectioned sessions, session-edit callbacks, refine-spec flow) | `[x]` | `9f007bee` |
| I.1 | Add `arch_component_size.test.ts` with ratchet allowlist | `[x]` | `27eeaee7` |
| J | Manual smoke + status doc + memory + final commit | `[x]` | (this commit) |

## Phase 6 — definition of done check

| Criterion | Status |
|---|---|
| `Sidebar.tsx` ≤ 500 lines | ✅ 494 lines |
| Architecture test passes (`arch_component_size.test.ts`) | ✅ 3/3 sub-tests pass |
| Sidebar.tsx is NOT on the legacy oversized allowlist | ✅ |
| Stale-allowlist sub-test guards the ratchet | ✅ third sub-test fails the build if any allowlisted file drops below the cap without being removed from the list |
| 0 sibling-imports-from-parent under `src/components/sidebar/` (non-test) | ✅ verified via `grep "from.*['\"]\\./Sidebar['\"]" src/components/sidebar/` returning zero non-test hits |
| `buildConsolidationGroupDetail` re-exported from Sidebar.tsx for back-compat | ✅ `Sidebar.status-actions.test.tsx` import unchanged |
| All 271+ existing sidebar tests pass | ✅ 206 sidebar-scoped tests green; no test body changes (only mechanical import-path edits within scope) |
| `just test` green | ✅ 2404 Rust tests + 3290 vitest tests (3 new arch tests added in this phase) |
| `arch_domain_isolation` and `arch_layering_database` green | ✅ |
| Manual smoke checklist (deferred to user — see below) | 📋 to be ticked off interactively per the Wave J commit checklist |

### Phase 6 — final file layout

`src/components/sidebar/`:
- `Sidebar.tsx` (494 lines) — thin projection
- `helpers/`
  - `versionGroupings.ts` — pure groupers (flatten, byEpic, splitBySection)
  - `sectionCollapse.ts` — collapse-state types + normalizer
  - `selectionMemory.ts` — `createSelectionMemoryBuckets`
  - `consolidationGroupDetail.ts` — `buildConsolidationGroupDetail`
  - `modalState.ts` — shared modal-state types
  - `createSafeUnlistener.ts` — pure UnlistenFn wrapper
  - `routeMergeConflictPrompt.ts` — pure prompt + terminal-id builder
  - `buildSessionCardActions.ts` — 17-callback `SessionCardActions` factory
  - `buildSidebarModalSlots.ts` — 8-modal slot factory for the trailer
- `hooks/`
  - `useSidebarCollapsePersistence.ts` — epic + section collapse localStorage
  - `useConsolidationActions.ts` — judge + winner-confirm + toast
  - `useConvertToSpecController.ts` — modal + shortcut opener
  - `useGitlabMrDialogController.ts` — modal + listener
  - `useMergeModalListener.ts` — OpenMergeModal listener
  - `useVersionPromotionController.ts` — promote modal + selectBest + executePromotion
  - `useOrchestratorBranch.ts` — branch fetch + ProjectReady/FileChanges listeners
  - `usePrDialogController.ts` — modal + shortcut + listener
  - `useSidebarBackendEvents.ts` — SessionRemoved/GitOperationCompleted/FollowUpMessage
  - `useSessionScrollIntoView.ts` — layoutEffect scroll-into-view
  - `useSidebarSelectionMemory.ts` — the 100-line selection-memory effect
  - `useSidebarKeyboardShortcuts.ts` — useKeyboardShortcuts orchestration
  - `useSidebarSelectionActions.ts` — handleSelectOrchestrator/Session/Cancel + selectPrev/Next
  - `useOrchestratorEntryActions.ts` — onSwitchModel + onReset
  - `useSidebarMergeOrchestration.ts` — merge drafts + handlers + resolve-in-agent
  - `useSidebarSectionedSessions.ts` — versionGroups → sectionGroups → flattened/scoped
  - `useSessionEditCallbacks.ts` — handleRenameSession + handleLinkPr
  - `useRefineSpecFlow.ts` — runRefineSpecFlow + handleRefineSpecShortcut
- `views/`
  - `SidebarHeaderBar.tsx` — top bar (~67 lines)
  - `OrchestratorEntry.tsx` — orchestrator card (~106 lines)
  - `SidebarSearchBar.tsx` — filter row + search (~119 lines)
  - `SidebarSessionList.tsx` — scroll container + 3-mode dispatch (~196 lines)
  - `SidebarVersionGroupRow.tsx` — `<SessionVersionGroup>` wrapper (~80 lines)
  - `SidebarSectionView.tsx` — section header + epic-grouped + ungrouped (~125 lines)
  - `SidebarModalsTrailer.tsx` — 9-modal renderer (~213 lines)
- (existing siblings — unchanged) `SessionCard.tsx`, `SessionVersionGroup.tsx`, `KanbanView.tsx`, `KanbanSessionRow.tsx`, `CollapsedSidebarRail.tsx`, `EpicGroupHeader.tsx`, `SidebarSectionHeader.tsx`, `CompactVersionRow.tsx`, etc.

### Phase 6 — Wave J manual smoke checklist (to be ticked interactively)

The smoke checklist in
[`plans/2026-04-29-task-flow-v2-phase-6-plan.md`](./2026-04-29-task-flow-v2-phase-6-plan.md)
§"Manual smoke-test checklist" (sections A–H) is the contract for
verifying behavior identity. Run `bun run tauri:dev` against a project
that has at least one spec, one running session, one multi-version run
with 2+ candidates, and one cancelled task; walk every item under
A. Section structure / B. Views + collapsed rail / C. Selection +
keyboard nav / D. Task lifecycle (promote/cancel/reopen/switch stages)
/ E. Forge integration / F. Agents + spec workflows / G. Epics /
H. Notifications + cross-cutting; tick each box. Compare any visual
oddity against `task-flow@b1f38f63` before attributing it to Phase 6.

This step is a **user-driven verification gate**: the test suite
proves correctness, the smoke walk proves feature correctness (per
the user's kickoff: "type checking and test suites verify code
correctness, not feature correctness").

### Phase 6 — legacy oversized component allowlist (visibility)

The `arch_component_size.test.ts` ratchet allows 21 currently-oversized
`.tsx` components to remain over the 500-line cap as known debt. New
oversized files are prohibited; when any allowlisted file drops below
the cap, the third sub-test (stale-allowlist guard) forces removing it
from the list, which then enforces the cap on it permanently. Future
cleanup phases or scout-rule sweeps can pull these off one at a time:

| Lines | File | Notes |
|---|---|---|
| 4035 | `diff/UnifiedDiffView.tsx` | the heaviest legacy component; pierre/inline diff merge target for a future phase |
| 3556 | `modals/SettingsModal.tsx` | settings panels; could split per-section |
| 2424 | `terminal/Terminal.tsx` | xterm.js + agent lifecycle; tightly coupled to PTY adapter |
| 1949 | `terminal/TerminalGrid.tsx` | grid + tab management |
| 1382 | `diff/DiffFileList.tsx` | virtualized file list with diff-stats wiring |
| 1279 | `specs/SpecEditor.tsx` | markdown editor + clarification flow |
| 982 | `diff/PierreDiffViewer.tsx` | pierre integration |
| 903 | `git-graph/GitGraphPanel.tsx` | git graph rendering |
| 890 | `sidebar/SessionCard.tsx` | session card with all action wiring |
| 811 | `forge/ForgePrDetail.tsx` | PR detail + comments |
| 764 | `home/AsciiBuilderLogo.tsx` | landing-page ASCII art (mostly data) |
| 704 | `sidebar/SessionVersionGroup.tsx` | version-group card with consolidation actions |
| 700 | `shared/SessionConfigurationPanel.tsx` | new-session form |
| 643 | `modals/UnifiedSearchModal.tsx` | global search palette |
| 642 | `right-panel/CopyContextBar.tsx` | copy-context UI |
| 632 | `right-panel/RightPanelTabs.tsx` | right-panel tab orchestration |
| 600 | `sidebar/CompactVersionRow.tsx` | compact session row |
| 577 | `modals/NewSessionModal.tsx` | new session form |
| 543 | `modals/MergeSessionModal.tsx` | merge dialog with mode toggle |
| 516 | `diff/SimpleDiffPanel.tsx` | simple diff fallback |
| 509 | `modals/GitHubPrPromptSection.tsx` | PR prompt UI |
| 501 | `modals/PrSessionModal.tsx` | PR creation modal |

Each of these is "if you're refactoring me, take me off the list" —
the guard test enforces the rule going forward.

### Phase 6 — v2 charter complete

Phase 6 closes the v2 charter. All 7 design changes from
[`2026-04-29-task-flow-v2-design.md`](./2026-04-29-task-flow-v2-design.md)
have shipped:

1. ✅ Drop `TaskRunStatus` (Phase 1) — derived getter, dropped column
2. ✅ Per-task mutex (Phase 2) — global RwLock removed
3. ✅ Stage = immutable artifact production (Phase 4 derived `current_*` getters)
4. ✅ Drop `RunRole` (Phase 3) — `slot_key` only
5. ✅ Session state observable (Phase 3 + Phase 4) — `is_spec` / `cancelled_at`; legacy enums dropped
6. ✅ `TaskStage::Cancelled` → `task.cancelled_at` (Phase 3)
7. ✅ Canonical `TaskFlowError` (Phase 4)
8. ✅ Explicit `lucode_task_run_done` MCP tool (Phase 5)
9. ✅ Direct calls for domain coordination (Phase 1 + Phase 5 — no `OnceCell` dispatcher)
10. ✅ Sidebar split (Phase 6)

The vestigial `sessions.stage` column surfaced by Phase 5.5 stays as a
**post-charter cleanup item**, tracked in
[`2026-04-29-task-flow-v2-status.md`](./2026-04-29-task-flow-v2-status.md)
§"Phase 5.5 — known follow-up surfaced" — out of scope for Phase 6.

---

## Phase 7 — wave-by-wave detail (in progress)

Phase 7's plan: [`2026-04-29-task-flow-v2-phase-7-plan.md`](./2026-04-29-task-flow-v2-phase-7-plan.md).

In progress. Phase 7 rebuilds the frontend on top of v2's task aggregate
backend so the task surface becomes user-facing. Plan size after
review: 18–22 sub-waves across 5 thematic chunks (A–E). Realistic
timeline: 6–8 weeks of active dev with mid-flight splits expected.

| Wave | Title | Status | Commit |
|---|---|---|---|
| (plan) | Phase 7 plan landed (post-review pass; 12 decisions logged) | `[x]` | `1c00aa20` |
| A.1.a | Backend wire-shape: `TaskWithBodies` + `TaskRun.derived_status` + `domains::tasks::wire` helpers + handler enrichment | `[x]` | `ad1116f0` |
| A.1.b | 25 `TauriCommands` enum entries + `src/types/task.ts` + structural pinning tests | `[x]` | `95998fa8` |
| A.2 | Frontend task atoms (`tasksAtom` canonical; `Task.task_runs` is the run list) | `[x]` | `f7623aea` |
| A.3 | TasksRefreshed listener + typed `taskService` wrappers | `[x]` | `7ca1da75` |
| A.3.b | OSC-emit gap closure: `app_handle_registry` + `record_first_idle_on_db` emits `TasksRefreshed` | `[x]` | `5481458e` |
| B.1 | `useSidebarStageSections` + `buildStageSections` helper | `[x]` | `00b78bb2` |
| B.2 | `SidebarStageSection` view component | `[x]` | `455838af` |
| B.3 | Wire stage sections into `Sidebar.tsx` | `[x]` | `6622a6e8` |
| B.4 | Selection model: discriminated union (orchestrator / session / task / task-run / task-slot) | `[ ]` | — |
| C.1 | `TaskRow` shell + stage-action button + state-table affordance test | `[ ]` | — |
| C.2 | Inline run history rendering + optimistic + rollback `useTaskRowActions` | `[ ]` | — |
| C.3 | Multi-candidate slot rendering + generalized labeled-affordance / nudge-banner / state-table pattern (incl. merge-failure-mid-confirm row) | `[ ]` | — |
| D.1 | NewTaskModal + capture-session affordance + bulk-capture button + orchestrator agent affordance | `[ ]` | — |
| D.2 | v1→v2 specs → draft-tasks migration + e2e | `[ ]` | — |
| D.3 | Right-panel rebind for task selections + plan editor write path | `[ ]` | — |
| E.0 | Programmatic full-lifecycle e2e (`tests/e2e_task_lifecycle_full.rs`) | `[ ]` | — |
| E.1.lifecycle | Manual smoke walk: create → promote → run → confirm → push → done; cancel/reopen | `[ ]` | — |
| E.1.migration | Manual smoke walk: v1 DB migrates, draft tasks populated, content preserved | `[ ]` | — |
| E.2 | Status doc + memory + Phase 7 close-out | `[ ]` | — |

### Wave A.1 — what landed

A.1 split into A.1.a (backend, ~10k lines reachable) + A.1.b
(frontend, ~500 lines added) per `feedback_test_scope_discipline`.

**Wave A.1.a** (`ad1116f0`):
- New module `src-tauri/src/domains/tasks/wire.rs` with
  `TaskWithBodies` wrapper, `enrich_task_runs_with_derived_status`,
  `enrich_runs_with_derived_status`,
  `enrich_tasks_with_derived_run_statuses`, plus 8 pinning tests.
- `TaskRun.derived_status: Option<TaskRunStatus>` field added with
  `#[serde(default)]`; internal DB hydrators always carry None,
  handlers populate before serialization.
- Four read commands rewired (`lucode_task_get` returns
  `TaskWithBodies` now; `lucode_task_list`, `lucode_task_run_list`,
  `lucode_task_run_get` populate `derived_status`).
- `notify_task_mutation_with_db` and `notify_task_mutation` enrich
  `TasksRefreshedPayload` runs before emit; body fields stay omitted
  per the §0.3 split decision.
- Helpers re-exported through `services::` to satisfy
  `arch_layering_database`.

**Wave A.1.b** (`95998fa8`):
- 25 task aggregate entries added to `src/common/tauriCommands.ts`
  (the previously-extant `LucodeTaskRunDone` retained).
- New `src/types/task.ts` with v2-corrected types: no `'queued'` in
  `TaskRunStatus`, no `'cancelled'` in `TaskStage`, no `RunRole`,
  `derived_status: TaskRunStatus | null` on `TaskRun`,
  `TaskWithBodies extends Task` with three optional body fields.
- `assertDerivedStatus(run)` narrows non-null and throws on regression
  with run-id + stage in the message.
- 14 vitest pinning tests including `@ts-expect-error` witnesses for
  forbidden literals and `extends` checks for union shapes.

`just test` green at 2431 Rust + ~3300 vitest after each sub-wave.

---

Updated when each phase merges to `task-flow-v2`.
