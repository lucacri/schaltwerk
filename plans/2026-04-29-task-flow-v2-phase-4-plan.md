# task-flow v2 — Phase 4 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the work Phase 3 deferred and ship the original Phase-4-as-designed scope. Concretely: (a) migrate the production `Session` write surface from the legacy enum columns to the orthogonal axes; (b) sweep ~250+ readers from `Session.status` / `Session.session_state` / `SessionStatus::*` / `SessionState::*` to `Session.is_spec` / `Session.cancelled_at` / `Session::lifecycle_state(...)`; (c) drop the legacy columns and delete the `SessionStatus` + `SessionState` enums entirely; (d) define the canonical `TaskFlowError` and migrate every task command to it; (e) replace the denormalized `tasks.current_spec` / `current_plan` / `current_summary` columns with derived getters over `task_artifacts`. After Phase 4, the v2 task surface has *one* canonical error type, *zero* enum-typed lifecycle columns on `sessions`, and *zero* denormalized artifact bodies on `tasks`.

**Architecture:** Same shape as Phases 1–3. Two streams per collapse — code evolution (write/read sweep + delete) and one-shot user-DB migration (backfill done in Phase 3 already; this phase adds the column-drop migration via SQLite's table-rebuild dance for the legacy session columns and a separate one for the denormalized task columns). The wire-format adapter introduced in Phase 3 (`SessionInfo.session_state` / `info.status` strings synthesized from `lifecycle_state()`) is preserved so the frontend remains untouched. Compile-time pins (fn-pointer assertions, exhaustive matches without wildcards) lock the new shape — if a future change reintroduces a dropped enum or field, the structural test fails to compile.

**Tech Stack:** Rust + Tauri (`src-tauri/`), SQLite via `rusqlite`, the existing `apply_*_migrations` and one-shot v1→v2 migration pattern in `infrastructure/database/migrations/`, RAII test cleanup, `cargo nextest`. No frontend code changes.

---

## 0 — Audit findings (executed before this plan)

This section is the load-bearing premise of Phase 4. Phase 3's framing was that the legacy enum columns had become read-only compatibility shims. The audit proves that's **partially incorrect** and reshapes Wave order accordingly.

### 0.1 Session write surface — six production sites, not zero

`grep`-and-eyeball audit of `Session.status` / `Session.session_state` writes in `src-tauri/src/`, excluding `#[cfg(test)]`, `tests/`, and `infrastructure/database/migrations/`. Production write sites found:

| # | File | Line | Pattern | Trigger |
|---|---|---|---|---|
| 1 | `domains/sessions/service.rs` | 3417 | `update_session_status(_, SessionStatus::Cancelled)` | `finalize_session_cancellation` — successful cancel |
| 2 | `domains/sessions/lifecycle/cancellation.rs` | 725 | `update_session_status(_, SessionStatus::Cancelled)` | `finalize_cancellation` — same flow, lifecycle module variant |
| 3 | `domains/sessions/service.rs` | 5136 | `db_manager.update_session_state(&session.id, state)` | public `update_session_state(...)` method — generic state transition |
| 4 | `domains/sessions/lifecycle/finalizer.rs` | 78 | `update_session_state(session_id, new_state)` | `finalize_state_transition` — generic state transition |
| 5 | `commands/schaltwerk_core.rs` | 4379 | `manager.update_session_state(&name, session_state)` | `schaltwerk_core_update_session_state` Tauri command — frontend-driven |
| 6 | `domains/sessions/repository.rs` | 155 | `session.session_state = SessionState::Spec` (in-memory) | `normalize_spec_state` defensive resync after `db.update_session_state()` |

Drilling into each:

- **(1, 2)** are the cancel-finalization flow. Phase 3 added `cancelled_at` but didn't rewire these. They currently write `status = 'cancelled'` to the DB. The `cancelled_at` column is populated lazily by the Phase 3 backfill migration — but only on first launch. Sessions cancelled *after* the backfill ran but *before* this Wave lands have `status='cancelled'` set and `cancelled_at` NULL. **This is a real correctness bug, not just hygiene.**
- **(3, 4)** are the generic `SessionState` transition path. Phase 3's `lifecycle_state()` getter ignores `session_state` entirely (it derives from `is_spec` + `cancelled_at` + worktree-exists), so reads to `session_state` after Phase 3 are dead. But these writers still set it. Burning DB writes on a column nothing reads.
- **(5)** is a Tauri command exposed to the frontend. The frontend doesn't currently call it (Phase 3 didn't surface UI changes), but the seam exists. It's the clearest case of the "v2 must rewire writes" requirement: the command's contract is `(session_name, SessionState) → ()`, which makes no sense once the enum is gone.
- **(6)** is the v1 reconciler's defensive resync. With two boolean axes, drift is impossible. This whole helper goes away.

**Implication for Wave order:** the column drop cannot happen until these six writers are rewired. The plan handles writers in Wave B, *before* the read-sweep waves, so that by the time the column-drop migration lands every code path that touched the columns has been rerouted.

#### Evidence — re-runnable audit queries

Reviewers can re-run the exact greps that produced the audit. Any additional hits surface as 7th, 8th, etc. — if they show up during Wave B execution they're handled per the test-first contract in §8 (write a regression test that fails on revert *before* the rewire). Queries:

```bash
# 1. Method-style writers (the trait methods + their wrappers).
rg -n 'set_session_status|set_session_state|update_session_status|update_session_state' --type rust

# 2. Direct field assignments, including struct-init form.
rg -n '\.status\s*=\s*Session(Status)?::|\.session_state\s*=\s*Session(State)?::|status:\s*SessionStatus::|session_state:\s*SessionState::' --type rust

# 3. SQL string literal writes against the sessions table.
rg -n 'UPDATE sessions SET (status|session_state)|INSERT INTO sessions[^)]*\b(status|session_state)\b' --type rust

# 4. Fire-and-forget writers — sites where a write sits inside a spawned task
#    (tokio::spawn / spawn_blocking). Phase 4 §10 calls out that the rewire
#    tightens the synchronous-stamp invariant; if any of these turn up, the
#    commit message must say so.
rg -n -B 5 'update_session_status|update_session_state' --type rust src-tauri/src/ \
    | rg -B 0 'tokio::spawn|spawn\(async|spawn_blocking'
```

After ruling out matches inside `#[cfg(test)]`, `#[test]`, `#[tokio::test]`, `tests/`, and `src-tauri/src/infrastructure/database/migrations/`, the deeper audit confirmed the original six. Specifically:

