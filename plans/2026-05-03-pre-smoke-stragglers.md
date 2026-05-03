# Phase 8 Pre-Smoke Stragglers — Repo Audit

**Scope:** Full-repo grep audit (excluding `node_modules/`, `target/`, `.git/`) for residual references to v1 task-flow vocabulary that the `arch_no_v1_session_leakage` test cannot catch (string literals, JSON keys, comments, fixtures, docs, plans, `src-tauri/`).

**Source patterns:**
1. `"spec session"` (case-insensitive)
2. `session-as-spec`
3. `convertToSpec` / `convert_to_spec`
4. `NewSession` (case-sensitive, word boundary)
5. `NewSpec` (case-sensitive, word boundary)
6. `version_group` / `versionGroup`
7. `is_spec` (session-shape field — see notes)
8. `RunRole`
9. `TaskRunStatus`
10. `setOpenAsSpec` / `openAsSpec`
11. `KeyboardShortcutAction.NewSpec` / `KeyboardShortcutAction.NewSession`
12. Retired Tauri command names (`lucode_task_capture_session`, `lucode_task_capture_version_group`)
13. Retired migrations (`v1_to_v2_specs_to_tasks`, `sessions_v1_specs_to_tasks_archive`)

**Classification legend:**
- **legitimate** — valid v2 surface (the term means a v2-supported concept)
- **dead-string** — comment / tombstone narration in source; harmless but stale
- **actual-leak** — production code or active test that references a retired symbol; needs a follow-up fix
- **plan-reference** — `plans/`, `docs-site/`, or design doc reference; informational only
- **archived/test-fixture** — fixture/integration test seeding session shape; OK

---

## Pattern 1 — `"spec session"` (case-insensitive)

The term “spec session” is still the human-readable label for v2's Spec-stage tasks (the session is bound to a Task at Draft/Spec stage). Backend method names like `start_spec_session`, log lines like `"Created spec session via API"`, and MCP tool descriptions are all current v2 vocabulary — the v2 architecture still has spec-shape sessions (just bound to a Task aggregate). These are **legitimate**.

