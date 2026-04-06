## Problem

Lucode's higher-level consolidation workflow currently exists only in Claude plugin files, and those files have already drifted from the in-app consolidation behavior. Codex and OpenCode both support native workflow files, but this repo does not publish Lucode workflows into those formats.

## Goals

- Keep one canonical workflow definition for Lucode skills.
- Publish that workflow in agent-native formats for Claude, Codex, and OpenCode.
- Expose the same workflow over MCP resources for any agent that can read resources but has no native wrapper.
- Prevent future drift with automated tests.

## Options Considered

### Option 1: Agent-specific files only

Add `.codex/skills/...` and `.opencode/...` by hand next to the Claude plugin.

Pros:
- Simple initial implementation.

Cons:
- Recreates the existing drift problem.
- Does not help agents without native workflow directories.

### Option 2: MCP resources only

Store the workflow once and expose it only as `lucode://skills/...` resources.

Pros:
- Single source of truth.
- Works for any MCP client.

Cons:
- Loses native command/skill UX for agents that already support it.
- Discoverability depends on agents reading docs or prompts correctly.

### Option 3: Canonical source plus generated wrappers

Keep one canonical workflow file in the repo, generate agent-native wrappers from it, and also expose the canonical source through MCP resources.

Pros:
- Single source of truth.
- Native UX for Claude, Codex, and OpenCode.
- Universal fallback for any MCP client.
- Lets tests verify wrapper parity.

Cons:
- Slightly more moving pieces than a single manual file.

## Chosen Design

Use option 3.

### Canonical workflow source

Add a tracked workflow source file under a neutral Lucode-owned directory. It will hold the actual consolidation logic, metadata, invocation hints, and agent-neutral instructions.

### Generated outputs

Generate these files from the canonical source:

- `claude-plugin/skills/consolidate/SKILL.md`
- `claude-plugin/commands/consolidate.md`
- `.codex/skills/consolidate/SKILL.md`
- `.opencode/command/consolidate.md`

The wrappers stay thin and agent-native, but the behavioral steps come from the canonical source.

### MCP resources

Extend the MCP server with:

- `lucode://skills`
- `lucode://skills/{name}`

The skill registry lists available workflows and short descriptions. The per-skill resource returns the canonical markdown. This gives every MCP client a fallback path even if it does not support native workflow directories.

### Prompt alignment

Update Lucode prompts and docs so they no longer depend on Claude-only `/lucode:consolidate` wording. They should point agents to either their native Lucode workflow entrypoint or the MCP skill resource.

### Drift prevention

Add tests that verify:

- Generated wrapper files match the canonical source.
- MCP `ListResources` includes the skill resources.
- MCP `ReadResource` returns the expected skill registry and skill body.

## Implementation Notes

- Preserve the current in-place promotion flow used by the app's consolidation prompt.
- Remove the stale separate-consolidation-session instructions from the Claude skill.
- Keep generated files tracked in git so worktrees receive them automatically.
- Prefer a small sync module or script that tests can call directly instead of duplicating templating logic inside several files.

## Testing

- Bun tests for workflow generation/parity.
- MCP server tests for skill resources.
- Existing prompt/default tests updated if any default text changes.
