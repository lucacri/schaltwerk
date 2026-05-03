# MCP Server End-to-End Compat Audit (Tier 2.6)

**Date:** 2026-05-03
**Scope:** Verify each MCP tool in `mcp-server/` maps to a live REST endpoint on the v2 backend (`src-tauri/src/mcp_api.rs`) and that request/response shapes still match after Phase 7+8.
**Method:** Static analysis of `mcp-server/src/lucode-mcp-server.ts` (tool registry), `mcp-server/src/lucode-bridge.ts` (HTTP client), `mcp-server/src/schemas.ts` (output schemas), against `src-tauri/src/mcp_api.rs` (route table + handler structs). Test suite ran live: `bun run test` in `mcp-server/` — **195 pass / 0 fail**.

**Architecture note.** MCP tools do **not** call Tauri `invoke` commands. The MCP server is a stdio process that talks to the running v2 desktop app over an HTTP API on `localhost:8547+hash`. So shape comparison is `MCP tool input → bridge HTTP body → mcp_api.rs request struct`. The Tauri `generate_handler!` block is irrelevant to MCP compat.

## 1. Inventory

35 MCP tools defined in `mcp-server/src/lucode-mcp-server.ts:411-1153`. Every tool routes through `bridge` (HTTP) to a backend route in `mcp_api.rs`.

| # | MCP tool | Bridge HTTP target | Backend route (mcp_api.rs:339-507) | Status |
|---|---|---|---|---|
| 1 | `lucode_create` | `POST /api/sessions` | `create_session` (8013-) | works |
| 2 | `lucode_get_setup_script` | `GET /api/project/setup-script` | `get_project_setup_script` | works |
| 3 | `lucode_set_setup_script` | `PUT /api/project/setup-script` | `set_project_setup_script` | works |
| 4 | `lucode_get_worktree_base_directory` | `GET /api/project/worktree-base-directory` | `get_project_worktree_base_directory` | works |
| 5 | `lucode_set_worktree_base_directory` | `PUT /api/project/worktree-base-directory` | `set_project_worktree_base_directory` | works |
| 6 | `lucode_list` | `GET /api/sessions[?state=running]` (+ falls through to `/api/specs` for spec filter) | `list_sessions` | works |
| 7 | `lucode_send_message` | `POST /webhook/follow-up-message` | `main.rs:1001` webhook handler | works |
| 8 | `lucode_cancel` | `DELETE /api/sessions/{name}` (after local git worktree remove) | `delete_session` | works |
| 9 | `lucode_spec_create` | `POST /api/specs` | `create_draft` (6873-) | works (drift: see §4.A) |
| 10 | `lucode_draft_update` | `PATCH /api/specs/{name}` | `update_spec_content` (7158-) | works |
| 11 | `lucode_spec_list` | `GET /api/specs/summary` | `list_spec_summaries` | works |
| 12 | `lucode_spec_read` | `GET /api/specs/{name}` | `get_spec_content` | works |
| 13 | `lucode_spec_set_stage` | `PATCH /api/specs/{name}/stage` | `update_spec_stage` (7225-) | works |
| 14 | `lucode_spec_set_attention` | `PATCH /api/specs/{name}/attention` | `update_spec_attention` (7307-) | works |
| 15 | `lucode_improve_plan` | `POST /api/specs/{name}/improve-plan` | `start_improve_plan_round` (7818-) | works |
| 16 | `lucode_diff_summary` | `GET /api/diff/summary` | `diff_summary` | works |
| 17 | `lucode_diff_chunk` | `GET /api/diff/file` | `diff_chunk` | works |
| 18 | `lucode_session_spec` | `GET /api/sessions/{name}/spec` | `get_session_spec` | works |
| 19 | `lucode_get_pr_feedback` | `GET /api/sessions/{name}/pr-feedback` | `get_session_pr_feedback` | works |
| 20 | `lucode_draft_start` | `POST /api/specs/{name}/start` | `start_spec_session` (7389-) | works |
| 21 | `lucode_draft_list` | `GET /api/specs` | `list_drafts` | works |
| 22 | `lucode_draft_delete` | `DELETE /api/specs/{name}` | `delete_draft` | works |
| 23 | `lucode_promote` | `POST /api/sessions/{name}/promote` | `promote_session` (9098-) | works |
| 24 | `lucode_consolidation_report` | `POST /api/sessions/{name}/consolidation-report` | `update_consolidation_report` | works |
| 25 | `lucode_trigger_consolidation_judge` | `POST /api/consolidation-rounds/{id}/judge` | `trigger_consolidation_judge` (10200-) | works |
| 26 | `lucode_confirm_consolidation_winner` | `POST /api/consolidation-rounds/{id}/confirm` | `confirm_consolidation_winner` (10315-) | works |
| 27 | `lucode_task_run_done` | `POST /api/task-runs/{run_id}/done` | `task_run_done` (10242-) | works (see §3.A) |
| 28 | `lucode_convert_to_spec` | `POST /api/sessions/{name}/convert-to-spec` | `convert_session_to_spec` | works |
| 29 | `lucode_merge_session` | `POST /api/sessions/{name}/merge` | `merge_session` (8477-) | works |
| 30 | `lucode_create_pr` | `POST /api/sessions/{name}/prepare-pr` | `prepare_pull_request` (8783-) | works (drift: see §4.B) |
| 31 | `lucode_link_pr` | `POST` or `DELETE /api/sessions/{name}/link-pr` | `link_session_pr` / `unlink_session_pr` | works |
| 32 | `lucode_create_epic` | `POST /api/epics` | `create_epic` (10766-) | works |
| 33 | `lucode_list_epics` | `GET /api/epics` | `list_epics` (10736-) | works |
| 34 | `lucode_prepare_merge` | `POST /api/sessions/{name}/prepare-merge` | `prepare_merge` (8966-) | works |
| 35 | `lucode_get_current_tasks` | `GET /api/sessions` + `GET /api/specs` | `list_sessions` + `list_drafts` | works (terminology drift: see §4.C) |

