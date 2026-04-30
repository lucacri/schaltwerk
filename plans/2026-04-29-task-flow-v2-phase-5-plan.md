# task-flow v2 — Phase 5 plan: explicit `lucode_task_run_done`

**Status:** draft (awaiting approval)
**Branch:** `task-flow-v2`
**Phase:** 5 of 6
**Design:** [`2026-04-29-task-flow-v2-design.md`](./2026-04-29-task-flow-v2-design.md) §8
**Status doc:** [`2026-04-29-task-flow-v2-status.md`](./2026-04-29-task-flow-v2-status.md)
**Estimated scope:** ≤ 1 session (single tool, well-trodden pattern)

## Goal

Add an explicit `lucode_task_run_done` MCP tool so AI agents can report run
completion deterministically. Replaces the *primary* signal that v1 inferred
from the 5s OSC-based idle heuristic. The heuristic stays as a fallback for
agents that don't cooperate (per design §8: "explicit MCP tool, not
heuristic"; the v2 idle-detection wiring remains live in
`session_facts_bridge`).

## Non-goals

- Sidebar work (Phase 6).
- Removing the OSC heuristic entirely. Stays as a fallback per design §8.
- Removing the `OnceCell` dispatcher pattern. Already done in Phase 1
  (the `attention_bridge`/`session_facts_bridge` no longer routes through
  one); design §9 referenced it but Phase 1 closed the gap.
- Updating *built-in* agents (Claude/Codex prompts) to actually call the
  tool. The tool ships first; prompt updates can land in a follow-up
  once we've validated the wire format with a real agent run.

## Tool shape (per design §8)

```jsonc
lucode_task_run_done {
  run_id: string,            // required — the TaskRun being reported on
  slot_session_id: string,   // required — the slot's session that owns this report
  status: "ok" | "failed",   // required
  artifact_id?: string,      // optional — when the agent produced a standalone artifact
  error?: string             // optional — failure reason text (only meaningful when status="failed")
}
```

**Output:** the updated `TaskRun` row (so the caller can observe the
derived status flip via `compute_run_status` on the next read). Mirrors
the `Result<TaskRun, …>` shape that `lucode_task_run_cancel` already
returns.

## Mapping to v2 surface

### `status: "ok"` — strict superset of the OSC idle heuristic

Calls `SessionFactsRecorder::record_first_idle(slot_session_id, now)`.

- Writes `session.first_idle_at = now()` on the slot session
  (write-once at the SQL layer; second call commits zero rows).
- `compute_run_status` Case 5 reads "all bound sessions have
  `first_idle_at IS NOT NULL`" to derive `AwaitingSelection`.
- For multi-slot/consolidation runs this stays at `Running` until the
  last candidate reports done, then trips `AwaitingSelection` once.
- Confirmation stays a separate human action via
  `lucode_task_confirm_stage`.

**Why not `confirm_selection`:** confirming = "this output is the
winner," and the agent doesn't know that. For multi-candidate runs
auto-confirming the first reporter defeats the point of having
candidates. For single-slot runs the user often wants to inspect
before confirming. The MCP tool replaces the *idle signal* (which is
what triggers AwaitingSelection), not the confirmation.

**Strict superset of OSC:** both the explicit MCP path and the OSC
heuristic write to the same column (`session.first_idle_at`); the MCP
path is the deterministic version where OSC is the fallback. A future
refactor that drops one path leaves the derivation contract intact.

**`artifact_id` handling:** accepted in the payload and logged via
`log::info!` so the trace shows what the agent reported. Phase 5
does *not* validate existence and does *not* persist a back-reference.

- *Not validated*: `TaskArtifactMethods` has only `get_current_task_artifact(task_id, kind)` and `list_*` lookups, no by-id lookup. Adding one is a trait change for ~zero Phase 5 benefit (the run's `task_id` isn't necessarily known at the lookup boundary).
- *Not persisted*: would require a schema change (`reported_artifact_id` column on `task_runs` or similar).

Accepting the parameter now keeps the wire format stable; future phases
can wire validation + persistence if/when a human-inspection UI surfaces.

### `status: "failed"`

Calls `TaskRunService::report_failure(run_id, reason)` only.

- Writes `task_runs.failed_at = now()` and
  `task_runs.failure_reason = error.unwrap_or("agent reported failure")`.
