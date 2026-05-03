# Tomorrow first read

> Read this BEFORE any of the audit docs. It tells you whether smoke is gated, what the ranked fix queue looks like, and what user judgment is needed.

## Smoke walk gating: clear

Walk `pre-smoke-walk-4` against `plans/2026-05-02-task-flow-v2-phase-8-smoke.md` (Phase 8 deltas) + `plans/archive/2026-04-29-task-flow-v2-phase-7-smoke.md` §A (unchanged items).

Nothing in the overnight audits would block any §A.1–§A.9 smoke item. The two patches that landed atop `pre-smoke-walk-3` (terminalKeybindings collapse, TaskArtifactEditor refetch) closed the only known walk-blockers; today's audits found no new ones at the smoke surface.

## Critical / high severity findings

Read the full detail in the cited audit docs.

- **CRITICAL — DB rollback irrecoverable post-cutover.** `v2_drop_session_legacy_columns` physically drops `sessions.status` + `sessions.session_state`. v1 SELECTs name those columns explicitly (no `SELECT *`), so once v2 opens a project DB, v1 cannot reopen it without restoring a backup. The post-merge runbook §7 sequences DB archival AFTER cutover — too late. **Action: amend runbook to back up project DBs BEFORE first v2 open.** Source: `2026-05-03-cutover-risks.md` §7.
- **HIGH — confirm_stage drops typed-sentinel context for confirm_selection + trailing get_task.** `feedback_stamp_after_side_effect.md` violation. Only `advance_stage` honors the doc-comment promise of "merge succeeded but follow-up failed; manual recovery needed." ~5-line fix. Source: `2026-05-03-error-handling-audit.md` H-1.
- **HIGH — TaskRow.handleReopen and Draft promote log to console only, no toast.** Asymmetric UX silent-failure (sibling `cancelTask` has sticky retry toast). Source: `2026-05-03-error-handling-audit.md` H-3.
- **HIGH — MCP port hash + tmux socket collide between v1 and v2 sidecar (Scenario A only).** `main.rs:778-787` MCP port = `8547 + project_path_hash` (no flavor); tmux socket prefix `lucode-v2-` identical across both binaries. v1 and v2 collide if both run concurrently against the same project. Source: `2026-05-03-cutover-risks.md` §3, §5.
- **HIGH (informational, not pre-merge) — 5 frontend deps + 5 transitive bumps for `@modelcontextprotocol/sdk`, `vite`, `happy-dom`.** All patched upstream. ReDoS, DNS rebinding, cross-client leak. Source: `2026-05-03-dep-audit.md`.
- **MEDIUM — projects.rs writes project_history.json + open_tabs.json via `dirs::config_dir().join("lucode")`** — bypasses `app_paths`, not flavor-aware. Recents cross-talk between v1 and v2 sidecar. Source: `2026-05-03-cutover-risks.md` §8.
- **MEDIUM — `notify_task_mutation_with_db` emits stale TasksRefreshed payload after enrichment failure.** Misleading "next read will reconcile" comment because this IS the read. Source: `2026-05-03-error-handling-audit.md` M-2.
- **MEDIUM — 3 phantom frontend enum entries (`ClipboardReadText`, `GetTerminalBacklog`, `SchaltwerkTerminalAcknowledgeOutput`)** point at non-existent backend commands. Verified zero callers — would runtime-error if invoked. Source: `2026-05-03-tauri-command-reachability.md`.

## Pre-merge code-fix queue (post-smoke, pre-merge)

Ordered by impact / cost.

