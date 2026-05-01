#!/usr/bin/env bash
# Test fixture for scripts/archive-prod-specs.sh
#
# Builds a synthetic v1-shape sessions.db plus two synthetic project repos,
# runs the script via LUCODE_PROD_DATA_ROOT, and asserts that the expected
# files appear (and unexpected ones don't), plus that re-running is a no-op.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_SCRIPT="${SCRIPT_DIR}/archive-prod-specs.sh"

if [ ! -x "$TARGET_SCRIPT" ]; then
    printf 'TEST FAIL: %s missing or not executable\n' "$TARGET_SCRIPT" >&2
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
REPO_B="$WORKDIR/repo_b"
REPO_GONE="$WORKDIR/does_not_exist"

mkdir -p "$PROJECTS_ROOT/repo_a-abc123"
mkdir -p "$REPO_A" "$REPO_B"

DB="$PROJECTS_ROOT/repo_a-abc123/sessions.db"

# Schema: minimal v1-shape with the columns the script reads.
sqlite3 "$DB" <<SQL
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    task_branch TEXT,
    current_spec TEXT,
    current_plan TEXT,
    current_summary TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    is_consolidation INTEGER NOT NULL DEFAULT 0,
    consolidation_role TEXT,
    spec_content TEXT,
    created_at INTEGER NOT NULL
);
SQL

# 2025-06-15 00:00:00 UTC = 1749945600. Use epoch-times that make stable dates.
TS_PROMOTED=1749945600       # 2025-06-15
TS_DRAFT=1749945601
TS_CONSOLIDATION=1750032000  # 2025-06-16
TS_JUDGE=1750118400          # 2025-06-17
TS_SESSION_SPEC=1750204800   # 2025-06-18
TS_GONE_REPO=1750291200      # 2025-06-19
TS_PROMOTED_B=1750377600     # 2025-06-20

PROMOTED_SPEC=$'spec for promoted task\nsecond line with content'
PROMOTED_PLAN=$'## plan\n- step one\n- step two'
PROMOTED_SUMMARY=$'summary final'
SESSION_SPEC=$'idea Y\n\nmulti\nline\nbody'

sqlite3 "$DB" <<SQL
INSERT INTO tasks (id, name, repository_path, task_branch, current_spec, current_plan, current_summary, created_at)
VALUES
  ('t-promoted', 'feature-x', '$REPO_A', 'lucode/feature-x',
   '$PROMOTED_SPEC', '$PROMOTED_PLAN', '$PROMOTED_SUMMARY', $TS_PROMOTED),
  ('t-draft', 'never-ran', '$REPO_A', NULL,
   'should not export', NULL, NULL, $TS_DRAFT),
  ('t-promoted-empty', 'partial-content', '$REPO_B', 'lucode/partial',
   'just a spec, no plan or summary', NULL, '   ', $TS_PROMOTED_B),
  ('t-promoted-gone', 'orphan-task', '$REPO_GONE', 'lucode/orphan',
   'orphan body', NULL, NULL, $TS_GONE_REPO);

INSERT INTO sessions (id, name, repository_path, is_consolidation, consolidation_role, spec_content, created_at)
VALUES
  ('s-spec', 'idea-Y', '$REPO_A', 0, NULL, '$SESSION_SPEC', $TS_SESSION_SPEC),
  ('s-consolidation', 'cons-candidate', '$REPO_A', 1, NULL,
   'should not export consolidation', $TS_CONSOLIDATION),
  ('s-judge', 'cons-judge', '$REPO_A', 0, 'judge',
   'should not export judge', $TS_JUDGE),
  ('s-empty', 'empty-spec', '$REPO_A', 0, NULL, '   ', $TS_SESSION_SPEC),
  ('s-null', 'null-spec', '$REPO_A', 0, NULL, NULL, $TS_SESSION_SPEC);
SQL

# Date for the known timestamps depends on local TZ since BSD `date -r` uses
# local time. Compute the expected dates the same way the script will.
expected_date_for() {
    date -r "$1" +%Y-%m-%d
}

D_PROMOTED=$(expected_date_for $TS_PROMOTED)
D_PROMOTED_B=$(expected_date_for $TS_PROMOTED_B)
D_SESSION=$(expected_date_for $TS_SESSION_SPEC)

# --- run ---
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

