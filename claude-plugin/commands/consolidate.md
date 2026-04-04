---
description: Consolidate multiple Lucode sessions that worked on the same spec into one best-of-breed implementation
---

## Invocation

```
/lucode:consolidate              # interactive - confirms before creating session
/lucode:consolidate --auto       # autonomous - skips confirmations
/lucode:consolidate session-name # target a specific spec group by name
```

## Flow

### Step 1: Discover sessions

Call `mcp__lucode__lucode_get_current_tasks` with `fields: ["name", "display_name", "status", "session_state", "branch", "epic_id"]` and `status_filter: "active"`.

Group sessions by `display_name`. Filter to groups with 2+ sessions (nothing to consolidate if only 1).

If no eligible groups found, inform the user and stop.

### Step 2: Select target spec

Parse `$ARGUMENTS`: detect `--auto` flag, remaining text (after removing the flag) is the spec name — this may contain spaces.

- If a session-name argument was provided, match it case-insensitively against group keys (display_name). Use substring matching if no exact match is found. Select that group directly. Error if no match.
- If `--auto` flag AND no argument: pick the first eligible group automatically.
- Otherwise (interactive mode): present eligible groups as a numbered list showing `display_name` and session count. Ask the user to pick ONE.

### Step 3: Show details (interactive only)

For the selected group, show a table with:
- Session name
- Branch name

Ask the user for any custom consolidation criteria (e.g., "prioritize test coverage", "the v2 approach to the API was better"). Accept empty for defaults.

### Step 4: Confirm target session (interactive only)

Show summary: "Will consolidate directly into session `{session_name}` for spec `{display_name}` reviewing {N} branches"

Ask for confirmation before proceeding.

### Step 5: Consolidate in place

Pick one existing session in the selected group as the working session:
- If the user named a specific session, use it.
- If the user gave custom criteria, prefer the session that best matches them.
- Otherwise prefer the highest-version non-spec session, falling back to the first running/reviewed session in the group.

Do NOT create a new consolidation session.

In the chosen session, the agent should:
- Review sibling branches with `git diff main...{branch}` for each sibling session.
- Cherry-pick or manually apply the strongest ideas from the other versions into the chosen session branch.
- Run the project's test suite.
- Call `mcp__lucode__lucode_promote` with:
  - `session_name`: the chosen session name
  - `reason`: a concise justification describing why this version won and what it absorbed from siblings

The promote call automatically cleans up sibling sessions. If promotion reports failures, surface them clearly to the user.

### Step 6: Report

Output the promoted session name, the justification used, and any cleanup failures. Do NOT reference any slash commands like `/lucode list` or `/lucode status` — they do not exist.
