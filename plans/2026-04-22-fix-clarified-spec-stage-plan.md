# Clarified Spec Stage Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore spec listing and stage updates by making legacy `clarified` spec stages backward-compatible with the task lifecycle's canonical `ready` stage.

**Architecture:** Add a compatibility alias at the Rust stage parser, normalize persisted `specs.stage` values during DB migration, and align MCP bridge/schema contracts so `ready` is canonical without breaking legacy `clarified` callers.

**Tech Stack:** Rust, SQLite/rusqlite, Tauri commands, MCP HTTP API, TypeScript, Bun tests.

---

### Task 1: Add failing backend regression coverage

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_specs.rs`
- Modify: `src-tauri/src/domains/sessions/entity.rs`

**Step 1: Write the failing tests**

Add tests that assert:
- a row persisted with `stage = 'clarified'` can be read back through `get_spec_by_id`
- `SpecStage::from_str("clarified")` maps to `SpecStage::Ready`

**Step 2: Run targeted tests to verify red**

Run:

```bash
cargo test clarified_spec_stage --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because the current parser rejects `clarified`.

### Task 2: Add failing MCP contract coverage

**Files:**
- Modify: `mcp-server/test/schemas.test.ts`
- Modify: `mcp-server/test/bridge-methods.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- MCP schemas accept `stage: 'ready'`
- the bridge accepts a `ready` stage payload for spec summaries/documents

**Step 2: Run targeted tests to verify red**

Run:

```bash
bun test mcp-server/test/schemas.test.ts mcp-server/test/bridge-methods.test.ts
```

Expected: FAIL because the MCP type/schema layer still only models `clarified`.

### Task 3: Implement the compatibility layer

**Files:**
- Modify: `src-tauri/src/domains/sessions/entity.rs`
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`
- Modify: `mcp-server/src/lucode-bridge.ts`
- Modify: `mcp-server/src/schemas.ts`
- Modify: `mcp-server/src/lucode-mcp-server.ts`

**Step 1: Make the Rust parser backward-compatible**

Accept `clarified` as a legacy alias for `SpecStage::Ready`.

**Step 2: Normalize persisted rows**

Update the specs migration to rewrite stored `clarified` rows to `ready`.

**Step 3: Align command and MCP contracts**

Allow legacy `clarified` inputs where needed, but treat `ready` as canonical in descriptions and output schemas.

**Step 4: Re-run focused tests**

Run:

```bash
cargo test clarified_spec_stage --manifest-path src-tauri/Cargo.toml
bun test mcp-server/test/schemas.test.ts mcp-server/test/bridge-methods.test.ts
```

Expected: PASS.

### Task 4: Full verification and finish

**Files:**
- Modify only if verification or review finds issues

**Step 1: Run full validation**

Run:

```bash
just test
```

Expected: PASS.

**Step 2: Request code review**

Review the final diff against this plan and fix any real issues before commit.

**Step 3: Create a squashed commit**

Run:

```bash
git add plans/2026-04-22-fix-clarified-spec-stage-design.md plans/2026-04-22-fix-clarified-spec-stage-plan.md src-tauri mcp-server
git commit -m "fix: restore clarified spec stage compatibility"
```
