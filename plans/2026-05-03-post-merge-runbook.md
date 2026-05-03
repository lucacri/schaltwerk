# Post-Merge Runbook — task-flow v2 cutover

**Audience:** the user (Luca), running this top-to-bottom on cutover day after a green smoke walk.

**Scope:** every step from "smoke walk passed" to "v2 is the new normal on `main`, the worktree is gone, branches/tags are tidy, prod data is dealt with, docs are live, and memory reflects reality."

**Order matters.** Do not skip ahead. Each section assumes everything above it has completed cleanly.

Related docs:
- `plans/2026-05-02-task-flow-v2-phase-8-smoke.md` — the smoke walk itself.
- `plans/archive/2026-04-29-task-flow-v2-phase-7-smoke.md` — Phase 7 §A items reused unchanged (archived during the pre-smoke harden run).
- `plans/2026-05-03-pre-smoke-test-stability.md` — pre-smoke harden context.
- `plans/2026-05-03-pre-smoke-archive-verify.md` — verified archive-script command (referenced in §7).
- Memory feedback: `feedback_tsc_incremental_cache_lies.md` (§1 cache-clear rationale), `feedback_build_before_commit.md`, `feedback_no_preexisting_excuse_taskflow.md`.

---

## 1. Pre-merge sanity check

You have just completed `plans/2026-05-02-task-flow-v2-phase-8-smoke.md` end-to-end (and any Phase 7 §A items that were reused unchanged in Phase 8) and seen everything green. Before touching `main`:

1. **Re-tag a post-smoke anchor.** This is a fresh anchor distinct from `pre-smoke-walk-3` (which marked the *pre-walk* state) so you can roll back to either point:
   ```bash
   git tag -a post-smoke-walk-3-green -m "Smoke walk 3 passed; ready to merge"
   git push origin post-smoke-walk-3-green
   ```

2. **Confirm working tree is clean:**
   ```bash
   git status
   ```
   Expected output: `nothing to commit, working tree clean`. If not, stop and investigate — do not stash and proceed; an uncommitted file at this point is a sign something was missed.

3. **Run the full validation suite with a forced-fresh TypeScript cache.** The cache-clear is mandatory per `feedback_tsc_incremental_cache_lies.md` — `tsc --incremental` reports green from a stale `.tsbuildinfo` even when fresh-cache compilation would fail:
   ```bash
   rm -f node_modules/.cache/tsconfig.tsbuildinfo
   bun run lint:ts
   just test
   ```
   All three must be green. If `just test` fails here, do **not** proceed to §2 — fix the failure on `task-flow-v2` first, re-run, and re-tag.

4. **Sanity-check the branch state:**
   ```bash
   git log --oneline -10
   git rev-parse HEAD
   ```
   Note the HEAD SHA — you'll want it later if anything goes wrong.

---

## 2. The merge

The default path is fast-forward. If main hasn't moved since `task-flow-v2` branched off, this is one command and you're done.

```bash
git checkout main
git pull origin main
git merge --ff-only task-flow-v2
```

### If the merge is NOT fast-forward

`git merge --ff-only` aborts cleanly with `fatal: Not possible to fast-forward, aborting.` when `main` has commits that aren't on `task-flow-v2`. Two recovery options:

**(a) Rebase task-flow-v2 onto main first (DEFAULT).** Keeps history linear. Choose this unless main has critical fixes you specifically want isolated as their own merge bubble.
```bash
git checkout task-flow-v2
git rebase main
# Resolve conflicts file-by-file. After each: git add <file> && git rebase --continue
rm -f node_modules/.cache/tsconfig.tsbuildinfo && bun run lint:ts && just test
# Re-tag the post-smoke anchor at the new HEAD:
git tag -f post-smoke-walk-3-green -m "Smoke walk 3 passed; ready to merge (post-rebase)"
git push --force-with-lease origin post-smoke-walk-3-green
# Retry the merge:
git checkout main
git merge --ff-only task-flow-v2
```
The `--force-with-lease` on the tag push is a deliberate exception: tags can be moved when their underlying commit is rewritten by rebase. This is **not** a force-push to a branch and is safe.

**(b) Merge commit, no rebase.** Use this only if `main` has a critical fix that needs to land as its own clearly-marked commit and you want the merge bubble to make that visible:
```bash
git checkout main
git merge --no-ff task-flow-v2 -m "Merge task-flow v2 (Phases 0-8)"
```

