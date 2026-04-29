# task-flow v2 — Phase 2 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the per-project `Arc<RwLock<SchaltwerkCore>>` (and the `get_core_read/write*` machinery, `LAST_CORE_WRITE`, `ProductionOrchestratorBundle::acquire`, `ConfirmStageResources::acquire`, `snapshot_from_core`, and the 5s timeout it was guarding) with two primitives: (a) a lock-free `CoreHandle` accessor that hands every caller a cheap clone of `(Database, repo_path)`; (b) a `TaskLockManager` that hands out per-task `Arc<Mutex<()>>` guards so concurrent operations on different tasks no longer serialize, while concurrent operations on the same task continue to.

**Architecture:** `SchaltwerkCore = { db: Database, repo_path: PathBuf }` where `Database: Clone` is internally synchronized (Arc-backed connection pool, WAL + `synchronous=NORMAL`) and `repo_path` is immutable. The `RwLock` therefore guarded *nothing useful once initialization completed* (per `project_schaltwerkcore_rwlock.md`). Phase 2 makes that explicit: `Project` ends with `schaltwerk_core: Arc<SchaltwerkCore>` (no lock), and the per-task serialization that some callers genuinely need is implemented directly on the granularity that matters via `TaskLockManager`. The DB pool's WAL is the only synchronization primitive Lucode needs for non-task work; we do not introduce a singleton process mutex for `lucode_core_*`.

**Tech Stack:** Rust + Tauri (`src-tauri/`), `tokio::sync::Mutex` for per-task locks (async-aware, integrates with the existing runtime), `dashmap` for the lock registry (already in `Cargo.toml` per `cargo tree | grep dashmap` — verify in Wave B0; otherwise add the dep), `cargo nextest` for tests.

---

## 0 — Scope clarifications resolved before this plan

- **`run_lifecycle_dispatch.rs` does not exist on `task-flow-v2`.** Phase 1 deliberately did not port it (the v2 cross-domain wiring goes through `infrastructure/session_facts_bridge.rs` instead — see Phase 1 §2 "Not ported from v1"). The user prompt's "async↔sync `block_on` dance in `run_lifecycle_dispatch.rs` (whatever survived Phase 1)" resolves to *nothing survived*; there is no dispatcher to retire in this phase. The bridge does still acquire a brief read guard on the existing `RwLock<SchaltwerkCore>` to clone the DB handle (`session_facts_bridge.rs:43,50`); that one read is replaced by the lock-free handle accessor in Wave F.

- **Timeout duration on the existing entry points is 5s, not 30s.** The baseline doc (frozen at v1 `b1f38f63`) recorded 30s; on `task-flow-v2` the timeouts at `main.rs:493,544,598,637` are all `Duration::from_secs(5)`. This plan removes the entry points entirely; the exact pre-removal duration is irrelevant.

- **MSRV is comfortably above 1.85.** `rustc 1.95.0` (Homebrew) on this machine; `src-tauri/Cargo.toml` declares `edition = "2024"` and pins no `rust-version`. `AsyncFnOnce` is stable. The `with_task_lock` helper in §1 keeps its proposed shape — no `Pin<Box<dyn Future>>` fallback needed.

- **No singleton mutex for non-task callers.** Per design doc §2 the option was open ("singleton mutex or accept that those serialize globally"). The decision in this plan is **neither** — we accept the existing internal synchronization of `Database` (WAL + connection pool) and remove the lock without replacement on the `lucode_core_*` / MCP / diff / session-refresh surfaces. Justification:
  1. `Database: Clone` is already an `Arc` over a connection pool with WAL; concurrent writers are serialized at the SQL layer, concurrent readers proceed in parallel.
  2. `SchaltwerkCore` has no other mutable in-memory state — only `db` and `repo_path` (both immutable handles after construction).
  3. A singleton mutex would *re-introduce* the global serialization Phase 2 is trying to delete, with the same useless-coordination shape `project_schaltwerkcore_rwlock.md` documents.
  4. If a concrete future caller needs cross-row atomicity, the right fix is `db.transaction(|tx| ...)`, not a process-global mutex.

  Document this in the commit and in `baseline.md` Phase-2-update section.

- **Call-site enumeration (consequential decision; reviewer should sanity-check each category against "is the WAL really enough here?").** The lock is being removed from ~127 call sites across these files (excluding `commands/tasks.rs`, which gets per-task locking; and the four `get_core_*` *definitions* in `main.rs`, which are deleted in Wave G):

