# task-flow v2 — Phase 3 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three coupled enum collapses on the v2 task-flow surface: (a) `RunRole` (7 variants) → `slot_key: Option<String>` only; (b) `SessionStatus::{Active,Cancelled,Spec}` + `SessionState::{Spec,Processing,Running}` → `cancelled_at: Option<Timestamp>` + `is_spec: bool` plus a runtime-only derived `SessionLifecycleState` getter; (c) `TaskStage::Cancelled` → `task.cancelled_at: Option<Timestamp>` (the variant goes away from the enum). After Phase 3, the v2 schema has *no* enum-typed lifecycle column for sessions and *no* terminal stage variant for tasks — both decay into nullable timestamps the way `task_runs.status` did in Phase 1.

**Architecture:** Same shape as Phase 1 + 2: two streams per collapse — (a) v2 native code is born without the dropped enum, (b) one-shot user-DB migration backfills timestamps from legacy enum values then drops the legacy columns via SQLite's table-rebuild dance. No frontend refactor — `session_state` and `status` survive on the wire as derived strings synthesized by a backend getter, so the existing UI keeps rendering until Phase 6 finishes the sidebar split. Compile-time pins (fn-pointer assertions, like Phase 2's `project_schaltwerk_core_field_is_lock_free`) lock the new shape — if a future change reintroduces a dropped variant, the structural test fails to compile.

**Tech Stack:** Rust + Tauri (`src-tauri/`), SQLite via `rusqlite`, the existing `apply_*_migrations` and one-shot v1→v2 migration pattern in `infrastructure/database/migrations/`, RAII test cleanup, `cargo nextest`.

---

## 0 — Scope clarifications resolved before this plan

- **`SessionStatus` is actually 3-variant on v2, not 2.** The baseline doc froze v1's pre-Spec snapshot; on `task-flow-v2` the enum is `Active | Cancelled | Spec`. The `Spec` variant denotes draft sessions that don't yet have a real worktree. Phase 3 must preserve this axis explicitly — the design's "reduces to `cancelled_at: Option<Timestamp>`" wording only addressed Active/Cancelled. **Decision: add `is_spec: bool` column on `sessions` alongside `cancelled_at`.** Two boolean concepts are simpler than one tri-state; the spec axis is genuinely orthogonal to the cancelled axis, which is itself proven by the reconciler's `if session.status == SessionStatus::Spec && session.session_state != SessionState::Spec` defensive sync.

- **`SessionState::Processing` is already derived, not persisted in any meaningful sense.** The only producer of `Processing` in production code is `domains/sessions/service.rs:3901-3905`, which synthesizes it at enrichment time when "session is `Running` in DB but worktree doesn't exist on disk". So `Processing` was always a UI hint, never a stored state machine. Phase 3 makes that explicit: drop `Processing` and `Running` from the enum; keep a runtime-only derived getter `Session::lifecycle_state() → SessionLifecycleState { Spec, Processing, Running, Cancelled }` that reproduces the existing computation from `is_spec` + `cancelled_at` + `exited_at` + worktree existence + the bound test-mode guard.

- **The wire payload keeps `session_state` and `status` as derived strings.** No frontend refactor in Phase 3. Phase 6 (sidebar split) is where the frontend may collapse the three-variant enum if it wants. The minimum viable adapter is: backend's `SessionInfo` builder synthesizes `session_state` (`"spec" | "processing" | "running"`) and `status` (`"active" | "cancelled" | "spec"`) using the derived getter so the frontend's existing `getSessionLifecycleState` keeps producing the same answers. The 33+ `info.session_state` reads in TypeScript see no change.

- **`RunRole` is purely backend.** `grep -rn "RunRole\|run_role" src/ --include="*.ts" --include="*.tsx"` returns zero matches. Frontend never knew about it. The 100 backend uses across 7 files all collapse to `slot_key: Option<String>` plus a runtime-only `SlotKind` enum (NOT serialized, NOT stored) computed inline at the orchestration call site from `PresetShape` position (which already encodes "candidate" vs "consolidator" vs "evaluator" structurally via `.candidates` / `.consolidator` / `.evaluator` fields).

- **`TaskStage::Cancelled` collapses cleanly because no other code branches on it as a successor of `Done`.** The only `STAGE_ORDER`-style array in v2 is `domains/tasks/entity.rs::tests::ALL_STAGES`. Production code does one `if task.stage == TaskStage::Cancelled` short-circuit at `domains/tasks/service.rs:204` (the cancel-cascade idempotence guard). That site collapses to `if task.cancelled_at.is_some()`. The `is_terminal()` helper goes from `matches!(self, Done | Cancelled)` to `matches!(self, Done)` — but tasks need a separate `task.is_cancelled()` accessor for the same idempotence check, which becomes a `.cancelled_at.is_some()` field-style getter.

- **What we deliberately defer (Phases 4–6):**
  - Phase 4: `TaskFlowError` sweep, `failure_flag`/`failure_reason` cleanup, derived `current_*` getters. Phase 3 leaves Task's `failure_flag: bool` exactly where Phase 1 left it.
  - Phase 5: explicit `lucode_task_run_done` MCP tool. Phase 3 doesn't add MCP surface.
  - Phase 6: `Sidebar.tsx` split. Phase 3 keeps the wire-format adapter so the sidebar renders unchanged.

- **MSRV check** (per Phase 2 §0 pattern): rustc 1.95.0 + edition 2024, comfortably above any feature MSRV needed in this phase. No toolchain churn.

---

## 1 — End-state shape after Phase 3

### `domains/tasks/entity.rs`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStage {
    Draft,
    Ready,
    Brainstormed,
    Planned,
    Implemented,
    Pushed,
    Done,
    // Cancelled — gone. The variant no longer exists. is_cancelled
    // becomes task.cancelled_at.is_some().
}

impl TaskStage {
    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStage::Done)  // was: Done | Cancelled
    }
    pub fn can_advance_to(&self, next: TaskStage) -> bool {
        // The "*→Cancelled" arm is gone. Cancellation is no longer a
        // stage transition; it is an orthogonal event recorded as
        // task.cancelled_at = now().
        if *self == next || self.is_terminal() { return false; }
        matches!((*self, next),
            (TaskStage::Draft, TaskStage::Ready)
                | (TaskStage::Ready, TaskStage::Brainstormed)
                | (TaskStage::Ready, TaskStage::Draft)
                | (TaskStage::Brainstormed, TaskStage::Planned)
                | (TaskStage::Planned, TaskStage::Implemented)
                | (TaskStage::Implemented, TaskStage::Pushed)
                | (TaskStage::Pushed, TaskStage::Done))
    }
}