- `compute_run_status` Case 3 reads `failed_at.is_some()` to derive
  `Failed`. Authoritative source for agent self-reported failure.
- **Does NOT** set `session.exit_code = 1`. An agent that called this
  tool didn't exit non-zero — it ran a tool. Setting `exit_code` would
  be a lie that produces false positives for any future query like
  `WHERE exit_code IS NOT NULL` looking for process crashes. Agent
  self-reported failure is a distinct state from PTY-exit failure.

**Authoritative-source contract:** the failure test pins
`run.failed_at.is_some() && run.failure_reason == Some(reason)` AND
`session.exit_code.is_none()` (negative assertion). A future reader
can grep `failed_at` to find the canonical write site.

**Caveat to fix:** `set_task_run_failed_at`'s doc currently says
"Migration-only. v2-native code should never call this." This was
authored before Phase 5 was scoped. We rewrite the doc to accept the
explicit MCP tool as a v2-native caller, and add a
`TaskRunService::report_failure(run_id, reason)` facade so the raw
DB setter stays out of `commands/`. The doc rewrite is part of Wave B.

## DB-level change surface

| Concern | Change |
|---|---|
| `task_runs.failed_at` | No schema change — column already exists from Phase 1 (migration carrier). Doc tightened to also accept `lucode_task_run_done`. |
| `task_runs.failure_reason` | Same — already exists. Setter `set_task_run_failure_reason` already public. |
| `sessions.exit_code` / `sessions.exited_at` | No schema change — already wired through `SessionFactsRecorder::record_exit`. |
| New service method | `TaskRunService::report_failure(run_id, reason)`. Wraps `set_task_run_failed_at` + `set_task_run_failure_reason`. Tested in `domains::tasks::runs::tests`. |
| Migration | None. Phase 5 is pure additive surface — no column changes. |

This is a **wire-only** phase. Per `feedback_compile_pins_dont_catch_wiring.md`,
the additive bits get a DB round-trip test (Wave B test 4 below) so we
prove the read path agrees with the write path. There's no schema
change, but there IS a new write path through
`TaskRunService::report_failure` that needs to round-trip through
`compute_run_status`.

## Wave plan

Each wave below is a single commit unless the implementation forces a
split. Wave boundaries are also `just test` boundaries per
`feedback_test_scope_discipline.md`. Inner-loop work uses
`just test-single <path>` against the touched file.

---

### Wave A — plan (this commit)

**Files:**
- Create: `plans/2026-04-29-task-flow-v2-phase-5-plan.md` (this file)
- Modify: `plans/2026-04-29-task-flow-v2-status.md` (add Phase 5 row, mark `[ ]`)

**Step 1: Write this plan.**
Already done.

**Step 2: Update status doc.**
Add a Phase 5 wave-by-wave section with rows for B–E pending.

**Step 3: Commit.**
```
docs(plans): Phase 5 plan — explicit lucode_task_run_done MCP tool
```

**Test scope:** none (docs only).

---

### Wave B — `TaskRunService::report_failure` + Tauri command + service tests

**Goal:** end-to-end backend flow lands here, with the failure path's
service facade and the Tauri command. REST handler comes in Wave C; MCP
server registration in Wave D.

**Files:**
- Modify: `src-tauri/src/domains/tasks/runs.rs`
  - Add public method `report_failure(&self, run_id: &str, reason: &str) -> Result<TaskRun>`.
  - Add 3 unit tests (red first):
    1. `report_failure_writes_failed_at_and_failure_reason`
    2. `report_failure_does_not_unwind_confirm_or_cancel` (write-once-on-priority binding test — if a run is already cancelled, calling report_failure still writes, but `compute_run_status` keeps Cancelled per its decision order).
    3. `report_failure_round_trips_through_compute_run_status` — DB round-trip test per `feedback_compile_pins_dont_catch_wiring.md`. Goes through the actual write/read path: `service.report_failure(run.id, "boom")` → `db.get_task_run(run.id)` → `compute_run_status(read_run, &[]) == Failed`.
- Modify: `src-tauri/src/infrastructure/database/db_tasks.rs`
  - Update doc comment on `set_task_run_failed_at` from "Migration-only" to "Migration *and* explicit-failure callers (`TaskRunService::report_failure`, used by the `lucode_task_run_done` MCP tool)".
