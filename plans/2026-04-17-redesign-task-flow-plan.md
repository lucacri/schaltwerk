# Redesign Task Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional multi-agent Improve Plan rounds before implementation and track PR/MR state independently from local session stage.

**Architecture:** Additive database columns keep `Stage` unchanged. Plan rounds reuse consolidation candidate/judge/report primitives with `round_type = plan`; confirmation writes the winning report into the owning spec. PR/MR state is a session field updated from link/create/forge-refresh paths and surfaced in session DTOs/UI.

**Tech Stack:** Rust/Tauri, SQLite via rusqlite, React/TypeScript, Vitest, cargo tests.

---

### Task 1: Add Durable Schema and Entity Fields

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/infrastructure/database/db_specs.rs`
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs`
- Modify: `src-tauri/src/domains/sessions/repository.rs`
- Modify: `src/types/session.ts`

**Steps:**
1. Write Rust tests for default `round_type`, persisted `improve_plan_round_id`, and persisted `pr_state`.
2. Run the targeted cargo tests and confirm they fail because the fields do not exist.
3. Add migrations and entity fields.
4. Update all session/spec row reads and writes.
5. Re-run the targeted tests.

### Task 2: Add Plan Section Helpers

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

**Steps:**
1. Write tests for appending `## Implementation Plan` and replacing only that section on rerun.
2. Run the targeted tests and confirm they fail.
3. Implement a pure helper that returns updated spec markdown.
4. Re-run the targeted tests.

### Task 3: Add Plan-Round Confirmation Semantics

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `mcp-server/src/lucode-bridge.ts`
- Modify: `mcp-server/src/lucode-mcp-server.ts`
- Modify: `mcp-server/src/schemas.ts`

**Steps:**
1. Write Rust tests for confirming a `round_type = plan` round: no code promotion, winner report written to spec, round marked promoted.
2. Run the targeted tests and confirm failure.
3. Add backend APIs for starting/confirming plan rounds while preserving implementation consolidation behavior.
4. Add MCP bridge/tool schema support for starting Improve Plan.
5. Re-run Rust and MCP targeted tests.

### Task 4: Add PR/MR State Updates

**Files:**
- Modify: `src-tauri/src/domains/sessions/db_sessions.rs`
- Modify: `src-tauri/src/domains/sessions/repository.rs`
- Modify: `src-tauri/src/commands/forge.rs`
- Modify: `src-tauri/src/commands/github.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `src-tauri/src/mcp_api.rs`

**Steps:**
1. Write tests for link/create/unlink and forge-detail state transitions.
2. Run the targeted tests and confirm failure.
3. Implement `PrState` mapping and persistence.
4. Re-run targeted tests.

### Task 5: Surface PR State in Frontend

**Files:**
- Modify: `src/types/session.ts`
- Modify: `src/utils/sessionComparison.ts`
- Modify: `src/components/sidebar/SessionCard.tsx`
- Modify: `src/components/sidebar/CompactVersionRow.tsx`
- Test: `src/utils/sessionComparison.test.ts`
- Test: `src/components/sidebar/SessionCard*.test.tsx` or adjacent status tests

**Steps:**
1. Write failing TypeScript tests for comparing `pr_state` and rendering the PR-state label.
2. Implement the type and UI badge.
3. Re-run focused Vitest tests.

### Task 6: Full Verification and Commit

**Files:**
- All changed files.

**Steps:**
1. Run `bun run lint`.
2. Run `bun run lint:rust`.
3. Run `bun run test`.
4. Request code review and address Critical/Important findings.
5. Create one squashed commit with the complete change.