1. **Cutover-day DB backup procedure** (no code, runbook only). Amend `plans/2026-05-03-post-merge-runbook.md` §7 to insert a "back up `~/Library/Application Support/lucode/projects/*/sessions.db` before opening any project in the merged v2 build" step. **Cost: 15 min. Source: `2026-05-03-cutover-risks.md` §7.**
2. **confirm_stage error-context fix** — `H-1` in error-handling. ~5 lines in `src-tauri/src/domains/tasks/orchestration.rs` to wrap `confirm_selection` and trailing `get_task` failures with the same `StageAdvanceFailedAfterMerge`-style typed sentinel that `advance_stage` already uses. **Cost: ~30 min including a regression test. Hot path; user decides whether to land before or after merge.** Source: error-handling §H-1.
3. **TaskRow handleReopen + Draft promote toasts** — `H-3` in error-handling. Mirror the cancelTask flow: catch → push sticky toast with retry → optimistic flip rollback. ~20 lines + test. **Cost: ~1 hour. Source: error-handling §H-3.**
4. **Gap 9 console.* migration** — pre-merge-fix per arch-gap-triage. 2 lines in `src/utils/ptyResizeScheduler.ts:21,51` (`console.log` / `console.warn` → `logger.info` / `logger.warn`) + add an arch pin that fails on any new `console.*` outside `logger.ts`. **Cost: 15 min. Source: `2026-05-03-arch-gap-triage.md` Gap 9.**
5. **Gap 3 Sidebar JSX shape pin** (user-decides; default = pre-merge-fix). Lock the top-level Sidebar children (`SidebarHeaderBar | OrchestratorEntry | SidebarSearchBar | SidebarStageSectionsView | SwitchOrchestratorModal`) so a future regression to dual-mount fails CI. **Cost: 30 min. Source: arch-gap-triage Gap 3.**
6. **Three frontend dep upgrades + dedupe** — see dep-audit pre-merge queue. `bun add -D vite@latest happy-dom@latest && bun update @modelcontextprotocol/sdk`. Verify `just test` after. **Cost: 30 min. Source: `2026-05-03-dep-audit.md`.**

**Total estimated pre-merge cost: ~3 hours of focused work.**

If you're impatient: items 1, 4, 6 are pure cosmetic + runbook + dep bumps; do those even if you defer 2, 3, 5.

## Post-merge-only items

Do NOT land before smoke walk + merge. These are tech-debt items that don't gate cutover and benefit from a clean main as the baseline.

- **MCP port hash + tmux socket flavor isolation** (Scenario A only — only matters if you sidecar v1 alongside v2 dev). Post-merge code change in `mcp_api.rs` port derivation + tmux socket prefix to include `LUCODE_FLAVOR`. Source: cutover-risks §3, §5.
- **Recents file flavor isolation** (`projects.rs`) — `project_history.json` + `open_tabs.json`. Source: cutover-risks §8.
- **Atom orphan cleanup**: `selectedTaskIdAtom`, `selectedTaskAtom`, `mainTaskAtom`, `taskRunsForTaskAtomFamily`, the entire `useTasks` hook — zero production consumers. Source: `2026-05-03-atom-graph.md`.
- **Tauri command retire candidates** — 54 retire candidates including 5 `gitlab_*_mr` + 2 `github_*_pr` left from the unified-forge migration. The `main.rs:1490` "TODO: remove after frontend migration to forge_*" is now actionable. Source: `2026-05-03-tauri-command-reachability.md`.
- **3 phantom frontend enum entries** — `ClipboardReadText`, `GetTerminalBacklog`, `SchaltwerkTerminalAcknowledgeOutput`. Add a build-time check that {enum value set} ⊆ {registered command set} ⊆ {`#[tauri::command]`-decorated set}. Source: tauri-reachability + arch-gap Gap 6.
- **Dead `#[tauri::command]` decorations** in `src-tauri/src/shared/permissions.rs:4,25,59` + `open_apps.rs:1427`. Pure dead code. Source: tauri-reachability.
- **selectionEquals task-kind handling** — line 198 returns `false` early for two `'task'`-kind selections, defeating the early-exit optimization. Spurious re-fires, not stale UI. Post-merge fix. Source: atom-graph.
- **`SidebarHeaderBar.tsx:50 text-[11px]`** → `text-caption`. Pre-existing; preserved verbatim through Phase 7 reshape. Source: `2026-05-03-theme-font-sweep.md`.
- **Gap 7 (`#[allow(dead_code)]` in db_tasks.rs:989)** + **Gap 10 (MCP harness setup)** from arch-gap-triage. Post-merge or batch-with-next-MCP-change.
- **MCP server cosmetic drifts** (3): `lucode_spec_create.base_branch` silently dropped, `lucode_create_pr` schema lists unused fields, `lucode_task_run_done` description references `lucode_task_confirm_stage` as if it were an MCP tool. Source: `2026-05-03-mcp-compat.md`.
- **MCP server build refresh**: `mcp-server/build/` is dated Apr 30 — missing `lucode_task_run_done`. User runs `cd mcp-server && bun run build` before next MCP server restart. Source: mcp-compat.
- **MCP surface expansion** — only `lucode_task_run_done` from the 17+ v2 Task Tauri commands is exposed via MCP. External agents cannot drive the v2 Task lifecycle end-to-end. **Product decision; not a compat issue.** Source: mcp-compat §5.

