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
# Compatible with macOS bash 3.2.

set -u

DATA_ROOT="${LUCODE_PROD_DATA_ROOT:-${HOME}/Library/Application Support/lucode/projects}"

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

    if [ -z "$repo" ] || [ ! -d "$repo" ]; then
        printf '  ! unreachable repository_path %s for %s "%s" — skipped\n' \
            "${repo:-<empty>}" "$source_label" "$name" >&2
        UNREACHABLE=$((UNREACHABLE + 1))
        return 0
    fi

    local date_str safe_name base
    date_str=$(format_date "$created_at")
    safe_name=$(sanitize_name "$name")
    base="${date_str}-${safe_name}-${kind}"

    write_artifact_from_file "${repo}/plans/lucode" "$base" "$body_file"
}

# List rows from tasks/sessions as: id<TAB>name<TAB>repo<TAB>created_at
# Names/repos in v1 don't contain tabs (sanitized session names + filesystem
# paths). created_at is always integer.
list_tasks() {
    local db="$1"
    sqlite3 -readonly -bail -noheader -separator $'\t' "$db" \
        "SELECT id, name, repository_path, COALESCE(created_at,0)
         FROM tasks
         WHERE task_branch IS NOT NULL
         ORDER BY created_at;" 2>/dev/null
}

list_sessions() {
    local db="$1"
    sqlite3 -readonly -bail -noheader -separator $'\t' "$db" \
        "SELECT id, name, repository_path, COALESCE(created_at,0)
         FROM sessions
         WHERE COALESCE(is_consolidation,0) = 0
           AND consolidation_role IS NULL
           AND spec_content IS NOT NULL
           AND length(trim(spec_content)) > 0
         ORDER BY created_at;" 2>/dev/null
}

process_db() {
    local db="$1"
    PROJECTS=$((PROJECTS + 1))
    printf 'project DB: %s\n' "$db"

    local id name repo created_at
    while IFS=$'\t' read -r id name repo created_at; do
        [ -z "${id:-}" ] && continue
        for kind in spec plan summary; do
            local col
            case "$kind" in
                spec)    col="current_spec" ;;
                plan)    col="current_plan" ;;
                summary) col="current_summary" ;;
            esac
            fetch_body "$db" "tasks" "$col" "$id"
            process_row_fields "task[$id]" "$name" "$repo" "$created_at" "$kind" "$TMP_BODY"
        done
    done < <(list_tasks "$db")

    while IFS=$'\t' read -r id name repo created_at; do
        [ -z "${id:-}" ] && continue
        fetch_body "$db" "sessions" "spec_content" "$id"
        process_row_fields "session[$id]" "$name" "$repo" "$created_at" "spec" "$TMP_BODY"
    done < <(list_sessions "$db")
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

printf '\nArchived %d files across %d projects, skipped %d already-archived, %d rows had unreachable repository_path.\n' \
    "$ARCHIVED" "$PROJECTS" "$SKIPPED_DUP" "$UNREACHABLE"