| File | Sites | A. Read-only | B. 1-stmt write | C. Multi-stmt via internal `conn.transaction(...)` | D. Multi-stmt **without** explicit txn (audit) | E. DB + filesystem/git | F. DB + subprocess |
|---|---:|---:|---:|---:|---:|---:|---:|
| `commands/schaltwerk_core.rs` | 75 | ~18 | ~12 | ~25 | ~5 | ~12 | ~3 |
| `mcp_api.rs` | 40 | ~12 | ~5 | ~15 | ~3 | ~5 | 0 |
| `diff_commands.rs` | 5 | ~3 | 0 | 0 | 0 | ~2 | 0 |
| `commands/sessions_refresh.rs` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `commands/settings.rs` | 3 | 0 | 3 | 0 | 0 | 0 | 0 |
| `commands/schaltwerk_core/codex_model_commands.rs` | 2 | 0 | 2 | 0 | 0 | 0 | 0 |

  Per-category WAL sufficiency:

  - **A — Read-only DB queries (~35 sites).** `manager.list_sessions()`, `db.get_*()`, `db.list_*()`. WAL gives concurrent snapshot reads natively. The lock provided no exclusion these calls needed. **Safe.** Representative commands: `list_enriched_sessions`, `list_archived_specs`, `list_epics`, `list_sessions`, `get_session`, `get_spec`, `get_consolidation_stats`, `get_archive_max_entries`, `list_project_files`, `generate_session_name`, `generate_commit_message`, REST GETs for sessions/epics/diff scope.
  - **B — Single-statement writes (~22 sites).** One `db.set_*` / `db.archive_*` / `db.delete_*` per call. SQLite WAL gives statement-level atomicity. **Safe.** Representative commands: `archive_spec_session`, `restore_archived_spec`, `delete_archived_spec`, `set_archive_max_entries`, `create_epic`, `update_epic`, `delete_epic`, `set_item_epic`, `set_agent_type` (and its session/orchestrator/spec variants), the three settings handlers, the two codex-model handlers, the REST equivalents.
  - **C — Multi-statement via internal `conn.transaction(...)` (~40 sites).** The Tauri command body calls one `SessionManager` (or equivalent) method that internally wraps its work in `conn.transaction(...)`. The lock added nothing on top of that — `conn.transaction` already gives all-or-nothing, and SQLite serializes writers via the WAL. **Safe.** Representative: `create_session`, `merge_session_to_main`, `merge_session_with_events`, `convert_session_to_draft`, `convert_version_group_to_spec`, `cancel_session`, `force_cancel_session`, `confirm_consolidation_winner`, `rename_version_group`, `trigger_consolidation_judge`, `start_improve_plan_round`, `cleanup_orphaned_worktrees`, the various agent-start commands, the REST counterparts.
  - **D — Multi-statement *without* an explicit transaction (~8 sites; the only ones flagged for individual review).** Two or more `db.set_*` / `db.insert_*` calls in sequence at the command-body level, where the lock *was* the only thing preventing a partial-failure window between calls. Concentrated in: `update_consolidation_outcome_vertical`, `update_git_stats`, and 3 multi-field consolidation/orchestrator update handlers in `mcp_api.rs`. **Action: in Wave E.0 (audit pass before the sweep), each Cat-D site is wrapped in an explicit `conn.transaction(...)` (or refactored to call an atomic manager method). Two-way binding: the audit pass adds a regression test per site that two interleaved Cat-D commands cannot leave a half-applied multi-write — the same guarantee the lock was implicitly providing.** This is the only place where "remove the lock" actually changes the synchronization contract; the audit is what makes it net-neutral.
  - **E — DB + filesystem/git work (~14 sites).** Worktree create/cleanup, git merge, diff materialization. The DB portion is one of A/B/C (all WAL-safe); the filesystem/git portion has its own ordering — but the lock was *not* what coordinated the filesystem side (concurrent file writes to disjoint paths were fine even under the lock; concurrent writes to the same path are still racy after the lock is gone, exactly as before). **Net: the lock's removal does not change FS/git ordering one way or the other.** Representative: `create_session`, `merge_session_*`, `forge_generate_writeback`, `cleanup_orphaned_worktrees`, the diff materialization paths.
  - **F — DB + subprocess (~3 sites).** Spawning consolidation agents, etc. The DB part is A/B/C. The subprocess spawn was never lock-dependent; the spawned agent runs against a session worktree that's already isolated. **Safe.**

  **Cat-D audit list (the explicit checklist Wave E.0 works through):**
  1. `commands/schaltwerk_core.rs::schaltwerk_core_update_consolidation_outcome_vertical` (~line 2266)
  2. `commands/schaltwerk_core.rs::schaltwerk_core_update_git_stats` (~line 2969)
  3. `commands/schaltwerk_core.rs` — 3 additional consolidation/orchestrator multi-field updates (Wave E.0 grep finalizes the list)
  4. `mcp_api.rs` — 3 REST handlers that update multiple consolidation fields (Wave E.0 grep finalizes)

  The expected outcome of the audit is "all Cat-D sites already use a manager method that wraps a transaction internally" — i.e. the count drops to ~0 once we read each call site's body. The 8-site upper bound is conservative; the exploration pass classified the function bodies but not every transitively-called manager method. If the audit confirms ≤2 sites genuinely need a `conn.transaction(...)` wrapper, that's a small Wave E.0 commit before the parallel sweep begins. If it confirms 0, even better.

  **What this list rules out:** there is no mention of state shared across calls within `SchaltwerkCore` itself (it's just `db` + `repo_path`). There is no in-memory cache the lock was guarding. There is no shared mutable map of session IDs that the lock was implicitly serializing. A reviewer doing the "is WAL enough?" check per site only needs to inspect the DB code path; nothing else was riding on the lock.

- **What we deliberately defer (Phases 3–6):**
  - Phase 3: drop `RunRole`, `SessionState`, `SessionStatus`. Phase 2 ports nothing from those.
  - Phase 4: `TaskFlowError` sweep. Phase 2 commands keep the `anyhow::Result` / `Result<_, String>` / `Result<_, SchaltError>` mix Phase 1 left in place.
  - Phase 5: explicit `lucode_task_run_done` MCP tool. Out of scope.
  - Phase 6: Sidebar split. No frontend work in this phase.

---

## 1 — End-state shape after Phase 2

### `Project` struct (`src-tauri/src/project_manager.rs:50-54`)

```rust
pub struct Project {
    pub path: PathBuf,
    pub terminal_manager: Arc<TerminalManager>,
    pub schaltwerk_core: Arc<SchaltwerkCore>,    // was Arc<RwLock<SchaltwerkCore>>
    pub task_locks: Arc<TaskLockManager>,        // NEW
}
```

`SchaltwerkCore` itself is unchanged. The `Arc` is kept because callers need a cheap clone they can hold across awaits. Dropping the `RwLock` is the load-bearing change.

### New module `src-tauri/src/infrastructure/task_lock_manager.rs`

```rust
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-task serialization registry. Operations on different tasks proceed
/// concurrently; operations on the same task serialize on the task's
/// `Arc<Mutex<()>>`.
///
/// Locks are scoped to a `Project` (one `TaskLockManager` per `Project`),
/// so tasks in different projects are never coordinated through a shared
/// lock. The `DashMap` is owned by the `Project` and dropped with it.
///
/// # Why this shape
///
/// - `DashMap` over `Mutex<HashMap<…>>`: lock-free reads of the registry
///   so concurrent operations on different tasks never contend on the
///   registry itself.
/// - `tokio::sync::Mutex` over `std::sync::Mutex`: callers hold the lock
///   across `.await` points (e.g. through `MergeService::merge_from_modal`
///   which spawns subprocesses and awaits them). A blocking std mutex
///   would either panic-hold across `.await` or force a `spawn_blocking`
///   dance.
/// - Lock value `()`: the lock is a coordination primitive, not a data
///   wrapper. Owners of the data (`Database`, services) are passed in
///   directly via the lock-free `CoreHandle`.
/// - No cleanup on task delete: ~40 bytes per ever-created task. Lucode
///   is a personal app (per `user_solo_macos.md`); the practical bound
///   is the number of tasks created in one app session, typically <100.
///   Project unload drops the whole map. If profiling ever flags this
///   as a leak, switch to `DashMap<TaskId, Weak<Mutex<()>>>`.
pub struct TaskLockManager {
    locks: DashMap<String, Arc<Mutex<()>>>,
}

impl TaskLockManager {
    pub fn new() -> Self {
        Self { locks: DashMap::new() }
    }

    /// Returns the lock for a task id. Creates an entry on first access.
    /// The returned `Arc<Mutex<()>>` is the only thing callers need; they
    /// invoke `.lock().await` on it and hold the resulting guard for the
    /// duration of the per-task critical section.
    pub fn lock_for(&self, task_id: &str) -> Arc<Mutex<()>> {
        if let Some(existing) = self.locks.get(task_id) {
            return existing.clone();
        }
        // Race-tolerant insert: if two callers race here, `entry().or_insert_with`
        // ensures both end up with the same Arc<Mutex>.
        self.locks
            .entry(task_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

impl Default for TaskLockManager {
    fn default() -> Self {
        Self::new()
    }
}
```

### New `CoreHandle` accessor on `Project` and `main.rs`

```rust
// project_manager.rs
impl Project {
    /// Cheap clone of the immutable resources every caller needs. Returns
    /// owned values so the caller can hold them across awaits without any
    /// guard. Replaces the v1 `get_core_read*`/`get_core_write*` pairs.
    pub fn core_handle(&self) -> CoreHandle {
        CoreHandle {
            db: self.schaltwerk_core.db.clone(),
            repo_path: self.schaltwerk_core.repo_path.clone(),
        }
    }
}

#[derive(Clone)]
pub struct CoreHandle {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl CoreHandle {
    pub fn session_manager(&self) -> SessionManager {
        SessionManager::new(self.db.clone(), self.repo_path.clone())
    }

    pub fn merge_service(&self) -> MergeService {
        MergeService::new(self.db.clone(), self.repo_path.clone())
    }
}

// main.rs (replaces get_core_read{,_for_project_path} and get_core_write{,_for_project_path})
pub async fn get_core_handle() -> Result<CoreHandle, String> { … }
pub async fn get_core_handle_for_project_path(project_path: Option<&str>)
    -> Result<CoreHandle, String> { … }
```

`get_core_handle*` resolves the active project (honoring `REQUEST_PROJECT_OVERRIDE`) and returns `Project::core_handle()`. No timeouts. No `OwnedRwLockReadGuard`. Fast path: `O(1)` clone of two `Arc`s.

### `commands/tasks.rs`: per-task lock applied at the orchestration boundary

The six task commands that mutate task lifecycle (`promote_to_ready`, `start_stage_run`, `start_clarify_run`, `confirm_stage`, `run_cancel`, `cancel`) each acquire `project.task_locks.lock_for(&task_id).lock().await` immediately after resolving the project, then run the orchestration against `CoreHandle`. The lock is held across the `.await` boundary so the `MergeService::merge_from_modal` subprocess work and `start_*_run` worktree creation continue to be exclusive *for that task*. Commands on other tasks proceed concurrently.

`ProductionOrchestratorBundle`, `ConfirmStageResources`, `snapshot_from_core`, and the `production_orchestrator_bundle_releases_global_write_guard_before_returning` regression test (commands/tasks.rs:1184) are deleted — they exist only to escape the global lock, which no longer exists.

### Files that disappear (or empty out) by end of Phase 2

| File | Disposition |
|---|---|
| `src-tauri/src/main.rs` `LAST_CORE_WRITE`, `get_core_read`, `get_core_read_for_project_path`, `get_core_write`, `get_core_write_for_project_path` | Deleted. |
| `src-tauri/src/commands/tasks.rs` `ProductionOrchestratorBundle`, `ConfirmStageResources`, `snapshot_from_core`, `confirm_stage_against_snapshot`, `with_production_orchestrator` | Deleted (or inlined where useful). |
| `src-tauri/src/commands/tasks.rs` `production_orchestrator_bundle_releases_global_write_guard_before_returning` test | Deleted (the contract it pinned no longer exists). |
| `src-tauri/src/commands/tasks.rs` `with_read_db` / `with_write_db` | Reduced to a single `with_core_handle` helper (the read/write split was meaningless once the lock provided no exclusion). |

### Files that change shape but do not disappear

| File | Change |
|---|---|
| `src-tauri/src/project_manager.rs` | `Project::schaltwerk_core` becomes `Arc<SchaltwerkCore>`; `current_schaltwerk_core` returns `Arc<SchaltwerkCore>`; new `core_handle()` and `task_locks` field. |
| `src-tauri/src/main.rs` | `get_schaltwerk_core{,_for_project_path}` return `Arc<SchaltwerkCore>` (signature change). New `get_core_handle{,_for_project_path}`. |
| `src-tauri/src/infrastructure/session_facts_bridge.rs` | Replaces `core_lock.read().await` with `Project::core_handle()`. |
| `src-tauri/src/commands/schaltwerk_core.rs` (75 sites), `src-tauri/src/mcp_api.rs` (40 sites), `src-tauri/src/diff_commands.rs` (5 sites), `src-tauri/src/commands/sessions_refresh.rs` (2 sites), `src-tauri/src/commands/settings.rs` (3 sites), `src-tauri/src/commands/schaltwerk_core/codex_model_commands.rs` (2 sites), `src-tauri/src/commands/tasks.rs` (10 sites) | `let core = get_core_read().await?` and `get_core_write().await?` patterns become `let core = get_core_handle().await?`. Body of each call site is otherwise unchanged — they were already using `core.db`, `core.repo_path`, `core.session_manager()` exactly the way the new `CoreHandle` exposes. |

---

## 2 — Migration order

The order is bounded by what each step depends on:

1. **Wave B — `TaskLockManager`** stands alone. New file. Tested in isolation.
2. **Wave C — `CoreHandle` accessor**, additive: introduces `get_core_handle*` *alongside* the existing `get_core_read/write*`. Gives every later wave a working target without breaking the world.
3. **Wave D — `commands/tasks.rs` migration**, the highest-risk single file. Introduces per-task locking and deletes the bundle/snapshot machinery. This wave is the one that proves the new model works for the orchestration surface.
4. **Wave E — sweep non-task callers** (parallel). Pure search-and-replace from `get_core_read`/`get_core_write` to `get_core_handle`. Splits across disjoint files for parallel agents.
5. **Wave F — bridge + recorder cleanup**, sequential.
6. **Wave G — drop the `RwLock` from `Project`**, sequential. This is the irreversible step that turns `Arc<RwLock<SchaltwerkCore>>` into `Arc<SchaltwerkCore>` and deletes `get_core_read{,_for_project_path}` and `get_core_write{,_for_project_path}`. By this wave every caller is on the new accessor; the old entry points have no live callers.
7. **Wave H — concurrency + integration tests**, sequential.
8. **Wave I — status + memory**, sequential.

Each wave commits independently. `just test` is green after every wave. No mid-phase gating with the user; the whole phase ships in one session.

### Non-task `get_core_*` callers — what happens to them

Per §0 above: removed entirely, replaced by `get_core_handle`. No singleton mutex. No serialization beyond what the DB pool provides. This is the **only correct answer** because:

- The lock served only as a "core exists" gate. `Project` is always fully constructed before it's stored in `ProjectManager::projects` (per `project_manager.rs:618-622`); there is no observable "core exists but is being torn down" window from the outside.
- Read-side callers (~80% of the 165 sites) obviously don't need exclusion — they're reading.
- Write-side callers all hit `Database` methods that go through the connection pool. Each individual SQL statement is atomic at the WAL layer. Multi-statement consistency is already handled per-method (e.g. `SessionMethods::create_session` is one transaction); removing the outer `RwLock<SchaltwerkCore>` doesn't change that.

The handful of *mixed* callers (read-then-write a derived value back) — if any — get an explicit `Database::transaction` wrap during Wave E if they need it. Initial scan suggests none exist on v2 outside what task command surface already does (and which is now serialized by the per-task lock anyway).

---

## 3 — Sub-wave breakdown for parallel execution

Per `feedback_parallel_agents_disjoint_files.md`: dispatch parallel agents on disjoint files with no-commit instructions; coordinator commits in waves. Phase 1 used the same pattern in Waves I.0–I.8.

```
Wave A   (sequential, this doc)         — plan + status doc rows
Wave B   (sequential, 1 file new)       — TaskLockManager + tests
Wave C   (sequential, 1 file edit)      — CoreHandle accessor (additive)
Wave D   (sequential, 1 file: tasks.rs) — per-task lock + handle migration
   D.1   port the 6 task lifecycle commands; delete bundle/snapshot
   D.2   reduce with_read_db/with_write_db → with_core_handle
   D.3   delete the bundle-release regression test
Wave E   (sequential audit then parallel sweep)
   E.0   Cat-D audit: each multi-stmt-no-txn site gets a transaction wrapper (or doc'd as already safe)
   E.1   commands/schaltwerk_core.rs (+ codex_model_commands.rs)   ← agent 1
   E.2   mcp_api.rs                                                  ← agent 2
   E.3   diff_commands.rs + sessions_refresh.rs + settings.rs        ← agent 3
   E.4   any stragglers found via final grep                         ← agent 4
Wave F   (sequential, 1 file edit)      — session_facts_bridge.rs + signature fanout
Wave G   (sequential, 2 file edits)     — drop RwLock from Project; delete dead entry points
Wave H   (sequential, 2 new test files) — concurrency proof + e2e
Wave I   (sequential, status doc)       — Phase 2 done row + sub-wave table
```

Wave E is the parallelizable one. The coordinator dispatches three agents (E.1/E.2/E.3 — E.4 is reserved for cleanup if E.1–E.3 miss anything). Each agent operates only on the files listed in its sub-wave, runs `cargo check` / `cargo nextest` on those files, and reports diffs without committing. The coordinator collects diffs, runs `just test` once, and commits per-sub-wave.

### Why Wave D doesn't fan out

`commands/tasks.rs` is one file (~2287 lines). Phase 1 Wave I.6 already ported it as one commit. Splitting Wave D across multiple agents would create merge conflicts inside the same file — the exact scenario `feedback_parallel_agents_disjoint_files.md` rules out.

### Wave G ordering

Wave G runs *after* the sweep so that by the time we delete `get_core_read{,_for_project_path}` and `get_core_write{,_for_project_path}` and change `Project::schaltwerk_core` to `Arc<SchaltwerkCore>`, no caller compiles against the old shape. The compiler enforces the migration at this boundary — if any caller was missed in Wave E, Wave G fails with a clean type error.

---

## 4 — Test strategy

Two-way binding tests per `feedback_regression_test_per_fix.md`. Every assertion that pins the per-task lock semantic must fail when the lock is removed in the implementation; every assertion that pins the lock-free handle accessor must fail if the accessor secretly takes the old global guard. Concurrency assertions are **deterministic** (per CLAUDE.md "no timing-based solutions") — `try_lock` and event ordering instead of timeouts.

### Wave B — `TaskLockManager` unit tests (in `task_lock_manager.rs::tests`)

| Test | Setup | Assertion | Two-way binding |
|---|---|---|---|
| `lock_for_returns_same_arc_on_repeat` | `mgr.lock_for("a")` twice | `Arc::ptr_eq(&first, &second)` | Replace `or_insert_with` with `insert` → second call gets fresh Arc → assertion fails |
| `lock_for_returns_different_arc_for_different_ids` | `mgr.lock_for("a")` and `mgr.lock_for("b")` | `!Arc::ptr_eq(&a, &b)` | Replace task_id with constant → both return same Arc → assertion fails |
| `same_task_serializes` | acquire `mgr.lock_for("a")`, then `try_lock` on a second clone | second `try_lock` returns `Err` (deterministic, no timeout) | If the lock value were per-call, `try_lock` would succeed → assertion fails |
| `different_tasks_do_not_serialize` | acquire `mgr.lock_for("a")`, then `try_lock` on `mgr.lock_for("b")` | second `try_lock` returns `Ok` | If `lock_for` returned a global mutex, `try_lock` would fail → assertion fails |
| `concurrent_first_access_race_resolves_to_one_arc` | spawn 16 tokio tasks each calling `lock_for("a")` and recording the `Arc`'s pointer; assert all 16 are pointer-equal | `entry().or_insert_with` is the contract; this is a regression test for the race-tolerant insert | Replacing the entry-API call with `insert(_, _, default)` would lose the race → at least one fork would observe a different Arc → assertion fails |

### Wave C — `CoreHandle` accessor

| Test | Setup | Assertion |
|---|---|---|
| `get_core_handle_returns_owned_clone` | call `get_core_handle()`, then call again | both calls succeed, both `db`s are independent clones (write to one is visible to the other; uses the in-memory project test fixture) |
| `core_handle_outlives_project_lookup` | `let h = get_core_handle().await?;` then write through `h.db` after dropping any reference to the project map | write succeeds (proves the handle owns its data, not a borrow) |

### Wave D — task command per-task lock

| Test | Setup | Assertion | Two-way binding |
|---|---|---|---|
| `promote_to_ready_serializes_with_start_stage_run_for_same_task` | drive `promote_to_ready` and `start_stage_run` against the same task in two tokio tasks; both routes use a stub provisioner that signals on a `tokio::sync::Notify` and awaits | observed call order is sequential (first command's provisioner Notify fires and completes before the second's) — observed via a `Vec<&'static str>` event log | Remove `task_locks.lock_for(task_id).lock().await` from one of the commands → events interleave → assertion fails |
| `start_stage_run_does_not_block_on_unrelated_task_id` | hold a guard on `task_locks.lock_for("task-a")`; drive `start_stage_run` against `task-b` in a second tokio task | the second tokio task's stub provisioner Notify fires within a single executor poll — proven via `try_lock` on `task_locks.lock_for("task-b")` succeeding mid-execution from the test thread | Replace per-task lock with a singleton mutex → `try_lock` on `task-b`'s registry entry fails → assertion fails |
| `cancel_task_run_serializes_with_confirm_stage_for_same_task` | identical pattern, different commands | event ordering is sequential | (same as row 1) |

The "stub provisioner" is the same `SessionProvisioner` trait Phase 1 already uses in `commands/tasks.rs::tests`. Adding a `notify_on_call: Arc<Notify>` field is a 5-line change.

### Wave E — sweep is mechanical, no new tests required beyond `just test` staying green

The contract being preserved is: every caller's externally visible behavior is unchanged. The existing test suite (~2333 tests as of Phase 1) is the contract. If `just test` stays green through E.1–E.4, the migration is correct. No new tests added for individual call sites; the original tests already covered them.

### Wave F — bridge migration

Existing `session_facts_bridge` tests (in `tests/run_status_integration.rs` and others) cover the recorder's behavior. The bridge change is purely structural (drop the read guard, use the handle); existing tests stay green.

### Wave G — `Arc<RwLock<…>>` removal

| Test | Assertion |
|---|---|
| `project_schaltwerk_core_field_is_lock_free` | structural; `Project::schaltwerk_core: Arc<SchaltwerkCore>` (not `Arc<RwLock<SchaltwerkCore>>`). Pinned by the type signature; if the field type regresses, the test file fails to compile. |
| `current_schaltwerk_core_returns_arc_schaltwerk_core` | structural; if regressed, doesn't compile. |
| `core_handle_is_independent_of_project_lifecycle` | obtain a `CoreHandle`, drop the `Arc<Project>`, and write through the handle's `db` — assert the write succeeds (proves the handle's `Database` clone outlives the project ref). |