## User decisions needed

The opinion-locking items from arch-gap-triage. My defaults; flip if you disagree.

1. **Gap 3 — Lock Sidebar JSX shape pin?** Default: **YES (pre-merge-fix)**. Rationale: W.1 just stabilized the structure; pinning now prevents the dual-mount regression class without constraining anything you've signaled you want to change. Override if you want to keep the sidebar shape mutable for a v2.1 polish wave.
2. **Gap 8 — Additive-only schema migration pin?** Default: **NO (no-action)**. Rationale: v2 charter explicitly favored aggressive deletions (W.4 retired `v1_to_v2_specs_to_tasks` outright). Pinning the opposite invariant constrains your freedom to delete in future phases. Override only if you want a compile-time gate against accidentally writing a destructive migration.

## Stretch findings (lower priority)

- **Performance baselines** (`2026-05-03-perf-baselines.md`): bundle -120 KB vs main; 5,865 total tests; v2 task surface introduces ZERO new slow tests. No regression.
- **MCP compat** (`2026-05-03-mcp-compat.md`): all 35 MCP tools work; 0 broken; 0 retired-tools-still-exposed.
- **Theme/font sweep** (`2026-05-03-theme-font-sweep.md`): Phase 7+8 introduced 0 color violations + 0 net-new font literals. Pre-merge fix queue empty.
- **Dependency audit** (`2026-05-03-dep-audit.md`): 0 critical, 37 high, 20 moderate, 1 low. All cargo warnings non-actionable from this repo (Linux-only / Windows-only / requires custom logger).

## What changed since pre-smoke-walk-4

9 doc-only commits, no code changes. Branch is at `9c09ff86`.

```
9c09ff86 overnight harden: theme/font sweep (Tier 3)
7d5a1efe overnight harden: dependency audit (Tier 3)
dd61a10e overnight harden: perf baselines (Tier 2)
c6c83e89 overnight harden: atom dependency graph
3fbfa652 overnight harden: Tauri command reachability map
806ed0c3 overnight harden: cutover risk audit
c26e94fa overnight harden: MCP server compat audit (Tier 2)
e25c9dbe overnight harden: error-handling audit
a9018635 overnight harden: arch-gap triage doc
```

`pre-smoke-walk-4` tag is unchanged at `f49deccc` (rollback anchor).

`just test` final verification result: see "Closing state" at the bottom of this doc once committed.

## Audit doc index (in case you want to drill in)

| Doc | Severity peak | Pre-merge items | Post-merge items |
|---|---|---|---|
| `2026-05-03-arch-gap-triage.md` | n/a | 1 (Gap 9) + 1 user-decides | 2 |
| `2026-05-03-error-handling-audit.md` | high | 2 | 7 |
| `2026-05-03-tauri-command-reachability.md` | medium | 0 | 54 retire + 3 phantom + 4 dead decorations |
| `2026-05-03-cutover-risks.md` | **critical** | 1 (runbook amendment) | 3 (flavor isolation) |
| `2026-05-03-atom-graph.md` | medium | 0 | 5 (dead atoms + selectionEquals) |
| `2026-05-03-mcp-compat.md` | low | 0 | 3 cosmetic drifts |
| `2026-05-03-perf-baselines.md` | n/a | 0 | 0 |
| `2026-05-03-theme-font-sweep.md` | low | 0 | 1 (cosmetic) |
| `2026-05-03-dep-audit.md` | high | 5 (dep bumps) | n/a |

---

## Closing state

Final validation (cleared caches: `rm -f node_modules/.cache/tsconfig.tsbuildinfo && CARGO_INCREMENTAL=0 just test`):

- **Result: GREEN.** Rust 2,442 / 2,442 pass (58 slow, 2 leaky — same as pre-smoke-walk-4 baseline). Frontend pass. MCP pass.
- Wall-clock: 39.3s (Rust nextest section).
- 2 leaky tests in summary footer match the run-twice stability check from earlier today; not Phase 8-introduced.

**Branch:** `task-flow-v2` at `<final-commit>` (this doc's commit).
**Tag:** `pre-smoke-walk-4` unchanged (rollback anchor).
**Pushed:** see git log; this doc commits + pushes as the close-out.

You can walk `pre-smoke-walk-4` whenever you're ready. If you want to land the pre-merge fix queue (especially items 1 + 2) before the walk, the suite is green and the surfaces affected are surgical enough that a re-walk after fixes is small.

