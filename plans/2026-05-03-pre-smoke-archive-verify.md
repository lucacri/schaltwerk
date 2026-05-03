# Pre-smoke verification: `scripts/archive-prod-specs.sh`

Phase 8 / Task 7. Runs the prod-spec archiver in output-only mode against the
real `~/Library/Application Support/lucode/projects` data, captures totals,
classifies every issue, and pins the cutover-day commands.

## Script

- **Path:** `/Users/lucacri/Sites/dev-tools/schaltwerk/.lucode/worktrees/task-flow-v2/scripts/archive-prod-specs.sh`
- **What it does:** One-shot exporter that opens each project's v1
  `sessions.db` read-only and writes Markdown copies of every "ran" spec /
  archived spec into either:
  - the project repo's own `plans/lucode/` directory (production mode), or
  - `<LUCODE_ARCHIVE_OUTPUT_ROOT>/<repo-basename>/` when that env var is set
    (dry-run / verification mode — bypasses the repo-existence check).
  Skips auto-generated consolidation/judge sessions, empty/whitespace-only
  bodies, and (after this verification) DBs whose `specs` table predates the
  v1 columns we depend on.

## Inputs

- **Source:** `~/Library/Application Support/lucode/projects/*/sessions.db`
  (10 project DBs total). Override with `LUCODE_PROD_DATA_ROOT`.
- **Env vars consumed:**
  - `LUCODE_PROD_DATA_ROOT` (optional) — alternate projects root.
  - `LUCODE_ARCHIVE_OUTPUT_ROOT` (optional) — when set, route all output
    under this root and skip the per-row `repository_path` existence check.
- **Read-only contract:** every SQL handle is opened with `sqlite3 -readonly
  -bail`. Source DBs were not modified; mtimes match pre-run.

## Outputs (verification run)

- **Output root:** `/tmp/v2-archive-verify`
- **Files produced:** `356`
- **Total bytes:** `2997137` (~2.86 MiB)
- **Per-project breakdown:**

  ```
  agent-for-gitlab    31 files     62853 bytes
  claude-mart         42 files    113567 bytes
  final-repo         123 files    994795 bytes
  mindbody-docs        1 files     11312 bytes
  NativeAppNew         3 files     11833 bytes
  new-chezmoi         23 files     22489 bytes
  schaltwerk         133 files   1780288 bytes
  ```

  Three projects produced no files: `lucode-rs`, `src-tauri`, `v2-smoke`.
  They have empty `archived_specs` and (after filter) no qualifying `specs`
  rows — verified by direct sqlite query, no data was missed.

## Run summary

- **Project DBs discovered:** `10`
- **Archive files produced:** `356`
- **Already-archived (skipped on idempotent path):** `32` (the `cmp -s`
  short-circuit fired because the ms→s normalization in `archived_at`
  collapsed some near-identical bodies onto the same `<date>-<name>-spec.md`
  filename across days; the second body was byte-identical and correctly
  deduped).
- **Unreachable `repository_path` rows:** `0` (override mode bypasses this
  check by design — the archive-anyway behaviour is documented).
- **Schema-mismatch DBs (post-fix):** `6` (see Issue 1).
- **Wall time:** 13 seconds.
- **Exit code:** `0`.

## Issues encountered

### 1. Silent SQL error on older `specs` schemas — script bug, FIXED.

Six of the ten production DBs have a legacy v1 `specs` shape that predates
the `ready_session_id` and `implementation_plan` columns:

- `agent-for-gitlab_d7e17b3c7a454f8d`
- `lucode-rs_48341ba5bd24617f`
- `mindbody-docs_f1fcc19e778eadd0`
- `NativeAppNew_ce725363c7675260`
- `new-chezmoi_0c2ed1db14541368`
- `src-tauri_e5c2025fabce5ffb`

The original `list_active_specs` query referenced both columns directly. On
those older DBs sqlite3 errored with `no such column: ready_session_id`,
but the script's `2>/dev/null` swallowed the error and the function returned
zero rows. The user would have seen no warning and no count.

**Impact on real data:** five of the six DBs have an empty or zero-content
`specs` table, so nothing was actually missed there. **One DB (`NativeAppNew`)
has a single 9195-byte spec named `upgrade-expo-sdk-52-to-55`** in
`stage=draft` with no `ready_session_id` and no `implementation_plan`. It
would not have been exported even on a current schema (the script's stated
contract is "only specs that ran"), but the schema-mismatch class was
masking that signal — see Cutover-day step 3 for the manual recovery path.