// RunRole — gone. Deleted entirely. No FromStr, no as_str, no
// serialization. Slot identity flows through Session::slot_key
// (which already exists from Phase 1 Wave I.8).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    // ... existing fields ...
    pub failure_flag: bool,
    // NEW:
    pub cancelled_at: Option<DateTime<Utc>>,
    // ... rest unchanged ...
}
```

### `domains/sessions/entity.rs`

```rust
// SessionStatus — gone. Deleted entirely.
// SessionState — gone. Deleted entirely.

// New in-memory derived enum (NOT serialized, NOT stored).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLifecycleState {
    Spec,
    Processing,  // is_spec=false, alive but worktree missing on disk
    Running,     // is_spec=false, alive, worktree present on disk
    Cancelled,   // cancelled_at.is_some()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    // ... existing fields ...
    pub worktree_path: PathBuf,
    // REMOVED: status: SessionStatus
    // REMOVED: session_state: SessionState
    // NEW:
    pub is_spec: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    // ... rest unchanged: exited_at, exit_code, first_idle_at,
    //                    task_id, task_run_id, slot_key,
    //                    REMOVED: run_role: Option<String>,
    //                    REMOVED: task_role: Option<String>,
}

impl Session {
    pub fn lifecycle_state(&self, worktree_exists_on_disk: bool) -> SessionLifecycleState {
        if self.cancelled_at.is_some() {
            return SessionLifecycleState::Cancelled;
        }
        if self.is_spec {
            return SessionLifecycleState::Spec;
        }
        if !worktree_exists_on_disk && !cfg!(test) {
            // Reproduces the v1 enrichment-time synthesis at
            // domains/sessions/service.rs:3901-3905.
            return SessionLifecycleState::Processing;
        }
        SessionLifecycleState::Running
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled_at.is_some()
    }
}
```

### `sessions` SQLite schema

```sql
-- BEFORE Phase 3 (v2 native + Phase 1 fact columns):
-- status TEXT NOT NULL,                  -- 'active' | 'cancelled' | 'spec'
-- session_state TEXT DEFAULT 'running',  -- 'spec' | 'processing' | 'running'
-- run_role TEXT,
-- task_role TEXT,

-- AFTER Phase 3:
-- is_spec INTEGER NOT NULL DEFAULT 0,
-- cancelled_at INTEGER NULL,
-- (status / session_state / run_role / task_role columns: dropped via table-rebuild dance)
```

### `tasks` SQLite schema

```sql
-- AFTER Phase 3:
-- (every existing column unchanged)
-- cancelled_at INTEGER NULL,  -- NEW
-- The stage column's permitted values lose 'cancelled'; the
-- v1→v2 migration backfills task.cancelled_at = updated_at for
-- legacy 'cancelled' rows and rewrites stage to whatever stage
-- preceded the cancel.
```

### Wire-format adapter

Backend's `SessionInfo` builder (`domains/sessions/service.rs::list_enriched_sessions_*`) synthesizes:

- `info.session_state: &str` ← `match session.lifecycle_state(...) { Spec => "spec", Processing => "processing", Running => "running", Cancelled => "running" /* see below */ }`.
- `info.status: &str` ← `if session.is_cancelled() { "cancelled" } else if session.is_spec { "spec" } else { "active" }`.

The `Cancelled` lifecycle state's wire-format mapping is `"running"` only when filling `session_state`, because cancelled sessions *also* carry `info.status = "cancelled"` and the frontend's existing precedence (`info.status === 'spec'` first) handles cancelled correctly. (Frontend's `getSessionLifecycleState` does NOT treat `'cancelled'` specially today — cancelled sessions disappear from the enriched list before reaching the sidebar — so this mapping is structurally inert.)

### Files that disappear or empty out

| File | Disposition |
|---|---|
| `domains/tasks/entity.rs` `RunRole` enum + `impl` + `FromStr` | Deleted. ~50 lines. |
| `domains/tasks/entity.rs` `TaskStage::Cancelled` variant + match arms | Variant removed; the match arms in `as_str`/`is_terminal`/`can_advance_to`/`FromStr` all lose their `TaskStage::Cancelled` branch. The `from_str("cancelled")` → no longer recognized; tests for it deleted. |
| `domains/sessions/entity.rs` `SessionStatus` enum + `impl` + `FromStr` | Deleted. ~40 lines. |
| `domains/sessions/entity.rs` `SessionState` enum + `impl` + `FromStr` | Deleted. ~25 lines. |
| `Session.run_role: Option<String>` field | Deleted. (Phase 1 added it as a string; Phase 3 removes the column entirely now that nothing reads it after the `RunRole`-enum sweep.) |
| `Session.task_role: Option<String>` field | Deleted. (Same reason.) |
| `domains/sessions/repository.rs:148-155` defensive `status==Spec && session_state!=Spec` resync | Deleted — both axes are now booleans, no possible drift. |

### Files that change shape but do not disappear

| File | Change |
|---|---|
| `domains/sessions/db_sessions.rs` | Reader/writer methods stop selecting/binding `status` / `session_state` / `run_role` / `task_role`. Add bindings for `is_spec` / `cancelled_at`. |
| `domains/sessions/service.rs:3895-3908` | The enrichment-time mapping becomes the `lifecycle_state()` getter call site (no in-place enum manipulation). |
| `domains/tasks/orchestration.rs` | `RunRole::TaskHost` / `RunRole::Clarify` / `RunRole::Single` / `RunRole::Candidate` / `RunRole::Consolidator` / `RunRole::Evaluator` literals → `slot_key` strings. The `host_calls` / `provisioned_session.run_role` test fields collapse to `slot_key`. |
| `domains/tasks/prompts.rs` | `build_stage_run_prompt(task, stage, role: RunRole)` → `build_stage_run_prompt(task, stage, kind: SlotKind)` where `SlotKind` is the new runtime-only enum derived inline at the orchestration call site from `PresetShape` position. |
| `domains/tasks/presets.rs` | `RunRole` references → `SlotKind`. |
| `domains/tasks/service.rs::cancel_task_cascading:204` | `if task.stage == TaskStage::Cancelled` → `if task.cancelled_at.is_some()`. The successful-cancel path stamps `task.cancelled_at = now()` instead of `task.stage = TaskStage::Cancelled`. |
| `domains/tasks/auto_advance.rs` | `TaskStage::Cancelled` short-circuit branches read `task.cancelled_at.is_some()` instead. |
| `domains/sessions/sorting.rs` | The status-based ordering reads the derived `lifecycle_state()` getter or the timestamps directly. |

---

## 2 — Migration order across the three collapses

The three collapses are loosely coupled. Dependencies:

- **A. `RunRole` → `slot_key` only.** Independent of B, C. Touches `domains/tasks/{entity,orchestration,prompts,presets,service,clarify}.rs` plus 6 test/command sites. Schema change: drop `sessions.run_role`, drop `sessions.task_role`. No backfill needed (slot_key already populated by Phase 1).
- **B. `SessionStatus` + `SessionState` → `is_spec` + `cancelled_at`.** Independent of A, C. Largest blast radius (~173 production sites). Schema migration: add `is_spec`, `cancelled_at`; drop `status`, `session_state`. Backfill: `is_spec = (status == 'spec')`, `cancelled_at = updated_at WHERE status = 'cancelled'`.
- **C. `TaskStage::Cancelled` → `task.cancelled_at`.** Independent of A, B. Schema migration: add `tasks.cancelled_at`; the `stage` column stays but its permitted values lose `'cancelled'`. Backfill: `cancelled_at = updated_at WHERE stage = 'cancelled'`; rewrite `stage` to the previous canonical stage. Touches `domains/tasks/{entity,service,auto_advance,reconciler,orchestration}.rs` plus 4 test/command sites.

**Recommended order: A → C → B.** Reasoning:

- **A first** — smallest blast radius, fewest call sites, builds confidence with the new `slot_key`/`SlotKind` pattern before B's larger sweep.
- **C second** — small-scoped to the tasks domain; no cross-domain churn. Gets the `cancelled_at`-as-orthogonal-timestamp pattern into the codebase before B uses the same shape on sessions.
- **B last** — by the time B lands, both `cancelled_at` (timestamp-as-state) and `is_spec` (boolean axis) patterns are already proven in the codebase. The B sweep also lights up several frontend tests via the wire-format adapter; doing it last keeps the test-suite signal clean for A and C.

Each collapse is its own wave (D, E, F respectively in the wave map below). Within each wave, the work order is:

1. **Schema migration first** (additive: add new columns idempotently).
2. **Entity types port** (add new fields, keep old fields for the moment so existing code compiles).
3. **DB layer port** (read/write the new columns).
4. **Service/orchestration sweep** (production callers move to new fields).
5. **Wire-format adapter** (synthesize legacy strings/enums at the boundary).
6. **Old enum/field deletion** (only when zero callers remain — `#![deny(dead_code)]` is the safety net).
7. **One-shot user-DB migration** (drop old columns via SQLite table-rebuild).
8. **Compile-time structural pin** (fn-pointer assertion that fails to compile if the dropped variant returns).

