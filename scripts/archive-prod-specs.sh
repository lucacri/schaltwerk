#!/usr/bin/env bash
# archive-prod-specs.sh
#
# One-shot tool that exports spec/plan/summary content from a production
# Lucode (v1) install into each project's own plans/lucode/ directory as
# Markdown files. Run this ONCE before cutting over to v2; afterwards the
# user may safely wipe ~/Library/Application Support/lucode/projects/.
#
# Source DBs are opened READ-ONLY (sqlite3 -readonly). The script never
# writes back. Re-running with the same source produces identical output
# (or skips files that are already byte-identical).
#
# Optional override: LUCODE_PROD_DATA_ROOT=/path/to/projects bash archive-prod-specs.sh
# Default: ~/Library/Application Support/lucode/projects
#
# Optional dry-run / testing override: LUCODE_ARCHIVE_OUTPUT_ROOT=/some/dir
# When set, files land at <root>/<basename(repository_path)>/<filename>.md
# instead of <repository_path>/plans/lucode/<filename>.md. Skips the
# repository-path-must-exist check (since we're not writing into real repos).
# Useful for previewing the archive output before running for real.
#
# Compatible with macOS bash 3.2.

set -u

DATA_ROOT="${LUCODE_PROD_DATA_ROOT:-${HOME}/Library/Application Support/lucode/projects}"
OUTPUT_ROOT="${LUCODE_ARCHIVE_OUTPUT_ROOT:-}"

if [ ! -d "$DATA_ROOT" ]; then
    printf 'archive-prod-specs: no production data found at %s — nothing to do.\n' "$DATA_ROOT"
    exit 0
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    printf 'archive-prod-specs: sqlite3 not found in PATH; cannot read source databases.\n' >&2
    exit 1
fi

ARCHIVED=0
SKIPPED_DUP=0
UNREACHABLE=0
PROJECTS=0
SCHEMA_SKIPPED=0

sanitize_name() {
    local raw="$1"
    local out
    out=$(printf '%s' "$raw" | LC_ALL=C tr -c 'A-Za-z0-9_-' '_' | sed 's/__*/_/g')
    out="${out#_}"
    out="${out%_}"
    [ -z "$out" ] && out="unnamed"
    printf '%s' "$out"
}

format_date() {
    local ts="$1"
    if [ -z "$ts" ] || ! [ "$ts" -eq "$ts" ] 2>/dev/null; then
        printf 'unknown-date'
        return
    fi
    date -r "$ts" +%Y-%m-%d 2>/dev/null || printf 'unknown-date'
}

# Args: target_dir, base, content_file (path to file holding raw bytes)
write_artifact_from_file() {
    local target_dir="$1"
    local base="$2"
    local content_file="$3"
    local candidate="${target_dir}/${base}.md"
    local n=2

    if ! mkdir -p "$target_dir" 2>/dev/null; then
        printf 'archive-prod-specs: WARN cannot create %s — skipping\n' "$target_dir" >&2
        return 1
    fi

    while [ -e "$candidate" ]; do
        if cmp -s "$candidate" "$content_file"; then
            SKIPPED_DUP=$((SKIPPED_DUP + 1))
            return 0
        fi
        candidate="${target_dir}/${base}-${n}.md"
        n=$((n + 1))
    done

    cp "$content_file" "$candidate"
    ARCHIVED=$((ARCHIVED + 1))
    printf '  + %s\n' "$candidate"
}

# Args: db, table, body_col, id_value
# Writes raw body bytes to TMP_BODY (trailing newline added by sqlite3 stripped).
fetch_body() {
    local db="$1" table="$2" body_col="$3" id_value="$4"
    local escaped
    escaped=$(printf '%s' "$id_value" | sed "s/'/''/g")
    : > "$TMP_BODY"
    sqlite3 -readonly -bail -noheader -list "$db" \
        "SELECT COALESCE($body_col,'') FROM $table WHERE id = '$escaped';" \
        > "$TMP_BODY" 2>/dev/null || :
    local size
    size=$(wc -c < "$TMP_BODY" | tr -d ' ')
    if [ "${size:-0}" -gt 0 ] && [ -z "$(tail -c 1 "$TMP_BODY")" ]; then
        truncate -s -1 "$TMP_BODY"
    fi
}