# Promoted task: all three artifacts in repo_a
assert_exists "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec.md"   "promoted task spec"
assert_exists "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-plan.md"   "promoted task plan"
assert_exists "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-summary.md" "promoted task summary"
assert_content "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec.md" "$PROMOTED_SPEC"
assert_content "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-plan.md" "$PROMOTED_PLAN"
assert_content "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-summary.md" "$PROMOTED_SUMMARY"

# Partial-content task in repo_b: spec only; whitespace summary skipped; null plan skipped.
assert_exists     "$REPO_B/plans/lucode/${D_PROMOTED_B}-partial-content-spec.md" "partial task spec"
assert_not_exists "$REPO_B/plans/lucode/${D_PROMOTED_B}-partial-content-plan.md" "null plan must not export"
assert_not_exists "$REPO_B/plans/lucode/${D_PROMOTED_B}-partial-content-summary.md" "whitespace summary must not export"

# Spec session in repo_a
assert_exists "$REPO_A/plans/lucode/${D_SESSION}-idea-Y-spec.md" "session spec_content"
assert_content "$REPO_A/plans/lucode/${D_SESSION}-idea-Y-spec.md" "$SESSION_SPEC"

# Draft task (no task_branch) — must not export
assert_not_exists "$REPO_A/plans/lucode/$(expected_date_for $TS_DRAFT)-never-ran-spec.md" "draft task must skip"

# Consolidation candidate — must not export
for f in "$REPO_A"/plans/lucode/*cons-candidate*.md; do
    if [ -e "$f" ]; then
        FAIL=$((FAIL + 1))
        printf 'FAIL: consolidation candidate exported as %s\n' "$f" >&2
    fi
done

# Judge session — must not export
for f in "$REPO_A"/plans/lucode/*cons-judge*.md; do
    if [ -e "$f" ]; then
        FAIL=$((FAIL + 1))
        printf 'FAIL: judge session exported as %s\n' "$f" >&2
    fi
done

# Empty/null spec_content sessions — must not export
for f in "$REPO_A"/plans/lucode/*empty-spec*.md "$REPO_A"/plans/lucode/*null-spec*.md; do
    if [ -e "$f" ]; then
        FAIL=$((FAIL + 1))
        printf 'FAIL: empty/null session exported as %s\n' "$f" >&2
    fi
done

# Unreachable-repo task — must not crash; warns and skips. Confirm the missing
# repo really wasn't conjured into existence.
if [ -e "$REPO_GONE" ]; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: script created the unreachable repo %s\n' "$REPO_GONE" >&2
fi

# Verify summary line and unreachable count from stdout.
if ! grep -q 'Archived 5 files across 1 projects' "$WORKDIR/run1.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: summary line wrong in run1.out\n' >&2
    grep -E '^Archived' "$WORKDIR/run1.out" >&2 || :
fi
if ! grep -q '1 rows had unreachable' "$WORKDIR/run1.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: unreachable count wrong in run1.out\n' >&2
fi

# --- run 2: idempotency ---
printf '\n--- run 2 (idempotency) ---\n'
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" bash "$TARGET_SCRIPT" > "$WORKDIR/run2.out" 2> "$WORKDIR/run2.err"
cat "$WORKDIR/run2.out"

if ! grep -q 'Archived 0 files' "$WORKDIR/run2.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: re-run wrote new files (expected Archived 0)\n' >&2
fi
if ! grep -q 'skipped 5 already-archived' "$WORKDIR/run2.out"; then
    FAIL=$((FAIL + 1))
    printf 'FAIL: re-run did not skip already-archived files\n' >&2
fi

# Confirm no -2.md collisions appeared on idempotent rerun.
for f in "$REPO_A"/plans/lucode/*-2.md "$REPO_B"/plans/lucode/*-2.md; do
    if [ -e "$f" ]; then
        FAIL=$((FAIL + 1))
        printf 'FAIL: idempotent rerun produced collision file %s\n' "$f" >&2
    fi
done

# --- run 3: collision when content changes ---
printf '\n--- run 3 (collision on content change) ---\n'
printf 'mutated by user' > "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec.md"
LUCODE_PROD_DATA_ROOT="$PROJECTS_ROOT" bash "$TARGET_SCRIPT" > "$WORKDIR/run3.out" 2> "$WORKDIR/run3.err"
cat "$WORKDIR/run3.out"

assert_exists "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec-2.md" "collision suffix file"
assert_content "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec-2.md" "$PROMOTED_SPEC"
assert_content "$REPO_A/plans/lucode/${D_PROMOTED}-feature-x-spec.md" "mutated by user"

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

printf '\n=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