- Modify: `src-tauri/src/commands/tasks.rs`
  - Add `#[tauri::command] pub async fn lucode_task_run_done(...) -> Result<TaskRun, TaskFlowError>`.
  - Per-task lock pattern (mirrors `lucode_task_run_cancel`).
  - Branch on `status` payload: "ok" → `confirm_selection(slot_session_id, "agent")`; "failed" → `record_exit` + `report_failure`.
  - Validate: `slot_session_id` belongs to the run (lineage check, mirrors `confirm_stage`'s lineage validation).
  - On the failed path, also notify task mutation (`notify_task_mutation_with_db`) so the UI re-renders with the new derived status.
- Modify: `src-tauri/src/main.rs`
  - Register `commands::tasks::lucode_task_run_done` in the invoke handler list (line ~1802, after `lucode_task_confirm_stage`).
- Add: 2 Tauri-command-level tests in `commands/tasks.rs::tests`:
  - `lucode_task_run_done_with_status_ok_records_first_idle` — sets up a task+run+session, calls the command with status=ok, re-reads the session, asserts `session.first_idle_at.is_some()` AND `run.confirmed_at.is_none()` (negative — proves we did NOT auto-confirm) AND `compute_run_status(run, &[session_facts])` returns `AwaitingSelection`.
  - `lucode_task_run_done_with_status_failed_marks_run_failed` — sets up a task+run+session, calls the command with status=failed, asserts `run.failed_at.is_some()` AND `run.failure_reason.as_deref() == Some("boom")` AND `session.exit_code.is_none()` (negative — proves we did NOT lie about the PTY exit) AND `compute_run_status(run, &[session_facts])` returns `Failed`.
- Add: 1 lineage-rejection test:
  - `lucode_task_run_done_rejects_session_not_bound_to_run` — passes a session_id that's bound to a different run; asserts `TaskFlowError::InvalidInput { field: "slot_session_id", … }`.
- Add: 1 idempotency test:
  - `lucode_task_run_done_status_ok_is_idempotent` — calls the command twice with status=ok; asserts both calls succeed and that `session.first_idle_at` does not get overwritten on the second call (write-once invariant; pinned because regressing it would break sticky AwaitingSelection).

**Step 1: Red — write the failing tests in `domains/tasks/runs.rs::tests` for `report_failure`.**

```rust
#[test]
fn report_failure_writes_failed_at_and_failure_reason() {
    let db = db();
    seed_task(&db, "t1", "first");
    let svc = TaskRunService::new(&db);
    let run = svc.create_task_run("t1", TaskStage::Implemented, None, None, None).unwrap();

    let after = svc.report_failure(&run.id, "agent reported failure").unwrap();

    assert!(after.failed_at.is_some());
    assert_eq!(after.failure_reason.as_deref(), Some("agent reported failure"));
    assert!(after.confirmed_at.is_none(), "report_failure must not stamp confirmed_at");
    assert!(after.cancelled_at.is_none(), "report_failure must not stamp cancelled_at");
}

#[test]
fn report_failure_round_trips_through_compute_run_status() {
    let db = db();
    seed_task(&db, "t1", "first");
    let svc = TaskRunService::new(&db);
    let run = svc.create_task_run("t1", TaskStage::Implemented, None, None, None).unwrap();

    svc.report_failure(&run.id, "boom").unwrap();

    let read_back = svc.get_run(&run.id).unwrap();
    assert_eq!(
        compute_run_status(&read_back, &[]),
        crate::domains::tasks::entity::TaskRunStatus::Failed,
        "after report_failure, compute_run_status reads failed_at and derives Failed"
    );
}
```

**Step 2: Run scoped tests to verify they fail.**

```bash
cargo nextest run -p lucode domains::tasks::runs::tests::report_failure
# Expected: FAIL with "no method named `report_failure`"
```

**Step 3: Green — implement `report_failure`.**

```rust
/// Record an explicit failure. Stamps `failed_at = now()` and writes
/// `failure_reason`. Used by the `lucode_task_run_done` MCP tool when an
/// agent self-reports a failure. The v2-native compute path also reads
/// `session.exit_code` (set independently via `SessionFactsRecorder`),
/// so the tool writes both for redundancy.
pub fn report_failure(&self, run_id: &str, reason: &str) -> Result<TaskRun> {
    self.db.set_task_run_failed_at(run_id)?;
    self.db.set_task_run_failure_reason(run_id, Some(reason))?;
    self.db.get_task_run(run_id)
}
```

**Step 4: Run scoped tests to verify they pass.**

```bash
cargo nextest run -p lucode domains::tasks::runs::tests::report_failure
# Expected: PASS
```

**Step 5: Update the `set_task_run_failed_at` doc.**

Edit `db_tasks.rs:109-113` to remove the "Migration-only" framing and
mention `TaskRunService::report_failure` as a v2-native caller.

**Step 6: Implement the Tauri command (red-green-refactor).**

Test file: `commands/tasks.rs::tests`. The two `lucode_task_run_done_*`
tests get written first (red), then the command body lands (green).
Lineage-rejection test lands alongside.

The command body in `commands/tasks.rs`:

```rust
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunDonePayload {
    pub run_id: String,
    pub slot_session_id: String,
    pub status: String,             // "ok" | "failed"
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn lucode_task_run_done(
    app: tauri::AppHandle,
    payload: TaskRunDonePayload,
    project_path: Option<String>,
) -> Result<TaskRun, TaskFlowError> {
    let (project, handle) = get_project_with_handle(project_path.as_deref()).await?;

    let run_svc = TaskRunService::new(&handle.db);
    let run = run_svc.get_run(&payload.run_id)
        .map_err(|err| TaskFlowError::InvalidInput {
            field: "run_id".into(),
            message: format!("task run '{}' not found: {err}", payload.run_id),
        })?;

    // Lineage check: the slot session must be bound to this run.
    let lineage = handle.db
        .get_session_task_lineage(&payload.slot_session_id)
        .map_err(|e| TaskFlowError::DatabaseError { message: e.to_string() })?;
    if lineage.task_run_id.as_deref() != Some(run.id.as_str()) {
        return Err(TaskFlowError::InvalidInput {
            field: "slot_session_id".into(),
            message: format!(
                "session '{}' is bound to run '{:?}', not run '{}'",
                payload.slot_session_id, lineage.task_run_id, run.id,
            ),
        });
    }

    let task_lock = project.task_locks.lock_for(&run.task_id);
    let _guard = task_lock.lock().await;

    if let Some(art_id) = payload.artifact_id.as_deref() {
        log::info!(
            "lucode_task_run_done: agent reported artifact '{}' for run '{}' (Phase 5 logs only; persistence is future work)",
            art_id, run.id,
        );
    }

    let updated = match payload.status.as_str() {
        "ok" => {
            // Phase 5 mapping: status=ok means "agent finished its work,"
            // not "this output is the winner." Set first_idle_at — strict
            // superset of the OSC heuristic. compute_run_status Case 5
            // derives AwaitingSelection once all bound sessions are idle.
            // Confirmation stays a separate human action.
            lucode::domains::sessions::SessionFactsRecorder::new(&handle.db)
                .record_first_idle(&payload.slot_session_id, chrono::Utc::now())
                .map_err(|e| TaskFlowError::DatabaseError { message: e.to_string() })?;
            run_svc.get_run(&run.id).map_err(TaskFlowError::from)?
        }
        "failed" => {
            let reason = payload.error.as_deref().unwrap_or("agent reported failure");
            // Authoritative source for agent self-reported failure: failed_at
            // + failure_reason on the run row. Do NOT set session.exit_code —
            // the agent didn't exit, and a future maintainer querying
            // exit_code IS NOT NULL would see false positives.
            run_svc.report_failure(&run.id, reason).map_err(TaskFlowError::from)?
        }
        other => {
            return Err(TaskFlowError::InvalidInput {
                field: "status".into(),
                message: format!("unknown status '{other}'; expected 'ok' or 'failed'"),
            });
        }
    };

    notify_task_mutation_with_db(&app, &handle.db, &handle.repo_path);
    Ok(updated)
}
```

**Step 7: Run scoped tests.**

```bash
cargo nextest run -p lucode commands::tasks
# Expected: all green
```

**Step 8: Wave-boundary full validation.**

```bash
just test
# Expected: green
```

**Step 9: Commit.**

```
feat(tasks): Phase 5 Wave B — TaskRunService::report_failure + lucode_task_run_done command
```

---

### Wave C — REST handler `POST /api/task-runs/{id}/done`

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
  - Add a route case in the dispatch (~line 480-ish, near the consolidation-rounds confirm handler) for `POST /api/task-runs/{id}/done`.
  - Add `extract_run_id_for_action(path, "/done")` helper modeled after `extract_round_id_for_action`.
  - Add `task_run_done(req, run_id, app) -> Result<Response<String>, hyper::Error>` handler. Body shape mirrors the Tauri command's `TaskRunDonePayload` (snake_case for REST, camelCase serde alias for the Tauri command — Tauri commands consistently use camelCase deserialization in this codebase).
  - The REST handler invokes the same logic as the Tauri command. Refactor: extract a private `task_run_done_inner(handle, payload, app) -> Result<TaskRun, TaskFlowError>` from the Tauri command body and call it from both. Mirrors how `confirm_consolidation_winner_inner` is structured.
- Add: 1 integration test in `mcp_api.rs::tests` modeled after `confirm_consolidation_winner` tests:
  - `task_run_done_ok_routes_to_confirm_selection`.
  - Asserts the response body contains the updated TaskRun JSON and that `compute_run_status` reads `Completed` after.

**Step 1: Red — write the failing integration test.**

**Step 2: Implement the route.**

**Step 3: Run scoped tests.**

```bash
cargo nextest run -p lucode mcp_api::tests::task_run_done
just test-single src-tauri/src/mcp_api.rs
```

**Step 4: Wave-boundary full validation.**

```bash
just test
```

**Step 5: Commit.**

```
feat(mcp): Phase 5 Wave C — POST /api/task-runs/{id}/done REST handler
```

---

### Wave D — MCP server tool registration

**Files:**
- Modify: `mcp-server/src/lucode-bridge.ts`
  - Add `taskRunDone(runId, slotSessionId, status, options)` method modeled after `confirmConsolidationWinner`.
  - Posts to `/api/task-runs/{id}/done` via `fetchWithAutoPort`.
  - Returns the parsed `TaskRun`.
- Modify: `mcp-server/src/schemas.ts`
  - Add `lucode_task_run_done` output schema entry under `toolOutputSchemas`. Output shape: the updated `TaskRun` row (id, task_id, stage, started_at, completed_at, cancelled_at, confirmed_at, failed_at, failure_reason, …). For pragmatism, use a permissive object schema that surfaces only the fields the MCP client needs to verify the report landed (`run_id`, `status` derived label, `failure_reason`). **OR** mirror the Rust `TaskRun` struct fully — pick whichever is more consistent with adjacent task tools. Decision deferred to implementation; document the choice in the commit.
- Modify: `mcp-server/src/lucode-mcp-server.ts`
  - Add `LucodeTaskRunDoneArgs` interface near the other task-related arg types.
  - Add tool registration entry (description, inputSchema, outputSchema) near `lucode_confirm_consolidation_winner`.
  - Add `case "lucode_task_run_done"` in the switch, mirroring `lucode_confirm_consolidation_winner`'s validation + bridge call + structured-response shape.
  - **Tool description text:** explicitly call out (a) this is the canonical primary signal for run completion; (b) the OSC/idle heuristic remains as a fallback; (c) the failure path writes both `session.exit_code` and `run.failed_at`. Per `feedback_compile_pins_dont_catch_wiring.md` — the description is the contract surface MCP clients see; a vague description is the "wire" that compile pins can't catch.
- Modify: `mcp-server/tests/` (look for existing `lucode-mcp-server.test.ts` or similar) — add a test for the new tool. **Inner-loop scope** for MCP changes: `bun --cwd mcp-server run test`.

**Step 1: Red — write the bridge test (if applicable) and the tool-registration test.**

**Step 2: Implement bridge + schema + registration.**

**Step 3: Run scoped tests.**

```bash
bun --cwd mcp-server run test
bun --cwd mcp-server run lint
```

**Step 4: Wave-boundary full validation.**

```bash
just test
```

**Step 5: Commit.**

```
feat(mcp-server): Phase 5 Wave D — register lucode_task_run_done tool
```

---

### Wave E — TauriCommands enum + design-doc update + status tracker + memory

**Files:**
- Modify: `src/common/tauriCommands.ts`
  - Add `LucodeTaskRunDone: 'lucode_task_run_done',`. Future-proofing — Phase 6 sidebar may invoke directly (unlikely, but the convention is "always add the enum entry when adding a Tauri command").
- Modify: `plans/2026-04-29-task-flow-v2-design.md` §8
  - Tighten the wording: replace the bullet `New MCP tool: lucode_task_run_done { run_id, slot_session_id, artifact_id, status: "ok" | "failed", reason? }` with the actual landed shape and a note that the OSC heuristic is the documented fallback.
- Modify: `plans/2026-04-29-task-flow-v2-status.md`
  - Mark Phase 5 row `[x]`.
  - Fill in the Phase 5 wave-by-wave section with commit hashes.
  - Add a Phase 5 Definition-of-Done check table.
- Auto-memory:
  - **Maybe** add a `feedback_*` if we learn anything new while wiring this up. Phase 4 added `feedback_compile_pins_dont_catch_wiring.md` because we discovered a class of bug; Phase 5 is mostly mechanical, so probably no new memory unless something surprising surfaces.

**Step 1: Final full validation.**

```bash
just test
# Expected: green
```

**Step 2: Commit.**

```
docs(plans): Phase 5 complete — Waves A–E summary + DoD check
```

---

## Definition of done (Phase 5)

| Criterion | How verified |
|---|---|
| `just test` green | `just test` final output |
| `lucode_task_run_done` tool registered in MCP server | `grep -n "lucode_task_run_done" mcp-server/src/lucode-mcp-server.ts` returns the registration + the case branch + the args interface |
| `POST /api/task-runs/{id}/done` REST route exists | `grep -n "/api/task-runs" src-tauri/src/mcp_api.rs` shows the dispatch entry |
| Tauri command `lucode_task_run_done` registered | `grep -n "lucode_task_run_done" src-tauri/src/main.rs` shows the invoke handler entry |
| TauriCommands enum has `LucodeTaskRunDone` | `grep -n "LucodeTaskRunDone" src/common/tauriCommands.ts` |
| `TaskRunService::report_failure` exists with round-trip test | `grep -n "fn report_failure" src-tauri/src/domains/tasks/runs.rs` shows the impl + the test |
| DB round-trip test goes through `db.get_task_run` after the write | `report_failure_round_trips_through_compute_run_status` in `domains::tasks::runs::tests` |
| Lineage-rejection test prevents cross-run session mismatch | `lucode_task_run_done_rejects_session_not_bound_to_run` in `commands::tasks::tests` |
| `arch_domain_isolation` and `arch_layering_database` green | part of `just test` |
| Design doc §8 reflects the landed tool shape | manual diff of design.md |
| Status doc Phase 5 row `[x]` | manual check |

## Risks

| Risk | Mitigation |
|---|---|
| `set_task_run_failed_at` doc tightening breaks a downstream assumption | Wave B greps for callers before changing the doc; only the migration and the new `report_failure` should be calling it. |
| Lineage check rejects legitimate calls from artifact-only runs | Phase 5 is scoped to session-bearing slots; artifact-only runs are out of scope. The tool spec requires `slot_session_id`, so artifact-only is impossible by construction. |
| MCP server schema mismatch with Rust `TaskRun` shape | The schema is permissive (defines only the fields the MCP client needs); the wire format is unchanged from Phase 1. |
| Belt-and-suspenders failed-path writes diverge in some edge case | Both writes are tested in `lucode_task_run_done_with_status_failed_marks_run_failed` (Wave B). If `compute_run_status` reads only one of them and the other drifts, the test catches it via assertions on both `session.exit_code` AND `run.failed_at`. |

## Out of scope (Phase 5)

- Updating the `attention_bridge`/`session_facts_bridge` listener (already
  Phase 1's job; design §9 referenced "drop OnceCell dispatcher" but
  Phase 1's `infrastructure/session_facts_bridge.rs` already replaced it
  with direct calls).
- Built-in agent prompt updates (Claude/Codex) to actually call this tool
  on completion. Land separately when we want to validate the wire
  format with a live agent.
- The artifact-only confirm path (XOR's other arm). The user's prompt
  raised this as a possibility — defer to a follow-up phase or scout-rule
  cleanup if/when the use case actually surfaces.
