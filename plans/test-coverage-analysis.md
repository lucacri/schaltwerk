# Test Coverage Analysis

## Current State Overview

| Layer | Source Files | Test Files | Test Cases | Coverage Ratio |
|-------|-------------|------------|------------|----------------|
| Frontend (TS/TSX) | ~401 | 268 | 2,337 | ~67% of files |
| Rust Backend | ~120 | 117 modules with `#[cfg(test)]` | ~1,000+ | Varies widely |
| MCP Server | 3 | 11 | ~50 scenarios | ~40% of methods |

---

## Priority 1: High-Impact Gaps

### 1. Rust: Session Lifecycle (domains/sessions/)

The session lifecycle is the core business logic of the app. Several critical paths lack tests:

- **`sessions/sorting.rs`** — 0 tests. Session ordering affects the entire sidebar UI.
- **`sessions/cache.rs`** — 0 tests. Cache invalidation bugs could cause stale UI state.
- **`sessions/entity.rs`** — 0 tests. The core Session struct and its transformations.
- **`sessions/process_cleanup.rs`** — 0 tests. Failure here leaks OS processes (each session spawns 3).
- **`sessions/repository.rs`** — 0 tests. The data access layer for sessions.
- **`sessions/lifecycle/bootstrapper.rs`** — 9 tests exist, but `cancellation.rs` (4 tests) and `finalizer.rs` (7 tests) could use more edge-case coverage around concurrent operations.

**Why this matters:** Session creation, cancellation, and cleanup are the most critical user-facing flows. Bugs here lose user work or leak resources.

### 2. Rust: Database Layer (infrastructure/database/)

- **`connection.rs`** — Has `#[cfg(test)]` but 0 `#[test]` functions. The WAL + connection pooling logic is untested.
- **`db_schema.rs`** — 1 test. Schema migrations are critical for upgrades.
- **`db_archived_specs.rs`** — 0 tests.
- **`db_epics.rs`** — 0 tests.
- **`db_specs.rs`** — 0 tests.
- **`timestamps.rs`** — 0 tests.

**Why this matters:** Database bugs can corrupt user data and are hard to diagnose in production.

### 3. Rust: Git Operations (domains/git/)

- **`worktrees.rs`** — Only 6 tests for the foundational worktree operations (create, remove, list). This is the core isolation mechanism.
- **`branches.rs`** — 1 test. Branch operations affect session identity.
- **`clone.rs`** — 3 tests. Project onboarding path.
- **`history.rs`** — 3 tests. Feeds the git graph UI.
- **`db_git_stats.rs`** — 0 tests.

**Why this matters:** Git worktree management is the defining feature. A worktree bug could delete a user's uncommitted work.

### 4. Frontend: Integration Contexts (No Tests at All)

These context providers manage critical external service integrations:

- **`GithubIntegrationContext.tsx`** — 0 tests
- **`GitlabIntegrationContext.tsx`** — 0 tests
- **`ForgeIntegrationContext.tsx`** — 0 tests
- **`RunContext.tsx`** — 0 tests
- **`ModalContext.tsx`** — 0 tests
- **`KeyboardShortcutsContext.tsx`** — 0 tests

Corresponding hooks are also untested:
- `useGithubIntegration.ts`, `useGitlabIntegration.ts`, `useForgeIntegration.ts`
- `useEpics.ts`, `useKeyboardShortcuts.ts`

**Why this matters:** These manage API calls, authentication state, and error handling for GitHub/GitLab. Regressions silently break forge features.

---

## Priority 2: Moderate Gaps

### 5. Rust: Merge Domain (domains/merge/)

- **`lock.rs`** — 0 tests. Merge locking prevents concurrent merge corruption.
- **`service.rs`** — 11 tests, but merge is a destructive operation (squash/rebase into main) that deserves more edge-case coverage (conflicts, partial failures, rollback).
- **`types.rs`** — 3 tests.

### 6. Rust: Power/Security Domain

- **`global_service.rs`** — 0 tests. Power management (keep-awake) for long-running agents.
- **`security.rs`** — 4 tests. Security validation for power commands needs more coverage.
- **Platform-specific files** (`linux.rs`, `macos.rs`, `windows.rs`) — 0 tests each.

### 7. Rust: Settings Domain