These are partly compile-time assertions (the type signature *is* the test). One runtime assertion proves the handle's lifetime is independent of the project's.

### Wave H — end-to-end concurrency proof

New file: `src-tauri/tests/e2e_per_task_concurrency.rs`.

| Test | Setup | Assertion |
|---|---|---|
| `two_tasks_run_in_parallel_through_command_surface` | create tasks A and B in an in-memory project; drive `lucode_task_start_stage_run` for A in tokio task 1, suspended via stub provisioner Notify; drive `lucode_task_start_stage_run` for B in tokio task 2 | task 2 reaches its provisioner without waiting on task 1 (proven by ordering on a shared `Vec<TaskId>` event log; task 2's "provisioner entered" event appears before task 1's "provisioner Notify released" event) |
| `same_task_two_commands_serialize_through_command_surface` | drive `promote_to_ready` and `start_stage_run` on the same task in parallel | second command waits; ordering guaranteed (event log shows command 1's lock-released before command 2's lock-acquired) |

These are the load-bearing regression tests for the whole phase. They directly express the design contract from §2 of the design doc: *operations on different tasks proceed concurrently; operations on the same task serialize without blocking the rest of the app.*

### Architecture tests

`arch_domain_isolation` and `arch_layering_database` already exist. `TaskLockManager` is in `src/infrastructure/`, so it's allowed to be touched from anywhere. `CoreHandle` lives in `src/lib.rs` (or `src/main.rs` re-exported via `lib.rs`) — same place as the existing core accessors. Neither addition violates a layering rule. Verify in Wave H that both arch tests stay green.