---

## 3 — User-DB migration extensions

Lives at `src-tauri/src/infrastructure/database/migrations/`. Same pattern as Phase 1's `v1_to_v2_task_runs.rs`. Each collapse gets its own migration module so a partial failure leaves the others intact.

### `v1_to_v2_run_role.rs` (Wave D)

Detect `sessions.run_role` and `sessions.task_role`. Archive `sessions` to `sessions_v1_role_archive`. The old columns are simply dropped via the table-rebuild dance — no backfill needed because Phase 1 already populated `slot_key` for v2-native rows, and v1 rows had no `slot_key`. For v1 rows where `slot_key` is NULL, leave it NULL — the orchestration code in v2 treats NULL `slot_key` as "single slot" already (per `domains/tasks/orchestration.rs::tests::started.sessions[0].run_role == RunRole::Single` shape, where `slot_key` is `Some("claude")` and the role is `Single`; the absence of `slot_key` means a non-orchestrated session, which is fine).

### `v1_to_v2_session_status.rs` (Wave F)

Detect `sessions.status` and/or `sessions.session_state`. Archive `sessions` to `sessions_v1_status_archive`. Backfill in this order:

```sql
-- is_spec from either legacy column (defensive: handle status/session_state drift)
UPDATE sessions SET is_spec = 1
    WHERE is_spec = 0
      AND (status = 'spec' OR session_state = 'spec');

-- cancelled_at from legacy status='cancelled'
UPDATE sessions SET cancelled_at = updated_at
    WHERE status = 'cancelled' AND cancelled_at IS NULL;
```

Then drop both `status` and `session_state` columns via the table-rebuild dance (one rebuild for both columns).

### `v1_to_v2_task_cancelled.rs` (Wave E)

Detect `tasks.stage = 'cancelled'` rows that exist before the `tasks.cancelled_at` column is populated. Archive `tasks` to `tasks_v1_cancelled_archive`. Backfill:

```sql
UPDATE tasks SET cancelled_at = updated_at
    WHERE stage = 'cancelled' AND cancelled_at IS NULL;

-- Rewrite stage to the safest non-cancelled placeholder.
-- 'draft' is chosen because most cancellations happen early (a task
-- never made it past brainstorm/plan); 'pushed' would falsely imply
-- "this almost shipped." 'draft' implies "we don't know how far this
-- got," which is the honest default. Artifact-history derivation
-- would be more precise but isn't worth the complexity for a
-- one-shot migration of a personal-app dataset. The archive table
-- preserves the precise pre-rewrite state for forensics.
UPDATE tasks SET stage = 'draft'
    WHERE stage = 'cancelled';
```

Document the `'draft'` fallback as a deliberate semantic loss — Phase 3 prefers a safe placeholder over preserving `'cancelled'` because the schema no longer allows it. The archive table preserves the precise pre-rewrite state.

The `tasks.stage` column itself is kept (the stage flow continues without the Cancelled variant); only individual rows' values are rewritten. No table-rebuild needed for tasks; only the sessions migration uses the rebuild dance.

### Migration call order in `db_schema.rs`

```rust
// inside apply_tasks_migrations or equivalent:
super::migrations::v1_to_v2_task_runs::run(conn)?;        // Phase 1
super::migrations::v1_to_v2_run_role::run(conn)?;         // Phase 3 Wave D
super::migrations::v1_to_v2_task_cancelled::run(conn)?;   // Phase 3 Wave E
super::migrations::v1_to_v2_session_status::run(conn)?;   // Phase 3 Wave F
```

Each migration is idempotent. v2-native DBs see all of them as no-ops.

---

## 4 — Frontend adapter strategy

**No frontend code changes in Phase 3.** The minimum viable adapter is in the Rust→TypeScript wire format.

