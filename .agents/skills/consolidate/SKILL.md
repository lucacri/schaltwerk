---
name: consolidate
description: Compare parallel Lucode sessions for the same spec and promote the winning consolidation result.
---

# Consolidate Lucode Sessions

Use this workflow when multiple Lucode sessions worked on the same spec and you need to contribute your strongest implementation to a consolidation round. Lucode will eventually use a synthesis judge to produce the final version that ships.

## Critical: use the Lucode MCP server for all session and spec data

Every reference to "Call `lucode_*`" below is a tool call on the **Lucode MCP server**. Depending on your agent these tools are exposed either as `lucode_<name>` or `mcp__lucode__lucode_<name>` — use whichever your client provides.

**You MUST NOT** try to find sessions, specs, prompts, or task lists by:

- Searching the filesystem (`Read`, `Grep`, `Glob`, `find`, `rg`, `ls`) for spec content, session metadata, or initial prompts.
- Opening Lucode's SQLite database, JSON caches, or any file under `~/Library/Application Support/lucode/` or `~/.local/share/lucode/`.
- Inferring session names, branches, or spec text from `git log`, branch names, or working-directory contents when an MCP tool can return them authoritatively.

If the Lucode MCP server is not connected, or a tool call returns an error, **stop and report it to the user**. Do not fall back to filesystem search — the canonical data lives in Lucode's database and is only reachable through the MCP tools.

## Arguments

Accept an optional `--auto` flag and an optional display-name substring to target a specific spec group.

If Lucode already created a dedicated consolidation session for you and your prompt lists the source sessions to review, skip Steps 1-5 and continue at Step 6 using the current session branch as the destination.

## Step 1: Discover sessions

Call `lucode_get_current_tasks` with `fields: ["name", "display_name", "status", "session_state", "branch", "epic_id", "initial_prompt"]` and `status_filter: "active"`.

Group sessions by `display_name`. Keep only groups with at least two running or ready sessions.

If no eligible group exists, stop and report that there is nothing to consolidate.

## Step 2: Select the target spec group

- If the user supplied a name, match it case-insensitively against the group `display_name`, falling back to substring matching.
- If `--auto` is present and no name was supplied, pick the first eligible group.
- Otherwise, show the eligible groups and ask the user to choose one.

## Step 3: Resolve spec context

Try to recover the original requirements before comparing implementations:

1. Call `lucode_session_spec` for the first session in the group.
2. If that is empty, fall back to the first non-empty `initial_prompt` in the group.
3. If neither source exists, continue with `No spec content found — infer intent from the branch diffs.`

## Step 4: Show branch details

For the chosen group, show the session names and branch names. Ask for any custom consolidation criteria and accept an empty response for the defaults.

## Step 5: Use the current consolidation session as the destination

Lucode should create a dedicated candidate session before these instructions run.

Apply all consolidation changes into the current session branch. Leave the source sessions unchanged.

## Step 6: Consolidate into the current session branch

Use the current session branch as the destination branch.

1. Review every sibling branch with `git diff main...{branch}`.
2. Compare each branch against the recovered spec context, not just code style.
3. Pick one branch as your conceptual base, then apply its best ideas into your current session branch. Remember which source session was the base — its session ID becomes the `base_session_id` you pass to `lucode_consolidation_report`.
4. Incorporate any valuable improvements from the remaining branches.
5. Run the project's verification commands.
6. **Rebase your candidate branch onto the latest trunk before filing your report.** Rebasing now ensures your candidate implementation is current and clean for the final synthesis judge.
   1. From inside the session worktree, fetch the latest trunk. Prefer the tracked remote (`git fetch origin main`); if no remote tracking branch exists, fall back to the local `main`.
   2. Rebase the current branch onto `origin/main` (`git rebase origin/main`), or onto local `main` (`git rebase main`) if no remote is tracked.
   3. If the rebase is clean, re-run the project's verification commands. They must pass before proceeding.
   4. If the rebase produces conflicts, resolve them in the worktree using the full context of what you just consolidated. Use `git add` for resolved paths, then `git rebase --continue`. Repeat until the rebase finishes. After a clean finish, re-run the project's verification commands. They must pass before proceeding.
   5. Do not file your report until the rebase is clean **and** verification is green on the rebased branch.
7. Call `lucode_consolidation_report` with:
   - `session_name`: the current consolidation session name
   - `report`: a structured explanation of which candidate base you chose, what you kept from each sibling, and any trade-offs
   - `base_session_id`: the session ID of the source version you chose as the strongest base (take it from the session list that was injected into your prompt)

Lucode uses the filed report as the durable completion signal for your candidate session. When every candidate files a report, Lucode will start a synthesis judge by default. Do not call `lucode_promote` directly.

## Step 7: Report

Report that your candidate implementation is ready and you have filed your report. Do not reference Lucode slash commands that may not exist in the current agent.