---

## 5 — Wave-by-wave detail

### Wave A — plan + status row (sequential)

**A1.** Write this file (`plans/2026-04-29-task-flow-v2-phase-2-plan.md`).
**A2.** Add a row to `plans/2026-04-29-task-flow-v2-status.md`'s Phase 2 sub-wave table after the user approves the plan; that lands as part of Wave I.

No code, no commit yet. Surface for review.

### Wave B — `TaskLockManager` (sequential, TDD)

**B0.** Verify `dashmap` is in `Cargo.toml`. If absent, `cargo add dashmap` (last release on crates.io). Single source of truth: `src-tauri/Cargo.toml`.

**B1.** New file `src-tauri/src/infrastructure/task_lock_manager.rs` with the struct shape from §1 above, plus `#[cfg(test)] mod tests` covering the 5 cases in §4 Wave B. TDD per case: write failing test, run, observe failure, implement, run, observe pass.

**B2.** Wire `pub mod task_lock_manager;` into `src/infrastructure/mod.rs` and re-export `TaskLockManager` at the crate root (or via `infrastructure::task_lock_manager::TaskLockManager` — match the convention `session_facts_bridge` uses).

**B3.** Add `task_locks: Arc<TaskLockManager>` to `Project` in `project_manager.rs`. Initialize in `Project::new` and `Project::new_in_memory`. No usage yet — the field is dead-coded until Wave D, but `#![deny(dead_code)]` requires us to expose it. Choice: make the field `pub`, since `Project` already has `pub schaltwerk_core` and `pub terminal_manager`. Wave D's edits to `commands/tasks.rs` are what justifies the `pub`.

