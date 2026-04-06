# Multi-Agent Skill Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish Lucode's consolidation workflow to Claude, Codex, OpenCode, and MCP resources from one canonical source.

**Architecture:** Add a canonical workflow module/file owned by Lucode, generate agent-native wrapper files from it, and expose the same content through MCP resources. Keep the current in-place promotion flow as the source behavior and add tests that fail if wrappers or resources drift.

**Tech Stack:** Bun TypeScript, MCP server request handlers, markdown workflow files, Bun tests.

---

### Task 1: Define the failing wrapper/resource contract

**Files:**
- Modify: `mcp-server/test/tool-handlers.test.ts`
- Create: `src/common/lucodeWorkflows.test.ts`

**Step 1: Write the failing MCP resource tests**

Add assertions that `ListResources` includes `lucode://skills` and `lucode://skills/consolidate`, and that reading those URIs returns the skill registry plus the canonical consolidate workflow.

**Step 2: Run the MCP test to verify it fails**

Run: `bun test mcp-server/test/tool-handlers.test.ts`
Expected: FAIL because the new resources do not exist yet.

**Step 3: Write the failing workflow parity tests**

Add a test module that loads the canonical workflow definition and asserts the generated Claude, Codex, and OpenCode wrapper contents match the expected rendered outputs.

**Step 4: Run the workflow parity test to verify it fails**

Run: `bun test src/common/lucodeWorkflows.test.ts`
Expected: FAIL because the workflow module and generated files do not exist yet.

### Task 2: Build the canonical workflow source and generators

**Files:**
- Create: `src/common/lucodeWorkflows.ts`
- Create: `.codex/skills/consolidate/SKILL.md`
- Create: `.opencode/command/consolidate.md`
- Modify: `claude-plugin/skills/consolidate/SKILL.md`
- Modify: `claude-plugin/commands/consolidate.md`

**Step 1: Implement the canonical workflow source**

Define metadata, registry data, canonical markdown body, and renderer helpers for each agent-native wrapper. Keep the behavior aligned with the in-place promotion flow already used by Lucode's consolidation prompt.

**Step 2: Generate/update the tracked wrapper files from that source**

Write the rendered outputs into the Claude, Codex, and OpenCode workflow entrypoints.

**Step 3: Run the workflow parity test**

Run: `bun test src/common/lucodeWorkflows.test.ts`
Expected: PASS.

### Task 3: Expose workflows through MCP resources

**Files:**
- Modify: `mcp-server/src/lucode-mcp-server.ts`
- Create or modify: `mcp-server/src/lucode-workflows.ts`

**Step 1: Add reusable workflow registry/resource helpers**

Expose the list of workflows and per-workflow markdown in a small shared module the MCP server can consume.

**Step 2: Register the new resources in `ListResources`**

Add `lucode://skills` and `lucode://skills/consolidate` with clear descriptions.

**Step 3: Serve the resources in `ReadResource`**

Return JSON for the registry and markdown for the per-skill resource. Reject unknown skill names with the existing invalid-request path.

**Step 4: Run the MCP test**

Run: `bun test mcp-server/test/tool-handlers.test.ts`
Expected: PASS.

### Task 4: Align prompts and docs with the universal workflow entrypoints

**Files:**
- Modify: `src/common/generationPrompts.ts`
- Modify: `src-tauri/src/domains/settings/defaults.rs`
- Modify: `mcp-server/PROMPTING.md`
- Modify: `mcp-server/README.md`

**Step 1: Update the default consolidation prompt text**

Change the prompt so it points agents to their native Lucode workflow or the `lucode://skills/consolidate` resource instead of Claude-only slash command language.

**Step 2: Update docs for discovery**

Document the new skill resources and the agent-native wrapper directories so non-Claude agents can discover the workflow without manual explanation.

**Step 3: Run the prompt-related tests**

Run: `bun test src/common/generationPrompts.test.ts`
Expected: PASS after any expectation updates.

### Task 5: Verify the integrated behavior

**Files:**
- Re-run touched tests only, then the required validation suite.

**Step 1: Run focused tests**

Run: `bun test src/common/lucodeWorkflows.test.ts mcp-server/test/tool-handlers.test.ts src/common/generationPrompts.test.ts`
Expected: PASS.

**Step 2: Run full project validation**

Run: `just test`
Expected: PASS.

**Step 3: Review generated wrapper files**

Confirm the tracked Claude, Codex, and OpenCode workflow files all describe the same in-place promotion workflow.

### Task 6: Commit the finished change

**Files:**
- Stage only the files from this implementation.

**Step 1: Inspect git status and diff**

Run: `git status --short` and `git diff --stat`

**Step 2: Create the requested squashed commit**

Run: `git add <files>` then `git commit -m "feat: add cross-agent Lucode workflow support"`

Plan complete and saved to `docs/plans/2026-04-06-multi-agent-skill-compat-plan.md`. Continuing in this session with the subagent-driven path requested by the user's autonomous workflow.