### What the frontend currently reads

`SessionInfo.session_state: SessionState | 'spec' | 'processing' | 'running'` — used at 33+ sites with `info.session_state === SessionState.Spec` etc.
`SessionInfo.status: 'active' | 'dirty' | 'missing' | 'archived' | 'spec'` — narrower union than backend's `SessionStatus` (frontend never sees `'cancelled'` because cancelled sessions are filtered out before reaching the sidebar).

### What the backend produces after Phase 3

`SessionInfoBuilder` (in `domains/sessions/service.rs`) computes:

```rust
let lifecycle = session.lifecycle_state(worktree_exists);
let session_state_wire: &str = match lifecycle {
    SessionLifecycleState::Spec => "spec",
    SessionLifecycleState::Processing => "processing",
    SessionLifecycleState::Running => "running",
    SessionLifecycleState::Cancelled => "running",  // see §1
};

let status_wire: &str = if session.is_cancelled() {
    "cancelled"
} else if session.is_spec {
    "spec"
} else {
    "active"
};
```

Both strings populate `SessionInfo.session_state` and `SessionInfo.status` exactly as v1 did. Frontend's `getSessionLifecycleState` continues producing the same answers. No `.tsx` / `.ts` file in `src/` is modified by Phase 3.

### What Phase 6 may want to clean up later