Commit: `feat(infra): TaskLockManager for per-task serialization`.

### Wave C — `CoreHandle` accessor (sequential, additive)

**C1.** Define `CoreHandle` and the lock-free accessors. Two locations:
   - `src-tauri/src/project_manager.rs`: `Project::core_handle()` method + `pub struct CoreHandle` in the same module (it's coupled to `Project`'s state shape).
   - `src-tauri/src/main.rs`: `get_core_handle()` and `get_core_handle_for_project_path(project_path: Option<&str>)` mirroring the existing `get_schaltwerk_core{,_for_project_path}` signatures, but returning `CoreHandle` directly. Honor `REQUEST_PROJECT_OVERRIDE`.

**C2.** Tests per §4 Wave C, in `commands/tasks.rs::tests` or a new `src-tauri/tests/core_handle_smoke.rs`. The handle is small enough to test inline.

**C3.** Existing `get_core_read/write*` and `LAST_CORE_WRITE` machinery stays untouched in this wave. They're parallel paths; neither blocks the other.

Commit: `feat(core): introduce lock-free CoreHandle accessor`.

### Wave D — migrate `commands/tasks.rs` (sequential within file)

**D.1.** The 6 lifecycle commands (`lucode_task_promote_to_ready`, `lucode_task_start_stage_run`, `lucode_task_start_clarify_run`, `lucode_task_confirm_stage`, `lucode_task_run_cancel`, `lucode_task_cancel`):