- **5 hits in test code** (correctly ignored): `mcp_api.rs:3205, :3303, :4768`, `service.rs:2700`, `finalizer.rs:296`. These set up legacy field state inside `#[tokio::test]` / `#[test]` blocks and are a separate problem (Wave B's two-way binding test pattern; see §8 Wave B for how the test-fixture-rewires land alongside the production rewires).
- **2 SQL writes on the wrong table** (`repository.rs:821, :839`): `UPDATE consolidation_rounds SET status = ?` — that's the consolidation rounds table's `status` column, unrelated to `sessions.status`. False positive; ignored.
- **1 SQL write in bootstrap migration code** (`db_schema.rs:508`): `UPDATE sessions SET session_state = 'running' WHERE session_state = 'reviewed'` — historical one-shot legacy migration; not a runtime writer. Ignored.
- **2 dead wrapper methods** (`repository.rs:384, :390`): `pub fn update_session_status` and `pub fn update_session_state` on the `SessionRepository`. `rg -n 'repository\.update_session_(status|state)|sessions_repo\.update_session_(status|state)'` returns zero callers. Dead code; deleted in Wave B.6 alongside the writer rewires.
- **0 fire-and-forget writers**: query (4) returns zero matches. Both production cancel-finalization writers (`service.rs:3431`, `cancellation.rs:725`) are called synchronously. The `service.rs:3424` doc comment ("call with brief lock") explicitly signals the synchronous-stamp contract — Phase 4 makes this contract structural rather than documentary.

If a Wave B sub-wave exposes a 7th writer (e.g. one that the grep regex didn't match — say, an alias method or a macro-expanded one), the rule per `feedback_regression_test_per_fix.md` is: write the regression test that asserts the new writer goes through `cancelled_at` / `is_spec` *first*, watch it fail, *then* rewire. Don't fix-and-add-test-after.

#### 0.1.b — Phase 3 wiring gap discovered during Wave B prep

A more critical gap surfaced while reading `db_sessions.rs` to plan the writer rewires: **the Phase 3 SELECT and INSERT statements were never wired to bind `is_spec` or `cancelled_at`.** The hydrators at `db_sessions.rs:313-314, :506-507, :599-600` and the all-test-fixture sites hardcode:

```rust
is_spec: false,
cancelled_at: None,
```

The INSERT at `db_sessions.rs:357-416` does not include either column in its column list or `params!` block. The 6+ SELECT statements (`create_session`, `get_session_by_name`, `get_session_by_id`, `list_sessions`, `list_sessions_by_state`, `get_sessions_by_task_run_id`) do not project either column.

Consequence: every `Session` returned from the DB has `is_spec=false, cancelled_at=None` regardless of what's stored in the row. The Phase 3 backfill migration *did* populate the columns on the SQLite side, but no production code path reads them back. `Session::lifecycle_state(...)` (the Phase 3 derived getter) is therefore returning incorrect answers — but only via tests that construct `Session` structs directly. No production code currently calls `lifecycle_state(...)`, so the bug is dormant.

This is the deepest reason Phase 4's read sweep (Wave C) couldn't have happened before Wave B's writer rewires AND the DB-layer wiring: switching a reader from `session.status == SessionStatus::Cancelled` to `session.cancelled_at.is_some()` *today* would silently always return `false` because the field isn't populated by the DB.

**Wave B therefore opens with a sub-wave B.0 that wires the DB layer end-to-end** — INSERT bindings, SELECT projections, hydrator field reads, plus the `set_session_cancelled_at` / `set_session_is_spec` setters that the writer rewires need. The two-way binding test for B.0 is exactly the right shape: write a regression test that round-trips a session with `is_spec=true, cancelled_at=Some(now)` through `db.create_session(...) → db.get_session_by_id(...)` and asserts the values survive. The test fails on the current main; B.0 makes it pass; reverting B.0 makes it fail again.

### 0.2 Session read surface — ~250 production sites

Catalog of reads of `Session.status`, `Session.session_state`, `SessionStatus::*`, `SessionState::*` in `src-tauri/src/`, top files by site count:

| File | Sites | Hard sites? | Notes |
|---|---|---|---|
| `mcp_api.rs` | 51–107 | yes | 3-arm consolidation status branching at 240/244/258; SQL-string predicate construction; ~107 if you count `.status` reads on sub-types |
| `domains/sessions/service.rs` | 42–53 | yes | Enrichment-time `Processing` synthesis (already migrated to `lifecycle_state()` getter in Phase 3 — most reads are pre-Phase-3 `match session.status` patterns) |
| `domains/sessions/db_sessions.rs` | 30–37 | **yes** | SQL `WHERE status = ?` and `WHERE session_state = ?` clauses must be rewritten as `WHERE is_spec = ?` / `WHERE cancelled_at IS [NOT] NULL`. Three SQL string-literal sites. |
| `domains/sessions/stage.rs` | 19 | no | Conditional logic, simple boolean reads |
| `domains/sessions/sorting.rs` | 19 | no | Sort ordering by status/state — translates to `lifecycle_state()` ordering |
| `domains/sessions/lifecycle/cancellation.rs` | 17 | no | Status guards on cancel path |
| `domains/sessions/repository.rs` | 16 | no | Includes the defensive normalizer at :148 (deleted in Wave B) |
| `domains/sessions/entity.rs` | 12 | yes | Enum definitions + `impl SessionStatus` + `impl SessionState` (all deleted in Wave D) |
| `domains/merge/service.rs` | 11 | no | 4 `SessionState::Spec` checks gating merge eligibility |
| `commands/schaltwerk_core.rs` | 10 | no | Command handlers translate request payload status strings |
| `domains/sessions/lifecycle/finalizer.rs` | ~7 | no | finalize state transitions |
| `domains/sessions/activity.rs` | ~6 | no | Activity tracking; trivially boolean-valued |
| `domains/sessions/action_prompts.rs` | ~5 | no | Prompt construction branches on status |
| `domains/sessions/consolidation_stub.rs` | ~5 | no | |
| `domains/sessions/facts_recorder.rs` | ~4 | no | |
| `domains/tasks/service.rs` | ~4 | no | Task-side reads of bound session lifecycle |
| `domains/tasks/auto_advance.rs` | ~3 | no | Same |
| `mcp_api/diff_api.rs` | ~22 | no | Mostly trivial filter predicates |

Top 5 files account for ~150–230 sites depending on how you count `.status` (some are `process.status`, `request.status`, etc., which are unrelated). The signal-to-noise ratio is high enough that disjoint-file parallel sub-waves will land cleanly.

**Hard sites** (require design-level thought, not mechanical substitution):
- **SQL string-literal predicates in `db_sessions.rs`.** ~3 sites. `WHERE status = 'cancelled'` rewrites to `WHERE cancelled_at IS NOT NULL`; `WHERE session_state = 'spec'` rewrites to `WHERE is_spec = 1`. The composite predicates (e.g. `WHERE status = 'active' AND session_state != 'spec'`) become `WHERE cancelled_at IS NULL AND is_spec = 0`.
- **Consolidation 3-way branching in `mcp_api.rs:240-258`.** Currently reads two sessions' `.status` and branches based on `(judge.status, source.status)` pairs. Must verify the post-collapse mapping (Active → `!is_cancelled`, Cancelled → `is_cancelled`, Spec → `is_spec`) preserves the existing case-by-case behavior. No semantic change intended — pure mechanical translation, but needs a second-pair-of-eyes test.
- **Enum definition site in `entity.rs`.** Phase 3 left `SessionStatus` and `SessionState` enums alongside the new fields. Phase 4 deletes both enums; the impl blocks (`FromStr`, `as_str`, `Display`) go with them.

### 0.3 Frontend read surface — zero changes

`grep -rn "session_state\|SessionStatus\|SessionState" src/ --include="*.ts" --include="*.tsx"` shows 33+ sites. **All of them read from `SessionInfo.session_state: string` (the wire format), not from a Rust struct directly.** Phase 3's wire-format adapter in `domains/sessions/service.rs::SessionInfoBuilder` synthesizes the legacy string from `lifecycle_state(...)`. Phase 4 preserves the adapter. **No `.ts` / `.tsx` files in `src/` are modified by Phase 4.** Phase 6 (sidebar split) is where the frontend may collapse the legacy-string-shaped wire format.

### 0.4 TaskFlowError audit — greenfield surface

- **23 task-related Tauri commands** registered in `main.rs:1782-1806`.
- **Return-type breakdown:**
  - `Result<_, String>`: **23 commands** (the majority — high-priority migration target because string errors are unstructured).
  - `Result<_, SchaltError>`: 4 sites (`lucode_task_cancel:571`, `lucode_task_confirm_stage:1003`, plus internal helpers `get_task:143` and `get_orchestration_context:877`).
- **Existing task-specific error variants live in `SchaltError`** at `src-tauri/src/errors.rs`:
  - `SchaltError::TaskNotFound { task_id }` (line 72)
  - `SchaltError::TaskCancelFailed { task_id, failures }` (line 77)
  - `SchaltError::StageAdvanceFailedAfterMerge { task_id, message }` (line 84)
- **Frontend `getErrorMessage`** is at `src/types/errors.ts:35-86`. It handles `SchaltError`'s common variants but **does not yet handle the three task-specific variants** — they'd fall through to a generic message today.
- **Frontend invocations of `lucode_task_*`: zero.** No `invoke(TauriCommands.LucodeTask*)` calls in `src/`. Tasks are not surfaced through the UI yet (UI lands in Phase 6).

**Implication:** TaskFlowError can be designed cleanly without compat constraints. The 23 string-error commands migrate without frontend churn. The three SchaltError task variants move into TaskFlowError; the four SchaltError-returning commands are rewired. The four SchaltError-using internal helpers are also rewired. `src/types/errors.ts` gets a new exhaustive switch added (additive — no existing handling breaks because there's no existing handling).

### 0.5 Derived `current_*` audit — small, machinery already exists

- **Task struct fields** at `domains/tasks/entity.rs:266-268`:
  ```rust
  pub current_spec: Option<String>,
  pub current_plan: Option<String>,
  pub current_summary: Option<String>,
  ```
  All three derive `Serialize`/`Deserialize` via the `Task` struct's `#[derive]`.
- **TaskArtifactKind variants** map cleanly: `Spec → current_spec`, `Plan → current_plan`, `Summary → current_summary` (entity.rs:227-232).
- **Existing DB getter** at `infrastructure/database/db_tasks.rs`: `fn get_current_task_artifact(task_id: &str, kind: TaskArtifactKind) -> Result<Option<TaskArtifact>>`. SQL: `SELECT … WHERE task_id = ?1 AND artifact_kind = ?2 AND is_current = 1 LIMIT 1`. **This is the production query the new derived getter wraps.**
- **Write surface — single site:** `domains/tasks/service.rs:462-465`. After `mark_task_artifact_current(...)` succeeds, this block calls the matching column setter:
  ```rust
  // current shape:
  match kind {
      TaskArtifactKind::Spec => db.set_task_current_spec(task_id, content)?,
      TaskArtifactKind::Plan => db.set_task_current_plan(task_id, content)?,
      TaskArtifactKind::Summary => db.set_task_current_summary(task_id, content)?,
      _ => {}
  }
  ```
  Phase 4 deletes this block — the artifact's `is_current` flag is the source of truth; the denormalized columns are derived.
- **Read sites:** ~10 in `prompts.rs` / `service.rs` / `commands/tasks.rs` / `db_tasks.rs`. All become method calls on `Task` that delegate to `db.get_current_task_artifact(...)`.
- **Frontend reads:** zero in production code. (Three reads in `mcp-server/test/*.ts` snapshot fixtures — easily updated.) **No frontend changes.**

**Implication:** Derived-getter migration is the smallest of the four scope items. ~25 read sites + 1 write block + 3 column drops. Standalone wave.

### 0.6 Wave order, decided

1. **Wave A** — this plan + audit (no code).
2. **Wave B** — rewire the six Session writers to write `is_spec` / `cancelled_at` directly (and delete the defensive normalizer). Sequential, single-domain. **Prerequisite for column drop.**
3. **Wave C** — sweep Session readers across ~250 sites in parallel sub-waves on disjoint files.
4. **Wave D** — drop the legacy `status` / `session_state` columns + delete `SessionStatus` and `SessionState` enums. One-shot v2 migration via the SQLite table-rebuild dance.
5. **Wave E** — define `TaskFlowError`; migrate task commands.
6. **Wave F** — derived `current_*` getters; drop denormalized columns; one-shot migration.
7. **Wave G** — final validation.
8. **Wave H** — status doc + memory update.

Waves E and F are independent of Waves B–D. They could run in parallel sessions, but for a single-coordinator plan the sequential order keeps test-suite signal clean: if `just test` goes red after Wave E, the cause is unambiguously a TaskFlowError migration bug, not a sessions sweep bug.

### 0.7 MSRV check

Per Phase 2 §0 / Phase 3 §0 pattern: rustc 1.95.0 + edition 2024. No new feature MSRV needs in this phase.

---

## 1 — End-state shape after Phase 4

### `domains/sessions/entity.rs`

```rust
// SessionStatus — DELETED. All variants gone.
// SessionState — DELETED. All variants gone.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLifecycleState {
    Spec,
    Processing,
    Running,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    // …
    pub is_spec: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    // REMOVED: pub status: SessionStatus,
    // REMOVED: pub session_state: SessionState,
    // …
}
```

### `domains/tasks/entity.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    // …
    // REMOVED: pub current_spec: Option<String>,
    // REMOVED: pub current_plan: Option<String>,
    // REMOVED: pub current_summary: Option<String>,
    pub failure_flag: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    // … rest unchanged
}

impl Task {
    pub fn current_spec(&self, db: &Database) -> Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Spec)
    }
    pub fn current_plan(&self, db: &Database) -> Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Plan)
    }
    pub fn current_summary(&self, db: &Database) -> Result<Option<String>> {
        derive_current_artifact_body(db, &self.id, TaskArtifactKind::Summary)
    }
}