- **`setup_script.rs`** — 0 tests. Setup scripts run arbitrary commands in user's environment.
- **`validation.rs`** — 0 tests. Settings validation protects against invalid config.
- **`types.rs`** — 0 tests.
- `service.rs` has 38 tests, which is good.

### 8. Frontend: Diff Viewer Components

The diff viewer is a complex, performance-critical UI:

- **`UnifiedDiffView.tsx`** — No tests (the main rendering component)
- **`PierreDiffViewer.tsx`** — No tests (alternative diff renderer)
- **`PierreDiffProvider.tsx`** — No tests
- **`virtualization.ts`** — No tests (pagination/virtualization logic)
- **`DiffSessionActions.tsx`** — No tests

While there are 29 test files for diff subcomponents, the main view components that compose them lack integration-level tests.

### 9. Frontend: Terminal Infrastructure

- **`TerminalTransport.ts`** — No tests. The transport layer between frontend and PTY.
- **`PluginTransport.ts`** — No tests.
- **`backend.ts`** (terminal transport) — No tests.
- **`transportFlags.ts`** — No tests.
- **`gpuRendererRegistry.ts`** — No tests.

### 10. MCP Server: Untested Bridge Methods

16 of 30 public methods in `lucode-bridge.ts` lack tests:

- `cancelSession`, `convertToSpec`, `createEpic`, `deleteDraftSession`
- `executeProjectRunScript`, `getCurrentTasks`, `listDraftSessions`
- `listEpics`, `listSessionsByState`, `markSessionReviewed`
- `sendFollowUpMessage`, and 5 others

The MCP tool handler logic in `lucode-mcp-server.ts` (1,885 lines) has minimal direct testing.

---

## Priority 3: Nice-to-Have

### 11. Frontend: Store Atoms Missing Tests

Several Jotai atoms lack tests:

- `copyContextSelection.ts`, `diffCompareMode.ts`, `epics.ts`
- `forge.ts`, `preview.ts`, `rightPanelTab.ts`
- `createSettingsListAtoms.ts` (shared factory)

### 12. Frontend: i18n System

The entire translation infrastructure is untested:
- `common/i18n/index.ts`, `types.ts`, `useTranslation.ts`

### 13. Rust: Infrastructure

- **`infrastructure/attention_bridge.rs`** — 0 tests
- **`infrastructure/keep_awake_bridge.rs`** — 0 tests
- **`infrastructure/pty.rs`** — 0 tests (PTY spawning)

### 14. Rust: MCP API Layer

- **`mcp_api.rs`** and **`mcp_api/diff_api.rs`** — `diff_api.rs` has 7 tests, but the main `mcp_api.rs` (REST API routing) has no direct tests.

---

## Recommendations (Ordered by Impact)

1. **Session lifecycle + cleanup tests** (Rust) — Add integration tests for the full session create → agent run → cancel/merge → cleanup flow. Especially test `process_cleanup.rs` to verify no OS process leaks.

2. **Database layer tests** (Rust) — Add tests for schema migrations, connection pooling edge cases, and all DB gateway modules (`db_specs.rs`, `db_epics.rs`, `db_archived_specs.rs`).

3. **Git worktree edge cases** (Rust) — Test concurrent worktree operations, cleanup on failure, and worktree-on-worktree scenarios.

4. **Integration context + hook tests** (Frontend) — Test GitHub/GitLab/Forge integration contexts with mocked API responses, especially error handling and auth flows.

5. **Merge domain hardening** (Rust) — Test merge lock contention, conflict detection, partial failure recovery.

6. **MCP bridge methods** (TypeScript) — Cover the 16 untested methods, especially `cancelSession`, `executeProjectRunScript`, and `sendFollowUpMessage`.

7. **Settings validation** (Rust) — Test `validation.rs` and `setup_script.rs` to ensure invalid or malicious settings are rejected.

8. **Diff viewer integration tests** (Frontend) — Test the main `UnifiedDiffView` and `PierreDiffViewer` rendering with various diff payloads.

9. **Terminal transport layer** (Frontend) — Test the transport between xterm.js and the PTY backend.

10. **Session sorting/caching** (Rust) — Test `sorting.rs` and `cache.rs` to prevent sidebar ordering bugs.