### After the merge (either path)

```bash
git push origin main
```

Verify the push landed:
```bash
git log origin/main -1 --oneline
git rev-parse HEAD origin/main   # should match
```

---

## 3. Post-merge `plans/` housekeeping

The Phase 7 + Phase 8 plan docs are now historical. Move them to `plans/archive/` so the active `plans/` directory only contains live work.

1. **Create the archive directory if it doesn't exist** (it currently does not on this branch):
   ```bash
   mkdir -p plans/archive
   ```

2. **Archive the closed plan docs with `git mv`** so history stays linked to the new path. (Note: the Phase 7 plan + smoke docs are already archived as part of the pre-smoke harden run; the commands below cover what's left after a green smoke walk.)
   ```bash
   # Phase 7 close-out doc — only if it exists; check first:
   [ -f plans/2026-04-29-task-flow-v2-phase-7-close-out.md ] && \
     git mv plans/2026-04-29-task-flow-v2-phase-7-close-out.md plans/archive/
   git mv plans/2026-05-02-task-flow-v2-phase-8-status.md plans/archive/
   git mv plans/2026-05-02-task-flow-v2-phase-8-smoke.md plans/archive/
   # All Phase 8 plan + audit docs:
   git mv plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md plans/archive/
   git mv plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md plans/archive/
   # If any other plans/2026-04-29-task-flow-v2-phase-8-*.md exist, archive them:
   for f in plans/2026-04-29-task-flow-v2-phase-8-*.md; do
     [ -f "$f" ] && git mv "$f" plans/archive/
   done
   ```

3. **Pre-smoke harden docs** (`plans/2026-05-03-pre-smoke-*.md` — currently `pre-smoke-test-stability.md`, plus `pre-smoke-archive-verify.md` if it has been written by then): **keep these in `plans/` for a few weeks** as historical context for anyone reading recent decisions. Archive them in the next housekeeping pass once they've aged out (mental rule: when nothing references them in active discussion).

4. **Commit:**
   ```bash
   git add plans/
   git commit -m "post-merge: archive Phase 7 + Phase 8 close-out plans"
   git push origin main
   ```

---

## 4. Stale tag cleanup

The pre-existing `pre-merge-task-flow-v2` tag (currently at `5cda1bedc75be73d043881819fc5dadac8ac9ee8` — a pre-Phase-8 SHA) no longer points at a meaningful state. Delete it:

```bash
git push --delete origin pre-merge-task-flow-v2
git tag -d pre-merge-task-flow-v2
```

### Optional: re-create `pre-merge-task-flow-v2` at post-merge HEAD

You decide whether this label is still useful. Two options:

- **Re-create it at the new merged main:** `pre-merge-task-flow-v2` becomes a "final task-flow v2 anchor" sitting on the merge commit.
  ```bash
  git tag -a pre-merge-task-flow-v2 main -m "Final task-flow v2 anchor (post-merge to main)"
  git push origin pre-merge-task-flow-v2
  ```
- **Skip it.** `post-smoke-walk-3-green` already serves the same purpose (it's the immediate-pre-merge state of the v2 branch) and `pre-smoke-walk-3` is the broader pre-walk anchor. Two tags is enough; three is clutter.

Default recommendation: **skip it.** Lean toward fewer anchors.

### Tags that stay forever

- `pre-smoke-walk-3` — historical anchor for the pre-walk state.
- `post-smoke-walk-3-green` — the merge anchor.

Do not delete either.

---

## 5. Worktree cleanup

**Wait at least a day or two of normal use** of the merged main before doing this. The worktree is your easiest rollback path; killing it prematurely costs you the ability to re-run the v2 build in isolation if a bug surfaces.

Once you're confident the merged main is rock-solid:

```bash
git worktree remove .lucode/worktrees/task-flow-v2
```

This deletes the worktree directory. The `task-flow-v2` branch ref still exists at this point — branch deletion is §6.

### If `git worktree remove` fails

The most common cause is uncommitted changes in the worktree. Symptoms:
```
fatal: '.lucode/worktrees/task-flow-v2' contains modified or untracked files, use --force to delete it
```

**Do not pass `--force` reflexively.** Investigate first:
```bash
cd .lucode/worktrees/task-flow-v2
git status
```

If the changes are real work that wasn't merged, stop and figure out why (probably a missed commit during the smoke walk). If the changes are detritus (build artifacts, log files), commit-or-clean them appropriately, then retry the remove without `--force`.

Only use `git worktree remove --force` when you've confirmed there is nothing of value in the worktree.

---

## 6. Branch cleanup

**Only after §5 has succeeded.**

### Local
```bash
git branch -D task-flow-v2
```

`-D` is required (not `-d`) because the branch will look "not fully merged" to git from main's perspective even though it was fast-forwarded — git's merge detection doesn't always pick up on rebased histories. Verify what you're deleting first:
```bash
git log task-flow-v2 --oneline -5
git branch --contains $(git rev-parse task-flow-v2) | grep -E '^[* ] main$'
```
If main contains the tip, deletion is safe.

### Remote
```bash
git push --delete origin task-flow-v2
```

**Only do this if you are certain no other clones, agents, or CI jobs have outstanding work on the branch.** Tags (`pre-smoke-walk-3`, `post-smoke-walk-3-green`) survive branch deletion; rollback anchors stay valid.

If you have any doubt — leave the remote branch alone for another week. Branch refs are cheap; recovering from accidental deletion of a still-in-use branch is not.

---

## 7. Production data cutover (one-time, when ready)

The v2 build now ignores v1-shape sessions on disk per the W.5 GAP 4 decision. There is **no urgency** here: the legacy v1 data lingers in `~/Library/Application Support/lucode/projects/<project>/sessions.db` but is invisible to the v2 sidebar. You can leave this section unrun indefinitely.

When you are ready:

### Option A — Archive (recommended before any wipe)

If you want to keep the pre-cutover state for forensics:

```bash
LUCODE_ARCHIVE_OUTPUT_ROOT=~/Lucode-pre-v2-archive scripts/archive-prod-specs.<ext>
```

The exact verified command (script extension, env-var contract, dry-run flag) is documented in `plans/2026-05-03-pre-smoke-archive-verify.md`. **Do not improvise the invocation** — use the verified version.

The script writes a compressed snapshot per project into the output root. Inspect the archive directory before considering it safe, then offsite a copy.

### Option B — Surgical wipe (preferred over whole-dir wipe)

After archiving, drop only the legacy session rows per project. Safer because it preserves any v2 task data you've accumulated since first opening v2.

> **Caveat:** the SQL below is a best-guess based on the schema discriminators (`task_id`, `is_spec`, `is_consolidation`). Before running on a real DB, **verify the WHERE clause against the current `sessions` table** by running it as a `SELECT` first and confirming the count of rows returned matches your expectation of "legacy v1 sessions only."

For each project DB at `~/Library/Application Support/lucode/projects/<hash>/sessions.db`:

```bash
# 1. Stop Lucode (the app must not be running, and no MCP server processes either).
# 2. Back up the DB before mutating:
cp ~/Library/Application\ Support/lucode/projects/<hash>/sessions.db \
   ~/Library/Application\ Support/lucode/projects/<hash>/sessions.db.pre-v2-wipe.bak
# 3. Verify the rows you're about to drop:
sqlite3 ~/Library/Application\ Support/lucode/projects/<hash>/sessions.db \
   "SELECT count(*) FROM sessions WHERE task_id IS NULL AND is_spec = 0 AND is_consolidation = 0;"
# 4. If the count looks right, run the deletion:
sqlite3 ~/Library/Application\ Support/lucode/projects/<hash>/sessions.db <<'SQL'
DELETE FROM sessions WHERE task_id IS NULL AND is_spec = 0 AND is_consolidation = 0;
VACUUM;
SQL
```

### Option C — Whole-dir wipe (faster, riskier)

Only after Option A has produced a verified archive:

```bash
# Lucode must be stopped first.
rm -rf ~/Library/Application\ Support/lucode/projects
```

This nukes per-project state for **every project**, including any v2 task data accumulated since first opening v2. Use this only if you genuinely want to start fresh across the board.

### What NOT to wipe

The application config at `~/Library/Application Support/com.lucacri.lucode/settings.json` is independent of project data — it holds theme, font sizes, etc. **Leave it alone.** Wiping it costs you your UI preferences for no benefit.

---

## 8. Docs publish

Mintlify usually auto-deploys from `main`. The merge in §2 should trigger publication, but verify rather than assume.

1. **Check whether `docs-site/` has an active deploy hook.** Look at the Mintlify dashboard linked from your account, or check for `.github/workflows/` entries that target `docs-site/`. If auto-deploy is on:
   - Wait for the deploy run to finish (usually a few minutes).
   - Open the live docs URL and spot-check a page that changed in W.5: epic picker doc, task list doc (no kanban references), task creation doc (no convert-to-spec). Confirm the changes are live.

2. **If auto-deploy is off** (i.e., the site has been stale across the smoke walk because publish is manual): trigger it. The exact command depends on your Mintlify integration — typically one of:
   - `mintlify deploy` from inside `docs-site/`.
   - A push to a separate `docs-deploy` branch.
   - A "Publish" button in the Mintlify dashboard.

   **Fill in your actual publish command here** the first time you run this section so future-you doesn't have to re-figure it out:

   > `<your-publish-command-here>`

3. **Smoke-check the published site** against the W.5 doc changes after deploy. If a page is stale, either the deploy didn't pick up the merge or the doc edit landed in the wrong file — investigate before walking away.

---

## 9. Memory + status tidy

These are content edits to the user's local memory store at `~/.claude/projects/-Users-lucacri-Sites-dev-tools-schaltwerk/memory/`. They do not touch the repo.

Update:
- `project_taskflow_v2_charter.md`
- `project_phase8_legacy_purge.md`

Edits to make in both:
- Mark Phase 8 + smoke walk + merge as **DONE**.
- Set `branch: main` (not `task-flow-v2`) as the canonical home.
- Note `post-smoke-walk-3-green` as the merge anchor.
- Note `pre-smoke-walk-3` as the rollback-pre-walk anchor.
- Remove or strike-through any "PENDING" markers about Phase 8 / smoke walk / cutover.

---

## 10. Rollback recipes (in case anything goes wrong post-merge)

Listed in order of severity — try the lightest first.

### 10a. Smoke walk passed but a regression turns up days later

`git revert -m 1 <merge-commit>` and push. The pre-merge state is restored on `main`; the v2 commits are still reachable via `git log task-flow-v2..` (the branch ref, if you haven't deleted it yet) or via the `post-smoke-walk-3-green` tag.

```bash
# Find the merge commit:
git log --merges --oneline -5
# Revert it (the -m 1 says "keep the first parent — i.e., main's history before the merge"):
git revert -m 1 <merge-commit-sha>
git push origin main
```

After reverting, investigate on a fresh branch off `post-smoke-walk-3-green`. Do not try to re-merge until the regression is understood and fixed.

### 10b. One specific Phase 8 wave is suspected

If you can narrow the regression to a single wave commit, surgical revert is cleanest:
```bash
git log post-smoke-walk-3-green..main --oneline   # commits introduced by the merge
git revert <wave-commit-sha>
git push origin main
```

The pre-smoke-walk-3 → main range is small and reviewable; cherry-pick reverts work cleanly when the waves are well-separated.

### 10c. Catastrophic regression and you need the pre-merge state immediately

```bash
git checkout main
git reset --hard pre-smoke-walk-3
```

Then push. **This is destructive history rewriting on `main`.** Do this **only** if:
- You are the only person/agent working on `main`.
- You are OK losing every commit that landed since the merge (including any post-merge fixes you cherry-picked in).
- You have explicitly weighed `git revert -m 1` (10a) first and rejected it for a specific reason.

To push after a hard reset:
```bash
git push --force-with-lease origin main
```

`--force-with-lease` (not `--force`) is the safer variant: it refuses to push if `origin/main` has moved since you last fetched, which catches the case where someone else pushed while you were resetting. **Never use plain `--force` against `main`** without coordinating with anyone else who might have a working clone.

### 10d. The `task-flow-v2` worktree/branch was already cleaned up before the regression appeared

You still have:
- `post-smoke-walk-3-green` tag → checkout this to recover the v2 tip state in a new worktree.
- `pre-smoke-walk-3` tag → the pre-walk state, also still reachable.

Recovery:
```bash
git worktree add .lucode/worktrees/task-flow-v2-recovery post-smoke-walk-3-green
cd .lucode/worktrees/task-flow-v2-recovery
git checkout -b task-flow-v2-recovery
```
Now you have a working branch at the v2 tip again and can investigate / fix forward.

---

**End of runbook.**