| File:line | Trimmed line | Classification |
|---|---|---|
| mcp-server/src/lucode-bridge.ts:1351 | `throw new Error(\`Failed to start spec session: …\`)` | legitimate |
| mcp-server/src/lucode-bridge.ts:1373 | `console.error('Failed to start spec session via API:', error)` | legitimate |
| mcp-server/src/lucode-bridge.ts:1391 | `console.error('Failed to delete spec session via API:', error)` | legitimate |
| mcp-server/src/lucode-bridge.ts:1412 | `console.error('Failed to list spec sessions via API:', error)` | legitimate |
| mcp-server/src/lucode-mcp-server.ts:567,573,594,600,627,633,649,670,690,800,822,844,1417,1661,1765,1767,1782,1798,2297,2298,2304 | MCP tool descriptions and summaries for spec-session lifecycle (`Create a spec session…`, `Spec session name…`, etc.) | legitimate |
| mcp-server/src/lucode-mcp-server.ts:960 | `…rejects spec sessions, unresolved conflicts…` (merge gate) | legitimate |
| mcp-server/src/lucode-mcp-server.ts:988 | `Spec sessions are not eligible for PR creation.` | legitimate |
| mcp-server/src/lucode-mcp-server.ts:1090 | `Spec sessions are not eligible for merging.` | legitimate |
| mcp-server/test/tool-handlers.test.ts:580 | `expect(text?.text).toContain('No spec sessions found')` | legitimate |
| mcp-server/test/diff-tools-integration.test.ts:368 | `it('reports persisted spec content length when creating spec sessions', …)` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:1811 | `message: "Cannot update a spec session".to_string(),` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:1892 | `.ok_or_else(|| "Spec session not found after restore".to_string())?;` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:4328 | `.map_err(|e| format!("Failed to create spec session: {e}"))?;` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:4355 | `"Spec session not found after creation; inconsistent spec/session sync"` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:4358 | `log::info!("Queueing sessions refresh after creating spec session");` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:4504 | `log::info!("Renaming spec session from '{old_name}' to '{new_name}'");` | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs:4511 | `.map_err(|e| format!("Failed to rename spec session: {e}"))?;` | legitimate |
| src-tauri/src/commands/github.rs:430 | `return Err("Cannot create PR for a spec session. Start the session first.".to_string());` | legitimate |
| src-tauri/src/commands/github.rs:663 | (same) | legitimate |
| src-tauri/src/commands/forge.rs:422 | `return Err("Cannot create PR/MR for a spec session…")` | legitimate |
| src-tauri/src/commands/gitlab.rs:651 | `return Err("Cannot create MR for a spec session…")` | legitimate |
| src-tauri/src/mcp_api.rs:6952,6960,7461,7472,7490,7495,7970,7987 | API log lines (`Created/Started/Deleted spec session via API`) | legitimate |
| src-tauri/src/domains/sessions/utils.rs:225 | `"Removing orphaned worktree: {} (no matching non-spec session found)"` | legitimate |
| src-tauri/src/domains/sessions/entity.rs:149 | `/// Phase 3 Wave F: identity axis. true for spec sessions (drafts…)` | legitimate |
| src-tauri/src/domains/sessions/repository.rs:591 | `.map_err(|e| anyhow!("Failed to rename spec session: {e}"))` | legitimate |
| src-tauri/src/domains/sessions/service.rs:1004 | `// Create a spec session, then start it (Spec -> Running; gates resume)` | legitimate |
| src-tauri/src/domains/sessions/service.rs:3330 | `log::info!("Cancel {name}: Archiving spec session instead of cancelling");` | legitimate |
| src-tauri/src/domains/sessions/service.rs:3440 | `"Cannot cancel spec session '{name}'. Use archive or delete spec operations instead."` | legitimate |
| src-tauri/src/domains/sessions/service.rs:3891 | `// session.session_state which for a spec session` | legitimate |
| src-tauri/src/domains/sessions/service.rs:5380 | `// Create new spec session` | legitimate |
| src-tauri/src/domains/sessions/lifecycle/cancellation.rs:172,365,430,512,986 | Same "Cannot cancel spec session" gate text | legitimate |
| src-tauri/src/domains/sessions/db_sessions.rs:920 | `return Err(anyhow::anyhow!("Can only rename spec sessions"));` | legitimate |
| src-tauri/src/domains/sessions/db_sessions.rs:2501,2509 | Round-trip test comment + assertion message | legitimate |
| src-tauri/src/domains/sessions/sorting.rs:96,261,283,347 | Test comments (sorting fixtures) | legitimate |
| src-tauri/src/schaltwerk_core/tests.rs:1415,1421,1444,1460,1466,1586,1592,1603,1826,1841 | Test comments seeding/asserting spec sessions | legitimate |
| src-tauri/src/store/atoms/sessions.ts:1594 | `logger.warn('[SessionsAtoms] Failed to reload after TerminalAgentStarted for spec session:', error)` | legitimate |
| src/utils/selectionNext.categoryChange.test.ts:118 | `// User switches to Specs filter, only spec sessions visible` | legitimate |
| src/utils/sessionVersions.test.ts:352 | `it('spec sessions are not counted as idle', …)` | legitimate |
| src/utils/sessionFilters.test.ts:31 | `it('isSpec should correctly identify spec sessions', …)` | legitimate |
| src/store/atoms/sessions.test.ts:546 | `it('ignores SpecClarificationActivity for non-spec sessions', …)` | legitimate |
| src/store/atoms/sessions.test.ts:1477 | `it('reloads spec sessions when clarification starts', …)` | legitimate |
| src/store/atoms/selection.test.ts:1001 | `it('skips terminal creation for spec sessions', …)` | legitimate |
| src/hooks/useSessionPrefill.ts:40 | `// Check spec_content first (for spec sessions), then draft_content, then initial_prompt` | legitimate |
| src/hooks/useSpecContent.test.tsx:43 | `it('returns cached content for a spec session immediately', …)` | legitimate |
| src/hooks/useAttentionNotifications.test.ts:274 | `it('returns false for spec sessions', …)` | legitimate |
| src/hooks/useSpecContentCache.test.tsx:173 | `it('always fetches content for spec sessions (not cached)', …)` | legitimate |
| src/hooks/useUpdateSessionFromParent.test.ts:309 | `message: 'Cannot update a spec session',` | legitimate |
| src/hooks/useUpdateSessionFromParent.test.ts:390 | `it('updates every non-spec session and skips specs', …)` | legitimate |
| src/hooks/useSpecMode.test.ts:314 | `it('should identify spec sessions correctly', …)` | legitimate |
| src/components/sidebar/SessionCard.test.tsx:399,870,1047 | Test descriptions for spec-session UI variants | legitimate |
| src/components/right-panel/RightPanelTabs.test.tsx:202,428 | Test descriptions for spec-session right-panel behavior | legitimate |
| src/components/right-panel/RightPanelTabs.tsx:206 | `// Get spec sessions for workspace` | legitimate |
| docs-site/guides/orchestrator.mdx:78,97 | User-facing docs explaining spec-session orchestration | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-smoke.md:141,155,158,189 | Plan/smoke walkthrough references | plan-reference |
| plans/2026-04-29-task-flow-v2-status.md:806 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-4-plan.md:1363 | Plan body (lifecycle table) | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:49 | Audit body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-3-plan.md:511 | Plan body (test name) | plan-reference |
| plans/2026-04-13-relocate-merge-checks-design.md:5 | Older design doc | plan-reference |