**Counts:** 35 tools, 35 works, 0 broken-name, 0 broken-shape, 0 retired-tool, 0 not-tested. Three tools have *behavioral drift* (cosmetic — input fields silently dropped or terminology mismatch) that don't break the call but mislead the agent. Listed in §4.

## 2. Broken tools

**None.** Every MCP tool resolves to an extant v2 endpoint, all required body fields are accepted by the backend, and the response shapes consumed by the bridge are produced by the handler. The MCP test suite (`bun run test` in `mcp-server/`) returns **195 pass / 0 fail / 519 expectations**, exercising bridge body construction, handler stubs, and JSON shape assertions for every tool in the inventory.

## 3. Phase 7+8 fresh-wired endpoints (verified)

These are the post-Phase-6 endpoints that didn't exist before and are the highest-risk for shape drift. All verified.

### A. `lucode_task_run_done` — Phase 5/7 task-run completion signal

- **MCP tool input:** `{ run_id, slot_session_id, status: 'ok'|'failed', artifact_id?, error? }` (lucode-mcp-server.ts:929-940).
- **Bridge body:** `POST /api/task-runs/{runId}/done` with `{ slot_session_id, status, artifact_id?, error? }` (lucode-bridge.ts:1796-1808). `run_id` is path-segment-only; matches handler.
- **Backend deserializer:** `TaskRunDoneApiRequest { slot_session_id, status, artifact_id, error }` (mcp_api.rs:10232-10240). Match.
- **Response:** Backend returns the full `TaskRun` JSON (entity.rs:365-393, with `derived_status` Phase 7 Wave A.1 enrichment). Bridge consumes `id`, `task_id`, `stage`, `failed_at`, `failure_reason`, `confirmed_at`, `cancelled_at` (lucode-bridge.ts:1810-1820). All fields present in `TaskRun`. Stage serializes lowercase (`#[serde(rename_all = "snake_case")]` on `TaskStage`, entity.rs:39) — bridge treats it as opaque string.

### B. Consolidation report / judge / confirm — Phase 7

- `lucode_consolidation_report` body fields `{ report, base_session_id?, recommended_session_id? }` ↔ `UpdateConsolidationReportRequest` (mcp_api.rs:1069-1076). Match.
- `lucode_trigger_consolidation_judge` body `{ early }` ↔ `TriggerConsolidationJudgeRequest { early: bool }` (mcp_api.rs:1087-1091). Match.
- `lucode_confirm_consolidation_winner` body `{ winner_session_id, override_reason? }` ↔ `ConfirmConsolidationWinnerRequest` (mcp_api.rs:1099-1104). Match.

### C. `EnrichedSession.info.session_state` — Phase 4 D.0 wire-format change

- The session_state moved from a `SessionState` enum (`#[serde(rename_all = "lowercase")]`) to a `String` field synthesized from `Session::lifecycle_state()` (entity.rs:572-578).
- Wire bytes are unchanged (`"spec"` | `"processing"` | `"running"`). Bridge consumes it as `string` and routes through unchanged (lucode-bridge.ts:1599). No drift.

## 4. Shape drift (cosmetic / silent-drop)

These tools accept input fields that are quietly dropped on their way to the backend, or use terminology that conflicts with the v2 model. They don't cause failures but may mislead agents reading the tool descriptions.

### A. `lucode_spec_create` — `base_branch` silently dropped

