#!/usr/bin/env bash
# Test fixture for scripts/archive-prod-specs.sh
#
# Builds a synthetic v1-shape sessions.db with the *real* source tables the
# script reads (`archived_specs`, `specs`), plus a synthetic project repo,
# runs the script via LUCODE_PROD_DATA_ROOT, and asserts:
#   - normal archived_specs/specs rows export
#   - empty/whitespace-only content is skipped
#   - auto-generated `*-consolidation` / `*-consolidation-judge-*` /
#     `*-consolidation_v<N>` rows are filtered out
#   - user-named rows merely *containing* "consolidation" with underscores
#     (not the auto-suffix) are still exported
#   - `archived_at` ms→s normalization yields the right date prefix
#   - `created_at` (already seconds) yields the right date prefix
#   - re-run is a no-op (idempotency)
#   - mutating an existing file forces a `-2.md` collision file
#   - LUCODE_ARCHIVE_OUTPUT_ROOT bypasses the repo-existence check and routes
#     output under <root>/<repo-basename>/
#   - older v1 schemas (no `ready_session_id` / `implementation_plan`) are
#     skipped for active-specs export with a stderr warning, instead of
#     silently swallowing a "no such column" error.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/archive-prod-specs.sh"

if [ ! -f "$TARGET_SCRIPT" ]; then
    printf 'TEST FAIL: %s missing\n' "$TARGET_SCRIPT" >&2
    exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    printf 'TEST SKIP: sqlite3 not available\n' >&2
    exit 0
fi

WORKDIR=$(mktemp -d -t archive-prod-specs-test.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

PROJECTS_ROOT="$WORKDIR/projects"
REPO_A="$WORKDIR/repo_a"
REPO_GONE="$WORKDIR/does_not_exist"

mkdir -p "$PROJECTS_ROOT/repo_a-abc123"
mkdir -p "$REPO_A"

DB="$PROJECTS_ROOT/repo_a-abc123/sessions.db"

# Schema: minimal v1-shape covering only the columns the script reads. Real v1
# has many more columns on these tables; keep this fixture lean.
sqlite3 "$DB" <<SQL
CREATE TABLE specs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    repository_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    implementation_plan TEXT,
    ready_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    stage TEXT NOT NULL DEFAULT 'draft',
    variant TEXT NOT NULL DEFAULT 'regular'
);
CREATE TABLE archived_specs (
    id TEXT PRIMARY KEY,
    session_name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    repository_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    archived_at INTEGER NOT NULL
);
SQL

# Real production timestamp scales:
#   - specs.created_at:        seconds  (e.g. 1776490222 → 2026-04-17)
#   - archived_specs.archived_at: milliseconds (e.g. 1776395480067 → 2026-04-17)
#
# These two reference values are taken from real prod data; the rest below are
# synthetic but use the same scales.
TS_ARCHIVED_MS=1776395480067            # 2026-04-17 (after ms→s normalize)
TS_ARCHIVED2_MS=1776481880067           # 2026-04-18
TS_ARCHIVED3_MS=1776568280067           # 2026-04-19
TS_ARCHIVED4_MS=1776654680067           # 2026-04-20
TS_ARCHIVED5_MS=1776741080067           # 2026-04-21
TS_ARCHIVED6_MS=1776827480067           # 2026-04-22
TS_ARCHIVED_GONE_MS=1776913880067       # 2026-04-23

TS_SPEC=1776490222                      # 2026-04-17 (seconds)
TS_SPEC_PLAN_ONLY=1776576622            # 2026-04-18
TS_SPEC_BOTH=1776663022                 # 2026-04-19
TS_SPEC_NO_RUN=1776749422               # 2026-04-20
TS_SPEC_JUDGE=1776835822                # 2026-04-21

# Bodies that round-trip through sqlite3.  Avoid embedded backslashes / single
# quotes that would force escape gymnastics; this is a fixture, not a fuzzer.
ARCHIVED_NORMAL=$'archived spec body\nsecond line'
ARCHIVED_FALSE_POSITIVE=$'user-named spec that contains the substring consolidation\nbut not as the auto-suffix'
SPEC_CONTENT=$'spec content body\nline two'
SPEC_PLAN_BODY=$'## implementation plan\n- step one\n- step two'
SPEC_BOTH_CONTENT=$'both: spec content'
SPEC_BOTH_PLAN=$'both: plan content'
SPEC_NO_RUN=$'spec that never ran — should NOT export'