---

## Pattern 2 — `session-as-spec`

| File:line | Trimmed line | Classification |
|---|---|---|
| _no hits_ | — | — |

---

## Pattern 3 — `convertToSpec` / `convert_to_spec`

The MCP tool `lucode_convert_to_spec` and the v2 service method `convert_session_to_spec` (bound to `KeyboardShortcutAction.ConvertSessionToSpec`, `Mod+S`) are still active in v2. The i18n block + bridge method are legitimate.

| File:line | Trimmed line | Classification |
|---|---|---|
| CLAUDE.md:58 | `- Running → Spec: \`convert_to_spec()\` removes worktree, keeps content` | legitimate |
| mcp-server/src/schemas.ts:696 | `lucode_convert_to_spec: { …` | legitimate |
| mcp-server/src/lucode-bridge.ts:1025 | `2. SAFER ALTERNATIVE: Use lucode_convert_to_spec instead` | legitimate |
| mcp-server/src/lucode-bridge.ts:2015 | `async convertToSpec(sessionName: string, projectPath?: string): Promise<void> {` | legitimate |
| mcp-server/src/lucode-mcp-server.ts:547,794,944,956,2054,2055,2057,2059,2060 | Tool registration + handler for `lucode_convert_to_spec` | legitimate |
| mcp-server/test/bridge-methods.test.ts:640,645,656,663 | Test suite for `convertToSpec` bridge method | legitimate |
| mcp-server/test/tool-handlers.test.ts:96,217,250,437,438,439,441 | Test suite for `lucode_convert_to_spec` tool handler | legitimate |
| mcp-server/test/schemas.test.ts:250 | `lucode_convert_to_spec: { …` | legitimate |
| src/locales/en.json:38 | `"convertToSpec": {` (modal i18n block) | legitimate |
| src/locales/zh.json:38 | (same, zh-CN) | legitimate |
| src/common/i18n/types.ts:42 | `convertToSpec: { …` (TS shape for the i18n block) | legitimate |
| plans/2026-04-29-task-flow-v2-phase-6-plan.md:49,70,129,267 | Phase 6 plan references to `convertToSpecModal`, `useConvertToSpecController` | plan-reference |
| plans/test-coverage-analysis.md:113 | Older test-coverage doc | plan-reference |

---

## Pattern 4 — `NewSession` (word boundary)