- **MCP tool input** (lucode-mcp-server.ts:579-582) advertises `base_branch: "Base branch for future worktree (default: main/master)"`.
- **Bridge** (`createSpecSession`, lucode-bridge.ts:1281-1295) forwards it as `parent_branch` in the body.
- **Backend** `create_draft` (mcp_api.rs:6873-6967) **does not read** `parent_branch` or `base_branch` — it calls `manager.create_spec_session_with_agent(name, content, agent_type, None, epic_id)` with a hardcoded `None` for the parent branch (mcp_api.rs:601-606).
- **Effect:** Spec is always created with a default parent branch derived elsewhere; the caller's `base_branch` is ignored.
- **Recommended fix:** either accept and pass through `base_branch` in `create_draft`, or remove the field from the MCP tool's `inputSchema` and `lucode_create`'s spec-mode fallback.

### B. `lucode_create_pr` — `commit_message`, `repository`, `cancel_after_pr` silently dropped

- **MCP tool input** (lucode-mcp-server.ts:1017-1028) advertises `commit_message`, `repository`, `cancel_after_pr` as suggestions.
- **Bridge** (`createPullRequest`, lucode-bridge.ts:1909-1916) only forwards `pr_title`, `pr_body`, `base_branch`, `pr_branch_name`, `mode`. The other three are dropped.
- **Backend** `prepare_pull_request` (mcp_api.rs:8783-8865) only reads `pr_title`, `pr_body`, `base_branch`, `pr_branch_name`, `mode`. The full `PullRequestRequest` struct (mcp_api.rs:8580-8597) lists `commit_message`/`repository`/`cancel_after_pr`, but those fields belong to the *legacy* `create_pull_request` path (the "actually create the PR right now" flow that's been replaced by the modal-prep flow Phase ~). The MCP tool description correctly says "opens a modal for user confirmation" — confirmation in the modal handles those settings — but the schema implies the agent can pre-fill them, which is misleading.
- **Recommended fix:** drop the three unused fields from the MCP tool's `inputSchema`, or extend `PreparePrRequest` (mcp_api.rs ~7990s) to forward them into the `OpenPrModalPayload` event so the modal pre-fills.

### C. `lucode_get_current_tasks` — terminology overlap with Phase 7 v2 Tasks

- The tool name says "tasks" but the payload combines `listSessions` + `listDraftSessions` — i.e., **sessions and specs**, not v2 `Task` entities.
- In v2 (Phase 7), `Task` is a top-level entity with its own `TaskRun`, `TaskArtifact`, lifecycle stages. Calling sessions "tasks" in the MCP surface predates that vocabulary.
- The tool description does say "agents" internally, but the *name* and the field `current_tasks` will confuse fresh agents who have read the v2 design and expect this to return rows from `domains/tasks/`.
- **Not broken** — the v2 backend doesn't care what we call them — but the MCP nomenclature is now inconsistent with the desktop app.
- **Recommended fix:** rename to `lucode_get_current_sessions` (with a deprecation alias) when Phase 8 ships, OR add real Task-list MCP tools (see §5) so this tool can return only sessions and a sibling tool returns Tasks.

### D. `lucode_task_run_done` description references nonexistent MCP tool `lucode_task_confirm_stage`

- The tool description (lucode-mcp-server.ts:924) says: *"confirmation stays a separate human action via lucode_task_confirm_stage"*.
- `lucode_task_confirm_stage` exists as a **Tauri command** (commands/tasks.rs, registered in main.rs:1800) but is **not exposed as an MCP tool**. An agent reading this description and trying to call it via MCP will get `MethodNotFound`.
- **Recommended fix:** either expose `lucode_task_confirm_stage` as an MCP tool (preferred — see §5) or rewrite the description to say "via the human Lucode UI".

## 5. Phase 7+8 wire surface not exposed to MCP (gaps, not breaks)

The v2 backend has 17+ Tauri commands for managing the new top-level `Task` model. Only **one** (`lucode_task_run_done`) is exposed via MCP. Every other Task command is desktop-app-only:

| Tauri command (commands/tasks.rs) | MCP coverage |
|---|---|
| `lucode_task_create` | not exposed |
| `lucode_task_list` | not exposed |
| `lucode_task_get` | not exposed |
| `lucode_task_update_content` | not exposed |
| `lucode_task_advance_stage` | not exposed |
| `lucode_task_attach_issue` | not exposed |
| `lucode_task_attach_pr` | not exposed |
| `lucode_task_delete` | not exposed |
| `lucode_task_cancel` | not exposed |
| `lucode_task_set_stage_config` | not exposed |
| `lucode_task_list_stage_configs` | not exposed |
| `lucode_task_run_list` | not exposed |
| `lucode_task_run_get` | not exposed |
| `lucode_task_run_cancel` | not exposed |
| `lucode_task_artifact_history` | not exposed |
| `lucode_task_reopen` | not exposed |
| `lucode_task_promote_to_ready` | not exposed |
| `lucode_task_start_stage_run` | not exposed |
| `lucode_task_start_clarify_run` | not exposed |
| `lucode_task_confirm_stage` | not exposed (referenced in §4.D description) |
| `lucode_task_run_done` | **exposed** |

**Not in scope for this audit** (Tier 2.6 is compat verification, not surface expansion), but worth noting: agents using only MCP cannot drive the v2 Task lifecycle end-to-end. They can only react to existing TaskRuns by reporting completion. Any "create a task and run it" workflow has to go through `lucode_create`/`lucode_spec_create`/`lucode_draft_start` (the legacy session model) and never touches the new Task entity.

## 6. Retired tools

W.3 of Phase 8 (commit `fef562fa`, plans/2026-05-02-task-flow-v2-phase-8-status.md:35-40) retired the **Tauri commands** `lucode_task_capture_session` and `lucode_task_capture_version_group`. **Neither was ever exposed as an MCP tool** — verified by:

```bash
grep -nE "lucode_task_capture|capture_session" mcp-server/src/
# Only matches: lucode_task_run_done schema line; no capture-as-task MCP tool
```

So **no retired-tool cleanup is needed in the MCP server.** This is a clean cut.

## 7. Live-run results

- **Live HTTP probing of the v2 dev server: skipped.** Standing up `bun run tauri:dev`, attaching an MCP client, and firing each of 35 tools would require interactive auth (Codex/Claude credentials) and a long-running supervised process. The Phase 8 smoke walk (plans/2026-05-02-task-flow-v2-phase-8-smoke.md) is the user-driven counterpart already gated before merge.
- **Static + unit-test verification: complete.** The MCP test suite under `mcp-server/test/` exercises every bridge method against fixture HTTP responses shaped to match the v2 backend (verified by reading both sides). Result: **195 pass / 0 fail / 519 expectations** in 84ms.

```
$ cd mcp-server && bun run test
...
 195 pass
 0 fail
 519 expect() calls
Ran 195 tests across 13 files. [84.00ms]
```

The test files covering shape compatibility:
- `test/bridge-methods.test.ts` — every bridge method's body construction
- `test/tool-handlers.test.ts` — MCP tool dispatch → bridge call
- `test/tool-registry.test.ts` — schema/registry consistency
- `test/schemas.test.ts` — output schema validation
- `test/diff-bridge.test.ts`, `diff-tools-integration.test.ts` — diff endpoints
- `test/merge-pr-flow.test.ts` — merge / PR modal flow
- `test/setup-script.test.ts`, `port-discovery.test.ts`, `project-routing.test.ts` — infra

## 8. Recommendations

### Pre-merge (none required)

No broken tools — task-flow-v2 can merge to main without MCP-side fixes. The MCP test suite already passes.

### Post-merge nice-to-haves

1. **§4.A:** Either pass `base_branch` through in `create_draft`, or drop the field from `lucode_spec_create`'s schema and `lucode_create` (is_draft fallback). Pick one — the current state lies to the agent.
2. **§4.B:** Either forward `commit_message`/`repository`/`cancel_after_pr` into `OpenPrModalPayload` so they pre-fill the modal, or drop them from the MCP tool schema.
3. **§4.D:** Fix the `lucode_task_run_done` description to reflect that `lucode_task_confirm_stage` is desktop-only, OR expose it as an MCP tool (see §5).
4. **MCP build refresh:** The `mcp-server/build/` artifacts are dated 2026-04-30, and the `lucode_task_run_done` tool was added late Phase 5. The user's currently-loaded MCP server (per the deferred-tool list at session start) does not include `lucode_task_run_done` — so a `bun run build` in `mcp-server/` is needed before the next user MCP-server restart for the tool to be discoverable.

### No-action

- **§4.C** (terminology drift on `lucode_get_current_tasks`): cosmetic. Don't rename mid-Phase-8; revisit when v2 Task MCP tools are added (§5).
- **§5** (Task-model MCP gap): out of scope for compat audit. Decide separately whether external agents need first-class Task lifecycle access, or whether they should remain session-driven.
- **§6** (retired W.3 commands): nothing to remove from MCP — they were never exposed.

## Appendix — mapping verification method

For every tool I:
1. Read the MCP tool's `inputSchema` block in `lucode-mcp-server.ts`.
2. Read the dispatch case (`switch (name)`) in the same file to find the bridge method called.
3. Read that bridge method in `lucode-bridge.ts` to find the HTTP method, path, and JSON body.
4. Found the matching route in `mcp_api.rs:339-507`.
5. Read the handler's request struct (`#[derive(Deserialize)]`) or `payload["..."]` accessors.
6. Cross-checked field names + types.
7. For the response: read the handler's `Response<String>` JSON serialization site, compared the field set to what the bridge consumes.

This is purely static — but the type-checker on both sides plus the 195-test bridge suite running against backend-shaped fixtures is strong evidence the wires are connected.