For each command:
1. Resolve `Project` (via the helper that the new `core_handle` accessor sits behind, or via direct project manager access if the accessor doesn't expose `Project`).
2. Acquire the per-task lock: `let _guard = project.task_locks.lock_for(&task_id).lock().await;`.
3. Build `CoreHandle` (or whatever flavor of handle is appropriate).
4. Drive the orchestration (`with_production_orchestrator(&handle, |orch| orch.start_stage_run(…))` or similar).
5. Drop the guard (implicit at end of scope).

Decision point: does the per-task lock need to be a `*Mutex<()>` *guard* held in scope, or should we abstract it as a `with_task_lock(project, task_id, |handle| async { … })` helper? The helper hides the lock-acquire/release pattern and prevents accidental double-locking. **Recommendation: write the helper.** Saves boilerplate across 6 call sites and gives Wave H one place to instrument the event log for the concurrency tests.

```rust
/// Acquire the per-task lock and run the closure with a `CoreHandle` and
/// the lock guard held. The guard is dropped when the closure returns.
async fn with_task_lock<F, R>(
    project_path: Option<&str>,
    task_id: &str,
    op: F,
) -> Result<R, String>
where
    F: for<'a> AsyncFnOnce(&'a CoreHandle) -> Result<R, String>,
{
    let project = resolve_project(project_path).await?;
    let lock = project.task_locks.lock_for(task_id);
    let _guard = lock.lock().await;
    let handle = project.core_handle();
    op(&handle).await
}
```

(Rust 1.85+ ships stable `AsyncFnOnce`; if the toolchain version pinned in this repo predates that, fall back to a boxed `Pin<Box<dyn Future>>`. Verify in Wave D.0.)

**D.2.** Replace `with_read_db`/`with_write_db` with a single `with_core_handle` helper that doesn't do per-task locking (used by the read/list/CRUD commands that don't mutate task lifecycle). Same body as the current `with_read_db`, but using `get_core_handle_for_project_path` instead of `get_core_read_for_project_path`.

**D.3.** Delete:
- `pub struct ProductionOrchestratorBundle` and its `impl`.
- `fn with_production_orchestrator`.
- `pub struct ConfirmStageResources` and its `impl`.
- `async fn confirm_stage_against_snapshot`.
- The regression test `production_orchestrator_bundle_releases_global_write_guard_before_returning`.

**D.4.** Add the per-task-lock tests (§4 Wave D, three cases). Place them in `commands/tasks.rs::tests` next to the existing fixtures.

**D.5.** Run `cargo nextest run -p schaltwerk_app commands::tasks` and `just test`. Green before commit.

Commits per file split:
- `refactor(tasks): per-task lock for orchestration commands`
- `refactor(tasks): consolidate with_read_db/with_write_db → with_core_handle`
- `refactor(tasks): remove ProductionOrchestratorBundle / ConfirmStageResources snapshots`

Or one combined commit if review prefers atomicity. Default: three commits for clean diff.

### Wave E — sweep non-task surfaces (audit, then parallel)

**E.0 — Cat-D audit pass (sequential, before parallelism).** Walk the Cat-D list from §0:
1. For each candidate site, read the function body.
2. If every `db.*` call inside is a single statement OR the call goes through a manager method that already wraps `conn.transaction(...)`, mark the site **already safe** in a working note.
3. If two or more `db.*` writes execute at the command-body level without a transaction wrapper, edit the body to wrap them in `conn.transaction(...)` (using the rusqlite pattern already in `db_tasks.rs` / `db_spec_review_comments.rs`).
4. For each site that needed a wrapper, add a regression test (in the same module, or in `tests/cat_d_consolidation_atomicity.rs` if cross-cutting) that fails if the wrapper is removed: simulate failure on the second write and assert the first write rolled back. Two-way binding: removing the `conn.transaction(...)` should make the test fail.

E.0 commits independently as `fix(commands): wrap multi-write consolidation/git-stats updates in explicit transactions`. If the audit finds zero sites that need wrappers, E.0 is a doc-only commit recording the result; the regression-test bullet is skipped.

**E.1 — `commands/schaltwerk_core.rs` (75 sites) + `commands/schaltwerk_core/codex_model_commands.rs` (2 sites).**