`KeyboardShortcutAction.NewSession` was collapsed to `NewTask`; the global enum now contains `NewTask` only (verified at `config.ts:29`). However, the **terminal-scope keybinding enum still ships `TerminalCommand.NewSession` and `TerminalCommand.NewSpec`**, contradicting Phase 8 W.2's prescription to retire `NewSpec` and rename `NewSession → NewTask` in `terminalKeybindings.ts`. Those rows are `actual-leak`.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/App.tsx:500 | `// Phase 8 W.2: NewSession + NewSpec collapsed onto NewTask. The` | dead-string |
| src/App.tsx:1558 | `// Phase 8 W.2: NewSession + NewSpec shortcuts collapsed onto a` | dead-string |
| src/keyboardShortcuts/config.ts:27 | `// Phase 8 W.2: NewSession + NewSpec collapsed to a single NewTask` | dead-string |
| src/components/terminal/Terminal.tsx:1657 | `// Phase 8 W.2: NewSession + NewSpec shortcuts collapsed into a` | dead-string |
| src/components/terminal/terminalKeybindings.ts:9 | `NewSession = 'terminal.newSession',` | actual-leak |
| src/components/terminal/terminalKeybindings.ts:21 | `TerminalCommand.NewSession,` (in `COMMANDS_TO_SKIP_SHELL`) | actual-leak |
| src/components/terminal/terminalKeybindings.ts:42 | `return { matches: true, commandId: TerminalCommand.NewSession };` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:29 | `it('should match Cmd+N as NewSession on Mac', …)` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:37 | `expect(result.commandId).toBe(TerminalCommand.NewSession);` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:141 | `expect(shouldSkipShell(TerminalCommand.NewSession)).toBe(true);` | actual-leak |
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:29,38 | Allowlist self-reference (the arch test names retired symbols to assert their absence) | legitimate |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:92,99,101,344,418 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:30,32,39,70,168,178 | Audit body | plan-reference |

---

## Pattern 5 — `NewSpec` (word boundary)

Same as Pattern 4: production usage in `terminalKeybindings.ts` plus its test file is `actual-leak`. Other source-tree hits are tombstone comments narrating the W.2 collapse — these are noise (`dead-string`). Plan/audit references are `plan-reference`. The arch test self-references the retired symbol on purpose to assert its absence — `legitimate`.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/App.tsx:500 | `// Phase 8 W.2: NewSession + NewSpec collapsed onto NewTask. The` | dead-string |
| src/App.tsx:532 | `// openAsDraft / setOpenAsSpec retired in Phase 8 W.2 (NewSpec gone).` | dead-string |
| src/App.tsx:1558 | `// Phase 8 W.2: NewSession + NewSpec shortcuts collapsed onto a` | dead-string |
| src/keyboardShortcuts/config.ts:27 | `// Phase 8 W.2: NewSession + NewSpec collapsed to a single NewTask` | dead-string |
| src/components/terminal/Terminal.tsx:1657 | `// Phase 8 W.2: NewSession + NewSpec shortcuts collapsed into a` | dead-string |
| src/components/terminal/terminalKeybindings.ts:10 | `NewSpec = 'terminal.newSpec',` | actual-leak |
| src/components/terminal/terminalKeybindings.ts:22 | `TerminalCommand.NewSpec,` (in `COMMANDS_TO_SKIP_SHELL`) | actual-leak |
| src/components/terminal/terminalKeybindings.ts:38 | `return { matches: true, commandId: TerminalCommand.NewSpec };` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:18 | `it('should match Cmd+Shift+N as NewSpec on Mac', …)` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:26 | `expect(result.commandId).toBe(TerminalCommand.NewSpec);` | actual-leak |
| src/components/terminal/terminalKeybindings.test.ts:142 | `expect(shouldSkipShell(TerminalCommand.NewSpec)).toBe(true);` | actual-leak |
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:29,39 | Allowlist self-reference | legitimate |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:92,99,101,119,344,374,418,447 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:20,31,33,34,37,39,68,71,168,178 | Audit body | plan-reference |

---

## Pattern 6 — `version_group` / `versionGroup`

`version_group_id` is a **current v2 field** on `Session` (carried into `consolidation_rounds` for multi-candidate task runs). It is *not* retired. Phase 7 plan demoted it from a top-level UI grouping to an intra-task-row concern; the field stays in the schema and on the wire. All Rust struct-init / SQL / wire-level hits are `legitimate`. The retired front-end helper `versionGroupings.ts` no longer exists in `src/components/sidebar/helpers/`; remaining mentions are plan tombstones. The `design/style-guide.pen` file is a Pencil design source — those `versionGroup*` names are design tokens (`archived/test-fixture` per design source).

To keep this section readable, hits are summarized per-file rather than per-line.

