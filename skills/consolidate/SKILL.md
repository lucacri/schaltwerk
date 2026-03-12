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

## Flow

### Step 1: Discover sessions

Call `mcp__lucode__lucode_get_current_tasks` with `fields: ["name", "display_name", "status", "session_state", "branch"]` and `status_filter: "active"`.

Group sessions by `display_name`. Filter to groups with 2+ sessions (nothing to consolidate if only 1).

If no eligible groups found, inform the user and stop.

### Step 2: Select target spec

Parse `$ARGUMENTS`: split on spaces, detect `--auto` flag, remaining token is the spec name.

- If a session-name argument was provided, match it against group keys (display_name). Select that group directly. Error if not found.
- If `--auto` flag AND no argument: pick the first eligible group automatically.
- Otherwise (interactive mode): present eligible groups as a numbered list showing `display_name` and session count. Ask the user to pick ONE.

### Step 3: Show details (interactive only)

For the selected group, show a table with:
- Session name
- Branch name

Ask the user for any custom consolidation criteria (e.g., "prioritize test coverage", "the v2 approach to the API was better"). Accept empty for defaults.

### Step 4: Confirm (interactive only)

Show summary: "Will create a consolidation session for spec `{display_name}` reviewing {N} branches"

Ask for confirmation before proceeding.

### Step 5: Create consolidation session

Call `mcp__lucode__lucode_create` with:
- `name`: `consolidate-{display_name}` (truncated/sanitized if needed)
- `skip_permissions`: true
- `prompt`: the consolidation prompt (see template below)

If `consolidate-{display_name}` already exists, append `-v2`, `-v3`, etc.

### Step 6: Report

Output the created session name and branch. Remind the user the agent is now working in Lucode.

## Consolidation Prompt Template

The prompt passed to `lucode_create` should be:

```
## Task: Consolidate {N} parallel implementations into one final version

You are consolidating work from {N} parallel agent sessions that all worked on the same spec: {display_name}.

### Branches to review

{table of session name and branch}

### Instructions

1. **Review all {N} branches** - run `git diff main...{branch}` for each branch to understand what each agent implemented. Take notes on the approach, architecture, and completeness of each.

2. **Compare and rank** - identify which version has:
   - Best architecture and code organization
   - Cleanest code (following CLAUDE.md guidelines)
   - Most complete implementation
   - Best test coverage
   - Note unique strengths from each version

3. **Pick the best base** - cherry-pick or manually apply the best version's changes to your branch, then improve it by incorporating the strongest ideas/fixes from the other versions.

4. **Validate** - run `just test` and ensure everything passes before considering the work done.

{custom_criteria section if user provided any, formatted as:
### Additional criteria
- {user's custom criteria}
}

### Important
- Follow all CLAUDE.md guidelines
- The final version should be the best possible synthesis of all {N} attempts
- Do NOT just pick one version blindly - actively look for improvements from the others
```
