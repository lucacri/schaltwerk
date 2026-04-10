# Fix Promotion Crash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent `lucode_promote` from cancelling the active consolidation session when a winner source version is promoted, and keep all shipped workflow text aligned with the new behavior.

**Architecture:** Start with failing regression tests in the Rust promotion logic and in the prompt/workflow text surfaces. Then make the smallest backend fix in `src-tauri/src/mcp_api.rs`, update the workflow/prompt sources that describe consolidation promotion, and verify the wrappers and generated defaults stay synchronized.

**Tech Stack:** Rust, Tokio tests, TypeScript, Vitest, Tauri backend, MCP server workflow resources, Markdown workflow wrappers.

---

### Task 1: Add failing backend regression coverage

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

**Step 1: Write the failing test changes**

Adjust the existing consolidation promotion assertions so they expect only losing source sessions in `siblings_cancelled`, and add a new regression test that exercises the real cancellation path and proves the consolidation session remains active with its worktree intact.

**Step 2: Run the narrow Rust tests and watch them fail**

Run:

```bash
cargo test promote_session_logic_transplants_winner_branch_without_cancelling_consolidation --manifest-path src-tauri/Cargo.toml
cargo test promote_consolidation_winner_leaves_consolidation_session_alive --manifest-path src-tauri/Cargo.toml
```

Expected: at least one test fails because the implementation still enqueues the consolidation session for cancellation.

### Task 2: Add failing prompt/workflow text coverage

**Files:**
- Modify: `src/common/generationPrompts.test.ts`
- Modify: `src/common/lucodeWorkflows.test.ts`
- Modify: `mcp-server/test/tool-registry.test.ts`

**Step 1: Write the failing assertions**

Add assertions that the default consolidation prompt and published workflow/tool text say the consolidation session remains open after `lucode_promote`, and that they no longer claim the consolidation session is cancelled automatically.

**Step 2: Run the narrow Vitest targets and watch them fail**

Run:

```bash
bun test src/common/generationPrompts.test.ts src/common/lucodeWorkflows.test.ts mcp-server/test/tool-registry.test.ts
```

Expected: failures against the current stale wording.

### Task 3: Apply the minimal backend fix

**Files:**
- Modify: `src-tauri/src/mcp_api.rs`

**Step 1: Remove the bad cleanup entry**

Delete the line that pushes the consolidation session into `to_cancel` inside `execute_consolidation_winner_promotion()`.

**Step 2: Keep the stronger regression coverage green**

Retain the winner transplant behavior and confirm the adjusted tests now pass.

### Task 4: Synchronize workflow and prompt sources

**Files:**
- Modify: `mcp-server/src/lucode-workflows.ts`
- Modify: `.agents/skills/consolidate/SKILL.md`
- Modify: `.codex/skills/consolidate/SKILL.md`
- Modify: `.opencode/commands/consolidate.md`
- Modify: `claude-plugin/commands/consolidate.md`
- Modify: `claude-plugin/skills/consolidate/SKILL.md`
- Modify: `mcp-server/src/lucode-mcp-server.ts`
- Modify: `src/common/generationPrompts.ts`
- Modify: `src-tauri/src/domains/settings/defaults.rs`
- Modify: `CHANGES.md`

**Step 1: Update workflow wording**

Change the shared consolidate workflow source so it says the losing source versions are cancelled automatically and the consolidation session remains open for review and manual cleanup.

**Step 2: Update prompt/tool mirrors**

Apply the same semantic change to the MCP tool description and the frontend/backend default consolidation prompts.

**Step 3: Keep checked-in wrappers aligned**

Update the checked-in wrapper files to match the shared workflow source exactly.

### Task 5: Verify, review, and commit

**Files:**
- No new functional files required

**Step 1: Run targeted checks**

Run the Rust and Vitest targets touched above until they are green.

**Step 2: Run the full validation suite**

Run:

```bash
just test
```

Expected: full suite passes.

**Step 3: Review the final diff**

Inspect the complete diff for promotion semantics, prompt drift, and wrapper synchronization.

**Step 4: Create one squashed commit**

Commit the consolidated result as a single commit in this session.