| File (count) | Classification |
|---|---|
| src-tauri/src/domains/sessions/entity.rs (2) | legitimate |
| src-tauri/src/domains/sessions/repository.rs (~20) | legitimate |
| src-tauri/src/domains/sessions/service.rs (~25) | legitimate |
| src-tauri/src/domains/sessions/db_sessions.rs (~20) | legitimate |
| src-tauri/src/domains/sessions/lifecycle/cancellation.rs (3) | legitimate |
| src-tauri/src/domains/sessions/lifecycle/finalizer.rs (1) | legitimate |
| src-tauri/src/domains/sessions/facts_recorder.rs (1) | legitimate |
| src-tauri/src/domains/sessions/sorting.rs (1) | legitimate |
| src-tauri/src/domains/sessions/activity.rs (3) | legitimate |
| src-tauri/src/domains/sessions/action_prompts.rs (1) | legitimate |
| src-tauri/src/domains/sessions/consolidation_stub.rs (1) | legitimate |
| src-tauri/src/domains/tasks/orchestration.rs (3) | legitimate |
| src-tauri/src/domains/tasks/wire.rs (1) | legitimate |
| src-tauri/src/domains/merge/service.rs (~36) | legitimate |
| src-tauri/src/commands/schaltwerk_core.rs (~14) | legitimate |
| src-tauri/src/commands/tasks.rs (2) | legitimate |
| src-tauri/src/mcp_api.rs (~70) | legitimate |
| src-tauri/src/mcp_api/diff_api.rs (1) | legitimate |
| src-tauri/src/diff_commands.rs (1) | legitimate |
| src-tauri/src/services/sessions.rs (1) | legitimate |
| src-tauri/src/infrastructure/session_facts_bridge.rs (1) | legitimate |
| src-tauri/src/infrastructure/database/db_schema.rs (5) | legitimate |
| src-tauri/src/infrastructure/database/migrations/v1_to_v2_run_role.rs (4) | legitimate |
| src-tauri/src/infrastructure/database/migrations/v2_drop_session_legacy_columns.rs (4) | legitimate |
| src-tauri/src/main.rs (5) | legitimate |
| src-tauri/src/schaltwerk_core/tests.rs (~20) | legitimate |
| src-tauri/src/shared/session_metadata_gateway.rs (1) | legitimate |
| src-tauri/tests/e2e_task_lifecycle_full.rs (1) | archived/test-fixture |
| src-tauri/tests/e2e_run_lifecycle.rs (1) | archived/test-fixture |
| src-tauri/tests/e2e_run_failure.rs (1) | archived/test-fixture |
| src-tauri/tests/run_status_integration.rs (1) | archived/test-fixture |
| mcp-server/src/lucode-bridge.ts (3) | legitimate |
| mcp-server/src/lucode-mcp-server.ts (2) | legitimate |
| mcp-server/src/schemas.ts (4) | legitimate |
| mcp-server/test/bridge-methods.test.ts (2) | legitimate |
| mcp-server/test/project-routing.test.ts (2) | legitimate |
| mcp-server/test/tool-handlers.test.ts (2) | legitimate |
| mcp-server/test/schemas.test.ts (2) | legitimate |
| src/store/atoms/sessions.ts (2) | legitimate |
| src/store/atoms/sessions.test.ts (8) | legitimate |
| src/hooks/useAttentionNotifications.test.ts (~14) | legitimate |
| src/hooks/useSpecContent.test.tsx (1) | legitimate |
| src/components/modals/SettingsModal.tsx (2) | legitimate |
| src/common/i18n/types.ts (2) | legitimate |
| src/common/uiEvents.ts (2) | legitimate |
| src/components/sidebar/Sidebar.tsx (1) | dead-string (comment listing retired helpers) |
| src/utils/sessionVersions.ts (4) | legitimate |
| src/locales/en.json:342–343 + zh.json:342–343 | legitimate (Settings UI label "Version group rename agent") |
| CHANGES.md:299 | legitimate (changelog body) |
| design/style-guide.pen (~120 hits) | archived/test-fixture (Pencil design tokens; not code) |
| docs/plans/2026-04-20-remove-candidate-count-from-improve-plan-design.md:61 | plan-reference |
| plans/2026-04-29-task-flow-v2-status.md:522,572,597 | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-plan.md:46 | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-6-plan.md:55,108,177 | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-2-plan.md:44 | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:60 | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:106,107 | plan-reference |
| plans/2026-05-02-task-flow-v2-phase-8-status.md:22 | plan-reference |

