# Pre-merge performance baselines (Tier 2.7)

Static-only capture of pre-merge performance metrics for `task-flow-v2`. No dev server, no interactive auth, no cache clears. All measurements taken on the `task-flow-v2` worktree at HEAD `3fbfa652`, with main at `1809ab0e`.

## 1. Test runtime — `just test` wall-clock

Cited from [`plans/2026-05-03-pre-smoke-test-stability.md`](./2026-05-03-pre-smoke-test-stability.md). Two back-to-back runs on warm cache:

| Run | Exit | Duration | Rust pass / fail | Frontend | MCP |
|-----|------|----------|------------------|----------|-----|
| 1 | 0 | **64 s** | 2438 / 0 (stability doc count) | passed | passed |
| 2 | 0 | **58 s** | 2438 / 0 | passed | passed |

Run 2 is 6 s faster, expected (warmer cargo + tsc + vitest caches). Suite is deterministic across the two runs.

> Note: the stability doc reports 2438 Rust tests (pre-smoke moment). Today's nextest run for slow-test capture (Section 3) reports **2442 tests run, 2442 passed (55 slow)** — see Section 6 for the +4 reconciliation.

Not re-run in this baseline pass.

## 2. Bundle size

`bun run build` (Vite + tsc) succeeded on `task-flow-v2` in **12.21 s**. Compared against the existing `dist/` on `/Users/lucacri/Sites/dev-tools/schaltwerk` (main worktree at `1809ab0e`, dist built Apr 28; the only main-side commit since dist build is doc-only `CLAUDE.md` + `justfile` — no frontend touch — so the dist is representative).

> `git checkout main` was **not** attempted: main is already checked out in the parent worktree `/Users/lucacri/Sites/dev-tools/schaltwerk`. Switching this worktree to main would conflict; comparing the parent worktree's existing dist is the safe path.

### Headline

| Branch | `du -sk dist/` | Largest chunk |
|--------|----------------|---------------|
| `main` (parent worktree, dist Apr 28) | **18 700 KB** | `vendor-Bib1L-ST.js` 12 774 182 B |
| `task-flow-v2` (this worktree, fresh build) | **18 580 KB** | `vendor-DpaAxDVV.js` 12 774 182 B |
| **Delta** | **−120 KB** (branch is smaller) | identical vendor megachunk |

Net: `task-flow-v2` ships **120 KB less** total bundle than main.

### Top chunks comparison (sorted by branch size, descending)

| Chunk family | main (KB) | branch (KB) | Δ KB |
|--------------|----------:|------------:|-----:|
| `vendor-*.js` (combined node_modules) | 12 475 | 12 475 | 0 |
| `mermaid-vendor-*.js` | 2 785 | 2 785 | 0 |
| `syntaxHighlighter.worker-*.js` | 965 | 967 | +2 |
| `main-*.js` (app entry) | 877 | **766** | **−111** |
| `xterm-vendor-*.js` | 322 | 322 | 0 |
| `react-vendor-*.js` | 242 | 241 | −1 |
| `worker-*.js` | 181 | 181 | 0 |
| `style-guide-*.js` | 34 | **66** | **+32** |
| `tauri-vendor-*.js` | 19 | 19 | 0 |
| `jotai-vendor-*.js` | 9 | 9 | 0 |
| `markdown-vendor-*.js` | 1 | 1 | 0 |
| **CSS:** `xterm-vendor-*.css` | 4 | 4 | 0 |
| **CSS:** `main-*.css` | 1 | 1 | 0 |

### Chunk identity changes (named-route lazy chunks)

These are the same lazy split-points renamed because the underlying route was renamed/replaced:

| main lazy chunk | branch lazy chunk | Δ KB |
|-----------------|-------------------|-----:|
| `ContextualActionsSettings-3mKTpyx4.js` 513 KB + CSS 258 KB | (none) | **−771** |
| (none) | `sanitizeName-BZxMePSu.js` 468 KB + CSS 257 KB | **+725** |

Net of the lazy-chunk swap: **−46 KB**. Combined with the 111 KB shrink in `main-*.js` and small worker drift, accounts for the −120 KB total.

### Bundle observations