# Returns 0 if the file is non-empty AND not whitespace-only.
body_is_meaningful() {
    local f="$1"
    [ -s "$f" ] || return 1
    # If only whitespace, treat as empty.
    if [ -z "$(tr -d '[:space:]' < "$f")" ]; then
        return 1
    fi
    return 0
}

process_row_fields() {
    # Args: source_label, name, repo, created_at, kind, body_file
    local source_label="$1" name="$2" repo="$3" created_at="$4" kind="$5" body_file="$6"

    if ! body_is_meaningful "$body_file"; then
        return 0
    fi

    local out_dir
    if [ -n "$OUTPUT_ROOT" ]; then
        # Dry-run override: route every artifact under <OUTPUT_ROOT>/<repo-basename>/
        # so the user can inspect the would-be output without touching real repos.
        local repo_basename="${repo:-unknown}"
        repo_basename="${repo_basename##*/}"
        if [ -z "$repo_basename" ]; then
            repo_basename="unknown"
        fi
        out_dir="${OUTPUT_ROOT}/${repo_basename}"
    else
        if [ -z "$repo" ] || [ ! -d "$repo" ]; then
            printf '  ! unreachable repository_path %s for %s "%s" — skipped\n' \
                "${repo:-<empty>}" "$source_label" "$name" >&2
            UNREACHABLE=$((UNREACHABLE + 1))
            return 0
        fi
        out_dir="${repo}/plans/lucode"
    fi

    local date_str safe_name base
    date_str=$(format_date "$created_at")
    safe_name=$(sanitize_name "$name")
    base="${date_str}-${safe_name}-${kind}"

    write_artifact_from_file "$out_dir" "$base" "$body_file"
}

# Real content lives in two places in v1:
#   - `archived_specs` table: every spec that was promoted past draft and
#     subsequently archived. By definition "ran". Body is in `content`.
#   - `specs` table: active specs. Filter to those that ran (ready_session_id
#     set, OR have a non-empty implementation_plan — both signal the spec
#     was acted upon). Body is in `content` (kind=spec) and
#     `implementation_plan` (kind=plan).
#
# Tables `tasks` / `sessions.spec_content` were the original target but turn
# out to be nearly empty in real production data — the user's content lives
# in the spec tables above. Per "not the consolidation/judges" rule:
# specs/archived_specs don't carry consolidation rows, so no extra filter
# needed.

# Auto-generated consolidation/judge session names follow these suffixes in
# v1 — exclude them per the user's "not the consolidation/judges" rule:
#   - `<base>-consolidation`             (the merge candidate's archived spec)
#   - `<base>-consolidation_v<N>`        (versioned candidate — typically only
#                                         in `sessions`, but keep for safety)
#   - `<base>-consolidation-judge-<ts>`  (judge session's archived spec)
# A user-named spec like `the_consolidation_judge_step` (uses underscores)
# does NOT match these suffixes and is kept.
CONSOLIDATION_NAME_FILTER="\
       AND name NOT LIKE '%-consolidation' \
       AND name NOT LIKE '%-consolidation-judge-%' \
       AND name NOT LIKE '%-consolidation\\_v%' ESCAPE '\\' "

list_archived_specs() {
    local db="$1"
    # archived_at is stored as MILLISECONDS in v1 (sessions.created_at + most
    # other timestamps are seconds; archived_at is the odd one out). Normalize
    # to seconds here so format_date doesn't see a year-58281 epoch.
    sqlite3 -readonly -bail -noheader -separator $'\t' "$db" \
        "SELECT id, session_name AS name, repository_path, COALESCE(archived_at,0)/1000
         FROM archived_specs
         WHERE content IS NOT NULL AND length(trim(content)) > 0
           AND session_name NOT LIKE '%-consolidation'
           AND session_name NOT LIKE '%-consolidation-judge-%'
           AND session_name NOT LIKE '%-consolidation\\_v%' ESCAPE '\\'
         ORDER BY archived_at;" 2>/dev/null
}