Agent prompt summary: *"In the listed files, replace every `let core = get_core_read().await?` (or `get_core_write().await?`) call with `let core = get_core_handle().await?`. Same for `_for_project_path` variants. Do not change anything else. The body of each call site already uses `core.db`, `core.repo_path`, and `core.session_manager()` — those exist on `CoreHandle` exactly as they do on the current guard, so no body changes are needed. Run `cargo check -p schaltwerk_app` and report any compile error. Do not commit."*

**E.2 — `mcp_api.rs` (40 sites).**

Same prompt, scoped to `mcp_api.rs`.

**E.3 — `diff_commands.rs` (5 sites) + `commands/sessions_refresh.rs` (2 sites) + `commands/settings.rs` (3 sites).**

Same prompt, scoped to those files.

**E.4 — Cleanup pass.** Coordinator runs `grep -rn 'get_core_read\|get_core_write' src-tauri/src/ --include='*.rs'` after E.1–E.3 land. Any stragglers get migrated by hand or dispatched as E.4.

**E.5 — `just test` green across the whole crate.** This is the integration check that proves the sweep didn't break behavior.

Commits per sub-wave:
- `refactor(schaltwerk_core): use CoreHandle accessor`
- `refactor(mcp_api): use CoreHandle accessor`
- `refactor(diff/sessions/settings): use CoreHandle accessor`

### Wave F — bridge cleanup (sequential)

**F.1.** `src-tauri/src/infrastructure/session_facts_bridge.rs`: replace `pm.current_schaltwerk_core().await` + `core_lock.read().await` with `pm.current_schaltwerk_core().await?.core_handle()`. Wait — `current_schaltwerk_core` will return `Arc<SchaltwerkCore>` after Wave G, but we're in Wave F so it still returns `Arc<RwLock<SchaltwerkCore>>`. To avoid temporary churn, introduce in this wave a `pm.current_core_handle()` helper that returns `Result<CoreHandle, anyhow::Error>` directly, and use that in the bridge. Wave G then changes `current_schaltwerk_core`'s signature; the bridge is unaffected.

**F.2.** Existing tests (`tests/run_status_integration.rs`) prove the bridge's behavior. They must stay green.

Commit: `refactor(infra): session_facts_bridge uses CoreHandle, no read guard`.

### Wave G — drop `RwLock` from `Project` (sequential)

**G.1.** In `src-tauri/src/project_manager.rs`: change `pub schaltwerk_core: Arc<RwLock<SchaltwerkCore>>` to `pub schaltwerk_core: Arc<SchaltwerkCore>`. Update `Project::new` and `Project::new_in_memory` to construct `Arc::new(SchaltwerkCore::…)` directly.

**G.2.** Update `current_schaltwerk_core`, `get_schaltwerk_core_for_path`, and any test helper to return `Arc<SchaltwerkCore>` instead of `Arc<RwLock<SchaltwerkCore>>`.

**G.3.** In `src-tauri/src/main.rs`: delete `get_schaltwerk_core{,_for_project_path}`'s `Arc<RwLock<…>>` return type wrappers (signatures fan out). Delete:
- `LAST_CORE_WRITE` (and its `Lazy<StdMutex<…>>` declaration).
- `get_core_read`, `get_core_read_for_project_path`.
- `get_core_write`, `get_core_write_for_project_path`.
- The `OwnedRwLockReadGuard` / `OwnedRwLockWriteGuard` imports if no other caller uses them.

**G.4.** `cargo check`. Any remaining caller using the dead entry points becomes a clean compile error pointing exactly at what the sweep missed (Wave E.4 was the safety net; this is the second one).

**G.5.** Update `plans/2026-04-29-task-flow-v2-baseline.md` §3 with a Phase-2-update note: *"Phase 2 deletes the entry points and the `RwLock` wrapper. The current shape is `Arc<SchaltwerkCore>` plus per-`Project` `TaskLockManager`."* (Or add the note inline as a comment block at the top of the §3 section.)

Commit: `refactor(infra): remove Arc<RwLock<SchaltwerkCore>>; drop get_core_read/write entry points`.

### Wave H — concurrency tests + final validation (sequential)

**H.1.** New file `src-tauri/tests/e2e_per_task_concurrency.rs` covering both cases in §4 Wave H. Use the same `Database::new_in_memory()` + stub provisioner pattern Phase 1 used in `tests/e2e_run_lifecycle.rs`. Event ordering via `Arc<Mutex<Vec<&'static str>>>` event log; no timing assertions.

**H.2.** Run `just test`. Verify green.

**H.3.** `bun run lint:rust` (cargo clippy) and `cargo shear` and `knip` clean.

**H.4.** Verify `arch_domain_isolation` and `arch_layering_database` still pass (they should; no domain-layer imports changed).

**H.5.** Manual smoke test: skipped — Phase 2 ships no UI, only internal locking changes. The CLAUDE.md "for UI or frontend changes" rule does not apply.

Commit: `test(infra): e2e per-task concurrency proof`.

### Wave I — status + memory (sequential)

**I.1.** Update `plans/2026-04-29-task-flow-v2-status.md`:
- Mark Phase 2 row `[x]` with the merge commit hash.
- Add a Phase 2 sub-wave table mirroring Phase 1's structure (Waves A–I).
- Add a Phase 2 definition-of-done check table.

**I.2.** Update auto-memory `project_taskflow_v2_charter.md` to reflect Phase 2 complete.

Commit: `docs(plans): Phase 2 complete`.

---

## 6 — Definition of done for Phase 2

- v2 branch compiles, `just test` green, `cargo shear` + `knip` clean.
- 0 references to `Arc<RwLock<SchaltwerkCore>>` in production code (still allowed in tests if any pin a v1-shaped invariant; the only such test, `production_orchestrator_bundle_releases_global_write_guard_before_returning`, is deleted in Wave D).
- 0 references to `get_core_read`, `get_core_read_for_project_path`, `get_core_write`, `get_core_write_for_project_path` in any code path.
- 0 references to `LAST_CORE_WRITE`.
- 0 references to `ProductionOrchestratorBundle`, `ConfirmStageResources`, `snapshot_from_core`, `confirm_stage_against_snapshot`, `with_production_orchestrator`.
- `Project::schaltwerk_core` field is `Arc<SchaltwerkCore>` (not `Arc<RwLock<…>>`); pinned by the structural test in Wave G.
- `TaskLockManager` exists at `src-tauri/src/infrastructure/task_lock_manager.rs` with the 5 unit tests in §4 Wave B all passing.
- The two e2e concurrency tests in `src-tauri/tests/e2e_per_task_concurrency.rs` both pass.
- `arch_domain_isolation` and `arch_layering_database` green.
- `plans/2026-04-29-task-flow-v2-status.md` Phase 2 row marked `[x]` with merge commit hash.
- Auto-memory updated.