fn derive_current_artifact_body(
    db: &Database,
    task_id: &str,
    kind: TaskArtifactKind,
) -> Result<Option<String>> {
    Ok(db.get_current_task_artifact(task_id, kind)?.and_then(|a| a.content))
}
```

> **Why method-with-`db`-parameter, not a field:** the wire format's `Task` shape changes. Frontend invocations are zero today (per audit §0.4 / §0.5), so the breakage budget is "only `mcp-server/test` snapshots and a handful of MCP REST consumers." For backend-internal callers the explicit `db` parameter is honest about the cost — these getters do a SQL round-trip per kind. Callers that need all three should batch via `list_task_artifacts(task_id)` and filter client-side.

### `domains/tasks/errors.rs` — NEW FILE

```rust
//! Single canonical error type for the task command surface.
//! All `#[tauri::command]` functions in `commands/tasks.rs` return
//! `Result<_, TaskFlowError>`. Frontend sees one tagged-enum shape.
//! `SchaltError` continues for non-task surfaces; the three task
//! variants previously living in SchaltError move here.

use serde::Serialize;
use std::fmt;
use crate::domains::tasks::entity::{TaskStage, TaskArtifactKind};

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum TaskFlowError {
    /// Task lookup failed by id.
    TaskNotFound {
        task_id: String,
    },
    /// Cascade cancel encountered one or more session-level failures.
    /// Mirror of the v1 SchaltError variant; moved here verbatim.
    TaskCancelFailed {
        task_id: String,
        failures: Vec<String>,
    },
    /// `confirm_stage` succeeded the merge but failed to advance the
    /// task stage. Distinct surface so the UI can prompt for manual
    /// recovery without retrying the merge.
    StageAdvanceFailedAfterMerge {
        task_id: String,
        message: String,
    },
    /// The requested stage transition is not allowed by `can_advance_to`.
    InvalidStageTransition {
        task_id: String,
        from_stage: TaskStage,
        to_stage: TaskStage,
    },
    /// Operation requires the task to be active; this task is cancelled.
    TaskCancelled {
        task_id: String,
        cancelled_at: chrono::DateTime<chrono::Utc>,
    },
    /// Stage-config / preset / orchestration setup failed.
    OrchestrationSetupFailed {
        task_id: String,
        operation: String,
        message: String,
    },
    /// Required artifact (typically a Spec or Plan) is missing for the
    /// requested operation.
    MissingArtifact {
        task_id: String,
        kind: TaskArtifactKind,
    },
    /// User-visible validation error (e.g. malformed payload).
    InvalidInput {
        field: String,
        message: String,
    },
    /// Bridge into the broader `SchaltError` surface for non-task
    /// operations the task command happens to perform (e.g. a session
    /// cancel triggered by a task cancel cascade).
    Schalt(crate::errors::SchaltError),
    /// Free-form database error. Use sparingly — prefer the structured
    /// variants above for things the UI is expected to act on.
    DatabaseError {
        message: String,
    },
}

impl fmt::Display for TaskFlowError { /* exhaustive Display */ }
impl std::error::Error for TaskFlowError {}

impl From<SchaltError> for TaskFlowError {
    fn from(e: SchaltError) -> Self {
        match e {
            SchaltError::TaskNotFound { task_id } => Self::TaskNotFound { task_id },
            SchaltError::TaskCancelFailed { task_id, failures } => {
                Self::TaskCancelFailed { task_id, failures }
            }
            SchaltError::StageAdvanceFailedAfterMerge { task_id, message } => {
                Self::StageAdvanceFailedAfterMerge { task_id, message }
            }
            other => Self::Schalt(other),
        }
    }
}

impl From<rusqlite::Error> for TaskFlowError {
    fn from(e: rusqlite::Error) -> Self {
        Self::DatabaseError { message: e.to_string() }
    }
}

impl From<TaskFlowError> for String {
    fn from(e: TaskFlowError) -> Self { e.to_string() }
}
```

The three task-specific `SchaltError` variants are *deleted from* `errors.rs` after the migration completes (Wave E.4). The `From<SchaltError>` mapping above is therefore intermediate: during Wave E.2 it routes the legacy variants; after Wave E.4 those `match` arms become unreachable (the variants are gone) and the `match` collapses to a single `other` arm.

### `domains/tasks/entity.rs` (`Task`)

```rust
// REMOVED: pub current_spec: Option<String>,
// REMOVED: pub current_plan: Option<String>,
// REMOVED: pub current_summary: Option<String>,
// new methods on impl Task: current_spec(&db) / current_plan(&db) / current_summary(&db)
```

### `tasks` SQLite schema

```sql
-- AFTER Phase 4:
-- (every existing column unchanged EXCEPT)
-- current_spec    TEXT NULL,        -- DROPPED
-- current_plan    TEXT NULL,        -- DROPPED
-- current_summary TEXT NULL,        -- DROPPED
```

The denormalized data lives forever in the archive table `tasks_v2_drop_current_archive` (Wave F migration) for forensics. Live reads go through `get_current_task_artifact(task_id, kind)`.

### `sessions` SQLite schema

```sql
-- AFTER Phase 4:
-- status         TEXT NOT NULL,          -- DROPPED
-- session_state  TEXT DEFAULT 'running', -- DROPPED
-- (everything else unchanged)
```

The legacy enum string columns are dropped via the SQLite table-rebuild dance (`PRAGMA foreign_keys=OFF; CREATE TABLE sessions_new ...; INSERT INTO sessions_new SELECT ...; DROP TABLE sessions; ALTER TABLE sessions_new RENAME TO sessions; PRAGMA foreign_keys=ON;`). Archive: `sessions_v2_drop_legacy_status_archive`.

### Files that disappear or empty out

| File | Disposition |
|---|---|
| `domains/sessions/entity.rs` `SessionStatus` enum + `impl` + `FromStr` | Deleted (~40 lines). |
| `domains/sessions/entity.rs` `SessionState` enum + `impl` + `FromStr` | Deleted (~25 lines). |
| `Session.status: SessionStatus` field | Deleted. |
| `Session.session_state: SessionState` field | Deleted. |
| `Task.current_spec` / `current_plan` / `current_summary` fields | Deleted. |
| `db_tasks.rs::set_task_current_spec` / `set_task_current_plan` / `set_task_current_summary` setters + the `current_spec`/`current_plan`/`current_summary` columns in `TASK_SELECT_COLUMNS` | Deleted. |
| `domains/sessions/service.rs::update_session_state` (the public method) | Deleted; callers move to `set_session_cancelled_at` / `set_session_is_spec` directly. |
| `commands/schaltwerk_core.rs::schaltwerk_core_update_session_state` Tauri command | Deleted; not called from frontend (audit §0.1.5). |
| `domains/sessions/repository.rs::normalize_spec_state` defensive resync at :148-155 | Deleted (impossible drift with two boolean axes). |
| `db_sessions.rs::update_session_status`/`update_session_state` (low-level setters) | Deleted; replaced by `set_session_cancelled_at` / `set_session_is_spec` (which Phase 3 added). |
| `errors.rs` `SchaltError::TaskNotFound` / `TaskCancelFailed` / `StageAdvanceFailedAfterMerge` variants | Deleted; moved to `TaskFlowError`. |
| `commands/tasks.rs` `confirm_stage_error_to_string` / `map_confirm_stage_error` (if present) | Deleted; replaced by `Display` impl on `TaskFlowError`. |

### Files that change shape but do not disappear

| File | Change |
|---|---|
| `domains/sessions/db_sessions.rs` | INSERT/UPDATE/SELECT statements stop binding/selecting `status` and `session_state`; SQL string-literal predicates rewritten. |
| `domains/sessions/service.rs` | All `match session.status` patterns rewritten to `if session.is_cancelled() / session.is_spec / session.lifecycle_state(...)`. |
| `mcp_api.rs` | ~107 sites mechanically translated; consolidation 3-way branches verified by test. |
| `commands/tasks.rs` | All 23 task commands' signatures change from `Result<_, String>` (or `SchaltError`) to `Result<_, TaskFlowError>`. |
| `domains/tasks/service.rs` | `mark_artifact_current` no longer mirrors to denormalized columns (block at :462-465 deleted); callers that previously did `task.current_spec` use `task.current_spec(db)?`. |
| `domains/tasks/prompts.rs` | `task.current_spec` / `task.current_plan` reads → `task.current_spec(db)?` / `task.current_plan(db)?`. |
| `src/types/errors.ts` | New exhaustive switch in `getErrorMessage` for `TaskFlowError` variants (additive). |

---

## 2 — Migration order across the four scope items

The four scope items are ordered for clean test-suite signal:

| Wave | Scope item | Reason for placement |
|---|---|---|
| B | Session writes → new axes | Prerequisite for Wave D (column drop). 6 sites; small commit. |
| C | Session reads sweep | Largest sub-task. Done with sub-waves C.1–C.5 on disjoint files. |
| D | Drop legacy session columns + enums | Depends on B (writes) + C (reads) being done. |
| E | TaskFlowError + 23-command migration | Independent of B–D. After D so the test suite signal is clean. |
| F | Derived `current_*` getters + drop columns | Independent. Last because it touches the smallest domain. |

Within each scope item, the work order is the same as Phase 3 §2:

1. **Schema migration first** (additive: adds new columns idempotently). Already done by Phase 3 for sessions; F adds nothing new (it only drops).
2. **Entity types port** (already done by Phase 3 — fields exist).
3. **DB layer port** (read/write the new columns — Phase 3 already wired the new setters; Wave B finishes by deleting the old setters).
4. **Service/orchestration sweep** (production callers move to new fields).
5. **Wire-format adapter** (Phase 3 already shipped this; Wave C must keep it intact).
6. **Old enum/field deletion** (only when zero callers remain — `#![deny(dead_code)]` is the safety net).
7. **One-shot user-DB migration** (drop old columns via SQLite table-rebuild).
8. **Compile-time structural pin** (fn-pointer assertion that fails to compile if the dropped variant returns).

---

## 3 — User-DB migration extensions

Two new migration modules. Same pattern as Phase 1's `v1_to_v2_task_runs.rs` and Phase 3's `v1_to_v2_task_cancelled.rs`. Each is idempotent; v2-native DBs see them as no-ops.

### `v2_drop_session_legacy_columns.rs` (Wave D)