sqlite3 "$DB" <<SQL
-- archived_specs: 8 rows covering the lifecycle.
INSERT INTO archived_specs (id, session_name, repository_path, content, archived_at) VALUES
  ('a-normal',        'feature-x',                   '$REPO_A', '$ARCHIVED_NORMAL',          $TS_ARCHIVED_MS),
  ('a-empty',         'empty-archive',               '$REPO_A', '',                          $TS_ARCHIVED2_MS),
  ('a-whitespace',    'whitespace-archive',          '$REPO_A', '   ' || x'0a' || '   ',    $TS_ARCHIVED3_MS),
  ('a-cons',          'something-consolidation',     '$REPO_A', 'should not export',         $TS_ARCHIVED4_MS),
  ('a-judge',         'something-consolidation-judge-1700000000', '$REPO_A', 'judge body',  $TS_ARCHIVED5_MS),
  ('a-cons-v',        'something-consolidation_v2',  '$REPO_A', 'versioned candidate',       $TS_ARCHIVED6_MS),
  ('a-fp',            'the_consolidation_thing',     '$REPO_A', '$ARCHIVED_FALSE_POSITIVE', $TS_ARCHIVED_MS),
  ('a-gone',          'orphan-archive',              '$REPO_GONE', 'orphan body',            $TS_ARCHIVED_GONE_MS);

-- specs: 5 rows covering ran/didn't-ran/judge variants.
INSERT INTO specs (id, name, repository_path, content, implementation_plan, ready_session_id, created_at, updated_at) VALUES
  ('s-spec',      'idea-a',                                '$REPO_A', '$SPEC_CONTENT',     NULL,             'ses-1', $TS_SPEC,           $TS_SPEC),
  ('s-plan-only', 'plan-only',                             '$REPO_A', '',                 '$SPEC_PLAN_BODY', NULL,    $TS_SPEC_PLAN_ONLY, $TS_SPEC_PLAN_ONLY),
  ('s-both',      'feature-y',                             '$REPO_A', '$SPEC_BOTH_CONTENT','$SPEC_BOTH_PLAN','ses-2', $TS_SPEC_BOTH,      $TS_SPEC_BOTH),
  ('s-no-run',    'never-ran',                             '$REPO_A', '$SPEC_NO_RUN',     NULL,              NULL,    $TS_SPEC_NO_RUN,    $TS_SPEC_NO_RUN),
  ('s-judge',     'something-consolidation-judge-1700000', '$REPO_A', 'judge spec body',  'judge plan body', 'ses-j', $TS_SPEC_JUDGE,     $TS_SPEC_JUDGE);
SQL

# Compute expected dates the same way the script will (BSD `date -r`, local TZ).
expected_date_for() {
    date -r "$1" +%Y-%m-%d
}

D_ARCHIVED=$(expected_date_for $((TS_ARCHIVED_MS / 1000)))
D_SPEC=$(expected_date_for $TS_SPEC)
D_SPEC_PLAN_ONLY=$(expected_date_for $TS_SPEC_PLAN_ONLY)
D_SPEC_BOTH=$(expected_date_for $TS_SPEC_BOTH)

PASS=0
FAIL=0

assert_exists() {
    local p="$1" reason="$2"
    if [ -f "$p" ]; then
        PASS=$((PASS + 1))
        printf 'ok  : exists %s\n' "$p"
    else
        FAIL=$((FAIL + 1))
        printf 'FAIL: missing %s — %s\n' "$p" "$reason" >&2
    fi
}

assert_not_exists() {
    local p="$1" reason="$2"
    if [ ! -e "$p" ]; then
        PASS=$((PASS + 1))
        printf 'ok  : absent %s\n' "$p"
    else
        FAIL=$((FAIL + 1))
        printf 'FAIL: unexpected file %s — %s\n' "$p" "$reason" >&2
    fi
}

assert_content() {
    local p="$1" expected="$2"
    local got
    got=$(cat "$p" 2>/dev/null || printf '')
    if [ "$got" = "$expected" ]; then
        PASS=$((PASS + 1))
        printf 'ok  : content %s\n' "$p"
    else
        FAIL=$((FAIL + 1))
        printf 'FAIL: content mismatch in %s\n  expected: %q\n  got:      %q\n' "$p" "$expected" "$got" >&2
    fi
}

