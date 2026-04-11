# Multi-Agent Consolidation Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add durable consolidation reports, multi-agent consolidation rounds, judge recommendations, and confirm-vs-auto-promote round handling without breaking the existing consolidation promotion API.

**Architecture:** Add round-aware metadata to the backend and frontend while preserving `version_group_id`, `is_consolidation`, `consolidation_sources`, and `lucode_promote`. Use a new `consolidation_rounds` table for shared round state and per-session report fields for durable candidate and judge reasoning. Build the flow test-first: persistence and API tests, then UI rendering and control tests, then prompt/MCP surfaces.

**Tech Stack:** Rust, SQLite, Tauri, TypeScript, React, Jotai, Vitest, MCP server tooling.

---

### Task 1: Add failing backend persistence tests

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs`

**Step 1: Write failing DB/session tests**

Add tests that expect session persistence for:

- `consolidation_round_id`
- `consolidation_role`
- `consolidation_report`
- `consolidation_base_session_id`
- `consolidation_recommended_session_id`

Add round-table persistence tests that expect a `consolidation_rounds` row with:

- confirmation mode
- current status
- recommended session metadata
- confirmed session metadata

**Step 2: Run the narrow Rust tests and watch them fail**

Run:

```bash
cargo test db_sessions --manifest-path src-tauri/Cargo.toml
```

Expected: failures because the new columns/table do not exist yet.

### Task 2: Add failing backend round-flow tests

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

**Step 1: Write failing round-flow tests**

Add tests for:

- creating a consolidation round with multiple candidate sessions
- writing candidate reports and detecting round completion
- auto-triggering a judge when all candidates report
- triggering a judge early before all candidates report
- confirming the judge recommendation in `confirm` mode
- auto-promoting in `auto-promote` mode when the judge reports
- cancelling losing candidate sessions after confirmation
- preserving candidate and judge reports after promotion/cancellation

**Step 2: Run the narrow Rust tests and watch them fail**

Run:

```bash
cargo test consolidation_round --manifest-path src-tauri/Cargo.toml
```

Expected: failures because the APIs and persistence do not exist yet.

### Task 3: Add failing frontend hydration and rendering tests

**Files:**
- Modify: `src/store/atoms/sessions.test.ts`
- Modify: `src/components/sidebar/SessionVersionGroup.status.test.tsx`
- Modify: `src/components/sidebar/SessionCard.test.tsx`

**Step 1: Write failing frontend tests**

Add tests that expect:

- session hydration for the new consolidation round/report fields
- a version group to render multiple consolidation candidates instead of a single merge row
- latest judge recommendation and confirmation mode to appear in the group UI
- durable reports to appear on the selected session card

**Step 2: Run the narrow Vitest targets and watch them fail**

Run:

```bash
bun test src/store/atoms/sessions.test.ts src/components/sidebar/SessionVersionGroup.status.test.tsx src/components/sidebar/SessionCard.test.tsx
```

Expected: failures because the types and rendering still assume one consolidation session.

### Task 4: Add failing MCP tool and bridge tests

**Files:**
- Modify: `mcp-server/test/tool-handlers.test.ts`
- Modify: `mcp-server/test/bridge-methods.test.ts`
- Modify: `mcp-server/test/schemas.test.ts`

**Step 1: Write failing MCP tests**

Add tests for new tool and bridge surfaces covering:

- create consolidation round
- write consolidation report
- trigger consolidation judge
- confirm consolidation winner

Keep the existing `lucode_promote` contract intact.

**Step 2: Run the narrow MCP tests and watch them fail**

Run:

```bash
bun test mcp-server/test/tool-handlers.test.ts mcp-server/test/bridge-methods.test.ts mcp-server/test/schemas.test.ts
```

Expected: failures because the new schemas and handlers do not exist yet.

### Task 5: Implement backend schema and repositories

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs`
- Modify: `src-tauri/src/domains/sessions/repository.rs`
- Modify: `src-tauri/src/domains/sessions/service.rs`
- Modify: any necessary session metadata adapters/tests touched by compile errors

**Step 1: Add the new schema**

Add session columns and the `consolidation_rounds` table plus migrations.

**Step 2: Thread the new fields through entities/repositories**

Keep changes minimal and mechanical: create, load, list, and update paths.

**Step 3: Re-run the targeted Rust persistence tests**

Run the Task 1 command again until it passes.

### Task 6: Implement backend round APIs and confirmation logic

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `src/common/tauriCommands.ts`
- Modify: any shared event payload types needed for session refreshes

**Step 1: Add explicit round actions**

Implement:

- round creation
- report writing
- judge triggering
- winner confirmation

Use the existing `lucode_promote` internals for the final promotion step.

**Step 2: Keep the round tests green**

Run the Task 2 command again until it passes.

### Task 7: Implement frontend types, grouping, and controls

**Files:**
- Modify: `src/types/session.ts`
- Modify: `src/common/events.ts`
- Modify: `src/common/uiEvents.ts`
- Modify: `src/store/atoms/sessions.ts`
- Modify: `src/utils/sessionVersions.ts`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/components/sidebar/SessionVersionGroup.tsx`
- Modify: `src/components/sidebar/SessionCard.tsx`
- Modify: `src/components/modals/NewSessionModal.tsx`
- Add or modify a confirmation modal component if needed

**Step 1: Hydrate the new fields**

Update frontend types and store hydration first.

**Step 2: Replace the single-consolidation UI assumption**

Render rounds and multiple candidate sessions coherently.

**Step 3: Add launch and confirm controls**

Let the user choose confirmation mode at launch and confirm or override the judge recommendation later.

**Step 4: Re-run the targeted frontend tests**

Run the Task 3 command again until it passes.

### Task 8: Implement MCP and prompt/workflow surfaces

**Files:**
- Modify: `mcp-server/src/lucode-bridge.ts`
- Modify: `mcp-server/src/lucode-mcp-server.ts`
- Modify: `mcp-server/src/schemas.ts`
- Modify: `mcp-server/src/lucode-workflows.ts`
- Modify: `.agents/skills/consolidate/SKILL.md`
- Modify: `.opencode/commands/consolidate.md`
- Modify: `claude-plugin/commands/consolidate.md`
- Modify: `src/common/generationPrompts.ts`
- Modify: `src-tauri/src/domains/settings/defaults.rs`

**Step 1: Add new tool schemas and handlers**

Expose the round/report/judge/confirm flow through MCP.

**Step 2: Update prompt/workflow text**

Teach candidate and judge agents to file reports and avoid direct self-promotion in the multi-agent round flow.

**Step 3: Re-run the targeted MCP tests**

Run the Task 4 command again until it passes.

### Task 9: Full verification, review, and commit

**Files:**
- No new functional files required beyond the changes above

**Step 1: Run focused test slices one more time**

Re-run the narrow Rust and Vitest suites touched above.

**Step 2: Run the full validation suite**

Run:

```bash
just test
```

Expected: full suite passes.

**Step 3: Request code review and address findings**

Use the requested review workflow after the implementation is complete.

**Step 4: Create one squashed commit**

Commit the completed redesign as a single commit in this session.
