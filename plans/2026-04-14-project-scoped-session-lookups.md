# Project-Scoped Session Lookups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve session-addressing backend commands against the project that owns the request instead of ambient current project state.

**Architecture:** Add optional project scope to Tauri session lookup commands and route those commands through core read/write helpers that accept a project path. Preserve ambient current-project behavior for commands without explicit scope and rely on the existing MCP `X-Project-Path` override for REST calls.

**Tech Stack:** Tauri Rust commands, React/Jotai frontend state, Vitest frontend tests, Rust unit/command tests where practical.

---

### Task 1: Capture Frontend Contract With Failing Tests

**Files:**
- Modify: `src/components/diff/DiffFileList.test.tsx`

**Step 1: Write failing tests**

Add tests that assert `DiffFileList` sends `projectPath` for:
- `get_changed_files_from_main`
- `schaltwerk_core_get_session`
- `get_uncommitted_files`

Add a test that rejects `get_uncommitted_files` with `{ type: 'SessionNotFound', data: { session_id: 'demo' } }` and expects no `logger.error`.

**Step 2: Run test to verify it fails**

Run: `bun test src/components/diff/DiffFileList.test.tsx`

Expected: FAIL because current invokes omit `projectPath` and dirty-file structured errors are logged.

### Task 2: Add Project-Scoped Core Helpers

**Files:**
- Modify: `src-tauri/src/main.rs`

**Step 1: Add helper signatures**

Add `get_schaltwerk_core_for_project_path(project_path: Option<&str>)`, `get_core_read_for_project_path(project_path: Option<&str>)`, and `get_core_write_for_project_path(project_path: Option<&str>)`.

**Step 2: Preserve existing behavior**

When `project_path` is `None` or blank, delegate to existing helpers. When present, get the project manager core by path and acquire the corresponding lock.

### Task 3: Thread Project Scope Through Diff Commands

**Files:**
- Modify: `src-tauri/src/diff_commands.rs`

**Step 1: Update command signatures**

Add `project_path: Option<String>` to session-addressing diff commands, starting with `get_changed_files_from_main`, `has_remote_tracking_branch`, and `get_uncommitted_files`.

**Step 2: Update lookup helpers**

Pass `project_path.as_deref()` through `resolve_session_branch`, `resolve_session_info`, `resolve_session_info_structured`, `resolve_repo_path_structured`, and `resolve_base_branch_structured`.

**Step 3: Keep non-session behavior stable**

For orchestrator/no-session paths, use the explicit `project_path` when provided and fall back to ambient current project/current directory only when omitted.

### Task 4: Thread Project Scope Through Core Session Commands

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`

**Step 1: Replace helper**

Change `session_manager_read()` to accept `project_path: Option<&str>`.

**Step 2: Update session-resolving command signatures**

Add optional `project_path: Option<String>` to `schaltwerk_core_get_session`, `schaltwerk_core_get_spec`, `schaltwerk_core_get_session_agent_content`, merge preview commands, and `schaltwerk_core_update_session_from_parent`.

**Step 3: Use scoped helpers**

Route these commands through `session_manager_read(project_path.as_deref())`, `get_core_read_for_project_path`, or `get_core_write_for_project_path` as appropriate.

### Task 5: Update Frontend Callers

**Files:**
- Modify: `src/components/diff/DiffFileList.tsx`
- Modify other frontend callers only where the current project scope is readily available.

**Step 1: Pass `projectPath` from Jotai state**

Use `projectPathRef.current` in async callbacks to include `projectPath` in diff and session invokes.

**Step 2: Fix structured dirty-file error filtering**

Use `isSessionMissingError(error)` and `getErrorMessage(error)` rather than `String(error)`.

### Task 6: Verify and Commit

**Files:**
- All changed files.

**Step 1: Run targeted tests**

Run: `bun test src/components/diff/DiffFileList.test.tsx`

**Step 2: Run full validation**

Run: `just test`

**Step 3: Request code review**

Use the requesting-code-review workflow against the final diff.

**Step 4: Create squashed commit**

Run: `git status --short`, stage the scoped files, and commit all task changes in one squashed commit.