---

## 7 — Deliberate semantic changes & risks

### Deliberate semantic changes (call out in commit messages and PR body)

**1. Concurrent operations on different tasks no longer serialize.** This is the headline change. Two `lucode_task_start_stage_run` calls on different task IDs proceed in parallel. A long-running `lucode_task_confirm_stage` on task A no longer blocks `lucode_task_run_get` on task B (or any other read).

**2. Concurrent operations on the same task still serialize, but at a different granularity.** Same-task ordering is preserved by `TaskLockManager`; the difference is that cross-task callers no longer get pulled into that wait queue.

**3. Non-task callers (`lucode_core_*`, MCP REST handlers, diff commands, etc.) see no synchronization beyond the DB pool's WAL.** This is consistent with the v1 reality (`project_schaltwerkcore_rwlock.md`: the `RwLock` already provided no exclusion); Phase 2 just makes it explicit. The DB pool's WAL + `synchronous=NORMAL` + `LUCODE_DB_POOL_SIZE=4` (per CLAUDE.md) is the only synchronization. SQLite's WAL guarantees statement-level atomicity; multi-statement consistency is per-method (e.g. `SessionMethods::create_session` already uses an explicit transaction).

**4. The 5s lock-acquire timeout is gone.** Operations that genuinely need to wait for a same-task lock will wait indefinitely. In practice the lock window for any single command is bounded by the orchestration work (worktree creation + git merge), which is itself bounded by reasonable subprocess timeouts. If a deadlock is possible (it shouldn't be — `Mutex` is not reentrant; we never acquire the same task's lock twice in one call chain), it surfaces as a hung tokio task that's straightforward to diagnose. Document in the Wave G commit.

### Risks

| Risk | Mitigation |
|---|---|
| The sweep in Wave E misses a call site, leaving a half-migrated codebase | Wave G is the safety net: it deletes the old entry points and forces a compile error at any remaining caller. The error message is exactly the function name that was missed. Wave E.4 is a pre-emptive grep pass that catches the same misses without going through Wave G's compile-error path. |
| `with_task_lock` helper relies on Rust 1.85+ stable `AsyncFnOnce` | Verify the toolchain version pinned in `rust-toolchain.toml` (or the Cargo.lock implicit MSRV). If older, fall back to `Box<dyn FnOnce(…) -> Pin<Box<dyn Future<…>>>>`. The helper signature is internal; the fallback is purely cosmetic. |
| Per-task lock memory leak (one `Arc<Mutex<()>>` per task ever created in this `Project`) | Documented in §1's `TaskLockManager` doc comment. Bounded by ~40 bytes per task. Project unload drops the whole map. If profiling ever flags this as a real cost, switch to `DashMap<TaskId, Weak<Mutex<()>>>` in a follow-up. Not a Phase 2 concern. |
| The lock-free handle accessor races with `Project` unload | `current_schaltwerk_core` already handles this — it returns `Err("No active project")` when there's none. The new `current_core_handle` reuses that path. After it returns the handle, the underlying `Database` is `Arc`-backed and survives independent of the project. So the race is closed: even if the project is unloaded mid-call, the handle's database stays usable. The only caller-visible effect is that operations against an unloaded project's handle become "writes to a database that's no longer wired to the live UI" — same hazard as the existing `core_lock.read().await` pattern in `session_facts_bridge.rs`. No regression. |
| Wave E parallelism produces overlapping diffs | Each agent is scoped to a disjoint set of files, per `feedback_parallel_agents_disjoint_files.md`. The coordinator (this session) is the only writer of commits. If two agents were to touch the same file, that's a coordinator bug; the file lists in §3 prevent it by construction. |
| Deleting the bundle/snapshot machinery in Wave D removes the lock-release regression test (`production_orchestrator_bundle_releases_global_write_guard_before_returning`) | The test pinned a contract that no longer exists ("bundle drops the write guard before returning"). Replacing it with the new contract ("operations on different tasks don't serialize") happens in Wave H — `two_tasks_run_in_parallel_through_command_surface` is the structural successor. Document the deletion in the Wave D commit body. |
| `with_task_lock` accidentally re-acquires the same task's lock from inside the closure (deadlock) | The `tokio::sync::Mutex` is not reentrant; a deadlock manifests as a hung tokio task. Code review catch: each task command's body does not call back into another task command. Wave D's per-command audit confirms this. The end-to-end test `same_task_two_commands_serialize_through_command_surface` would *time out* (not deadlock) because each command's lock acquire-release is bounded in scope. If a regression introduces nested locking, the test surfaces it as a hang in CI; not silent. |

---

## 8 — Execution handoff

Plan complete. Two execution options per the writing-plans skill:

1. **Subagent-driven (this session).** Coordinator (this session) dispatches fresh subagents per wave; reviews diffs between waves; commits. Best for Wave E (the 4-agent parallel sweep). Same pattern Phase 1's Wave I used.
2. **Parallel session.** New session with `superpowers:executing-plans`, executes through the wave sequence with checkpoints.

Recommended: **subagent-driven**. Phase 2 has one big mechanical sweep (Wave E) that benefits directly from parallel agents on disjoint files, and the per-wave review checkpoints catch the kinds of single-line-change mistakes that the sweep is most prone to.

The whole phase ships in one session (per the user's "execute end-to-end in one session — same pattern as Phase 1's Wave I" instruction). Surface for review only when the whole phase is green and committed, or on a real blocker. Context-budget escape hatch: if context genuinely runs out, commit what's green, update the status doc with where work stopped, stop. Don't leave the tree red or half-ported.

Awaiting plan review before starting code.