# Older v1 schemas predate `ready_session_id` / `implementation_plan` on the
# `specs` table. Running list_active_specs on those DBs would hit "no such
# column" and silently return zero rows (the SELECT's stderr is suppressed so
# we don't drown the user in noise on healthy DBs). Probe the schema first;
# emit a one-line warning and skip the active-specs export when the columns
# aren't there, so a real schema mismatch surfaces instead of hiding.
specs_table_supports_active_export() {
    local db="$1"
    local missing
    missing=$(sqlite3 -readonly -bail -noheader -list "$db" \
        "SELECT 'ready_session_id' WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('specs') WHERE name = 'ready_session_id')
         UNION ALL
         SELECT 'implementation_plan' WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('specs') WHERE name = 'implementation_plan');" \
        2>/dev/null)
    if [ -n "$missing" ]; then
        printf '  ! specs table missing columns (%s) — skipping active-specs export for %s\n' \
            "$(printf '%s' "$missing" | tr '\n' ',' | sed 's/,$//')" "$db" >&2
        SCHEMA_SKIPPED=$((SCHEMA_SKIPPED + 1))
        return 1
    fi
    return 0
}

list_active_specs() {
    local db="$1"
    sqlite3 -readonly -bail -noheader -separator $'\t' "$db" \
        "SELECT id, name, repository_path, COALESCE(created_at,0)
         FROM specs
         WHERE (ready_session_id IS NOT NULL
             OR (implementation_plan IS NOT NULL AND length(trim(implementation_plan)) > 0))
           AND (
                (content IS NOT NULL AND length(trim(content)) > 0)
                OR (implementation_plan IS NOT NULL AND length(trim(implementation_plan)) > 0)
               )
           AND name NOT LIKE '%-consolidation'
           AND name NOT LIKE '%-consolidation-judge-%'
           AND name NOT LIKE '%-consolidation\\_v%' ESCAPE '\\'
         ORDER BY created_at;" 2>/dev/null
}

process_db() {
    local db="$1"
    PROJECTS=$((PROJECTS + 1))
    printf 'project DB: %s\n' "$db"

    local id name repo ts

    # archived_specs: content only (no implementation_plan column).
    while IFS=$'\t' read -r id name repo ts; do
        [ -z "${id:-}" ] && continue
        fetch_body "$db" "archived_specs" "content" "$id"
        process_row_fields "archived_spec[$id]" "$name" "$repo" "$ts" "spec" "$TMP_BODY"
    done < <(list_archived_specs "$db")

    # active specs: content (-spec.md) + implementation_plan (-plan.md) when present.
    if specs_table_supports_active_export "$db"; then
        while IFS=$'\t' read -r id name repo ts; do
            [ -z "${id:-}" ] && continue
            fetch_body "$db" "specs" "content" "$id"
            process_row_fields "spec[$id]" "$name" "$repo" "$ts" "spec" "$TMP_BODY"
            fetch_body "$db" "specs" "implementation_plan" "$id"
            process_row_fields "spec[$id]" "$name" "$repo" "$ts" "plan" "$TMP_BODY"
        done < <(list_active_specs "$db")
    fi
}

TMP_BODY=$(mktemp -t archive-prod-specs.XXXXXX)
trap 'rm -f "$TMP_BODY"' EXIT

found_any=0
for project_dir in "$DATA_ROOT"/*/; do
    [ -d "$project_dir" ] || continue
    db="${project_dir}sessions.db"
    if [ -f "$db" ]; then
        found_any=1
        process_db "$db"
    fi
done

if [ "$found_any" -eq 0 ]; then
    printf 'archive-prod-specs: no project databases found under %s — nothing to do.\n' "$DATA_ROOT"
    exit 0
fi

printf '\nArchived %d files across %d projects, skipped %d already-archived, %d rows had unreachable repository_path, %d project DBs skipped active-specs export due to schema mismatch.\n' \
    "$ARCHIVED" "$PROJECTS" "$SKIPPED_DUP" "$UNREACHABLE" "$SCHEMA_SKIPPED"
