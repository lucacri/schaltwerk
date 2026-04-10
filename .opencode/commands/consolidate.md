---
description: Compare parallel Lucode sessions for the same spec and promote the winning consolidation result.
---

# Consolidate Lucode Sessions

Use this workflow when multiple Lucode sessions worked on the same spec and you need to choose the best implementation, merge the strongest ideas from sibling branches, and promote a dedicated consolidation session as the winner.

## Arguments

Accept an optional `--auto` flag and an optional display-name substring to target a specific spec group.

If Lucode already created a dedicated consolidation session for you and your prompt lists the source sessions to review, skip Steps 1-5 and continue at Step 6 using the current session branch as the destination.

## Step 1: Discover sessions

Call `lucode_get_current_tasks` with `fields: ["name", "display_name", "status", "session_state", "branch", "epic_id", "initial_prompt"]` and `status_filter: "active"`.

Group sessions by `display_name`. Keep only groups with at least two running or reviewed sessions.

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

Lucode should create a dedicated consolidation session before these instructions run.

Apply all consolidation changes into the current session branch. Leave the source sessions unchanged so `lucode_promote` can compare against them later.

## Step 6: Consolidate into the current session branch

Use the current consolidation session branch as the destination branch.

1. Review every sibling branch with `git diff main...{branch}`.
2. Compare each branch against the recovered spec context, not just code style.
3. Pick the strongest branch as the conceptual base, then apply its best ideas into the current consolidation session branch. Remember which source session was the base — its session ID becomes the `winner_session_id` you pass to `lucode_promote`.
4. Incorporate any valuable improvements from the remaining branches.
5. Run the project's verification commands.
6. **Rebase the consolidation branch onto the latest trunk before promoting.** Rebasing now prevents a later merge attempt from hitting conflicts that would otherwise require a fresh agent run to resolve — at a point where the consolidation context is gone.
   1. From inside the consolidation session worktree, fetch the latest trunk. Prefer the tracked remote (`git fetch origin main`); if no remote tracking branch exists, fall back to the local `main`.
   2. Rebase the current consolidation branch onto `origin/main` (`git rebase origin/main`), or onto local `main` (`git rebase main`) if no remote is tracked.
   3. If the rebase is clean, re-run the project's verification commands. They must pass before proceeding to promote.
   4. If the rebase produces conflicts, resolve them in the worktree using the full context of what was just consolidated from every sibling branch. Use `git add` for resolved paths, then `git rebase --continue`. Repeat until the rebase finishes. After a clean finish, re-run the project's verification commands. They must pass before proceeding to promote.
   5. Do not call `lucode_promote` until the rebase is clean **and** verification is green on the rebased branch.
7. Call `lucode_promote` with:
   - `session_name`: the current consolidation session name
   - `reason`: a concise explanation of why this version won and what it absorbed from siblings
   - `winner_session_id`: the session ID of the source version you chose as the strongest base (take it from the session list that was injected into your prompt)

The promote call transplants the consolidated commits onto the winner's branch so that session survives with the merged work. After `lucode_promote` returns, the consolidation session remains open so the user can review its reason and diff in the UI, and should be closed manually when that review is done. The losing source versions are cancelled automatically. If promotion reports failures, surface them clearly.

## Step 7: Report

Report the promoted session name, the promotion reason, and any cleanup failures. Do not reference Lucode slash commands that may not exist in the current agent.