Distinct from `v1_to_v2_session_status.rs` (which is the Phase 3 backfill — preserved unchanged). This new migration runs *after* the backfill has populated `is_spec` and `cancelled_at`, then performs the SQLite table-rebuild dance to drop the legacy columns.

```rust
//! Phase 4 Wave D: drop the legacy `sessions.status` and
//! `sessions.session_state` columns now that all production readers
//! and writers consume the orthogonal axes (is_spec + cancelled_at).
//!
//! Prerequisite: `v1_to_v2_session_status::run()` has populated the new
//! columns (idempotent; run unconditionally before this).
//!
//! Strategy: SQLite cannot drop a column without rebuilding the table.
//! Steps:
//!   1. Detect: does the `sessions` table still have a `status` or
//!      `session_state` column? If neither, no-op.
//!   2. Archive: copy `sessions` to `sessions_v2_drop_legacy_status_archive`
//!      (forensics; preserves the legacy column values for v1 row debugging).
//!   3. Rebuild: CREATE TABLE sessions_new (without the dropped columns),
//!      INSERT INTO sessions_new SELECT (every column except the dropped ones),
//!      DROP TABLE sessions, ALTER TABLE sessions_new RENAME TO sessions.
//!   4. Re-create indexes that referenced the table by name.

pub fn run(conn: &Connection) -> Result<()> { … }
```

