---
name: consolidate
description: Use when multiple Lucode sessions worked on the same spec and you need to pick the best version, merging improvements from all branches into one final consolidated session
---

## Invocation

```
/lucode:consolidate              # interactive - confirms before creating session
/lucode:consolidate --auto       # autonomous - skips confirmations
/lucode:consolidate session-name # target a specific spec group by name
```

## Mode Detection

This skill has two modes. Detect which one applies:

- **Creation mode**: You are NOT in a consolidation session. The user invoked `/lucode:consolidate` to create one. Follow the "Creation Flow" below.
- **Execution mode**: You ARE in a consolidation session (your branch/session name contains "consolidat" or you were dispatched with a consolidation prompt listing branches to review). Follow the "Execution Flow" below.

---

## Creation Flow

### Step 1: Discover sessions

Call `mcp__lucode__lucode_get_current_tasks` with `fields: ["name", "display_name", "status", "session_state", "branch", "epic_id", "initial_prompt"]` and `status_filter: "active"`.

Group sessions by `display_name`. Filter to groups with 2+ sessions (nothing to consolidate if only 1).

If no eligible groups found, inform the user and stop.

### Step 2: Select target spec

Parse `$ARGUMENTS`: detect `--auto` flag, remaining text (after removing the flag) is the spec name — this may contain spaces.

- If a session-name argument was provided, match it case-insensitively against group keys (display_name). Use substring matching if no exact match is found. Select that group directly. Error if no match.
- If `--auto` flag AND no argument: pick the first eligible group automatically.
- Otherwise (interactive mode): present eligible groups as a numbered list showing `display_name` and session count. Ask the user to pick ONE.

### Step 3: Resolve spec context

After selecting the group, read the original spec content and store it as `spec_context`.

Try these sources in order:
1. Call `mcp__lucode__lucode_session_spec` on the first session in the group. If it returns spec markdown, use that.
2. Otherwise, fall back to the first non-empty `initial_prompt` found in the group (from Step 1 data).

If neither source provides content, set `spec_context` to:

`No spec content found — review branch diffs to infer intent.`

### Step 4: Show details (interactive only)

For the selected group, show a table with:
- Session name
- Branch name

Ask the user for any custom consolidation criteria (e.g., "prioritize test coverage", "the v2 approach to the API was better"). Accept empty for defaults.

### Step 5: Confirm (interactive only)

Show summary: "Will create a consolidation session for spec `{display_name}` reviewing {N} branches"

Ask for confirmation before proceeding.

### Step 6: Create consolidation session

Before creating, check if a session named `consolidate-{display_name}` already exists by searching the session list from Step 1. If it does, increment the suffix (`-v2`, `-v3`, etc.) until an unused name is found.

Call `mcp__lucode__lucode_create` with:
- `name`: the resolved unique name (sanitized: lowercase, spaces replaced with hyphens, max 50 chars)
- `skip_permissions`: true
- `prompt`: the consolidation prompt (see Prompt Template below)
- `epic_id`: the `epic_id` from the selected group's sessions (use the first non-null `epic_id` found in the group). Omit if no sessions have an epic.

If the call fails, report the error to the user and stop.

### Step 7: Report

Output the created session name and branch. Tell the user to select the session in the Lucode app and start an agent to begin the consolidation work. Do NOT reference any slash commands like `/lucode list` or `/lucode status` — they do not exist.

### Prompt Template

The prompt passed to `lucode_create` should be:

```
You are consolidating work from {N} parallel agent sessions that all worked on the same spec: {display_name}.

Use the /lucode:consolidate skill to execute the consolidation.

### Original spec

{spec_context}

### Branches to review

{table of session name, branch, and worktree path}

### Source sessions to cancel after consolidation

{comma-separated list of session names, e.g.: session_v1, session_v2, session_v3}

{If custom criteria were provided in Step 4, include:}
### Additional criteria
- {user's custom criteria, one bullet per item}
```

---

## Execution Flow

### Step 1: Review all branches

The original spec is included in your prompt above under "Original spec". Use it to evaluate which branch best fulfills the original requirements, not just which has the cleanest code.

For each branch listed in the prompt, run `git diff main...{branch}` to understand what each agent implemented. Use parallel subagents for efficiency. Take notes on each approach's architecture, completeness, and code quality.

### Step 2: Compare and rank

Identify which version has:
- Closest adherence to the original spec's requirements
- Best architecture and code organization
- Cleanest code (following CLAUDE.md guidelines)
- Most complete implementation
- Best test coverage
- Note unique strengths from each version

### Step 3: Pick the best base and synthesize

Cherry-pick or manually apply the best version's changes to your branch, then incorporate the strongest ideas/fixes from the other versions.

**Important:**
- Follow all CLAUDE.md guidelines
- The final version should be the best possible synthesis of all attempts
- Do NOT just pick one version blindly — actively look for improvements from the others

### Step 4: Verify

**REQUIRED:** Use the superpowers:verification-before-completion skill. Run the project's test command and ensure everything passes. Do NOT proceed until tests are green. Pre-existing failures unrelated to your changes are acceptable — document them explicitly.

### Step 5: Create squashed commit

Stage all changes and create a single commit:
- Use a conventional commit message (e.g., `feat:`, `fix:`, `refactor:`)
- The message should describe WHAT the consolidated result achieves, not the consolidation process
- Include `Co-Authored-By` trailer

### Step 6: Cancel source sessions

Cancel all source sessions listed in the prompt using `mcp__lucode__lucode_cancel` with `force: true` for each one.

### Step 7: Finish

**REQUIRED:** Use the superpowers:finishing-a-development-branch skill to present merge/PR options to the user.