- Drop the `Processing` variant from the frontend enum (it's structurally derived; Phase 6 can compute it client-side from `is_spec` + worktree-exists if needed).
- Drop the `'cancelled'` variant from `info.status` (since the frontend never observed it anyway).

These are noted in the Phase 6 sidebar-split plan, not Phase 3.

---

## 5 — Sub-wave breakdown for parallel execution

Per `feedback_parallel_agents_disjoint_files.md`: the coordinator dispatches parallel agents on disjoint files; coordinator commits per sub-wave.

```
Wave A   (sequential, this doc)         — plan + status doc rows
Wave B   (sequential, single file)      — task.cancelled_at field + Wave-prep entity changes
Wave C   (sequential, single file)      — schema column adds (sessions.is_spec, sessions.cancelled_at, tasks.cancelled_at)
Wave D   (mixed)                        — RunRole drop
   D.1   (sequential)                   — entity changes + SlotKind introduction
   D.2   (parallel, 3 disjoint files)   — sweep orchestration/prompts/presets to SlotKind
   D.3   (sequential)                   — DB layer + Session struct field removal
   D.4   (sequential)                   — v1→v2 run_role migration
Wave E   (mixed)                        — TaskStage::Cancelled drop
   E.1   (sequential)                   — entity changes + variant removal
   E.2   (parallel, 3 disjoint files)   — sweep service/auto_advance/reconciler/orchestration
   E.3   (sequential)                   — v1→v2 task_cancelled migration + structural test
Wave F   (mixed)                        — SessionStatus/SessionState drop
   F.1   (sequential)                   — entity changes + SessionLifecycleState introduction
   F.2   (parallel, ≤4 disjoint files)  — sweep production code: db_sessions, service, mcp_api, sorting/utils
   F.3   (parallel, ≤4 disjoint files)  — sweep production code: cancellation, finalizer, repository, activity
   F.4   (parallel, ≤3 disjoint files)  — sweep production code: tasks/service, tasks/auto_advance, merge/service
   F.5   (parallel, ≤3 disjoint files)  — sweep production code: stage, action_prompts, consolidation_stub, facts_recorder
   F.6   (sequential)                   — wire-format adapter + DB layer column removal
   F.7   (sequential)                   — v1→v2 session_status migration + structural tests
Wave G   (sequential)                   — final compile + cargo shear + knip + arch tests
Wave H   (sequential, status doc)       — Phase 3 done row + sub-wave table
```

### Why F is the biggest wave

`SessionStatus` + `SessionState` collectively touch ~173 production sites across 22 files. Even after splitting into 4 parallel sub-waves on disjoint files, the coordinator's commit-and-verify cycle is the bottleneck. Plan budget: F is ~50% of Phase 3's wall time.

### Why Wave A is its own wave

Per Phase 1 / Phase 2 convention: the plan + status doc lands first as a separate commit. Wave I in those phases marked the phase complete; Wave A here marks the plan ready for review.

### Wave dispatching rules

- Each sub-wave's parallel agents are scoped to disjoint file lists.
- Each agent runs `cargo check -p lucode` against its scope and reports diff + any compile errors.
- Coordinator collects diffs, runs `just test` once after each sub-wave, then commits.
- If `just test` fails after a sub-wave: identify the breaking sub-wave, revert just its commit, dispatch a follow-up agent with the failure context, retry.

---

## 6 — Compile-time contract assertions

Per the user's instruction to use type-level pinning. Each of these lives in the relevant `tests` module and fails to *compile* (not just fail at runtime) if a regression reintroduces the dropped variant.

### `RunRole` removal pin (Wave D)

```rust
// domains/tasks/entity.rs::tests
/// Compile-time pin: `RunRole` no longer exists in the entity module.
/// If a future change reintroduces the enum (or any of its variants),
/// the function-pointer coercion below fails to compile.
#[test]
fn run_role_is_not_a_type_in_entity() {
    // The trick: any reference to `RunRole` would resolve via `super::*`
    // to a defined type. Phase 3 deletes the type; this empty test plus
    // the entity module's lack of a `pub enum RunRole` is the contract.
    // The compile-time check is the absence of the type — verified by
    // `grep` in the wave's verification step rather than a Rust-level
    // assertion (Rust has no negative-existence type assertion).
}
```

Rust has no negative-existence assertion at the type level. Substitute: a `grep` check in the wave's verification step ("`grep -rn 'pub enum RunRole' src-tauri/src/` returns zero matches") plus a positive assertion that `Session.slot_key: Option<String>` is the only slot identifier.

```rust
#[test]
fn session_slot_key_field_is_option_string() {
    fn assert_slot_key_field(_: fn(&Session) -> &Option<String>) {}
    assert_slot_key_field(|s: &Session| &s.slot_key);
}
```

### `TaskStage::Cancelled` removal pin (Wave E)

```rust
#[test]
fn task_cancelled_at_field_is_option_datetime() {
    use chrono::{DateTime, Utc};
    fn assert_cancelled_at_field(_: fn(&Task) -> &Option<DateTime<Utc>>) {}
    assert_cancelled_at_field(|t: &Task| &t.cancelled_at);
}

#[test]
fn task_stage_has_seven_variants_not_eight() {
    // Exhaustive match — if a Cancelled variant returns, the
    // wildcard cannot be `unreachable!()` because it'd be a typo
    // for an unhandled variant; rustc's `non_exhaustive` lint would
    // surface it. Equivalent: the `as_str` impl below covers
    // exactly 7 stages without a wildcard arm.
    let stage = TaskStage::Done;
    let _label: &str = match stage {
        TaskStage::Draft => "draft",
        TaskStage::Ready => "ready",
        TaskStage::Brainstormed => "brainstormed",
        TaskStage::Planned => "planned",
        TaskStage::Implemented => "implemented",
        TaskStage::Pushed => "pushed",
        TaskStage::Done => "done",
    };
    // No Cancelled arm. If a future change reintroduces Cancelled,
    // this match becomes non-exhaustive and the compile fails.
}
```

### `SessionState` / `SessionStatus` removal pin (Wave F)

```rust
#[test]
fn session_is_spec_field_is_bool() {
    fn assert_is_spec_field(_: fn(&Session) -> &bool) {}
    assert_is_spec_field(|s: &Session| &s.is_spec);
}

#[test]
fn session_cancelled_at_field_is_option_datetime() {
    use chrono::{DateTime, Utc};
    fn assert_cancelled_at_field(_: fn(&Session) -> &Option<DateTime<Utc>>) {}
    assert_cancelled_at_field(|s: &Session| &s.cancelled_at);
}

#[test]
fn session_lifecycle_state_has_four_variants() {
    let st = SessionLifecycleState::Running;
    let _label = match st {
        SessionLifecycleState::Spec => "spec",
        SessionLifecycleState::Processing => "processing",
        SessionLifecycleState::Running => "running",
        SessionLifecycleState::Cancelled => "cancelled",
    };
    // No wildcard arm. Adding a 5th variant would make this
    // non-exhaustive; removing one would make a literal unreachable.
}
```

These are mechanical positive assertions that the new shape is in place; the negative ("no SessionStatus enum exists") is enforced by `#![deny(dead_code)]` plus a verification grep in Wave G.

---

## 7 — Test strategy

Two-way binding tests per `feedback_regression_test_per_fix.md`. Every assertion that pins the new shape must fail when the new shape is reverted; every assertion that pins a derived getter must fail if the getter regresses to direct field access.

### Wave D — `RunRole` drop

| Test | Purpose | Two-way binding |
|---|---|---|
| `slot_key_replaces_run_role_in_session_struct` | structural pin: `Session.slot_key: Option<String>` is the only slot identifier | Reintroducing `Session.run_role` or `Session.task_role` fails the field-type assertion |
| `slot_kind_is_runtime_only` | `SlotKind` enum is not `Serialize`/`Deserialize` and cannot be sent on the wire | Adding `#[derive(Serialize)]` would break this — verified by an `assert_not_serializable` macro or a `serde_json::to_string` call that fails to compile |
| `presets_emit_slot_kind_via_preset_position` | `PresetShape::candidates → SlotKind::Candidate`, etc. | Removing the position-based mapping makes the orchestration tests' role-assertions fail |
| `prompts_branch_on_slot_kind_not_run_role` | `build_stage_run_prompt(task, stage, kind: SlotKind)` signature | If the function signature regresses to `RunRole`, every caller fails to compile |
| `migration_drops_run_role_and_task_role_columns` | post-migration, `pragma_table_info('sessions')` excludes both columns | Compare against archive table: archive has them, live table doesn't |

### Wave E — `TaskStage::Cancelled` drop + `task.cancelled_at`

| Test | Purpose | Two-way binding |
|---|---|---|
| `task_cancelled_at_field_is_option_datetime` | structural pin (compile-time) | Removing the field fails compile |
| `task_stage_has_seven_variants_not_eight` | exhaustive match without wildcard | Reintroducing Cancelled variant requires updating every match site |
| `cancel_task_cascading_stamps_cancelled_at_not_stage` | the cancel cascade writes `cancelled_at = now()`, leaves `stage` untouched | If a regression flips `stage = Cancelled`, the test fails because the assertion explicitly compares stage to its pre-call value |
| `is_terminal_excludes_cancelled` | `TaskStage::is_terminal()` returns true ONLY for `Done` after Phase 3 | A regression that re-adds Cancelled to is_terminal fails this directly |
| `auto_advance_treats_cancelled_at_as_terminal` | the auto-advance machine short-circuits when `cancelled_at.is_some()` | Removing the cancelled_at guard makes the test fail with an unexpected stage transition |
| `migration_backfills_task_cancelled_at_and_rewrites_stage` | post-migration, legacy `stage='cancelled'` rows have `cancelled_at` populated and `stage='draft'` (the documented fallback) | Compare against archive: archive has stage='cancelled', live has stage='draft' + cancelled_at set |

### Wave F — `SessionStatus` / `SessionState` drop

| Test | Purpose | Two-way binding |
|---|---|---|
| `session_is_spec_field_is_bool` | structural pin (compile-time) | Removing the field fails compile |
| `session_cancelled_at_field_is_option_datetime` | structural pin (compile-time) | Removing the field fails compile |
| `session_lifecycle_state_has_four_variants` | exhaustive match | Adding a 5th variant requires updating every consumer |
| `lifecycle_state_returns_processing_when_worktree_missing` | the derived getter reproduces the v1 enrichment behavior at `service.rs:3901-3905` | Removing the worktree-exists check produces `Running` instead of `Processing` and the test fails |
| `lifecycle_state_returns_spec_for_is_spec_session` | derived getter for spec sessions | Toggling `is_spec` flips the answer |
| `lifecycle_state_returns_cancelled_when_cancelled_at_set` | derived getter for cancelled sessions | Setting/unsetting `cancelled_at` flips the answer |
| `wire_format_adapter_synthesizes_legacy_session_state_string` | the `SessionInfo.session_state` wire string matches v1's exact value for every (is_spec, cancelled_at, worktree_exists) combination | If the synthesis regresses, the existing frontend's `getSessionLifecycleState` test (already in the frontend test suite) fails because the wire format changed |
| `wire_format_adapter_synthesizes_legacy_status_string` | the `SessionInfo.status` wire string matches v1 | Same shape as above |
| `migration_backfills_is_spec_and_cancelled_at` | post-migration, `is_spec=1` for legacy `status='spec'` rows; `cancelled_at` populated for `status='cancelled'` | Compare against archive |
| `migration_drops_status_and_session_state_columns` | post-migration, `pragma_table_info('sessions')` excludes both | Compare against archive |
| `migration_idempotent_on_v2_native_db` | running the migration twice on a v2-native DB is a no-op | Same shape as Phase 1's migration tests |

### Frontend test suite

No new frontend tests; the existing 800+ frontend tests act as the regression suite. If any of them break after Phase 3, the wire-format adapter is buggy — fix the adapter, not the tests.

### Architecture tests

`arch_domain_isolation` and `arch_layering_database` already exist. Phase 3's new module `domains/sessions/lifecycle_state.rs` (or wherever the derived getter lives) must conform to the existing layer rules. Verify in Wave G.

---

## 8 — Wave-by-wave detail

### Wave A — plan + status row (sequential)

**A1.** Write this file.
**A2.** Add a row to `plans/2026-04-29-task-flow-v2-status.md`'s Phase 3 sub-wave table (lands in Wave H).

No code, no commit yet beyond the plan. Surface for review.

### Wave B — `task.cancelled_at` field + entity prep (sequential, single file)

**B1.** Add `pub cancelled_at: Option<DateTime<Utc>>` to `Task` struct in `domains/tasks/entity.rs`. Default to `None`.
**B2.** Add `pub fn is_cancelled(&self) -> bool { self.cancelled_at.is_some() }` accessor on `Task`.
**B3.** Compile check.

Commit: `feat(tasks): Task.cancelled_at field + is_cancelled accessor`.

### Wave C — schema column adds (sequential, single file)

**C1.** Add `ALTER TABLE sessions ADD COLUMN is_spec INTEGER NOT NULL DEFAULT 0` to `apply_sessions_migrations` in `db_schema.rs`.
**C2.** Add `ALTER TABLE sessions ADD COLUMN cancelled_at INTEGER NULL`.
**C3.** Add `ALTER TABLE tasks ADD COLUMN cancelled_at INTEGER NULL`.
**C4.** Idempotency tests: each column survives `initialize_schema` running twice.
**C5.** Backfill statements: `UPDATE sessions SET is_spec = 1 WHERE status = 'spec' AND is_spec = 0` (defensive, will be redundant once Wave F migration runs but keeps the column populated for code that lands before then).

Commit: `feat(db): Phase 3 schema columns (sessions.is_spec, sessions.cancelled_at, tasks.cancelled_at)`.

### Wave D — `RunRole` drop

**D.1 — entity + SlotKind introduction (sequential, 1 file).**

1. New runtime-only enum `SlotKind` in `domains/tasks/entity.rs`:
   ```rust
   #[derive(Debug, Clone, Copy, PartialEq, Eq)]
   pub enum SlotKind {
       TaskHost,
       Single,
       Candidate,
       Consolidator,
       Evaluator,
       MainHost,
       Clarify,
   }
   ```
   No `Serialize`/`Deserialize`. No `FromStr`. Pure runtime.

2. Keep `RunRole` enum in place for now (Wave D.2 sweeps callers).

Commit: `feat(tasks): SlotKind runtime-only enum (RunRole successor)`.

**D.2 — sweep orchestration/prompts/presets (parallel, 3 disjoint files).**

Three agents, one file each:
- `domains/tasks/orchestration.rs`: replace `RunRole::Variant` with `SlotKind::Variant`, update `host_calls` field types, update test fixtures.
- `domains/tasks/prompts.rs`: change `build_stage_run_prompt(task, stage, role: RunRole)` signature to `kind: SlotKind`.
- `domains/tasks/presets.rs` + `domains/tasks/clarify.rs`: pure name-change rewrites.

Each agent runs `cargo check -p lucode` and reports.

Commits: 3 commits, one per file (matches Phase 2 D.1 pattern).

**D.3 — DB layer + Session field removal (sequential, 2 files).**

1. `domains/sessions/db_sessions.rs`: stop binding `run_role` and `task_role` in INSERT/UPDATE; stop selecting them in queries. Read `slot_key` only.
2. `domains/sessions/entity.rs`: remove `pub run_role: Option<String>` and `pub task_role: Option<String>` fields from `Session` struct.
3. Delete `RunRole` enum + impl + FromStr.

`#![deny(dead_code)]` is the safety net — if any caller still references the deleted symbols, compile fails immediately.

Commit: `refactor(sessions): drop run_role/task_role fields and RunRole enum`.

**D.4 — v1→v2 run_role migration + structural test (sequential, 2 files).**

1. New file `infrastructure/database/migrations/v1_to_v2_run_role.rs`. Same shape as Phase 1's `v1_to_v2_task_runs.rs`. Detects `run_role` column, archives `sessions` to `sessions_v1_role_archive`, drops `run_role` and `task_role` via the table-rebuild dance.
2. Wire into `apply_sessions_migrations` after the existing migration calls.
3. Structural test `session_slot_key_field_is_option_string`.
4. 5 migration tests modeled on Phase 1's `v1_to_v2_task_runs::tests`.

Commit: `feat(db): one-shot v1→v2 run_role migration`.

### Wave E — `TaskStage::Cancelled` drop

**E.1 — entity changes (sequential, 1 file).**

1. Remove `TaskStage::Cancelled` variant from `TaskStage` enum.
2. Remove `Cancelled` arm from `as_str`, `is_terminal`, `can_advance_to`, `FromStr`.
3. Update the `ALL_STAGES` test array: 7 entries, not 8.
4. Update transition tests: delete `any_non_terminal_stage_can_jump_to_cancelled` (the transition no longer exists).

Commit: `refactor(tasks): drop TaskStage::Cancelled variant`.

**E.2 — sweep service/auto_advance/reconciler/orchestration (parallel, 3 disjoint files).**

Three agents:
- `domains/tasks/service.rs`: rewrite `cancel_task_cascading:204` from `if task.stage == TaskStage::Cancelled` to `if task.cancelled_at.is_some()`. The success path stamps `task.cancelled_at = now()` instead of `task.stage = TaskStage::Cancelled`.
- `domains/tasks/auto_advance.rs` + `domains/tasks/reconciler.rs`: `TaskStage::Cancelled` short-circuits → `task.cancelled_at.is_some()` short-circuits.
- `domains/tasks/orchestration.rs` + `commands/tasks.rs`: any remaining `TaskStage::Cancelled` references → `task.cancelled_at.is_some()`.

Commits: 3 commits, one per file.

**E.3 — v1→v2 task_cancelled migration + structural test (sequential, 2 files).**

1. New file `infrastructure/database/migrations/v1_to_v2_task_cancelled.rs`. Backfill `task.cancelled_at = updated_at WHERE stage = 'cancelled'`. Rewrite `stage = 'draft'` for those rows. Archive `tasks` to `tasks_v1_cancelled_archive` first.
2. Wire into `apply_tasks_migrations`.
3. Structural test `task_cancelled_at_field_is_option_datetime` + the exhaustive-match pin `task_stage_has_seven_variants_not_eight`.
4. 4 migration tests.

Commit: `feat(db): one-shot v1→v2 task_cancelled migration`.

### Wave F — `SessionStatus` / `SessionState` drop

**F.1 — entity changes + SessionLifecycleState introduction (sequential, 1 file).**

1. Add new fields to `Session` struct: `pub is_spec: bool`, `pub cancelled_at: Option<DateTime<Utc>>`.
2. New runtime-only enum `SessionLifecycleState` (Spec / Processing / Running / Cancelled).
3. New method `Session::lifecycle_state(&self, worktree_exists: bool) -> SessionLifecycleState`.
4. Keep `SessionStatus`/`SessionState` enums + `status`/`session_state` fields in place for now (F.6 deletes them).

Commit: `feat(sessions): is_spec + cancelled_at fields + SessionLifecycleState`.

**F.2 — sweep production code (parallel, 4 disjoint files).**

Four agents:
- `domains/sessions/db_sessions.rs`: bind/select the new columns in INSERT/UPDATE/SELECT; keep binding the old columns for now (F.6 finalizes).
- `domains/sessions/service.rs`: rewrite the enrichment-time `SessionState::Processing` synthesis at `:3901-3905` to use the new `lifecycle_state()` getter.
- `mcp_api.rs`: 29 sites. `session.session_state == SessionState::Spec` → `session.is_spec`. `SessionState::Processing | SessionState::Running` → `!session.is_spec`. Filter logic (lines 8125, 8163-8164) collapses to `is_spec` boolean.
- `domains/sessions/sorting.rs` + `domains/sessions/utils.rs`: enum-based sorting/grouping → derived state.

Commits: 4 commits, one per file.

**F.3 — sweep production code (parallel, 4 disjoint files).**

- `domains/sessions/lifecycle/cancellation.rs`: `if self.session.session_state == SessionState::Spec` → `if self.session.is_spec`. The cancel path stamps `cancelled_at = now()` instead of `status = SessionStatus::Cancelled`.
- `domains/sessions/lifecycle/finalizer.rs`: same shape.
- `domains/sessions/repository.rs`: delete the defensive `status==Spec && session_state!=Spec` resync at :148-155 (no longer possible with two booleans).
- `domains/sessions/activity.rs`: enum reads → boolean reads.

Commits: 4 commits, one per file.

**F.4 — sweep tasks/auto_advance + tasks/service + merge/service (parallel, 3 disjoint files).**

- `domains/tasks/service.rs`: the parts that read session state.
- `domains/tasks/auto_advance.rs`: same.
- `domains/merge/service.rs`: 4 sites where `SessionState::Spec` checks gate merge eligibility → `is_spec` checks.

Commits: 3 commits.

**F.5 — sweep stage + action_prompts + consolidation_stub + facts_recorder (parallel, ≤3 disjoint files).**

- `domains/sessions/stage.rs`
- `domains/sessions/action_prompts.rs`
- `domains/sessions/consolidation_stub.rs` + `domains/sessions/facts_recorder.rs` (combined; small files)

Commits: 3 commits.

**F.6 — wire-format adapter + DB layer column removal (sequential, 2 files).**

1. `domains/sessions/service.rs::SessionInfoBuilder`: synthesize `info.session_state` and `info.status` strings from the derived getter.
2. `domains/sessions/db_sessions.rs`: stop binding/selecting the old columns. Delete the rusqlite mappings.
3. `domains/sessions/entity.rs`: delete `SessionStatus` enum, `SessionState` enum, `Session.status` field, `Session.session_state` field.

`#![deny(dead_code)]` enforces zero remaining callers.

Commit: `refactor(sessions): drop SessionStatus + SessionState enums; wire-format adapter`.

**F.7 — v1→v2 session_status migration + structural tests (sequential, 2 files).**

1. New file `infrastructure/database/migrations/v1_to_v2_session_status.rs`. Backfill `is_spec` and `cancelled_at`; archive `sessions` to `sessions_v1_status_archive`; drop both `status` and `session_state` columns via table-rebuild dance.
2. Wire into `apply_sessions_migrations`.
3. Structural tests: `session_is_spec_field_is_bool`, `session_cancelled_at_field_is_option_datetime`, `session_lifecycle_state_has_four_variants`.
4. 5 migration tests + 4 wire-format adapter tests.

Commit: `feat(db): one-shot v1→v2 session_status migration + wire-format adapter`.

### Wave G — final compile + arch + clippy + shear/knip (sequential)

**G.1.** Run `bun run lint:rust` (`cargo clippy`).
**G.2.** Run `cargo shear` (Rust dependency hygiene).
**G.3.** Run `bun run lint` (TypeScript lint — must stay green; the wire-format adapter prevents any frontend churn).
**G.4.** Run `knip` (dead code detection).
**G.5.** Verify `arch_domain_isolation` and `arch_layering_database` pass.
**G.6.** Run full `just test`. Must be green at >2344 tests.
**G.7.** `grep -rn "RunRole\|SessionStatus\|SessionState\|TaskStage::Cancelled" src-tauri/src/ --include="*.rs"` returns only doc-comment references (or zero).

If any of G.1–G.6 fail: identify the breaking sub-wave's commit, revert just that one, dispatch a fix agent, retry. Do not commit partial fixes that leave G.6 red.

Commit: none (validation only).

### Wave H — status doc + memory (sequential)

**H.1.** Update `plans/2026-04-29-task-flow-v2-status.md`:
- Mark Phase 3 row `[x]` with the merge commit hash.
- Add a Phase 3 sub-wave table (Waves A–H).
- Add a Phase 3 definition-of-done check table.

**H.2.** Update auto-memory `project_taskflow_v2_charter.md` to reflect Phase 3 complete (paragraph mirroring Phase 2's "load-bearing contracts" section).

Commit: `docs(plans): Phase 3 complete`.

---

## 9 — Definition of done for Phase 3

- v2 branch compiles, `just test` green, `cargo shear` + `knip` clean, `cargo clippy` clean.
- 0 references to `pub enum RunRole` in production code (the FromStr/as_str impls are deleted; the enum itself is gone).
- 0 references to `pub enum SessionStatus` in production code.
- 0 references to `pub enum SessionState` in production code.
- 0 references to `TaskStage::Cancelled` in production code.
- 0 references to `Session.run_role`, `Session.task_role`, `Session.status`, `Session.session_state` in production code (fields deleted).
- `Task.cancelled_at: Option<DateTime<Utc>>` field exists; pinned by `task_cancelled_at_field_is_option_datetime`.
- `Session.is_spec: bool` and `Session.cancelled_at: Option<DateTime<Utc>>` fields exist; pinned by structural tests.
- `SessionLifecycleState` runtime-only enum with 4 variants pinned by `session_lifecycle_state_has_four_variants`.
- `SlotKind` runtime-only enum, NOT serializable.
- All four one-shot migrations idempotent, with archive tables containing exactly the v1 row count.
- Wire-format adapter produces identical `info.session_state` and `info.status` strings as v1 for every (is_spec, cancelled_at, worktree_exists) combination — pinned by 4 wire-format adapter tests.
- `arch_domain_isolation` and `arch_layering_database` green.
- `plans/2026-04-29-task-flow-v2-status.md` Phase 3 row marked `[x]`.
- Auto-memory updated.

---

## 10 — Deliberate semantic changes & risks

### Deliberate semantic changes (call out in commit messages and PR body)

**1. Cancellation is no longer a stage transition.** v1 modeled cancel as `task.stage = TaskStage::Cancelled` and `task.can_advance_to(Cancelled) == true` from any non-terminal stage. v2 records cancellation as an orthogonal event (`task.cancelled_at = now()`) and leaves `task.stage` at whatever it was when cancel happened. A cancelled task can be reopened (Phase 1's `reopen_task_to_stage` already exists) without an awkward "advance from cancelled to ready" backwards transition; reopen is `cancelled_at = NULL` plus stage assignment.

**2. Migration downgrades `stage='cancelled'` rows to `stage='draft'`.** This is a deliberate semantic loss. The archive table `tasks_v1_cancelled_archive` preserves the original. `'draft'` is the safer fallback than `'pushed'` because most cancellations happen early in the task lifecycle (cancellation is rarely a "this almost shipped" event); claiming `'pushed'` would overstate progress. `'draft'` honestly says "we don't know how far this got" without overclaiming. Document in the migration commit and in the Phase 3 status doc.

**3. `SessionState::Processing` is now a runtime-derived label, not a persisted state.** The user-visible behavior is unchanged — the wire format still emits `"processing"` when worktree-missing-on-disk. But the DB no longer has a `session_state` column, so the distinction is computed every read. Net: same UX, less DB surface, no possible drift.

**4. `Session.run_role` and `Session.task_role` are deleted, not just deprecated.** Phase 1 added `slot_key` alongside both columns; Phase 3 removes the legacy columns entirely. v1 sessions migrated to v2 have their `run_role` / `task_role` archived in `sessions_v1_role_archive` for forensics; live `sessions` rows have only `slot_key` (which Phase 1 backfilled from `task_role` per `db_schema.rs:951`).

### Risks

| Risk | Mitigation |
|---|---|
| Wave F is large (~173 sites across 22 files); a sweep agent misses a site | Wave F.6 deletes the old enums; `#![deny(dead_code)]` makes any missed caller a compile error pointing exactly at the missed site. Wave G's grep is the final safety net. |
| Frontend breaks because the wire format silently changed | Wire-format adapter tests in F.7 pin every (is_spec, cancelled_at, worktree_exists) combination's output string. The frontend's existing `getSessionLifecycleState` test suite ALSO catches drift. |
| `task.cancelled_at` and `task.stage` get out of sync (a cancelled task somehow regains a stage transition) | Phase 4 introduces `TaskFlowError` which can carry the typed conflict. Phase 3 adds a defensive guard in `service.rs::cancel_task_cascading` to short-circuit if `cancelled_at.is_some()` (already part of the cascade idempotence check, just rewritten). |
| Migration's `stage='draft'` fallback hides a user-visible regression | Document loudly in the migration commit + Phase 3 status doc. Lucode is a personal app per `user_solo_macos.md`; the user can manually reset the stage post-migration if desired. The archive table preserves the original. |
| `SlotKind` accidentally becomes serializable | Compile-time test `slot_kind_is_runtime_only` plus a code review check. If the enum gets `#[derive(Serialize)]`, the test breaks. |
| The reconciler's defensive `status==Spec && session_state!=Spec` resync was hiding a real bug | Possible. The resync was load-bearing in v1 because the two columns could drift. With v2's single `is_spec: bool`, drift is impossible. If a hidden bug surfaces (a session that should have been spec but wasn't), it surfaces as a wire-format adapter test failure during Wave F.7 — easy to diagnose. |
| Wave parallelism produces overlapping diffs | Same protocol as Phase 2 Wave E: each agent scoped to disjoint files; coordinator is the only writer of commits. |
| The four migrations interact in subtle ways during a multi-version upgrade | Each migration is independently idempotent. The detection step (`pragma_table_info` lookup) is the gate. If a future user upgrades from v1 (with both Phase 1 + Phase 3 migrations pending), the call order in `apply_sessions_migrations` ensures Phase 1's migration runs first and Phase 3's see the post-Phase-1 schema. |

**Open question deferred to Phase 4**: should `TaskFlowError` distinguish "task is cancelled" from "task not found"? Phase 3 leaves the existing `TaskNotFoundError` shape; Phase 4 may add a `TaskCancelled { task_id, cancelled_at }` variant.

---

## 11 — Execution handoff

Plan complete. Two execution options per the writing-plans skill:

1. **Subagent-driven (this session).** Coordinator dispatches fresh subagents per sub-wave; reviews diffs between sub-waves; commits per sub-wave. Best for Wave F (the 4-sub-wave parallel sweep).
2. **Parallel session.** New session with `superpowers:executing-plans`, executes through the wave sequence with checkpoints.

Recommended: **subagent-driven**. Phase 3 has the same shape as Phase 2 Wave E/F: large mechanical sweeps across disjoint files. Subagent dispatching with per-sub-wave commits is the proven pattern.

The whole phase ships in one session (per the user's "execute end-to-end in one session — same pattern as Phases 1 and 2" instruction). Surface for review only when the whole phase is green and committed, or on a real blocker. Context-budget escape hatch: if context genuinely runs out, commit what's green, update the status doc with where work stopped, stop. Don't leave the tree red.

Awaiting plan review before starting code.