---

## Pattern 7 — `is_spec`

`is_spec: bool` is the **canonical v2 session-shape field** (Phase 3 introduced it as the orthogonal identity axis to replace the v1 `SessionStatus` enum). Every struct initializer, SELECT/INSERT binding, hydrator field read, branch predicate, test fixture, and migration body that mentions `is_spec` is using the v2 production shape. Roughly **300+ hits across `src-tauri/`** — all `legitimate`. None of them are leaks.

The frontend (`src/`, `mcp-server/`) does **not** reference `is_spec`; it consumes the wire-format string via `SessionInfo.session_state` instead. There are zero frontend hits and zero `actual-leak` hits.

| Aggregate | Classification |
|---|---|
| `src-tauri/src/domains/sessions/**` (~150 hits across `entity.rs`, `service.rs`, `db_sessions.rs`, `repository.rs`, `lifecycle/cancellation.rs`, `lifecycle/finalizer.rs`, `sorting.rs`, `stage.rs`, `activity.rs`, `action_prompts.rs`, `facts_recorder.rs`, `utils.rs`, `consolidation_stub.rs`) | legitimate |
| `src-tauri/src/domains/tasks/**` (~10 hits across `service.rs`, `orchestration.rs`, `wire.rs`, `auto_advance.rs`) | legitimate |
| `src-tauri/src/domains/merge/service.rs` (~6) | legitimate |
| `src-tauri/src/commands/**` (~14 hits across `schaltwerk_core.rs`, `tasks.rs`, `forge.rs`, `gitlab.rs`, `github.rs`) | legitimate |
| `src-tauri/src/mcp_api.rs` + `mcp_api/diff_api.rs` (~30) | legitimate |
| `src-tauri/src/infrastructure/database/db_schema.rs` + `migrations/v1_to_v2_run_role.rs` + `migrations/v2_drop_session_legacy_columns.rs` + `migrations/v1_to_v2_session_status.rs` (~50) | legitimate |
| `src-tauri/src/infrastructure/session_facts_bridge.rs` (1) | legitimate |
| `src-tauri/src/shared/session_metadata_gateway.rs` (1) | legitimate |
| `src-tauri/src/schaltwerk_core/tests.rs` (~5) | legitimate |
| `src-tauri/tests/**` (5 fixtures: `e2e_task_lifecycle_full.rs`, `e2e_run_lifecycle.rs`, `e2e_run_failure.rs`, `run_status_integration.rs`, `arch_hydrator_completeness.rs`) | archived/test-fixture |
| `plans/**` (~40 hits across phase-3, phase-4, phase-7, phase-8 plan bodies) | plan-reference |

---

## Pattern 8 — `RunRole`

