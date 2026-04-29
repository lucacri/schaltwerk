# task-flow v1 baseline — frozen reference

**Purpose:** Captures the v1 task-flow surface as it exists at the start of the v2 rewrite. This file is the comparison point reviewers use during phases 1–6 to see what was removed, collapsed, or restructured.

**Frozen snapshot of:** [`task-flow` branch @ `b1f38f63`](../) (96 commits ahead of `main`).

**Companion documents:**
- [Design](./2026-04-29-task-flow-v2-design.md) — what v2 looks like and why.
- [Status](./2026-04-29-task-flow-v2-status.md) — phase tracker.

**Contents:**
1. [SQLite schema](#1-sqlite-schema)
2. [Domain enums](#2-domain-enums)
3. [Locking model](#3-locking-model)
4. [Cross-domain wiring](#4-cross-domain-wiring)

---

## 1. SQLite schema

Sources:
- Sessions CREATE — `db_schema.rs:23` + ALTERs at `:321`, `:343`, `:355`, `:628`
- Tasks CREATE — `db_schema.rs:468` + ALTER `:515`
- Task runs CREATE — `db_schema.rs:550` + ALTER `:570`
- Task artifacts CREATE — `db_schema.rs:584`

Entity references: `domains/tasks/entity.rs` (Task, TaskRun, TaskArtifact) and `domains/sessions/entity.rs` (Session).

### `tasks`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | TEXT | NOT NULL | (PK) | UUID |
| name | TEXT | NOT NULL | — | sanitized; UNIQUE per repo |
| display_name | TEXT | NULL | — | human-friendly label |
| repository_path | TEXT | NOT NULL | — | absolute repo root; part of UNIQUE |
| repository_name | TEXT | NOT NULL | — | derived basename |
| variant | TEXT | NOT NULL | `'regular'` | TaskVariant enum |
| stage | TEXT | NOT NULL | `'draft'` | TaskStage enum (incl. `cancelled`) |
| request_body | TEXT | NOT NULL | `''` | original user request |
| current_spec | TEXT | NULL | — | denormalized current artifact body |
| current_plan | TEXT | NULL | — | denormalized current artifact body |
| current_summary | TEXT | NULL | — | denormalized current artifact body |
| source_kind | TEXT | NULL | — | origin tag |
| source_url | TEXT | NULL | — | upstream URL |
| task_host_session_id | TEXT | NULL | — | host session for orchestration |
| task_branch | TEXT | NULL | — | branch owned by this task |
| base_branch | TEXT | NULL | — | base to fork from |
| issue_number | INTEGER | NULL | — | linked issue |
| issue_url | TEXT | NULL | — | linked issue URL |
| pr_number | INTEGER | NULL | — | linked PR |
| pr_url | TEXT | NULL | — | linked PR URL |
| pr_state | TEXT | NULL | — | open/succeeding/failed/mred |
| failure_flag | BOOLEAN | NOT NULL | FALSE | sticky failure marker |
| epic_id | TEXT | NULL | — | optional epic grouping |
| attention_required | BOOLEAN | NOT NULL | FALSE | UI flag |
| created_at | INTEGER | NOT NULL | — | unix-seconds |
| updated_at | INTEGER | NOT NULL | — | unix-seconds |

UNIQUE(`repository_path`, `name`).

### `task_runs`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | TEXT | NOT NULL | (PK) | UUID |
| task_id | TEXT | NOT NULL | — | FK → tasks(id) ON DELETE CASCADE |
| stage | TEXT | NOT NULL | — | TaskStage this run targets |
| preset_id | TEXT | NULL | — | agent preset |
| status | TEXT | NOT NULL | `'queued'` | TaskRunStatus enum |
| base_branch | TEXT | NULL | — | branch forked from |
| target_branch | TEXT | NULL | — | branch produced |
| selected_session_id | TEXT | NULL | — | winning session post-confirm |
| selected_artifact_id | TEXT | NULL | — | chosen artifact post-confirm |
| selection_mode | TEXT | NULL | — | how selection was made |
| started_at | INTEGER | NULL | — | unix-seconds |
| completed_at | INTEGER | NULL | — | unix-seconds |
| failure_reason | TEXT | NULL | — | populated on Failed (added 2026-04-29) |
| created_at | INTEGER | NOT NULL | — | unix-seconds |
| updated_at | INTEGER | NOT NULL | — | unix-seconds |

FK: `task_id` → `tasks(id)` ON DELETE CASCADE.

### `task_artifacts`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | TEXT | NOT NULL | (PK) | UUID |
| task_id | TEXT | NOT NULL | — | FK → tasks(id) ON DELETE CASCADE |
| artifact_kind | TEXT | NOT NULL | — | TaskArtifactKind enum |
| title | TEXT | NULL | — | optional |
| content | TEXT | NULL | — | inline body |
| url | TEXT | NULL | — | external URL for link/attachment |
| metadata_json | TEXT | NULL | — | JSON blob |
| is_current | BOOLEAN | NOT NULL | FALSE | true → live version per (task,kind) |
| produced_by_run_id | TEXT | NULL | — | task_runs.id provenance |
| produced_by_session_id | TEXT | NULL | — | sessions.id provenance |
| created_at | INTEGER | NOT NULL | — | unix-seconds |
| updated_at | INTEGER | NOT NULL | — | unix-seconds |

FK: `task_id` → `tasks(id)` ON DELETE CASCADE.

### `sessions` (task-relevant columns highlighted; full table is broader)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | TEXT | NOT NULL | (PK) | UUID |
| name | TEXT | NOT NULL | — | UNIQUE per repo |
| repository_path | TEXT | NOT NULL | — | part of UNIQUE |
| branch | TEXT | NOT NULL | — | git branch |
| parent_branch | TEXT | NOT NULL | — | branch forked from |
| original_parent_branch | TEXT | NULL | — | captured pre-rebase |
| worktree_path | TEXT | NOT NULL | — | filesystem path |
| status | TEXT | NOT NULL | — | `active` / `cancelled` / `spec` |
| session_state | TEXT | NULL | `'running'` | `spec` / `processing` / `running` |
| **task_id** | TEXT | NULL | — | task this session belongs to |
| **task_stage** | TEXT | NULL | — | SpecStage tracked on session |
| **task_role** | TEXT | NULL | — | legacy role (pre run-aware) |
| **task_run_id** | TEXT | NULL | — | task_runs.id this was spawned for |
| **run_role** | TEXT | NULL | — | RunRole within run; backfilled from task_role |
| **slot_key** | TEXT | NULL | — | slot identifier (e.g. candidate index) |
| pr_number | INTEGER | NULL | — | linked PR |
| pr_state | TEXT | NULL | — | open/succeeding/failed/mred |
| ready_to_merge | BOOLEAN | NULL | FALSE | |
| merged_at | INTEGER | NULL | — | unix-seconds when merged |
| ci_autofix_enabled | BOOLEAN | NULL | FALSE | |
| (consolidation_*) | TEXT | NULL | — | round/role/report/source/etc. |
| (created_at, updated_at, last_activity) | INTEGER | (per col) | — | unix-seconds |

UNIQUE(`repository_path`, `name`). Full session schema includes ~40 columns; bolded above are the task-flow lineage links.

### Storage notes
- All timestamps stored as unix seconds (INTEGER).
- BOOLEANs are SQLite NUMERIC (`0`/`1`).
- `task_role` predates the run-aware lineage; `run_role` was added later and one-shot backfilled from `task_role` (`db_schema.rs:631`).
- `failure_flag` (tasks) and `failure_reason` (task_runs) appear in CREATE and a redundant ALTER — the ALTER upgrades older DBs created before those columns were inlined.

---

## 2. Domain enums

### `TaskStage` — `domains/tasks/entity.rs:8`
Serde: `rename_all = "snake_case"`. Helpers: `is_terminal`, `can_advance_to`. `FromStr` accepts legacy alias `"clarified"` → `Ready`.

| Variant | Wire | Notes |
|---|---|---|
| Draft | `draft` | initial |
| Ready | `ready` | post-promote; task_branch provisioned |
| Brainstormed | `brainstormed` | |
| Planned | `planned` | |
| Implemented | `implemented` | |
| Pushed | `pushed` | |
| Done | `done` | terminal |
| Cancelled | `cancelled` | terminal; reachable from any non-terminal |

Allowed transitions: Draft→Ready, Ready→Brainstormed, **Ready→Draft (only backwards edge)**, Brainstormed→Planned, Planned→Implemented, Implemented→Pushed, Pushed→Done, plus *→Cancelled.

### `TaskRunStatus` — `domains/tasks/entity.rs:224`
Serde: `rename_all = "snake_case"`.

| Variant | Wire | Notes |
|---|---|---|
| Queued | `queued` | created at run start |
| Running | `running` | **No production caller before commit `cf55de1d` (2026-04-29).** Now flipped from `start_stage_run` / `start_clarify_run` post-provision. |
| AwaitingSelection | `awaiting_selection` | **No production caller before `5ab1a394` (2026-04-29).** Now driven by `attention_bridge` on `WaitingForInput`. Sticky once flipped. |
| Completed | `completed` | set by `confirm_selection` |
| Failed | `failed` | **No production caller before `5ab1a394`.** Now driven by PTY non-zero exit (`handle_agent_crash`), tmux dead-pane (`emit_agent_crashed_for_dead_pane`), and CI red on linked PR (`persist_pr_state_refresh`). One-way (green CI doesn't resurrect). |
| Cancelled | `cancelled` | wired via session cancel paths |

**Pre-rewrite-sweep, only `Queued`, `Completed`, `Cancelled` were ever observed in production.** v2 collapses the entire enum into derived state.

### `RunRole` — `domains/tasks/entity.rs:264`
Serde: `rename_all = "snake_case"`.

| Variant | Wire |
|---|---|
| TaskHost | `task_host` |
| Single | `single` |
| Candidate | `candidate` |
| Consolidator | `consolidator` |
| Evaluator | `evaluator` |
| MainHost | `main_host` |
| Clarify | `clarify` |

v2 collapses to `slot_key: Option<String>` only.

### `TaskArtifactKind` — `domains/tasks/entity.rs:307`
Serde: `rename_all = "snake_case"`.

`Request, Spec, Plan, Review, Decision, Summary, Attachment, Link`.

### `TaskVariant` — `domains/tasks/entity.rs:196` (and **duplicated** at `domains/sessions/entity.rs:138`)
`Regular` (default), `Main`. The second declaration is a duplicate — scout-rule consolidation candidate.

### `SessionState` — `domains/sessions/entity.rs:341`
`Processing`, `Running`. v2 will drop entirely.

### `SessionStatus` — `domains/sessions/entity.rs:334`
`Active`, `Cancelled`. v2 reduces to `cancelled_at: Option<Timestamp>`.

### `PrState` — `domains/sessions/entity.rs:242`
| Variant | Wire | Notes |
|---|---|---|
| Open | `open` | |
| Succeeding | `succeeding` | green CI |
| Failed | `failed` | red CI; triggers `task.failure_flag = true` |
| **Mred** | `mred` | **Intentional misspelling of "Merged"** per project memory. Load-bearing on the wire. |

### `SelectionKind` — `domains/tasks/runs.rs:21`
Runtime-only Rust enum (no serde, no FromStr). `Session(String)` or `Artifact(String)`. Mirrors the XOR DB invariant on `task_runs.{selected_session_id, selected_artifact_id}`.

### Adjacent / overlapping enums
- `SpecStage` (`sessions/entity.rs:276`) — duplicates `TaskStage` 1:1, same `"clarified"` alias. Consolidation candidate.
- `TaskWorkflowStage` (`sessions/entity.rs:199`) — subset of TaskStage.
- `SessionStatusType`, `SessionType`, `TestStatus`, `SortMode`, `FilterMode` — out of v2 scope but flagged.

---

## 3. Locking model

> **Phase 2 update (Wave G, 2026-04-29):** This entire section describes the v1 lock model that has been removed.
> - `Project::schaltwerk_core` is now `Arc<SchaltwerkCore>` (no `RwLock` wrapper).
> - `get_core_read`, `get_core_read_for_project_path`, `get_core_write`, `get_core_write_for_project_path`, and `LAST_CORE_WRITE` are deleted from `main.rs`.
> - The `ProductionOrchestratorBundle::acquire` / `ConfirmStageResources::acquire` / `snapshot_from_core` machinery in `commands/tasks.rs` is deleted.
> - The 5s timeout on the four entry points is gone.
> - Per-task ordering is provided by `infrastructure::task_lock_manager::TaskLockManager` on each `Project`. The six lifecycle commands acquire `project.task_locks.lock_for(&task_id).lock().await` immediately after resolving the project; non-task callers go through the lock-free `Project::core_handle()` accessor (returns `CoreHandle { db, repo_path }`).
> - The DB pool's WAL + `synchronous=NORMAL` is the only synchronization for non-task work.
>
> The text below is preserved as a frozen v1 reference; the v2 successor is `infrastructure::task_lock_manager::TaskLockManager` plus `project_manager::CoreHandle`.

### The "global" lock (per-project, not process-wide)

`Project` owns `pub schaltwerk_core: Arc<RwLock<SchaltwerkCore>>` (`project_manager.rs:47`). There is no process-wide `OnceCell<RwLock<SchaltwerkCore>>`; `PROJECT_MANAGER` (`main.rs:386`) is the singleton, and dispenses one `Arc<RwLock<SchaltwerkCore>>` per loaded project via `current_schaltwerk_core()` (`project_manager.rs:623`) and `get_schaltwerk_core_for_path()` (line 632). When this codebase says "the global core lock", it means "the active project's lock".

`SchaltwerkCore` shape (`schaltwerk_core/mod.rs:124-127`):
```rust
pub struct SchaltwerkCore {
    pub db: Database,
    pub repo_path: PathBuf,
}
```

That is the entire payload. `Database` is internally synchronized (Arc-backed connection pool with WAL + `synchronous=NORMAL`, `Database: Clone` at `infrastructure/database/connection.rs:16-17`). `repo_path` is immutable. **The `RwLock` provides no useful exclusion once the core is initialized** — it's effectively a "core exists and isn't being torn down" gate.

Diagnostic: `LAST_CORE_WRITE: Lazy<StdMutex<Option<(Uuid, Instant)>>>` (`main.rs:391-392`) records the most recent write-acquire so a timeout can attribute starvation.

Per-request override: task-local `REQUEST_PROJECT_OVERRIDE` (`main.rs:397-399`) lets MCP HTTP requests target a specific project's lock.

### Six lock entry points (`main.rs`)

| Function | Line | Type | Timeout |
|---|---|---|---|
| `get_schaltwerk_core` | 429 | `Arc<RwLock<…>>` | n/a |
| `get_schaltwerk_core_for_project_path` | 460 | `Arc<RwLock<…>>` | n/a |
| `get_core_read` | 482 | `OwnedRwLockReadGuard` | **30s** |
| `get_core_read_for_project_path` | 532 | `OwnedRwLockReadGuard` | **30s** |
| `get_core_write` | 587 | `OwnedRwLockWriteGuard` | **30s** |
| `get_core_write_for_project_path` | 625 | `OwnedRwLockWriteGuard` | **30s** |

Timeout bumped 5s→30s in commit `afd87851`. Same commit downgraded timeout logs from `error`→`warn` (the dev-error-dispatch hook was spawning toasts on contention). All entry points log a UUID `call_id`, wait duration, and on timeout return `Err("Timed out waiting for core …")`.

### Snapshot patterns (`commands/tasks.rs`)

The pattern: acquire write guard → clone cheap fields → drop guard → run async/sync work against the owned snapshot.

#### `ProductionOrchestratorBundle` (`commands/tasks.rs:881-925`)

```rust
pub struct ProductionOrchestratorBundle {
    pub db: Database,
    pub repo_path: PathBuf,
    pub manager: SessionManager,
    pub merge_service: MergeService,
}
```

`acquire(project_path)` → `get_core_write_for_project_path()` → `snapshot_from_core(&core)` → `drop(core)` → returns owned bundle. Used by `lucode_task_promote_to_ready`, `lucode_task_start_stage_run`, `lucode_task_start_clarify_run`. Commit `8db8c675` extended the snapshot pattern to all four task orchestration commands.

#### `ConfirmStageResources` (`commands/tasks.rs:1018-1045`)

Smaller cousin (just `db` + `repo_path`) for the **async** confirm-stage path. Distinct from the bundle because `TaskOrchestrator::confirm_stage` is async and runs `MergeService::merge_from_modal` (which spawns git subprocesses), so it needs factory methods (`session_manager()`, `merge_service()`) that re-derive services per call. Translated into structured errors via `map_confirm_stage_error` (`commands/tasks.rs:1078`).

### Async↔sync bridge: `ActiveProjectDispatcher`

`infrastructure/run_lifecycle_dispatch.rs:46-89`. Holds `Arc<ProjectManager>` (NOT a snapshotted `Database`) so project switches are picked up automatically. `snapshot_active_db()` strategy:

```rust
match Handle::try_current() {
    Ok(handle) => std::thread::scope(|s| {
        s.spawn(move || handle.block_on(read_active_db(&pm)))
            .join().expect("…")
    }),
    Err(_) => tauri::async_runtime::block_on(read_active_db(&pm)),
}
```

Inside Tokio: scoped OS thread for `block_on` to avoid runtime self-deadlock. Outside Tokio (raw `#[test]`): transient runtime via `tauri::async_runtime::block_on`. `read_active_db` acquires the read guard, clones `(db, repo_path)`, returns. No mutation. `None` and debug-log when no project loaded — never panics.

### What v2 replaces

Per `plans/2026-04-29-task-flow-v2-design.md` §2 + Phase 2:
- Replace `Arc<RwLock<SchaltwerkCore>>` with per-task `DashMap<TaskId, Arc<Mutex<()>>>`.
- Operations on different tasks proceed concurrently.
- `ConfirmStageResources` and the snapshot pattern go away.
- The 5s→30s timeout bump goes away.
- `lucode_core_*` commands either get a singleton mutex or accept global serialization.

---

## 4. Cross-domain wiring

### Listener traits + dispatchers

#### `TaskRunFailureRecorder` (`infrastructure/run_lifecycle_notify.rs:16`)

Process-global `OnceCell<Arc<dyn …>>` registry. Trait:
```rust
pub trait TaskRunFailureRecorder: Send + Sync {
    fn record_agent_exit(&self, session_name: &str, exit_code: Option<i32>);
}
```
- `set_task_run_failure_recorder` is idempotent (`let _ = RECORDER.set(...)`).
- `notify_agent_exit` no-ops on missing session_name or no recorder. Does NOT re-check `status.success()` — caller decides.
- Called from `domains/terminal/lifecycle.rs:176` (gated by `task_run_failure_exit_code()` so only non-zero exits propagate) and `commands/schaltwerk_core.rs:239` (tmux dead-pane reattach with `exit_code: None`).

#### `AwaitingSelectionDeps` (`infrastructure/attention_bridge.rs:98`)

```rust
pub trait AwaitingSelectionDeps: Send + Sync {
    fn get_session_run_lineage(&self, session_id: &str) -> Result<Option<(String, Option<String>)>>;
    fn get_run_status(&self, run_id: &str) -> Result<TaskRunStatus>;
    fn list_sessions_for_run(&self, run_id: &str) -> Result<Vec<SessionForRun>>;
    fn mark_awaiting_selection(&self, run_id: &str) -> Result<()>;
}
```

Decision is a pure function (`evaluate_run_awaiting`, `attention_bridge.rs:149`):
1. No `task_run_id` lineage → `NoOp`.
2. Run not in `Running` → `NoOp`.
3. Role dispatch:
   - `candidate`: flip ONLY when EVERY sibling-candidate is `WaitingForInput` (full quiescence).
   - `task_host` / `single` / `consolidator` / `evaluator` / unknown: flip immediately.

Returns `AwaitingSelectionOutcome::{NoOp, Flip { run_id }}`. Errors warn-logged.

#### `ActiveProjectDispatcher` (`infrastructure/run_lifecycle_dispatch.rs:46`)

Single struct that satisfies BOTH listener traits by routing each call through `ProjectManager::current_schaltwerk_core()`. Installed at startup (`main.rs:1935-1951`) — one `Arc<ActiveProjectDispatcher>` cloned into both `OnceCell`s.

### Signal sources

| Source | Event | Fires on | Carries |
|---|---|---|---|
| `terminal/lifecycle.rs:147` `handle_agent_crash` | `SchaltEvent::AgentCrashed` (emit at `:202`) + gated `notify_agent_exit` (at `:176`) | EVERY PTY child exit, success or non-zero. The UI event fires regardless; the run-fail propagation is gated by `task_run_failure_exit_code()`. **Caveat: event is misnamed — fires on success too.** | `terminal_id, agent_type, session_name?, exit_code?, buffer_size, last_seq` |
| `terminal/local.rs:643` `spawn_idle_ticker` (250ms interval) | `SchaltEvent::TerminalAttention` (emit at `:702` and `:1761`) | Idle/active transitions on session top terminals. Ticker emits `idle`/`null`; title-signal path emits `waiting_for_input`. | `session_id, terminal_id, needs_attention, attention_kind` |
| `commands/schaltwerk_core.rs:205` `emit_agent_crashed_for_dead_pane` (called at `:2535`, `:2885`) | `SchaltEvent::AgentCrashed` re-emit + direct `notify_agent_exit(name, None)` | Tmux reattach where pane is already dead. Synthesizes a crash so UI and task-run failure see the dead session. | same as `handle_agent_crash`, `exit_code: None` |
| `commands/forge.rs:266` `persist_pr_state_refresh::task_run_fail` step | No direct event for the run-fail; CI green→red emits `SchaltEvent::CiStatusFailed` (`forge.rs:332`) separately | Forge details refresh observes `ci_failed = true`, task carries `failure_flag`, active `Running` run exists at task's stage. No-op when terminal/no PR/no matching run. | `PrStatePersistOutcome { session_update, auto_advance, task_run_fail, ci_status_emit, task_id }` |

### Helper functions (`domains/tasks/run_lifecycle_listener.rs`)

Pure resolvers, unit-testable with `Database::new_in_memory()`:

```rust
pub enum RunFailureOutcome {
    NoTaskRun,
    AlreadyTerminal { run_id: String, status: TaskRunStatus },
    Failed { run_id: String, reason: String },
}

pub fn resolve_and_fail_run_for_session_id(db, session_id, exit_code) -> Result<RunFailureOutcome>;
pub fn resolve_and_fail_run_for_session_name(db, repo_path, session_name, exit_code) -> Result<RunFailureOutcome>;
fn format_failure_reason(exit_code: Option<i32>) -> String; // "agent exit code N" | "agent terminated without exit code"
```

`resolve_and_fail_run_for_session_id` reads `get_session_task_lineage`; no `task_run_id` → `NoTaskRun`. Already-terminal run → `AlreadyTerminal` (idempotent — never re-flips). Otherwise `TaskRunService::fail_run(run_id, Some(&reason))` → `Failed`.

### `SchaltEvent` task-flow variants (`infrastructure/events/mod.rs`)

| Variant | Wire string | Role |
|---|---|---|
| `TasksRefreshed` (`mod.rs:15`) | `schaltwerk:tasks-refreshed` | UI: task list with embedded `task_runs` changed. Payload: `TasksRefreshedPayload { project_path, tasks }`. |
| `SessionsRefreshed` (`mod.rs:14`) | `schaltwerk:sessions-refreshed` | UI: sidebar session list changed. Run state changes fan out as session refresh. |
| `TerminalAttention` (`mod.rs:25`) | `schaltwerk:terminal-attention` | Drives `AwaitingSelectionDeps` listener AND the UI idle/waiting badges. |
| `AgentCrashed` (`mod.rs:29`) | `schaltwerk:agent-crashed` | UI crash banners. Run-fail side effect goes through `notify_agent_exit` directly, NOT this event. |
| `CiStatusFailed` (`mod.rs:45`) | `schaltwerk:ci-status-failed` | Emitted on green→red CI flip on task-linked PR. UI-facing. |
| `ForgePrDetailsRefreshed` (`mod.rs:44`) | `schaltwerk:forge-pr-details-refreshed` | UI-only signal after each forge poll. |

### What v2 replaces

- **Direct method calls for cross-domain coordination.** Instead of `notify_agent_exit` → `OnceCell` → dispatcher → `resolve_and_fail_run_for_session_name`, the v2 task domain exposes a service that the terminal/forge call sites invoke directly via a project-scoped service locator. No `OnceCell` registries; no sync↔async bridging via worker-thread scopes.
- **`SchaltEvent` retained for UI only.** The event variants stay; cross-domain state mutations no longer flow through the event system implicitly.
- **`AwaitingSelectionOutcome` and `RunFailureOutcome` survive as pure-decision enums.** Already pure and unit-testable; v2 keeps them but invokes from the task domain's own service surface.
- **`ActiveProjectDispatcher` goes away.** Once cross-domain calls are direct and project-scoped, the runtime-detection dance and silent no-op behavior are no longer needed.

---

## Files frozen by this snapshot

- `src-tauri/src/infrastructure/database/db_schema.rs`
- `src-tauri/src/domains/tasks/entity.rs`
- `src-tauri/src/domains/tasks/runs.rs`
- `src-tauri/src/domains/tasks/run_lifecycle_listener.rs`
- `src-tauri/src/domains/sessions/entity.rs`
- `src-tauri/src/domains/terminal/lifecycle.rs`
- `src-tauri/src/domains/terminal/local.rs`
- `src-tauri/src/commands/tasks.rs`
- `src-tauri/src/commands/forge.rs`
- `src-tauri/src/commands/schaltwerk_core.rs`
- `src-tauri/src/infrastructure/attention_bridge.rs`
- `src-tauri/src/infrastructure/run_lifecycle_notify.rs`
- `src-tauri/src/infrastructure/run_lifecycle_dispatch.rs`
- `src-tauri/src/infrastructure/events/mod.rs`
- `src-tauri/src/schaltwerk_core/mod.rs`
- `src-tauri/src/project_manager.rs`
- `src-tauri/src/main.rs`

When in doubt during the rewrite, the v1 source remains accessible at `task-flow` branch HEAD `b1f38f63`.