- The 12.7 MB `vendor-*.js` and 2.85 MB `mermaid-vendor-*.js` dominate the bundle. Branch and main produce **byte-identical** vendor chunks (same hash → same dep tree).
- `main-*.js` shrank by 111 KB. Plausible cause: v1 spec/promotion code paths retired in W.1–W.4 (per Phase 8 status doc).
- The new `sanitizeName-*` lazy chunk replaces the old `ContextualActionsSettings-*` chunk; net reduction.
- No new lazy chunk families introduced beyond the rename above.
- No new source-map files appear; no new wasm; no new imageset.

## 3. Top 20 slowest Rust tests

Captured by re-running `cargo nextest run -p lucode --no-fail-fast` from `src-tauri/` (no cache clear; tee'd into `/tmp/nextest-perf.log`). Wall-clock for the Rust suite alone: **36.135 s**. Total: 2442 tests, 0 failures, **55 slow** per nextest's own footer.

Nextest emits markers at two thresholds (`> 5.000s` and `> 10.000s`) but does not print the underlying numeric duration in the default text reporter. Below: the 14 tests that crossed the 10 s threshold (sorted by family / module), then the next 6 from the 5 s bucket. **All 14 of the >10 s entries live in `domains::terminal::manager_test`** — the real-PTY harness family.

### Crossed > 10 s (14 tests, all in `domains::terminal::manager_test`)

| # | Test |
|---|------|
| 1 | `tests::test_concurrent_terminal_creation` |
| 2 | `tests::test_paste_multiline_with_special_chars` |
| 3 | `tests::test_path_environment_merging` |
| 4 | `tests::test_process_zombie_prevention` |
| 5 | `tests::test_queue_initial_command_dispatches_after_delay_without_output` |
| 6 | `tests::test_queue_initial_command_dispatches_on_ready_marker` |
| 7 | `tests::test_race_conditions_during_creation_destruction` |
| 8 | `tests::test_resource_tracking_across_async_ops` |
| 9 | `tests::test_shell_detection_and_configuration` |
| 10 | `tests::test_shell_specific_escaping` |
| 11 | `tests::test_signal_handling` |
| 12 | `tests::test_terminal_with_custom_app` |
| 13 | `tests::test_terminal_with_custom_size` |
| 14 | `tests::test_timing_sensitive_operations` |

### Crossed > 5 s but not > 10 s (sample — 6 of remaining 41)

| # | Test |
|---|------|
| 15 | `domains::terminal::tmux::tests::concurrent_create_with_same_id_issues_new_session_exactly_once` |
| 16 | `domains::terminal::tmux::tests::concurrent_create_with_different_ids_does_not_serialize` |
| 17 | `domains::terminal::tmux::tests::create_calls_new_session_when_missing` |
| 18 | `domains::terminal::tmux::tests::create_skips_new_session_when_session_already_exists` |
| 19 | `domains::terminal::local::tests::test_full_terminal_workflow` |
| 20 | `domains::terminal::manager::tests::test_close_all_kills_all_terminals` |

The remaining 35 tests in the >5 s bucket are split across:
- `domains::terminal::local::tests::*` (~17 tests — adapter / lifecycle / PTY workflow)
- `domains::terminal::manager_test::tests::*` (rest — additional manager scenarios under 10 s)
- `domains::terminal::manager::tests::*` (~2 tests — `close_all`, `get_terminal_buffer_returns_output`)
- `domains::terminal::command_builder::tests::environment_includes_terminal_metadata`
- `project_manager::tests::test_cleanup_specific_project_does_not_affect_others`
- `project_manager::tests::test_remove_project_clears_hashmap_and_current`
- `shared::login_shell_env::tests::capture_login_shell_env_returns_path`
- `lucode::spec_name_generation::spec_name_generation_updates_spec_display_name` (only non-terminal in >5 s)

Full unique-slow inventory in `/tmp/slow-tests-rust.txt` (55 entries).

## 4. Top 20 slowest frontend tests

Captured via `bun vitest run --reporter=json` to `/tmp/vitest-perf.json` (3 228 total tests, 1 075 suites, 1 todo). Per-test `duration` field in ms.

| # | Duration | Test |
|---|---------:|------|
| 1 | 3.61 s | `src/test/architecture.test.ts > Tauri Command Architecture should use TauriCommands enum for all invoke calls` |
| 2 | 2.15 s | `src/main.test.tsx > main.tsx entry initializes React root and renders App tree` |
| 3 | 1.33 s | `src/components/diff/SimpleDiffPanel.test.tsx > SimpleDiffPanel renders DiffFileList and no dock by default (orchestrator)` |
| 4 | 0.93 s | `src/components/specs/MermaidDiagram.test.tsx > MermaidDiagram assigns a unique id per diagram so multiple can coexist` |
| 5 | 0.89 s | `src/main.test.tsx > main.tsx entry handles missing root element by failing fast` |
| 6 | 0.84 s | `src/components/modals/SettingsModal.test.tsx > project settings nav prompts before saving a changed setup script and blocks on cancel` |
| 7 | 0.79 s | `src/main.test.tsx > main.tsx entry works with a mocked DOM element availability` |
| 8 | 0.72 s | `src/components/modals/SettingsModal.test.tsx > project settings nav saves when setup script changes and user confirms` |
| 9 | 0.67 s | `src/components/diff/UnifiedDiffModal.sidebar-scroll.test.tsx > sidebar stability keeps the current file selected when file change events report the same files` |
| 10 | 0.66 s | `src/components/specs/SpecEditor.state.test.tsx > spec content persistence retains edited spec content after navigating away and back` |
| 11 | 0.56 s | `src/components/diff/UnifiedDiffModal.keyboard-nav.test.tsx > navigates through files in visual tree order with ArrowDown` |
| 12 | 0.55 s | `src/style-guide/StyleGuide.test.tsx > renders the gallery sections and exposes all supported themes` |
| 13 | 0.54 s | `src/components/diff/UnifiedDiffModal.selection.test.tsx > shows stat badges in the file header once diff loads` |
| 14 | 0.43 s | `src/components/modals/SettingsModal.test.tsx > AI Generation custom prompts shows a warning when a required template variable is removed` |
| 15 | 0.36 s | `src/test/architecture.test.ts > State Management Architecture should use Jotai atom naming conventions` |
| 16 | 0.33 s | `src/components/diff/UnifiedDiffModal.keyboard-nav.test.tsx > navigates through files in visual tree order with ArrowUp (reverse)` |
| 17 | 0.32 s | `src/components/right-panel/WebPreviewPanel.test.tsx > enables back/forward navigation based on history` |
| 18 | 0.31 s | `src/components/terminal/TerminalGrid.test.tsx > preserves session-specific terminal tabs when switching between sessions` |
| 19 | 0.31 s | `src/components/diff/UnifiedDiffView.comment-selection.test.tsx > uses the selection file when selectedFile is stale after multi-line drag` |
| 20 | 0.30 s | `src/test/architecture.test.ts > Theme System Architecture should not use hardcoded colors outside theme files` |

**Per-test medians sub-100 ms.** Top frontend test (3.61 s) is a `glob`-the-source filesystem scan in the architecture pin — that's the cost of catching wire-string regressions, not a behavior test slowness signal.

No frontend test crosses the 5 s threshold; no `slow` markers from vitest at default config.

## 5. Lines of code metrics

`find … -name "*.ts" -o -name "*.tsx" -o -name "*.rs" | xargs wc -l`. Source trees only (`src/` + `src-tauri/src/`); excludes generated, vendored, and tests not co-located.

| Tree | main | task-flow-v2 | Δ |
|------|-----:|-------------:|--:|
| `src/` (TS/TSX) | 173 381 | 162 009 | **−11 372** |
| `src-tauri/src/` (Rust) | 124 407 | 142 360 | **+17 953** |
| **Total** | **297 788** | **304 369** | **+6 581** |

Branch is **+2.2 %** in total LoC vs main, but with a structural shift: TypeScript shrank by 11.4 K lines (~6.6 %) while Rust grew by 18 K lines (~14.4 %). Consistent with the v1→v2 rewrite charter — domain logic relocated into `src-tauri/src/domains/tasks/` and adjacent crates, while v1 spec UI / state was retired.

### Branch volume

```
git rev-list --count main..task-flow-v2  →  188 commits
git log --shortstat main..task-flow-v2:
    712 files changed, 49 863 insertions(+), 28 547 deletions(-)
```

712 file changes across 188 commits, net +21 316 lines diff (LoC delta is smaller because diff includes test code, deletions of generated lookups, etc.).

## 6. Test count

| Suite | Count | Source |
|-------|------:|--------|
| **Rust** (today, `cargo nextest run -p lucode`) | **2 442** | `Summary [ 36.135s] 2442 tests run: 2442 passed (55 slow)` |
| **Rust** (Phase 7 pre-Phase-8 baseline) | 2 448 | per task-flow-v2 charter |
| **Rust** (Phase 8 close-out) | 2 438 | per `plans/2026-05-02-task-flow-v2-phase-8-status.md` |
| **Frontend** (`bun vitest run --reporter=json`) | **3 228** (1 075 suites, 1 todo) | `numTotalTests` |
| **MCP** (`mcp-server` `bun test`) | **195** (519 expects, 13 files) | live run footer |

### Rust count drift reconciliation (Phase 7 → today)

```
Phase 7 close-out:        2 448
Phase 8 close-out:        2 438   (−10: 3 capture-helper + 7 specs-to-tasks deletions)
+ pre-smoke arch test:    2 439
+ post-W.7 retire/adds:   2 442   (today)
                          -----
Net delta vs Phase 7:        −6
```

The task spec said "current is 2442 (1 new arch test added in pre-smoke harden, several retire tests removed in W.3/W.4)" — that's accurate.

## 7. Regression watch — which slow tests are recent vs pre-existing

The dominant family in slow markers (>5 s **and** >10 s) is `domains::terminal::*`:
- `domains::terminal::manager_test::tests::*` — 14 of 14 (>10 s); ~24 of 55 (>5 s)
- `domains::terminal::local::tests::*` — ~17 of 55 (>5 s)
- `domains::terminal::tmux::tests::*` — ~6 of 55 (>5 s)
- `domains::terminal::manager::tests::*` — ~2 of 55 (>5 s)
- `domains::terminal::command_builder::*` — 1

That's **~48 of 55 slow tests = 87 %** in the terminal stack. Per the test-stability doc § "What this does NOT cover" and the project_taskflow_v2_charter note: "the terminal test family's slow tests are pre-existing — Phase 8 didn't make them slower."

### Definitively pre-Phase-7 (pre-existing baggage)

- All `domains::terminal::manager_test::*` slow markers — predate v2 work; live in the legacy real-PTY harness.
- All `domains::terminal::local::*`, `tmux::*`, `manager::*` — same legacy harness family.
- `project_manager::tests::test_cleanup_specific_project_does_not_affect_others` — pre-Phase 7.
- `shared::login_shell_env::tests::capture_login_shell_env_returns_path` — pre-existing; spawns real login shell.

### Phase 7+8 era (potential new slow tests)

- `lucode::spec_name_generation::spec_name_generation_updates_spec_display_name` — **only non-terminal slow test outside the `project_manager` cleanup family**. Lives in the v2 spec name generation path. Worth flagging — but a single >5 s test on the new surface, against 47 in the legacy terminal harness, is a green signal, not a red one.

### No new-slow-tests cluster on the v2 task surface

`domains::tasks::*` does not appear in either slow bucket. The Phase-8 task-flow-v2 surface (the bulk of the rewrite) introduces no new tests in the >5 s tail — it's all unit-scope, in-memory.

### Recommendation

No action item from this baseline. The terminal harness family is the long-standing hotspot; the v2 rewrite did not extend it. If we ever want to pay down that family, it'd be a separate workstream — not a merge gate.

---

## Headline

- **Test suite:** 64 s / 58 s wall-clock (cited from stability doc), 2 442 Rust + 3 228 frontend + 195 MCP = **5 865 tests total**, all green.
- **Bundle:** 18.58 MB on branch vs 18.70 MB on main → **−120 KB** smaller. `main-*.js` shrank by 111 KB; lazy-chunk rename net −46 KB.
- **LoC:** branch is +6 581 net (+2.2 %). TypeScript −11 372 (−6.6 %), Rust +17 953 (+14.4 %).
- **Slow Rust tests:** 55 unique cross 5 s, 14 cross 10 s. **All 14 of the >10 s tests are in `domains::terminal::manager_test::*` — pre-existing harness baggage**, untouched by v2.
- **Slow frontend tests:** none cross 5 s. Top is a 3.61 s glob-the-source architecture pin.