The `RunRole` enum was deleted in Phase 3 Wave D. Production code now has only doc-comment tombstones referencing it (the `SlotKind` successor's docs explain "Phase 3 successor to `RunRole`"). All remaining `src-tauri/src/` hits are dead-string comments; no enum/field/import survives.

| File:line | Trimmed line | Classification |
|---|---|---|
| src-tauri/src/domains/tasks/orchestration.rs:510 | `/// values v1's \`RunRole::as_str()\` produced, so the wire format is` | dead-string |
| src-tauri/src/domains/tasks/orchestration.rs:512 | `/// \`RunRole\` enum.` | dead-string |
| src-tauri/src/domains/tasks/entity.rs:170 | `/// **Phase 3 successor to \`RunRole\`.** Unlike v1's \`RunRole\`, this enum is:` | dead-string |
| src/types/task.ts:10 | `// - There is no \`RunRole\`. The slot identifier is \`slot_key: string \| null\`` | dead-string |
| src/types/task.test.ts:4 | `// no \`'queued'\` literal, no \`RunRole\`, \`TaskStage\` does not include` | dead-string |
| plans/** (~40 hits across phase-1, phase-2, phase-3, phase-7, design, status docs) | plan-reference |

---

## Pattern 9 — `TaskRunStatus`

`TaskRunStatus` is a **live v2 enum** (defined at `src-tauri/src/domains/tasks/entity.rs:133`). It is the wire format and the return type of `compute_run_status`. The design intent was "no `Queued` variant + never persisted as a column"; both invariants hold. All hits are `legitimate` (production callers + tests) or plan references.

| Aggregate | Classification |
|---|---|
| `src-tauri/src/domains/tasks/{entity,run_status,runs,reconciler,service,wire,orchestration,mod}.rs` (~60) | legitimate |
| `src-tauri/src/services/mod.rs:64` (re-export) | legitimate |
| `src-tauri/src/commands/tasks.rs` (3) | legitimate |
| `src-tauri/tests/{e2e_task_lifecycle_full,e2e_run_lifecycle,e2e_run_failure,e2e_legacy_migration_then_read,run_status_integration}.rs` (~30) | archived/test-fixture |
| `src/types/task.ts` (~5) | legitimate |
| `src/types/task.test.ts` (~5) | legitimate |
| `src/components/sidebar/TaskRunRow.tsx` (2) | legitimate |
| `src/components/sidebar/TaskRunRow.test.tsx` (3) | legitimate |
| `plans/**` (many) | plan-reference |

---

## Pattern 10 — `setOpenAsSpec` / `openAsSpec`

The state was retired in Phase 8 W.2. One tombstone comment remains in `App.tsx`. No production code call sites; no test references. All `setOpenAsSpec(...)` invocations exist only in plan/audit bodies.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/App.tsx:532 | `// openAsDraft / setOpenAsSpec retired in Phase 8 W.2 (NewSpec gone).` | dead-string |
| plans/2026-04-29-task-flow-v2-phase-7-plan.md:62,399 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:88,342,343 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:16,30,31,50,51,64,68,70,71,72,73,74,75,76,77,78,88,148,158 | Audit body | plan-reference |

---

## Pattern 11 — `KeyboardShortcutAction.NewSpec` / `KeyboardShortcutAction.NewSession`

The enum collapse to `NewTask` is complete in `src/keyboardShortcuts/config.ts` (only `NewTask` remains; `NewSpec` and `NewSession` are gone from the enum). The arch test names them as a denylist self-reference. No production leak.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:38 | `{ symbol: 'KeyboardShortcutAction.NewSession', rationale: 'collapsed into NewTask in W.2' },` | legitimate |
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:39 | `{ symbol: 'KeyboardShortcutAction.NewSpec', rationale: 'collapsed into NewTask in W.2' },` | legitimate |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:92,119,344,374,447 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:30,31,32,33 | Audit body | plan-reference |

---

## Pattern 12 — `lucode_task_capture_session` / `lucode_task_capture_version_group`

These Tauri commands were removed in Phase 8 W.3 per `plans/2026-05-02-task-flow-v2-phase-8-status.md:40`. No production code references remain; the arch test names them in its denylist. All other hits are plan/audit bodies.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:30 | `// \`.NewTask\` in W.2; \`lucode_task_capture_session\` and friends went in` | legitimate |
| plans/2026-05-02-task-flow-v2-phase-8-status.md:40 | Status body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-smoke.md:208 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-plan.md:77,400,401,609 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:142,377 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:22 | Audit body | plan-reference |

---

## Pattern 13 — `v1_to_v2_specs_to_tasks` / `sessions_v1_specs_to_tasks_archive`

The migration + its forensics archive table were deleted in Phase 8 W.4 per `plans/2026-05-02-task-flow-v2-phase-8-status.md:46`. No production code references remain; the arch test names them in its denylist. All other hits are plan/audit bodies.

| File:line | Trimmed line | Classification |
|---|---|---|
| src/components/__tests__/arch_no_v1_session_leakage.test.ts:31 | `// W.3; \`v1_to_v2_specs_to_tasks\` is the W.4 retiree.` | legitimate |
| plans/2026-05-02-task-flow-v2-phase-8-status.md:46 | Status body | plan-reference |
| plans/2026-05-02-task-flow-v2-phase-8-smoke.md:135 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-smoke.md:169 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-7-plan.md:423 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-phase-8-legacy-purge.md:159,163,164 | Plan body | plan-reference |
| plans/2026-04-29-task-flow-v2-smoke-fail-A.1-audit.md:22 | Audit body | plan-reference |

---

## Summary

| Classification | Count (approx.) | Notes |
|---|---|---|
| legitimate | ~700 | dominated by `is_spec` (~300), `version_group_id` (~250 backend), MCP-server "spec session" descriptions, and `TaskRunStatus` |
| dead-string | 9 | tombstone comments (`App.tsx` ×3, `keyboardShortcuts/config.ts` ×1, `Terminal.tsx` ×1, `Sidebar.tsx` ×1, `orchestration.rs` ×2, `entity.rs` ×1, plus 2 in `src/types/task.ts` and `src/types/task.test.ts`) |
| **actual-leak** | **11** | all in `src/components/terminal/terminalKeybindings.{ts,test.ts}` — Phase 8 W.2 prescribed retiring `NewSpec` and renaming `NewSession → NewTask` here, but the file still ships both legacy enum members and their match arms |
| plan-reference | ~250 | `plans/**`, `docs-site/**`, `docs/**`, `CHANGES.md` |
| archived/test-fixture | ~10 backend test files + ~120 hits in `design/style-guide.pen` | session-fixture rows in `src-tauri/tests/*` and design tokens in the Pencil source |

---

## Action items (post-smoke fix candidates)

The 11 `actual-leak` hits all live in two files. The fix is the W.2 follow-through that the legacy-purge plan called for: collapse `TerminalCommand.NewSession`/`NewSpec` into a single `TerminalCommand.NewTask` and update the keybinding match table so both `Mod+N` and `Mod+Shift+N` emit it.

1. `src/components/terminal/terminalKeybindings.ts:9` — `NewSession = 'terminal.newSession',` → rename to `NewTask = 'terminal.newTask'`.
2. `src/components/terminal/terminalKeybindings.ts:10` — `NewSpec = 'terminal.newSpec',` → delete.
3. `src/components/terminal/terminalKeybindings.ts:21` — `TerminalCommand.NewSession,` (in `COMMANDS_TO_SKIP_SHELL`) → rename to `TerminalCommand.NewTask`.
4. `src/components/terminal/terminalKeybindings.ts:22` — `TerminalCommand.NewSpec,` → delete from `COMMANDS_TO_SKIP_SHELL`.
5. `src/components/terminal/terminalKeybindings.ts:38` — `return { matches: true, commandId: TerminalCommand.NewSpec };` → return `TerminalCommand.NewTask` (collapse both `Mod+Shift+N` and `Mod+N` arms onto NewTask).
6. `src/components/terminal/terminalKeybindings.ts:42` — `return { matches: true, commandId: TerminalCommand.NewSession };` → return `TerminalCommand.NewTask`.
7. `src/components/terminal/terminalKeybindings.test.ts:18` — `it('should match Cmd+Shift+N as NewSpec on Mac', …)` → rewrite as `'should match Cmd+Shift+N as NewTask on Mac'`.
8. `src/components/terminal/terminalKeybindings.test.ts:26` — `expect(result.commandId).toBe(TerminalCommand.NewSpec);` → `TerminalCommand.NewTask`.
9. `src/components/terminal/terminalKeybindings.test.ts:29` — `it('should match Cmd+N as NewSession on Mac', …)` → rewrite as `'should match Cmd+N as NewTask on Mac'`.
10. `src/components/terminal/terminalKeybindings.test.ts:37` — `expect(result.commandId).toBe(TerminalCommand.NewSession);` → `TerminalCommand.NewTask`.
11. `src/components/terminal/terminalKeybindings.test.ts:141` and `:142` — replace the two `shouldSkipShell(TerminalCommand.NewSession|NewSpec)` assertions with one assertion against `TerminalCommand.NewTask`.

After applying, also extend `arch_no_v1_session_leakage.test.ts` (already pinning `KeyboardShortcutAction.NewSession`/`NewSpec`) with `TerminalCommand.NewSession` and `TerminalCommand.NewSpec` so a future regression cannot silently re-introduce the terminal-scope variants.