assert_no_glob_match() {
    local glob="$1" reason="$2"
    local matched=0
    for f in $glob; do
        if [ -e "$f" ]; then
            matched=1
            FAIL=$((FAIL + 1))
            printf 'FAIL: %s — unexpected match %s\n' "$reason" "$f" >&2
        fi
    done
    if [ "$matched" -eq 0 ]; then
        PASS=$((PASS + 1))
        printf 'ok  : no match for %s\n' "$glob"
    fi
}

# --- run 1: real-repo mode (writes to $REPO_A/plans/lucode/) ---
printf '\n--- run 1 ---\n'
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" bash "$TARGET_SCRIPT" > "$WORKDIR/run1.out" 2> "$WORKDIR/run1.err"
RC=$?
if [ $RC -ne 0 ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: script exited %d\n' "$RC" >&2
    cat "$WORKDIR/run1.out"
    cat "$WORKDIR/run1.err" >&2
fi
cat "$WORKDIR/run1.out"

# archived_specs cases
assert_exists "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec.md" "archived_spec normal row"
assert_content "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec.md" "$ARCHIVED_NORMAL"
assert_no_glob_match "$REPO_A/plans/lucode/*empty-archive*.md"      "empty content must not export"
assert_no_glob_match "$REPO_A/plans/lucode/*whitespace-archive*.md" "whitespace-only content must not export"
assert_no_glob_match "$REPO_A/plans/lucode/*something-consolidation-spec.md" "*-consolidation suffix must not export"
assert_no_glob_match "$REPO_A/plans/lucode/*consolidation-judge*.md" "*-consolidation-judge-* must not export"
assert_no_glob_match "$REPO_A/plans/lucode/*consolidation_v*.md"     "*-consolidation_v<N> must not export"

# False-positive guard: user-named row with "consolidation" in the middle, with
# underscores around it (not the auto-suffix), MUST be exported.
assert_exists "$REPO_A/plans/lucode/${D_ARCHIVED}-the_consolidation_thing-spec.md" \
    "false-positive guard: user-named row containing 'consolidation' should still export"
assert_content "$REPO_A/plans/lucode/${D_ARCHIVED}-the_consolidation_thing-spec.md" "$ARCHIVED_FALSE_POSITIVE"

# specs cases
assert_exists "$REPO_A/plans/lucode/${D_SPEC}-idea-a-spec.md" "spec with ready_session_id, no plan: -spec.md"
assert_content "$REPO_A/plans/lucode/${D_SPEC}-idea-a-spec.md" "$SPEC_CONTENT"
assert_not_exists "$REPO_A/plans/lucode/${D_SPEC}-idea-a-plan.md" "spec with NULL plan must not produce -plan.md"

assert_exists "$REPO_A/plans/lucode/${D_SPEC_PLAN_ONLY}-plan-only-plan.md" \
    "spec with NULL ready_session_id but non-empty implementation_plan still exports plan"
assert_content "$REPO_A/plans/lucode/${D_SPEC_PLAN_ONLY}-plan-only-plan.md" "$SPEC_PLAN_BODY"
assert_not_exists "$REPO_A/plans/lucode/${D_SPEC_PLAN_ONLY}-plan-only-spec.md" "empty content must not produce -spec.md"

assert_exists "$REPO_A/plans/lucode/${D_SPEC_BOTH}-feature-y-spec.md" "spec with both content+plan: -spec.md"
assert_exists "$REPO_A/plans/lucode/${D_SPEC_BOTH}-feature-y-plan.md" "spec with both content+plan: -plan.md"
assert_content "$REPO_A/plans/lucode/${D_SPEC_BOTH}-feature-y-spec.md" "$SPEC_BOTH_CONTENT"
assert_content "$REPO_A/plans/lucode/${D_SPEC_BOTH}-feature-y-plan.md" "$SPEC_BOTH_PLAN"

assert_no_glob_match "$REPO_A/plans/lucode/*never-ran*.md"          "spec with no ready_session_id and no plan must not export"
assert_no_glob_match "$REPO_A/plans/lucode/*consolidation-judge*"   "judge-suffix spec must not export"

# Unreachable repo: real-repo mode logs a warning to stderr; OUTPUT_ROOT mode
# does not. We check the warning only here.
if ! grep -q 'unreachable repository_path' "$WORKDIR/run1.err"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: expected unreachable warning on stderr in run1.err\n' >&2
fi
if [ -e "$REPO_GONE" ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: script created the unreachable repo %s\n' "$REPO_GONE" >&2
fi

# Summary line: 5 archived (1 normal + 1 false-positive + spec + plan-only-plan + both-spec + both-plan = 6).
# Recount:
#   archived_specs exports: a-normal, a-fp                          -> 2
#   specs exports:          s-spec(spec), s-plan-only(plan),
#                           s-both(spec), s-both(plan)              -> 4
#   total                                                            = 6
if ! grep -q 'Archived 6 files across 1 projects' "$WORKDIR/run1.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: summary line wrong in run1.out (expected Archived 6 files across 1 projects)\n' >&2
    grep -E '^Archived' "$WORKDIR/run1.out" >&2 || :
fi
if ! grep -q '1 rows had unreachable' "$WORKDIR/run1.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: unreachable count wrong in run1.out (expected 1)\n' >&2
fi
if ! grep -q '0 project DBs skipped active-specs export due to schema mismatch' "$WORKDIR/run1.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: schema-skip count missing or wrong in run1.out (expected 0)\n' >&2
fi

# --- run 2: idempotency ---
printf '\n--- run 2 (idempotency) ---\n'
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" bash "$TARGET_SCRIPT" > "$WORKDIR/run2.out" 2> "$WORKDIR/run2.err"
cat "$WORKDIR/run2.out"

if ! grep -q 'Archived 0 files' "$WORKDIR/run2.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: re-run wrote new files (expected Archived 0)\n' >&2
fi
if ! grep -q 'skipped 6 already-archived' "$WORKDIR/run2.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: re-run did not skip already-archived files (expected 6)\n' >&2
fi
assert_no_glob_match "$REPO_A/plans/lucode/*-2.md" "idempotent rerun must not produce collision files"

# --- run 3: collision when content changes under us ---
printf '\n--- run 3 (collision on content change) ---\n'
printf 'mutated by user' > "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec.md"
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" bash "$TARGET_SCRIPT" > "$WORKDIR/run3.out" 2> "$WORKDIR/run3.err"
cat "$WORKDIR/run3.out"

assert_exists  "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec-2.md" "collision suffix file"
assert_content "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec-2.md" "$ARCHIVED_NORMAL"
assert_content "$REPO_A/plans/lucode/${D_ARCHIVED}-feature-x-spec.md"   "mutated by user"

# --- run 4: missing data root ---
printf '\n--- run 4 (missing data root) ---\n'
LUCODE_PROD_DATA_ROOT="$WORKDIR/no_such_dir" bash "$TARGET_SCRIPT" > "$WORKDIR/run4.out" 2> "$WORKDIR/run4.err"
RC=$?
if [ $RC -ne 0 ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: script returned %d when data root missing (expected 0)\n' "$RC" >&2
fi
if ! grep -q 'no production data found' "$WORKDIR/run4.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: missing-data-root run did not print expected message\n' >&2
fi

# --- run 5: LUCODE_ARCHIVE_OUTPUT_ROOT override ---
# When set, files land at <root>/<repo-basename>/<filename>.md and the
# repo-existence check is skipped — this is also how the unreachable repo gets
# exported (it doesn't exist on disk, but the override says "I don't care").
printf '\n--- run 5 (LUCODE_ARCHIVE_OUTPUT_ROOT override) ---\n'
OVERRIDE_OUT="$WORKDIR/out"
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" \
    LUCODE_ARCHIVE_OUTPUT_ROOT="$OVERRIDE_OUT" \
    bash "$TARGET_SCRIPT" > "$WORKDIR/run5.out" 2> "$WORKDIR/run5.err"
RC=$?
if [ $RC -ne 0 ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: override run exited %d\n' "$RC" >&2
fi
cat "$WORKDIR/run5.out"

# Override mode routes <repo>/plans/lucode/foo.md → <out>/<repo-basename>/foo.md
D_ARCHIVED_GONE=$(expected_date_for $((TS_ARCHIVED_GONE_MS / 1000)))
assert_exists "$OVERRIDE_OUT/repo_a/${D_ARCHIVED}-feature-x-spec.md" \
    "override mode: archived_specs row routed under <out>/<basename>"
assert_exists "$OVERRIDE_OUT/does_not_exist/${D_ARCHIVED_GONE}-orphan-archive-spec.md" \
    "override mode: unreachable repo (does_not_exist) is exported because override skips existence check"

# Override mode must NOT log unreachable warnings (the whole point of the
# override is to dry-run without warnings).
if grep -q 'unreachable repository_path' "$WORKDIR/run5.err"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: override mode unexpectedly logged unreachable warning\n' >&2
    cat "$WORKDIR/run5.err" >&2
fi

# Override mode must report 0 unreachable rows.
if ! grep -q '0 rows had unreachable' "$WORKDIR/run5.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: override mode unreachable count wrong (expected 0)\n' >&2
fi

# --- run 6: older v1 schema (no ready_session_id / implementation_plan) ---
# A second project DB is created with the legacy `specs` shape that predates
# those columns. The script must warn on stderr, skip active-specs export for
# that DB, and still export the project's archived_specs rows. The summary
# line must report `1 project DBs skipped active-specs export due to schema
# mismatch`.
printf '\n--- run 6 (older v1 specs schema) ---\n'
OLD_SCHEMA_PROJECTS_ROOT="$WORKDIR/projects_old"
OLD_REPO="$WORKDIR/repo_old"
mkdir -p "$OLD_SCHEMA_PROJECTS_ROOT/repo_old-xyz789"
mkdir -p "$OLD_REPO"
OLD_DB="$OLD_SCHEMA_PROJECTS_ROOT/repo_old-xyz789/sessions.db"

sqlite3 "$OLD_DB" <<SQL
CREATE TABLE specs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    repository_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE archived_specs (
    id TEXT PRIMARY KEY,
    session_name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    repository_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    archived_at INTEGER NOT NULL
);
INSERT INTO specs (id, name, repository_path, content, created_at, updated_at) VALUES
  ('os-draft', 'old-schema-draft', '$OLD_REPO', 'old schema draft body', $TS_SPEC, $TS_SPEC);
INSERT INTO archived_specs (id, session_name, repository_path, content, archived_at) VALUES
  ('os-archived', 'old-schema-feature', '$OLD_REPO', 'old schema archived body', $TS_ARCHIVED_MS);
SQL

OLD_OUT="$WORKDIR/out_old"
LUCODE_PROD_DATA_ROOT="$OLD_SCHEMA_PROJECTS_ROOT" \
    LUCODE_ARCHIVE_OUTPUT_ROOT="$OLD_OUT" \
    bash "$TARGET_SCRIPT" > "$WORKDIR/run6.out" 2> "$WORKDIR/run6.err"
RC=$?
if [ $RC -ne 0 ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: old-schema run exited %d\n' "$RC" >&2
fi
cat "$WORKDIR/run6.out"
cat "$WORKDIR/run6.err" >&2

# stderr must include the schema-mismatch warning and name the missing columns.
if ! grep -q 'specs table missing columns' "$WORKDIR/run6.err"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: expected schema-mismatch warning on stderr in run6.err\n' >&2
fi
if ! grep -q 'ready_session_id' "$WORKDIR/run6.err"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: schema-mismatch warning missing ready_session_id\n' >&2
fi
if ! grep -q 'implementation_plan' "$WORKDIR/run6.err"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: schema-mismatch warning missing implementation_plan\n' >&2
fi

# archived_specs row should still be exported (its schema is unaffected).
assert_exists "$OLD_OUT/repo_old/${D_ARCHIVED}-old-schema-feature-spec.md" \
    "old-schema DB still exports archived_specs rows"

# specs row must NOT be exported (active-specs branch was skipped).
assert_no_glob_match "$OLD_OUT/repo_old/*old-schema-draft*.md" \
    "old-schema DB must not attempt active-specs export"

# Summary must mark 1 project skipped due to schema mismatch.
if ! grep -q '1 project DBs skipped active-specs export due to schema mismatch' "$WORKDIR/run6.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: schema-skip count wrong in run6.out (expected 1)\n' >&2
    grep -E '^Archived' "$WORKDIR/run6.out" >&2 || :
fi

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