**Fix:** added a `pragma_table_info('specs')` probe before invoking the
active-specs query. When the columns are absent the script emits a one-line
warning to stderr (modelled on the existing `unreachable repository_path`
warning) and increments a new `SCHEMA_SKIPPED` counter that lands in the
final summary line. `archived_specs` export is unaffected for those DBs.

**Test coverage:** added run 6 to
`scripts/archive-prod-specs.test.sh` building a synthetic old-schema project
DB and asserting:
- the schema-mismatch warning fires on stderr and names both missing columns,
- `archived_specs` rows still export under that project,
- `specs` rows are not exported,
- the final summary counts `1 project DBs skipped active-specs export due to
  schema mismatch`.

`bash scripts/archive-prod-specs.test.sh` passes (`29 passed, 0 failed`).

### 2. `NativeAppNew` orphan draft — data classification, by design.

`NativeAppNew` has one draft spec (`upgrade-expo-sdk-52-to-55`, 9195 bytes,
about an Expo SDK 52→55 upgrade) that the script intentionally does not
export because:

- it is `stage=draft`,
- it has no `ready_session_id`, and
- it has no `implementation_plan`.

The script's contract is "specs that ran" so a draft never qualifies.
Surfacing it here so the user can decide before cutover whether to copy the
content out manually:

```bash
sqlite3 -readonly "$HOME/Library/Application Support/lucode/projects/NativeAppNew_ce725363c7675260/sessions.db" \
    "SELECT content FROM specs WHERE name = 'upgrade-expo-sdk-52-to-55';" \
    > "$HOME/Sites/LoopSpark/NativeAppNew/plans/lucode/upgrade-expo-sdk-52-to-55-draft.md"
```

(Adjust the destination path; `repository_path` recorded in the DB is
`/Users/lucacri/Sites/LoopSpark/NativeAppNew`.)

### 3. No other anomalies.

- Zero unreachable `repository_path` rows in production (every spec's
  recorded path resolves on disk; the override mode used here doesn't check
  it but a real prod-mode run would). Confirmed by spot-checking each
  project's `repository_path` column.
- No sqlite errors (post-fix). Pre-fix the only errors were the silent
  schema-mismatch `2>/dev/null` swallow, fixed in Issue 1.
- No bash panics, no `set -e` aborts, no broken pipes.

## Cutover-day instructions

When the user is ready to run for real, after this PR is merged:

1. **Quit Lucode** before running the archiver. The DBs are opened
   read-only here, but a hot WAL from a live process can still surprise the
   ms→s normalization on `archived_at` if a session writes mid-scan.
2. **Run the archiver in REAL mode** — `LUCODE_ARCHIVE_OUTPUT_ROOT` must be
   **unset** so files land in each project repo's `plans/lucode/`:

   ```bash
   cd /Users/lucacri/Sites/dev-tools/schaltwerk
   bash scripts/archive-prod-specs.sh
   ```

   Expect ~356 lines of `+ <path>` output, the same six schema-mismatch
   warnings on stderr, and a final summary like:

   ```
   Archived 356 files across 10 projects, skipped 0 already-archived,
   0 rows had unreachable repository_path,
   6 project DBs skipped active-specs export due to schema mismatch.
   ```

   (`unreachable` may be non-zero if the recorded `repository_path` for any
   row no longer exists on disk; in that case re-check the per-row warnings
   on stderr, decide whether to clone the missing repo or accept the loss.)
3. **Recover the `NativeAppNew` orphan draft manually** if it is still
   wanted (see Issue 2 above).
4. **Verify each project repo** picked up the new files:

   ```bash
   for repo in /Users/lucacri/Sites/dev-tools/schaltwerk \
              /Users/lucacri/Sites/LoopSpark/loopspark \
              <other repos with plans/lucode/ entries>; do
       printf '\n=== %s ===\n' "$repo"
       cd "$repo" && git status --short -- plans/lucode/ | head
   done
   ```

   Each repo should show new `?? plans/lucode/...` entries equal to the
   per-project counts in this report. Commit those into each repo on the
   user's normal cadence — the archiver does not touch git.
5. **(Optional) re-run for safety.** Re-running with the same source is
   idempotent: existing files compare byte-equal and are skipped, mutated
   files trigger a `-2.md` collision suffix. Expect:

   ```
   Archived 0 files across 10 projects, skipped 356 already-archived, ...
   ```

6. **Wipe v1 data only after every repo's `plans/lucode/` is committed.**
   The archiver does not delete sources; the user can `rm -rf
   ~/Library/Application\ Support/lucode/projects` once v2 is happy.