Tests (modeled on Phase 3's `v1_to_v2_session_status::tests`):
- `noop_on_v2_native_db_without_legacy_columns`
- `archive_table_preserves_legacy_values`
- `rebuilds_sessions_without_status_column`
- `rebuilds_sessions_without_session_state_column`
- `idempotent_repeat_run_is_clean_noop`
- `preserves_all_other_columns_and_their_values`
- `preserves_indexes`
- `preserves_data_for_unrelated_columns_under_concurrent_pressure` (defensive — uses the archive count vs live count comparison)

### `v2_drop_task_current_columns.rs` (Wave F)

```rust
//! Phase 4 Wave F: drop the denormalized `tasks.current_spec`,
//! `tasks.current_plan`, `tasks.current_summary` columns. Their values
//! are derived at read time from `task_artifacts` (where is_current=1
//! and artifact_kind matches).
//!
//! Strategy: SQLite table-rebuild dance, same as the sessions migration.
//! Archive table: `tasks_v2_drop_current_archive` (preserves the
//! pre-rewrite denormalized values for forensics).
//!
//! Defensive verification before drop: for every (task_id, kind) where
//! `task.current_*` was set, assert that `task_artifacts` has a matching
//! `is_current=1` row. If any drift is found, log a WARN with the
//! mismatch details. Drift is not an error — Phase 1 / 3 maintained
//! both surfaces in lockstep, so drift would only happen if a v1 user
//! manually edited the DB; we tolerate that.

pub fn run(conn: &Connection) -> Result<()> { … }
```

Tests:
- `noop_on_v2_native_db_without_legacy_columns`
- `archive_table_preserves_denormalized_values`
- `rebuilds_tasks_without_current_columns`
- `idempotent_repeat_run_is_clean_noop`
- `preserves_all_other_task_columns`
- `logs_drift_warning_when_artifact_history_does_not_match_denormalized` (verifies the defensive check fires; doesn't fail the migration)

### Migration call order in `db_schema.rs`

```rust
// Inside apply_sessions_migrations or equivalent:
super::migrations::v1_to_v2_task_runs::run(conn)?;        // Phase 1
super::migrations::v1_to_v2_run_role::run(conn)?;         // Phase 3 Wave D
super::migrations::v1_to_v2_task_cancelled::run(conn)?;   // Phase 3 Wave E
super::migrations::v1_to_v2_session_status::run(conn)?;   // Phase 3 Wave F (backfill)
super::migrations::v2_drop_session_legacy_columns::run(conn)?;  // Phase 4 Wave D (NEW)
super::migrations::v2_drop_task_current_columns::run(conn)?;    // Phase 4 Wave F (NEW)
```

Order matters: the Phase 3 backfill must run before the Phase 4 column drop (otherwise the rebuild SELECT would have nothing to project from in some edge cases). Each migration is independently idempotent; the chain is replay-safe.

---

## 4 — TaskFlowError design notes (Wave E)

### Variant rationale

| Variant | Why it's first-class (not just a string) |
|---|---|
| `TaskNotFound` | UI may render a 404-style placeholder. Frontend can branch without parsing strings. |
| `TaskCancelFailed` | Carries the per-session failure list. UI can show "5 of 7 sessions cancelled successfully; remaining failures: …". |
| `StageAdvanceFailedAfterMerge` | Critical recovery surface. User must know that the merge succeeded but the stage didn't advance, so they don't re-merge. |
| `InvalidStageTransition` | Frontend can disable the offending stage button instead of showing a generic "operation failed" toast. |
| `TaskCancelled` | Frontend can re-route to a cancelled-task view. Carries `cancelled_at` so the UI can render "cancelled 3 hours ago" without a second round-trip. |
| `OrchestrationSetupFailed` | Branches into operation-specific recovery (e.g., retry preset configuration) rather than a generic toast. |
| `MissingArtifact` | UI can render "no spec found — write one first" with a direct CTA. |
| `InvalidInput` | Mirrors `SchaltError::InvalidInput` exactly. Lets the UI highlight the offending field. |
| `Schalt(SchaltError)` | Bridge for non-task errors that happen during a task operation (e.g., a session cancel cascading from a task cancel). Preserves the SchaltError shape for frontend's existing handler. |
| `DatabaseError` | Catch-all for `rusqlite::Error` that doesn't fit the structured variants. Lossy by design — frontend renders the message verbatim. |

### Frontend mapping

`src/types/errors.ts` gets a sibling type to `SchaltErrorType`:

```ts
type TaskFlowErrorPayload =
  | { type: "TaskNotFound"; data: { task_id: string } }
  | { type: "TaskCancelFailed"; data: { task_id: string; failures: string[] } }
  | { type: "StageAdvanceFailedAfterMerge"; data: { task_id: string; message: string } }
  | { type: "InvalidStageTransition"; data: { task_id: string; from_stage: string; to_stage: string } }
  | { type: "TaskCancelled"; data: { task_id: string; cancelled_at: string } }
  | { type: "OrchestrationSetupFailed"; data: { task_id: string; operation: string; message: string } }
  | { type: "MissingArtifact"; data: { task_id: string; kind: string } }
  | { type: "InvalidInput"; data: { field: string; message: string } }
  | { type: "Schalt"; data: SchaltErrorPayload }
  | { type: "DatabaseError"; data: { message: string } };

export function isTaskFlowError(error: unknown): error is TaskFlowErrorPayload { … }

export function getErrorMessage(error: unknown): string {
    if (isTaskFlowError(error)) { return formatTaskFlowError(error); }
    if (isSchaltError(error)) { return formatSchaltError(error); }
    if (typeof error === "string") return error;
    return "Unknown error";
}
```

The check order is `TaskFlowError` first (because it can wrap a SchaltError), then SchaltError, then string fallback.

### Migration mechanics

23 commands × `Result<_, String>` → `Result<_, TaskFlowError>`. Every `.map_err(|e| e.to_string())` becomes `.map_err(TaskFlowError::from)?` (or a structured variant where the error is known to map to a specific TaskFlowError variant). Most errors today are `anyhow::Error` or `rusqlite::Error` flowing through `.to_string()`; the `From<rusqlite::Error>` impl on `TaskFlowError` handles the latter, and a small number of `anyhow::Error` sites get rewritten to bubble up the structured variant directly.

The 4 commands currently returning `Result<_, SchaltError>` are migrated similarly:
- `lucode_task_cancel`: `Result<Task, SchaltError>` → `Result<Task, TaskFlowError>`. The `SchaltError::TaskCancelFailed` it currently produces gets directly constructed as `TaskFlowError::TaskCancelFailed` instead.
- `lucode_task_confirm_stage`: `Result<Task, SchaltError>` → `Result<Task, TaskFlowError>`. The `SchaltError::StageAdvanceFailedAfterMerge` becomes `TaskFlowError::StageAdvanceFailedAfterMerge` directly.
- Internal helpers `get_task` and `get_orchestration_context`: same treatment.

After the migration, the three task variants are deleted from `SchaltError`. The `From<SchaltError> for TaskFlowError` impl's match arms for those variants become unreachable and are removed.

### What doesn't change

- `SchaltError` continues to exist for non-task surfaces. Nothing removed from it except the three task-specific variants.
- The session-cancel cascade still surfaces session-level errors via the `Schalt(SchaltError)` bridge. The UI's existing SchaltError handling continues to work.
- Backend modules outside `domains/tasks/` and `commands/tasks.rs` continue using `SchaltError`.

---

## 5 — Sub-wave breakdown for parallel execution

Per `feedback_parallel_agents_disjoint_files.md`: coordinator dispatches parallel agents on disjoint files; coordinator commits per sub-wave.

```
Wave A   (sequential, this doc)         — plan + audit + status doc rows
Wave B   (sequential, ≤4 files)         — Session write rewires
   B.1   (single file)                  — domains/sessions/service.rs:3417, :5136 cancellation finalize + delete update_session_state
   B.2   (single file)                  — domains/sessions/lifecycle/cancellation.rs:725
   B.3   (single file)                  — domains/sessions/lifecycle/finalizer.rs:78
   B.4   (single file)                  — commands/schaltwerk_core.rs:4379 delete schaltwerk_core_update_session_state command
   B.5   (single file)                  — domains/sessions/repository.rs:148-155 delete normalize_spec_state
Wave C   (mixed, the bulk)              — Session read sweep
   C.1   (parallel, 4 disjoint files)   — mcp_api.rs (split by line range or feature)
   C.2   (parallel, 4 disjoint files)   — domains/sessions/{service,db_sessions,sorting,utils}.rs
   C.3   (parallel, 4 disjoint files)   — domains/sessions/{stage,activity,action_prompts,consolidation_stub,facts_recorder}.rs
   C.4   (parallel, 3 disjoint files)   — domains/sessions/lifecycle/{cancellation,finalizer}.rs + domains/sessions/repository.rs
   C.5   (parallel, 3 disjoint files)   — domains/{merge,tasks}/service.rs + domains/tasks/auto_advance.rs + commands/schaltwerk_core.rs
Wave D   (sequential, 3 files)          — drop legacy session columns + enums
   D.1   (sequential)                   — delete SessionStatus, SessionState enums in entity.rs; remove fields from Session struct
   D.2   (sequential)                   — db_sessions.rs: stop binding/selecting status/session_state in INSERT/UPDATE/SELECT
   D.3   (sequential)                   — v2_drop_session_legacy_columns migration + structural tests
Wave E   (mixed)                        — TaskFlowError sweep
   E.1   (sequential)                   — define TaskFlowError in domains/tasks/errors.rs + From impls + Display + tests
   E.2   (parallel, ≤3 disjoint sets)   — migrate the 23 task commands in commands/tasks.rs (split by command range)
   E.3   (sequential)                   — frontend src/types/errors.ts: add TaskFlowError type + getErrorMessage branch
   E.4   (sequential)                   — delete the three task variants from SchaltError; collapse From<SchaltError> match
Wave F   (mixed)                        — derived current_* getters
   F.1   (sequential)                   — entity.rs: add current_spec(db)/current_plan(db)/current_summary(db) methods; remove fields
   F.2   (sequential)                   — domains/tasks/service.rs:462-465: delete denormalized-mirror block
   F.3   (parallel, 2 disjoint files)   — sweep readers in prompts.rs + commands/tasks.rs to method calls
   F.4   (sequential)                   — db_tasks.rs: drop set_task_current_* setters; remove from TASK_SELECT_COLUMNS
   F.5   (sequential)                   — v2_drop_task_current_columns migration + structural tests
Wave G   (sequential)                   — final compile + cargo shear + knip + arch tests + grep verification
Wave H   (sequential, status doc)       — Phase 4 done row + sub-wave table + memory update
```

### Why C is split into 5 sub-waves on ~16 files total

`mcp_api.rs` alone is 51–107 sites. Splitting it across 4 disjoint line ranges (e.g., 0–2000, 2000–4000, 4000–6000, 6000+) lets four agents work in parallel on the same file. Coordinator merges by line range. Risk: line ranges overlap if the file shifts during the merge; mitigation: each sub-wave commits its file then the next sub-wave rebases its reads.

Alternatively (and probably cleaner): split `mcp_api.rs` by *feature area* (consolidation, diff, sessions list, …) where each agent is scoped to a specific function or pair of functions. This is the recommended approach.

### Wave dispatching rules

- Each sub-wave's parallel agents are scoped to disjoint file lists or disjoint line ranges within the same file.
- Each agent runs `cargo check -p lucode` against its scope and reports diff + any compile errors.
- Coordinator collects diffs, runs `just test` once after each sub-wave, then commits.
- If `just test` fails after a sub-wave: identify the breaking sub-wave, revert just its commit, dispatch a follow-up agent with the failure context, retry.

---

## 6 — Compile-time contract assertions

Each fn-pointer assertion is a **positive** structural pin: if the new shape regresses, the assertion fails to compile. Negative existence ("no `SessionStatus` enum exists") is enforced by `#![deny(dead_code)]` plus a Wave G grep.

### Session enum removal pins (Wave D)

```rust
// domains/sessions/entity.rs::tests
#[test]
fn session_struct_has_no_status_field() {
    // Compile-time pin: the legacy `status` field is gone.
    // If a regression reintroduces it, the field-shape assertion below
    // fails because we explicitly enumerate the surviving identity
    // axes — adding `status` back doesn't break the assertion, but the
    // grep in Wave G + #![deny(dead_code)] do.
    fn assert_is_spec_field(_: fn(&Session) -> &bool) {}
    fn assert_cancelled_at_field(_: fn(&Session) -> &Option<DateTime<Utc>>) {}
    assert_is_spec_field(|s: &Session| &s.is_spec);
    assert_cancelled_at_field(|s: &Session| &s.cancelled_at);
    // (the status / session_state fields are gone; if they came back,
    // they'd just sit there until #![deny(dead_code)] lit them up.)
}

// Compile-time pin: SessionLifecycleState exhaustive match without wildcard
#[test]
fn session_lifecycle_state_match_is_exhaustive_without_wildcard() {
    let st = SessionLifecycleState::Running;
    let _label = match st {
        SessionLifecycleState::Spec => "spec",
        SessionLifecycleState::Processing => "processing",
        SessionLifecycleState::Running => "running",
        SessionLifecycleState::Cancelled => "cancelled",
    };
}
```

### `TaskFlowError` shape pin (Wave E)

```rust
// domains/tasks/errors.rs::tests
#[test]
fn task_flow_error_is_serializable() {
    fn assert_serializable<T: serde::Serialize>(_: &T) {}
    let e = TaskFlowError::TaskNotFound { task_id: "x".into() };
    assert_serializable(&e);
}

#[test]
fn task_flow_error_match_is_exhaustive_without_wildcard() {
    let e = TaskFlowError::TaskNotFound { task_id: "x".into() };
    let _label: &'static str = match e {
        TaskFlowError::TaskNotFound { .. } => "not_found",
        TaskFlowError::TaskCancelFailed { .. } => "cancel_failed",
        TaskFlowError::StageAdvanceFailedAfterMerge { .. } => "stage_advance_failed",
        TaskFlowError::InvalidStageTransition { .. } => "invalid_transition",
        TaskFlowError::TaskCancelled { .. } => "task_cancelled",
        TaskFlowError::OrchestrationSetupFailed { .. } => "orchestration_setup_failed",
        TaskFlowError::MissingArtifact { .. } => "missing_artifact",
        TaskFlowError::InvalidInput { .. } => "invalid_input",
        TaskFlowError::Schalt(_) => "schalt",
        TaskFlowError::DatabaseError { .. } => "database_error",
    };
}

// commands/tasks.rs::tests
#[test]
fn lucode_task_create_returns_task_flow_error() {
    fn assert_signature(_: fn(_, _, _, _) -> Result<Task, TaskFlowError>) {}
    // assert_signature(lucode_task_create);  // pseudocode — adapt to actual signature
}
```

### Task `current_*` field removal pin (Wave F)

```rust
// domains/tasks/entity.rs::tests
#[test]
fn task_struct_does_not_have_denormalized_current_fields() {
    // Compile-time pin: callers must use the method, not the field.
    // If a future change reintroduces `current_spec: Option<String>`,
    // the method-vs-field disambiguator below would still compile —
    // so this is enforced by Wave G grep + #![deny(dead_code)] plus
    // the positive assertion that the methods exist with the expected
    // db-parameter signature.
    fn assert_current_spec_method(_: fn(&Task, &Database) -> Result<Option<String>>) {}
    fn assert_current_plan_method(_: fn(&Task, &Database) -> Result<Option<String>>) {}
    fn assert_current_summary_method(_: fn(&Task, &Database) -> Result<Option<String>>) {}
    assert_current_spec_method(Task::current_spec);
    assert_current_plan_method(Task::current_plan);
    assert_current_summary_method(Task::current_summary);
}
```

### Wave G grep verification

After Waves D, E, F, the following greps return zero matches in production code:

```bash
# Session enums dropped
grep -rn 'SessionStatus' src-tauri/src/ --include='*.rs' | grep -v 'tests'
grep -rn 'SessionState[^L]' src-tauri/src/ --include='*.rs' | grep -v 'tests' | grep -v 'SessionLifecycleState'

# Legacy session columns dropped from DB layer
grep -rn '\.status =\|\.session_state =\|"status"\|"session_state"' src-tauri/src/domains/sessions/db_sessions.rs

# Task current_* fields dropped
grep -rn 'task\.current_spec\b\|task\.current_plan\b\|task\.current_summary\b' src-tauri/src/ --include='*.rs' | grep -v 'tests'
grep -rn 'set_task_current_spec\|set_task_current_plan\|set_task_current_summary' src-tauri/src/ --include='*.rs'

# Task command Result<_, String> returns dropped
grep -rn 'Result<.*, String>' src-tauri/src/commands/tasks.rs

# SchaltError task variants dropped
grep -rn 'SchaltError::TaskNotFound\|SchaltError::TaskCancelFailed\|SchaltError::StageAdvanceFailedAfterMerge' src-tauri/src/ --include='*.rs'
```

---

## 7 — Test strategy

Two-way binding tests per `feedback_regression_test_per_fix.md`. Every assertion that pins the new shape must fail when the new shape is reverted; every assertion that pins a derived getter must fail if the getter regresses to direct field access.

### Wave B — Session writes

| Test | Purpose | Two-way binding |
|---|---|---|
| `finalize_session_cancellation_sets_cancelled_at_not_status` | `finalize_session_cancellation` writes `cancelled_at = now()`, leaves `status` untouched (pre-Wave D the column still exists; this asserts the writer migrated) | If a regression rewires it back to `update_session_status`, the test catches it via DB-level assertion |
| `update_session_state_method_no_longer_exists` | The public `service.rs::update_session_state(...)` method is gone | Compile-time — calling it fails to compile |
| `schaltwerk_core_update_session_state_command_no_longer_registered` | The Tauri command registry doesn't expose it | Compile-time at `main.rs::generate_handler!` site if listed there |
| `normalize_spec_state_helper_no_longer_exists` | Defensive resync deleted | Compile-time |

### Wave C — Session reads sweep

| Test | Purpose | Two-way binding |
|---|---|---|
| `wire_format_adapter_unchanged_after_phase_4` | `SessionInfo.session_state` and `info.status` strings still match v1 for all 8 (is_spec, cancelled_at, worktree_exists) combinations | If the adapter regresses, the existing frontend `getSessionLifecycleState` test suite catches it |
| `consolidation_judge_branching_unchanged` | `mcp_api.rs:240-258` 3-way branching still produces the same outcomes for (judge_active, source_active), (judge_cancelled, …), etc. | Pre/post-sweep behavior pinned by an integration test running the consolidation surface |
| `db_sessions_sql_predicates_use_new_columns` | Generated SQL no longer references `status` or `session_state` | grep in test-suite assertion |
| Existing 2366 tests stay green | The sweep doesn't break behavior | If any test regresses, the sub-wave revert protocol kicks in |

### Wave D — Drop session columns + enums

| Test | Purpose | Two-way binding |
|---|---|---|
| `session_lifecycle_state_match_is_exhaustive_without_wildcard` | Compile-time exhaustive match | A regression that adds a 5th variant breaks compile |
| `session_struct_has_no_status_field` | Compile-time pin via fn-pointer (positive assertion of `is_spec` / `cancelled_at` field types) | Removing either field fails compile |
| `session_status_enum_does_not_exist_in_production` | Wave G grep returns zero matches in production code | If the enum is reintroduced, the grep fails the test |
| `migration_drops_status_and_session_state_columns` | Post-migration `pragma_table_info('sessions')` excludes both columns | Compare against archive table |
| `migration_idempotent_on_v2_native_db` | Running the migration twice on a v2-native DB is a no-op | Same shape as Phase 3 §7 migration tests |
| `archive_table_preserves_legacy_values` | `sessions_v2_drop_legacy_status_archive` has the original values for forensics | Defensive |

### Wave E — TaskFlowError + command migration

| Test | Purpose | Two-way binding |
|---|---|---|
| `task_flow_error_is_serializable` | Compile-time pin via trait-bound assertion | A regression that adds a non-Serialize variant breaks compile |
| `task_flow_error_match_is_exhaustive_without_wildcard` | Compile-time exhaustive match | Adding a variant requires updating every consumer |
| `task_flow_error_serializes_with_tagged_enum_format` | `serde_json::to_string(&TaskFlowError::TaskNotFound { task_id: "x" })` produces `{"type":"TaskNotFound","data":{"task_id":"x"}}` | A regression to `#[serde(untagged)]` breaks the frontend's discriminator pattern |
| `lucode_task_*_returns_task_flow_error` (per command) | fn-pointer signature assertion for each of the 23 commands | Compile-time |
| `from_schalt_error_maps_three_task_variants` | The `From<SchaltError> for TaskFlowError` impl preserves the three legacy task variants | Pre-Wave E.4 only; post-E.4 the variants are gone |
| `schalt_error_no_longer_has_task_variants` | Compile-time exhaustive match on `SchaltError` covers every variant without `TaskNotFound`/`TaskCancelFailed`/`StageAdvanceFailedAfterMerge` | Adding any back fails compile |

### Wave F — Derived `current_*` getters

| Test | Purpose | Two-way binding |
|---|---|---|
| `task_current_spec_method_reads_from_artifacts` | Calling `task.current_spec(&db)` returns the body of the artifact with `is_current=1` and `kind='spec'` | If the method regresses to `self.current_spec` (field access), it fails to compile (the field is gone) |
| `task_current_spec_returns_none_when_no_current_artifact` | Edge case: no artifact → None | Defensive |
| `task_current_spec_returns_latest_after_artifact_replaced` | Replacing the current artifact updates the derived value | Direct read-after-write check |
| `mark_artifact_current_no_longer_writes_denormalized_columns` | `domains/tasks/service.rs:462-465` block deleted | Wave G grep + DB-level assertion |
| `migration_drops_task_current_columns` | Post-migration `pragma_table_info('tasks')` excludes the three columns | Compare against archive |
| `migration_idempotent_on_v2_native_db` | Running migration twice is a no-op | Same shape as other migration tests |
| `migration_drift_warning_logged_when_artifact_history_disagrees` | The defensive drift-check logs a WARN if denormalized values don't match artifact history | Verifies the safety net fires |

### Frontend test suite

The existing 800+ frontend tests act as the regression suite. If any break after Phase 4, the wire-format adapter is buggy or the new `getErrorMessage` branch is misshaped — fix the adapter/handler, not the tests.

### Architecture tests

`arch_domain_isolation` and `arch_layering_database` already exist. Phase 4's new module `domains/tasks/errors.rs` must conform to the existing layer rules (errors layer is below domains, can be imported by both domains and infrastructure). Verify in Wave G.

---

## 8 — Wave-by-wave detail

### Wave A — plan + audit + status row (sequential)

**A1.** Write this file (audit findings in §0).
**A2.** Surface for review.
**A3.** Add a row to `plans/2026-04-29-task-flow-v2-status.md`'s Phase 4 sub-wave table (lands in Wave H).

No code, no commit yet beyond the plan.

### Wave B — Session writes (sequential, 7 sub-waves)

**Two-way binding contract (load-bearing):** Each writer rewire ships as **two commits or one combined commit with both diffs visible** — a *test-first* commit that adds a regression test asserting the new path stamps `cancelled_at` / `is_spec` directly *and would fail if reverted to the legacy column write*, then the rewire commit that makes the test pass. Per `feedback_regression_test_per_fix.md`, the binding goes both ways: the test must fail when the rewire is reverted (otherwise it's not a regression test, it's a tautology). To keep wave commit count manageable, this plan combines the test + rewire into a single commit per writer with the test added in the same diff — the "would fail if reverted" property is verified manually before commit by temporarily restoring the legacy write and running the test.

**B.0 — DB layer wiring for `is_spec` and `cancelled_at` (prerequisite, single file).**

Per §0.1.b: the Phase 3 plan added the columns and struct fields but never wired the SQL layer. Without B.0, every Wave B writer rewire would write to a column that no SELECT reads back.

Test (added in `db_sessions.rs::tests`):
- `db_round_trips_is_spec_and_cancelled_at_through_create_and_get_by_id`: create a session with `is_spec=true, cancelled_at=Some(t)`; call `db.get_session_by_id(...)`; assert both fields match. **Fails on the current main** because the hydrator hardcodes them.
- `db_round_trips_is_spec_and_cancelled_at_through_create_and_get_by_name`: same, via `get_session_by_name`.
- `db_round_trips_is_spec_and_cancelled_at_through_list_sessions`: same, via the bulk `list_sessions` hydrator.
- `db_round_trips_is_spec_and_cancelled_at_through_get_sessions_by_task_run_id`: same, via the task-run-bound query.
- `set_session_cancelled_at_writes_column`: invoke the new setter, read back via `get_session_by_id`, assert the column reflects.
- `set_session_is_spec_writes_column`: same shape for the spec axis.

Rewire (single file, ~120 lines diff):
- Add to `SessionMethods` trait + impl:
  ```rust
  fn set_session_cancelled_at(&self, id: &str, cancelled_at: chrono::DateTime<chrono::Utc>) -> Result<()>;
  fn set_session_is_spec(&self, id: &str, is_spec: bool) -> Result<()>;
  ```
  Implementation mirrors `set_session_exited_at`'s shape (small UPDATE statement, also touches `updated_at`).
- Update INSERT at `db_sessions.rs:357-416`: add `is_spec, cancelled_at` to the column list, `?46, ?47` to the VALUES, and bindings to `params!`.
- Update SELECT at `:425-432, :522, :642, :729, :913, :1416-1437`: add `is_spec, cancelled_at` to the column lists. Update each hydrator's row indexing.
- Update `hydrate_session_summaries` (the bulk loader) to project the new columns into the summary tuple and read them in the row builder.
- Add the `SessionSummaryRow` struct's two new fields.
- Replace every `is_spec: false, cancelled_at: None` hardcode at the production hydrator sites (lines 313-314, 506-507, 599-600) with reads from the row.
- Test fixtures (lines 1525, 1598, 1678, 1754, 1933, 2018, 2119, 2208, 2293) keep their hardcoded defaults — those are test-fixture builders, not production hydrators.

Verify two-way binding manually: temporarily revert the SELECT projection on `is_spec`, observe the round-trip test fails with "expected `is_spec=true`, got `false`".

Commit: `feat(db): wire is_spec and cancelled_at through INSERT, SELECT, and hydrators`. Body should note: closes the Phase 3 wiring gap; without this, every Wave B writer rewire would write to a column that no SELECT reads back.

**B.1 — `service.rs::finalize_session_cancellation` (writer #1, line 3431).**

Test (added in `domains/sessions/service.rs::tests` or `tests/e2e_session_cancel_writes.rs`):
- `finalize_session_cancellation_stamps_cancelled_at_synchronously`: invoke the function, assert `db.get_session_by_id(...).cancelled_at == Some(_)` AND **assert that no legacy column was written** (i.e. the legacy `status` column reads as it was at function entry — currently expected to be `'active'` because Phase 3 left it at `'active'` until cancellation; the test pins that it stays `'active'` through the rewire).

Rewire: replace `db_manager.update_session_status(_, SessionStatus::Cancelled)` with `db_manager.set_session_cancelled_at(session_id, Utc::now())` (the setter already exists from Phase 3 Wave F.1).

Verify two-way binding manually before commit: temporarily revert the rewire, run the test, confirm it fails with "expected `cancelled_at = Some(_)`, got `None`".

Commit: `refactor(sessions): finalize_session_cancellation stamps cancelled_at synchronously`. Mention in the commit body: the function's doc comment at :3424 ("call with brief lock") signals the contract is synchronous; Phase 4 makes that contract structural by writing the timestamp directly instead of through the legacy enum column.

**B.2 — `cancellation.rs::finalize_cancellation` (writer #2, line 725).**

Test (added in `domains/sessions/lifecycle/cancellation.rs::tests`):
- `finalize_cancellation_stamps_cancelled_at_synchronously`: same shape as B.1's test, scoped to the lifecycle-module variant.

Rewire: same substitution.

Verify two-way binding manually.

Commit: `refactor(sessions): finalize_cancellation in lifecycle module stamps cancelled_at synchronously`.

**B.3 — `finalizer.rs::finalize_state_transition` (writer #4, line 78).**

This one's different: the legacy `session_state` column is now derived (Phase 3 made `lifecycle_state(...)` ignore it). The function's job was setting `session_state`. Audit verdict: the function reduces to a no-op for the post-Phase-3 codebase. Verify by reading the function body — if the only side effect was `db_manager.update_session_state(...)`, delete the function and its callers' calls to it. If there are other side effects, keep them and just delete the column write.

Test (added before the rewire):
- `finalize_state_transition_does_not_write_legacy_session_state`: invoke the function, assert that the legacy `session_state` column on the row is unchanged from its pre-call value.

Rewire: delete the column write (and possibly the function entirely).

Verify two-way binding manually.

Commit: `refactor(sessions): drop legacy session_state writes in finalizer` (or `delete finalize_state_transition` if the function collapses).

**B.4 — `service.rs::update_session_state` (writer #3, line 5155 — the public service method).**

The `pub fn update_session_state(&self, session_name, state)` method on the service exists for the Tauri command in B.5 to call. Once B.5 deletes the command, this method has zero production callers.

Test:
- `service_update_session_state_method_no_longer_exists`: compile-time check via grep — Wave G's verification.

Rewire: delete the method.

Verify two-way binding manually: temporarily restore the method, confirm `cargo check` succeeds (i.e. the method has no callers if the command is also gone). After B.5 deletes the command, this is a clean delete.

Order constraint: B.4 must happen *after* B.5 (otherwise the command's call site fails to compile). Actually — flip the sequence. B.4 becomes B.5 in execution order. (Note: I'm keeping the numeric labels stable for plan reference; execution order is B.1, B.2, B.3, B.5_command_delete, B.4_method_delete, B.6.)

Commit: `refactor(sessions): delete public update_session_state method (no callers post-B.5)`.

**B.5 — `commands/schaltwerk_core.rs::schaltwerk_core_update_session_state` Tauri command (writer #5, line 4378).**

Test:
- `schaltwerk_core_update_session_state_command_no_longer_registered`: grep `main.rs::generate_handler!` — Wave G's verification. Compile-time fails to remove because removing from `generate_handler!` requires the command function still exists OR the function is also removed.

Rewire: delete the command function and remove from `main.rs:1618` `generate_handler!`. Remove from `commands/mod.rs:90`. Audit confirmed zero frontend invocations.

Verify two-way binding manually: temporarily restore both the function and the `generate_handler!` entry, confirm the project compiles.

Commit: `refactor(commands): delete schaltwerk_core_update_session_state Tauri command`.

**B.6 — `repository.rs::normalize_spec_state` defensive resync (writer #6, lines 154-155) + dead wrapper-method cleanup.**

Test:
- `normalize_spec_state_helper_no_longer_exists`: compile-time check — calling the function fails to compile.
- `repository_update_session_status_method_no_longer_exists`: same; the dead wrapper method at `:384` has zero callers (audit verified).
- `repository_update_session_state_method_no_longer_exists`: same for `:390`.

Rewire: delete `normalize_spec_state`. Delete the two dead wrapper methods on `SessionRepository`.

Verify two-way binding: temporarily restore each, confirm the project compiles AND that no production call site reaches the function. (Audit verified zero callers; this is double-checking.)

Commit: `refactor(sessions): delete normalize_spec_state and dead repository wrappers`.

After Wave B: 6 commits. Run `just test`. All 2366+ tests must stay green. The Phase 3 wire-format adapter is unchanged; the frontend sees identical wire payloads. The five test-fixture sites identified in §0.1 (`mcp_api.rs:3205, :3303, :4768`, `service.rs:2700`, `finalizer.rs:296`) continue using `SessionStatus`/`SessionState` enum constructors — they're test-fixture-builders, not runtime writers, and are migrated as part of Wave D.1 (entity cleanup) when the enums get deleted.

### Wave C — Session reads sweep (parallel sub-waves on disjoint files)

This is the largest wave. Five sub-waves, each dispatching parallel agents on disjoint files.

**C.1 — `mcp_api.rs` (parallel, 4 agents on disjoint feature areas).**

`mcp_api.rs` has ~107 read sites. Split by feature area:
- Agent 1: consolidation surface (lines ~200–800)
- Agent 2: diff surface (lines ~800–2500)
- Agent 3: session list / detail surface (lines ~2500–5000)
- Agent 4: tasks/runs surface (lines ~5000–end)

Each agent translates `session.status` reads to `session.is_cancelled() / session.is_spec / lifecycle_state(...)`, runs `cargo check -p lucode` on its scope. Coordinator merges; `just test`; one commit per feature area.

Commits: 4 commits.

**C.2 — `domains/sessions/{service,db_sessions,sorting,utils}.rs` (parallel, 4 agents).**

The most architecture-load-bearing files. Sub-wave-internal serialization order:
- `db_sessions.rs` first (SQL predicate rewrites — ~3 hard sites)
- `service.rs` next (the enrichment / list path — depends on `db_sessions` shape)
- `sorting.rs` and `utils.rs` last (depend on `service.rs`)

Each agent runs `cargo check -p lucode`. Coordinator merges; `just test`; one commit per file (4 commits).

**C.3 — `domains/sessions/{stage,activity,action_prompts,consolidation_stub,facts_recorder}.rs` (parallel, 4–5 agents).**

Smaller files, mostly trivial substitutions. One agent per file.

Commits: 4–5 commits.

**C.4 — `domains/sessions/lifecycle/{cancellation,finalizer}.rs` + `domains/sessions/repository.rs` (parallel, 3 agents).**

The cancellation and finalizer files have moderate read counts. Repository was the home of the deleted normalizer (already gone via Wave B); remaining reads are list/lookup paths.

Commits: 3 commits.

**C.5 — `domains/{merge,tasks}/service.rs` + `domains/tasks/auto_advance.rs` + `commands/schaltwerk_core.rs` (parallel, 4 agents).**

Cross-domain reads from non-sessions modules.

Commits: 4 commits.

After Wave C completes: `just test` must be green. Total: 19 commits in this wave.

### Wave D — Drop legacy session columns + enums (sequential, 3 sub-waves)

**D.1 — entity.rs cleanup (sequential).**

1. Delete `pub enum SessionStatus` + impl + FromStr.
2. Delete `pub enum SessionState` + impl + FromStr.
3. Remove `pub status: SessionStatus` and `pub session_state: SessionState` fields from `Session` struct.
4. `#![deny(dead_code)]` enforces zero remaining callers — if the sweep missed a site, the compile fails here pointing at the missed site.
5. Add structural pins: `session_lifecycle_state_match_is_exhaustive_without_wildcard`, the field-shape assertions.

Commit: `refactor(sessions): drop SessionStatus + SessionState enums`.

**D.2 — DB layer (sequential).**

1. `db_sessions.rs`: remove `status` and `session_state` from INSERT/UPDATE/SELECT statements. Remove the rusqlite `from_row` mappings for those columns.
2. Remove the low-level setters `update_session_status` / `update_session_state` (these are the DB-trait methods, distinct from the service-layer wrappers deleted in Wave B).

Commit: `refactor(db): drop status/session_state column bindings`.

**D.3 — Migration + structural tests (sequential).**

1. New file `infrastructure/database/migrations/v2_drop_session_legacy_columns.rs`. Implements the SQLite table-rebuild dance + archive table + idempotency check.
2. Wire into `apply_sessions_migrations` after `v1_to_v2_session_status::run`.
3. 6 migration tests (per §7).

Commit: `feat(db): drop sessions.status and sessions.session_state columns`.

After Wave D: `just test` green. The wire-format adapter still synthesizes the legacy strings for the frontend. Run the existing 800+ frontend tests; they should remain unaffected.

### Wave E — TaskFlowError sweep (mixed)

**E.1 — Define TaskFlowError (sequential, 1 file).**

1. New file `domains/tasks/errors.rs` with the enum, `Display` impl, `From<SchaltError>` impl, `From<rusqlite::Error>` impl, `From<TaskFlowError> for String`.
2. Re-export from `domains/tasks/mod.rs`.
3. Compile-time tests: `task_flow_error_is_serializable`, `task_flow_error_match_is_exhaustive_without_wildcard`, `task_flow_error_serializes_with_tagged_enum_format`.

Commit: `feat(tasks): TaskFlowError canonical error type`.

**E.2 — Migrate the 23 task commands (parallel, 3 agents on disjoint command sets).**

Split by line range or command grouping in `commands/tasks.rs`. Each agent migrates its commands' return type from `Result<_, String>` (or `Result<_, SchaltError>`) to `Result<_, TaskFlowError>`. Pattern:
- `.map_err(|e| e.to_string())?` → `.map_err(TaskFlowError::from)?` (default)
- Or, if the error path is a known structured variant, construct it directly.

Each agent runs `cargo check -p lucode`. Coordinator merges; `just test`; one commit per disjoint set.

Commits: 3 commits.

**E.3 — Frontend `src/types/errors.ts` (sequential, 1 file).**

1. Add `TaskFlowErrorPayload` type.
2. Add `isTaskFlowError(error)` discriminator.
3. Add `formatTaskFlowError(error)` mapper.
4. Update `getErrorMessage(error)` to check TaskFlowError before SchaltError.
5. Add unit tests for each variant's mapper output.

Commit: `feat(types): TaskFlowError handling in getErrorMessage`.

**E.4 — Delete legacy SchaltError task variants (sequential, 2 files).**

1. `errors.rs`: delete `TaskNotFound`, `TaskCancelFailed`, `StageAdvanceFailedAfterMerge` variants from `SchaltError`. Update `Display`, `from_session_lookup`, etc.
2. `domains/tasks/errors.rs::From<SchaltError>`: collapse the now-unreachable match arms; the `match` becomes `Self::Schalt(other)` for every variant.
3. `src/types/errors.ts`: remove the never-shipped task variants from the SchaltError handler (if any leaked in).
4. Update structural pin: `schalt_error_no_longer_has_task_variants`.

Commit: `refactor(errors): move task variants from SchaltError to TaskFlowError`.

After Wave E: `just test` green. All 23 task commands return `Result<_, TaskFlowError>`.

### Wave F — Derived current_* getters (mixed)

**F.1 — entity.rs (sequential, 1 file).**

1. Add methods `Task::current_spec(&self, db: &Database) -> Result<Option<String>>` (and `_plan`, `_summary`).
2. Add private helper `derive_current_artifact_body(db, task_id, kind)`.
3. Remove fields `current_spec`, `current_plan`, `current_summary` from `Task` struct.
4. `#![deny(dead_code)]` flushes out any caller still using field access.
5. Add structural pin: `task_struct_does_not_have_denormalized_current_fields`.

Commit: `refactor(tasks): replace current_* fields with derived methods`.

**F.2 — service.rs denormalized-mirror block (sequential, 1 file).**

Delete the block at `domains/tasks/service.rs:462-465` that mirrors artifact bodies to the denormalized columns.

Commit: `refactor(tasks): drop denormalized current_* mirror in mark_artifact_current`.

**F.3 — Sweep readers (parallel, 2 files).**

Two agents:
- `domains/tasks/prompts.rs`: ~3 reads → method calls.
- `commands/tasks.rs`: ~5 reads → method calls.

Commits: 2 commits.

**F.4 — DB layer (sequential, 1 file).**

1. `db_tasks.rs`: delete `set_task_current_spec` / `set_task_current_plan` / `set_task_current_summary` setters from `TaskMethods` trait + impl.
2. Remove the three columns from `TASK_SELECT_COLUMNS` constant.
3. Update `from_row` mapping for `Task` to drop the three field reads.

Commit: `refactor(db): drop current_* setters and column bindings`.

**F.5 — Migration + structural tests (sequential, 2 files).**

1. New file `v2_drop_task_current_columns.rs`. Same shape as Wave D's migration. Includes the defensive drift-check that logs WARN if denormalized values disagree with `task_artifacts` (per §3).
2. Wire into `apply_tasks_migrations` after `v1_to_v2_task_cancelled::run`.
3. 6 migration tests + the structural pin.

Commit: `feat(db): drop tasks.current_spec/current_plan/current_summary columns`.

After Wave F: `just test` green.

### Wave G — Final validation (sequential)

**G.1.** `bun run lint:rust` (`cargo clippy`).
**G.2.** `cargo shear` (Rust dependency hygiene).
**G.3.** `bun run lint` (TypeScript lint — must stay green; the wire-format adapter prevents any frontend churn).
**G.4.** `knip` (dead code detection).
**G.5.** `arch_domain_isolation` and `arch_layering_database` pass.
**G.6.** Full `just test`. Must be green at >2366 tests (Wave E and Wave F add ~10 new tests; Wave D's structural pins add ~3 more).
**G.7.** Wave G grep verification (per §6) — every grep returns zero matches in production code.

If any of G.1–G.7 fail: identify the breaking sub-wave's commit, revert just that one, dispatch a fix agent, retry. Do not commit partial fixes that leave G.6 red.

Commit: none (validation only).

### Wave H — status doc + memory (sequential)

**H.1.** Update `plans/2026-04-29-task-flow-v2-status.md`:
- Mark Phase 4 row `[x]` with the merge commit hash.
- Add a Phase 4 sub-wave table (Waves A–H).
- Add a Phase 4 definition-of-done check table.

**H.2.** Update auto-memory `project_taskflow_v2_charter.md` to reflect Phase 4 complete (paragraph mirroring Phase 2 / Phase 3's "load-bearing contracts" section). Note: Phase 4 surface = TaskFlowError + `current_*` derived + legacy session columns dropped.

Commit: `docs(plans): Phase 4 complete`.

---

## 9 — Definition of done for Phase 4

- v2 branch compiles, `just test` green, `cargo shear` + `knip` clean, `cargo clippy` clean.
- 0 references to `pub enum SessionStatus` in production code.
- 0 references to `pub enum SessionState` in production code.
- 0 references to `Session.status` or `Session.session_state` as field reads in production code.
- 0 references to `db.update_session_status` or `db.update_session_state` low-level setters in production code (the methods are deleted from the trait).
- 0 references to `service.update_session_state` (the public service method is deleted).
- 0 references to `schaltwerk_core_update_session_state` Tauri command (deleted).
- 0 references to `Task.current_spec` / `current_plan` / `current_summary` as field reads in production code (only method calls remain).
- 0 references to `db.set_task_current_spec` / `set_task_current_plan` / `set_task_current_summary` (deleted).
- 0 task command return signatures of `Result<_, String>` in `commands/tasks.rs`.
- 0 task command return signatures of `Result<_, SchaltError>` (all moved to `Result<_, TaskFlowError>`).
- `domains/tasks/errors.rs::TaskFlowError` exists with the documented variants.
- `SchaltError` no longer has `TaskNotFound`, `TaskCancelFailed`, or `StageAdvanceFailedAfterMerge` variants.
- `Task::current_spec(db)` / `current_plan(db)` / `current_summary(db)` methods exist; pinned by `task_struct_does_not_have_denormalized_current_fields`.
- Two new migrations exist and are idempotent: `v2_drop_session_legacy_columns` + `v2_drop_task_current_columns`. Both have archive tables. Both have `noop_on_v2_native_db` + `idempotent_repeat_run` tests.
- Wire-format adapter unchanged: `SessionInfo.session_state` and `SessionInfo.status` strings still match v1 for every (is_spec, cancelled_at, worktree_exists) combination.
- `arch_domain_isolation` and `arch_layering_database` green.
- `plans/2026-04-29-task-flow-v2-status.md` Phase 4 row marked `[x]`.
- Auto-memory updated.

---

## 10 — Deliberate semantic changes & risks

### Deliberate semantic changes (call out in commit messages and PR body)

**1. Cancellation timestamps now stamped synchronously.** v1 (and Phase 3) wrote `status='cancelled'` immediately and lazily backfilled `cancelled_at` via the migration. Wave B rewires every cancellation path to write `cancelled_at = now()` directly. New cancellations (post-Wave B, pre-migration) on a v1-shaped DB still work because Wave B's writers operate against the column that Phase 3 added; the migration drop in Wave D only happens after every writer is rewired.

**2. The generic state-transition setter goes away.** v1 had `set_session_state(SessionState::Running | Processing | …)` as a generic setter. v2's lifecycle states are derived from boolean axes + worktree-exists; there's no `state` to set. Anything that previously called `update_session_state` either (a) was setting a value the getter would have derived anyway (delete the call), or (b) was setting a value the getter cannot derive (which would be a Phase 3 design gap, but we found none in the audit).

**3. The defensive `normalize_spec_state` resync is deleted.** v1 had a defensive sync because `status` and `session_state` could disagree. With one boolean axis (`is_spec`), drift is impossible. If a hidden bug surfaces (a session that should be a spec but isn't), it surfaces as a wire-format-adapter test failure — easy to diagnose.

**4. Task command error shape becomes structured.** 23 commands previously returned `Result<_, String>`; now they return `Result<_, TaskFlowError>`. The frontend's `getErrorMessage` gains exhaustive handling. Today the frontend doesn't call any of these commands (UI lands in Phase 6), so no user-visible change in Phase 4. But the contract is now structured so Phase 6's UI work is unblocked.

**5. `tasks.current_spec` / `current_plan` / `current_summary` move from columns to derived getters.** Each read becomes a SQL round-trip. The denormalized columns existed because v1 worried about read amplification; in practice these columns are read at most once per task list page load, and the round-trip cost is negligible. The benefit is that the artifact-history `is_current=1` flag becomes the unambiguous source of truth — no possible drift between the column and the artifact table.

**6. The drift-check on `v2_drop_task_current_columns` migration logs WARN, not ERROR.** If a v1 user has manually edited their DB to set `tasks.current_spec` without a corresponding `task_artifacts` row, the migration logs the mismatch but continues. Lucode is a personal app per `user_solo_macos.md`; aborting the migration on user data corruption would lock them out of the app. The archive table preserves the original column values for forensics.

### Risks

| Risk | Mitigation |
|---|---|
| Wave C's parallel sub-waves on `mcp_api.rs` produce overlapping diffs because line ranges shift mid-sweep | Use feature-area splitting (consolidation / diff / sessions / tasks) instead of line ranges. Each agent's scope is the function body, not a line range. |
| Wave B's writer rewires + Wave D's column drop interact in a multi-version upgrade | Each migration is independently idempotent. Wave B's writers go to `cancelled_at` / `is_spec` columns that exist post-Phase-3 backfill; Wave D's column drop runs after the backfill via the call-order in `apply_sessions_migrations`. A multi-version upgrade applies Phase 1 → Phase 3 → Phase 4 in order. |
| TaskFlowError shape designed wrong; future variants need adding | The enum is the boundary, not the implementation — adding variants is purely additive. The `tagged_enum_format` test pins the `{type, data}` discriminator. Adding a variant requires updating the exhaustive match + the frontend handler; that's the cost of structured errors and is paid once per variant. |
| The 23-command sweep misses a `String` return | `#![deny(dead_code)]` doesn't catch this. Mitigation: Wave G's `grep -rn 'Result<.*, String>' src-tauri/src/commands/tasks.rs` returns zero. |
| Derived `current_*` round-trips slow down task listing | Profile post-Wave-F. If listing N tasks does N×3 round-trips, batch via `db.list_current_artifacts_by_task(task_ids)` (a new query). Not implemented in Phase 4 unless profiling shows it; YAGNI per CLAUDE.md. |
| Phase 3's wire-format adapter has a bug surfaced by the sweep | The 800+ frontend tests catch it. If a frontend test goes red after Wave C, the sweep agent missed translating a read; fix the read, not the adapter. |
| Wave C's read sweep accidentally breaks the wire format by re-routing through `lifecycle_state()` differently than the adapter | The adapter is the *only* place that produces wire-format strings (`SessionInfoBuilder` in `service.rs`). All other reads read the new fields directly. The adapter is unchanged by Wave C. |
| Frontend's existing SchaltError handler breaks when the three task variants are removed | The frontend's `getErrorMessage` doesn't currently handle them (audit §0.4); removing them is a non-event for the frontend. |
| Wave E.4 collapses the `From<SchaltError>` match too aggressively | Compile-time exhaustive match catches it. After Wave E.4, `SchaltError` has no task variants, so the `match` reduces to a single `other` arm; the compiler verifies. |
| The migration's drift-check log message floods the log on a corrupted DB | Limit the log to the first N drift entries; log a summary count after that. |

---

## 11 — Execution handoff

Plan complete. Two execution options per the writing-plans skill:

1. **Subagent-driven (this session).** Coordinator dispatches fresh subagents per sub-wave; reviews diffs between sub-waves; commits per sub-wave. Best for Wave C (the 5-sub-wave parallel sweep). Recommended.
2. **Parallel session.** New session with `superpowers:executing-plans`, executes through the wave sequence with checkpoints.

Recommended: **subagent-driven**. Phase 4 has the same shape as Phase 3 Wave F: large mechanical sweeps across disjoint files. Subagent dispatching with per-sub-wave commits is the proven pattern.

The whole phase ships in one session (per the user's "execute end-to-end" instruction). Surface for review only when the whole phase is green and committed, or on a real blocker.

**Context-budget escape hatch:** if context genuinely runs out, commit what's green, update the status doc with where work stopped, stop. Don't leave the tree red. Likely safe stopping points:
- After Wave B (writers rewired; reads still on legacy fields; tree green)
- After Wave C (full sweep; columns and enums still exist; tree green; Wave D pending)
- After Wave D (sessions done; TaskFlowError pending)
- After Wave E (TaskFlowError done; current_* pending)

Awaiting plan review before starting code.
