# Promote On Finalize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make consolidation-round confirmation fully finalize the round by cancelling winning candidate and judge sessions, while exposing judge cleanup in the MCP response.

**Architecture:** Use a confirmation helper in `src-tauri/src/mcp_api.rs` to keep the public entrypoint thin and directly testable. Extend the MCP bridge/schema layer so `judge_sessions_cancelled` is preserved end-to-end.

**Tech Stack:** Rust, Tokio tests, Tauri backend, Bun-based MCP server tests.

---

### Task 1: Write the failing regression tests

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`
- Modify: `mcp-server/test/bridge-methods.test.ts`
- Modify: `mcp-server/test/schemas.test.ts`

**Step 1: Add Rust confirmation cleanup tests**

Describe the desired end state for round confirmation:

- only the promoted source session stays active,
- the winning and losing candidates are cancelled,
- the judge is cancelled,
- round confirmation survives cleanup failure after promotion.

**Step 2: Add MCP response-shape expectations**

Update the bridge and schema tests so confirmation must return `judge_sessions_cancelled`.

**Step 3: Run focused tests and watch them fail**

Run:

```bash
cargo test confirm_consolidation_winner_cleans_up_winning_candidate_and_judge --manifest-path src-tauri/Cargo.toml -- --exact --nocapture
cargo test confirm_consolidation_winner_marks_round_promoted_before_cleanup_failures --manifest-path src-tauri/Cargo.toml -- --exact --nocapture
(cd mcp-server && bun test bridge-methods.test.ts schemas.test.ts)
```

Expected: failures because the helper/response field does not exist yet and the current confirmation flow does not cancel judge sessions.

### Task 2: Implement the backend confirmation fix

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

**Step 1: Add an internal confirmation helper**

Refactor the confirmation flow behind a helper that accepts refresh/cancel callbacks so tests can run the real logic without an app handle.

**Step 2: Finalize round cleanup after promotion**

After the winner transplant succeeds, mark the round confirmed, cancel all active candidate and judge sessions for the round, and return the cancelled names split by role.

**Step 3: Re-run the focused Rust tests**

Run the two targeted cargo tests above and confirm they pass.

### Task 3: Implement MCP propagation

**Files:**
- Modify: `mcp-server/src/lucode-bridge.ts`
- Modify: `mcp-server/src/lucode-mcp-server.ts`
- Modify: `mcp-server/src/schemas.ts`
- Modify: `mcp-server/test/bridge-methods.test.ts`
- Modify: `mcp-server/test/schemas.test.ts`
- Modify: `CHANGES.md`

**Step 1: Thread `judge_sessions_cancelled` through the bridge**

Extend the TypeScript result type, response parser, structured MCP response, and output schema.

**Step 2: Re-run the focused MCP tests**

Run:

```bash
(cd mcp-server && bun test bridge-methods.test.ts schemas.test.ts)
```

Expected: PASS.

### Task 4: Full verification, review, and squash commit

**Files:**
- Review the consolidated diff

**Step 1: Run the full validation suite**

Run:

```bash
just test
```

Expected: all checks pass.

**Step 2: Review the final diff**

Confirm the behavior change is scoped to consolidation-round confirmation and MCP response propagation.

**Step 3: Create one squashed commit**

Commit the final consolidated result as a single commit in this session.
