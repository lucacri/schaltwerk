# Arch-gap triage — Tier 1.1

Date: 2026-05-03
Branch: task-flow-v2
Source: `plans/2026-05-03-pre-smoke-arch-gaps.md`

## Scope and method

The pre-smoke audit identified 10 arch-test gaps. Three (Gaps 1-Rust,
4, 5) shipped in commit `b37a3cf3` as additive pins. The remaining
seven (Gaps 2, 3, 6, 7, 8, 9, 10) were deferred. This document
triages each into one of four buckets — `pre-merge-fix`,
`post-merge-fix`, `no-action`, `user-decides-with-default-X` — with
rationale and a cost estimate.

### Note on the "4 would-fail-today" framing

The prompt asked to verify "the 4 would-fail-today entries". The
audit document only flags **two** gaps as currently failing if the
pin were strict (Gap 7 and Gap 9). I verified both still hold:

- Gap 7 — `#[allow(dead_code)]` at
  `src-tauri/src/infrastructure/database/db_tasks.rs:989` is **still
  present** as of HEAD (`f49deccc`). Confirmed by direct file read.
- Gap 9 — `console.log` at `src/common/ptyResizeScheduler.ts:21` and
  `console.warn` at `src/common/ptyResizeScheduler.ts:51` are **still
  present** as of HEAD. Confirmed by direct file read.

No other deferred gap is described in the audit as "would fail
today". Gaps 2, 3, 6, 8, 10 are either opinion-gated or
empirically clean today.

---

## Gap 2 — Global mutable state pin (broader than AppHandle)

1. **What it would catch.** A new process-wide singleton (`OnceCell`,
   `OnceLock`, `Lazy`, `LazyLock`, `lazy_static!`, `static mut`) added
   in any future change without explicit review.
2. **Why deferred.** Audit classified this as "redundant or sprawling
   allowlist" — the codebase already has many legitimate statics
   (mimalloc, settings manager, project manager, attention registry,
   etc.). Pinning would either lock the current set as canonical (the
   user has not committed to that) or require a sprawling allowlist
   that adds review burden.
3. **Recommendation:** `no-action`.
4. **Rationale.** The existing `arch_app_handle_global_singleton`
   already pins the highest-risk shape (event-emit registry sprawl).
   See `reference_arch_app_handle_singleton.md` — the user's
   established practice is "pin the specific dangerous shape, not all
   globals". A broader pin would have a high false-positive rate
   without catching a tighter regression class. Revisit only if a
   specific new singleton causes a real bug.
5. **Cost.** N/A.

---

## Gap 3 — Sidebar render structure pin

1. **What it would catch.** A future agent re-mounting `<SessionCard>`
   directly under `<Sidebar>` (the pre-Phase-8 dual-mount shape) or
   adding any other unauthorized JSX child.
2. **Why deferred.** Opinion-gated. Audit notes this would "lock in
   current behavior; only ship if the user has agreed the shape is
   final."
3. **Recommendation:** `user-decides-with-default-pre-merge-fix`.
   Default: **lock the current shape now**.
4. **Rationale.** Phase 8 W.1 just deleted `SidebarSessionList`; the
   sidebar JSX shape is freshly-stabilized and locking it reinforces
   the v2 model the user has in their head. Per
   `feedback_dual_mount_smell.md` and the project charter's W.1
   close-out, the structural change was deliberate and the user
   wants regressions to fail loudly. The pin is a one-file additive
   test (regex over `Sidebar.tsx` JSX root children) — easy to
   loosen later if the user wants to add a new child.
5. **Cost.** tiny (<30min) — single vitest file, parses
   `Sidebar.tsx`, asserts top-level children are subset of allowlist
   (`SidebarHeaderBar`, `OrchestratorEntry`, `SidebarSearchBar`,
   `SidebarStageSectionsView`, `SwitchOrchestratorModal`).

---

## Gap 6 — Compile-time pin for retired enum members

1. **What it would catch.** Re-introduction of
   `KeyboardShortcutAction.NewSession` or `.NewSpec` enum members.
2. **Why deferred.** Audit classified as redundant: the existing TS
   pin in `arch_no_v1_session_leakage` already catches identifier
   references to those names.
3. **Recommendation:** `no-action`.
4. **Rationale.** Adding a Rust-side or doc-test pin would catch
   exactly the same regression class as the existing TS pin —
   re-introduction by name. No tighter shape is gained. This matches
   the user's established practice: don't add redundant pins
   (`reference_arch_app_handle_singleton.md`).
5. **Cost.** N/A.

---

## Gap 7 — `#[allow(dead_code)]` enforcement

1. **What it would catch.** Any future use of
   `#[allow(dead_code)]` in `src-tauri/src/`, enforcing the CLAUDE.md
   rule "never use `#[allow(dead_code)]`. Either use the code or
   delete it."
2. **Why deferred.** Pin would currently FAIL — there is one
   intentional Phase-1-Wave-I scaffold at
   `src-tauri/src/infrastructure/database/db_tasks.rs:989` (verified
   still present at HEAD `f49deccc`):

   ```rust
   #[allow(dead_code)]
   const _UNUSED_COLUMN_LISTS: &[&str] = &[TASK_SELECT_COLUMNS, TASK_RUN_SELECT_COLUMNS];
   ```

3. **Recommendation:** `post-merge-fix`.
4. **Rationale.** This is a known scaffold the user is aware of;
   Wave I will reference these column lists when porting
   orchestration. Forcing a resolution now (delete or use) is
   premature work that pre-empts a planned wave. Per
   `feedback_no_deferred_subwaves_at_close_out.md`, gating merge on
   work that isn't part of the close-out is the wrong lever — but
   this gap is the inverse: we'd be gating merge on work that
   belongs to a *future* wave. Once Wave I lands, the pin is a
   one-liner.
5. **Cost.** tiny (<30min) once the scaffold const is referenced or
   deleted.

---

## Gap 8 — DB schema additive-only pin

1. **What it would catch.** A future migration that DROPs a column
   or table (vs. only adding).
2. **Why deferred.** Strongly opinion-gated. Audit notes this is a
   "v2-charter-level decision the user would need to ratify before
   pinning."
3. **Recommendation:** `user-decides-with-default-no-action`.
   Default: **do not pin**.
4. **Rationale.** The user's v2 charter
   (`project_taskflow_v2_charter.md`) explicitly chose "v2 schema is
   canonical, don't migrate from v1" — i.e., the *opposite* of
   additive-only. An additive-only pin would constrain the user's
   freedom to make further v2 schema cuts. This is the kind of
   constraint the prompt warned against ("yes, schema must be
   additive-only — that constrains the user's freedom"). The
   existing `arch_hydrator_completeness` already catches the
   higher-risk shape (additive change without hydrator update),
   which is the regression class compile pins miss
   (`feedback_compile_pins_dont_catch_wiring.md`).
5. **Cost.** N/A.

---

## Gap 9 — Frontend `console.*` pin

1. **What it would catch.** Direct `console.log/warn/error/info/debug`
   calls in `src/`, enforcing the CLAUDE.md rule "always use the
   project 'logger'."
2. **Why deferred.** Pin would currently FAIL — two occurrences at
   `src/common/ptyResizeScheduler.ts:21` (debug `console.log` gated by
   `NODE_ENV === 'test'`) and `:51` (warn on resize ignore). Verified
   still present at HEAD `f49deccc`. Both predate Phase 8.
3. **Recommendation:** `pre-merge-fix`.
4. **Rationale.** The fix is mechanical: convert line 21 to
   `logger.debug` (or delete since it's already gated by
   `NODE_ENV === 'test'`) and line 51 to `logger.warn`. Per
   `feedback_no_preexisting_excuse_taskflow.md`, "don't deflect bugs
   as 'pre-existing'; if found, fix it." Both are in the
   task-flow-v2 surface. Shipping the pin alongside the migration
   prevents drift in the post-smoke window where new console calls
   are most likely (debugging during walk-3). Bonus: `eslint-disable
   no-console` comments on both lines disappear too.
5. **Cost.** tiny (<30min) — 2-line edit + new arch test that walks
   `src/`, excludes `utils/logger.ts` and tests, fails on
   `console.(log|warn|error|info|debug)(`.

---

## Gap 10 — MCP server retired-symbol pin (cross-target half)

1. **What it would catch.** Re-introduction of retired Tauri command
   names (`lucode_task_capture_session`,
   `lucode_task_capture_version_group`, or
   `v1_to_v2_specs_to_tasks`) in `mcp-server/src/`.
2. **Why deferred.** Audit notes the surface is empty today, but
   shipping requires "wiring the test into mcp-server's vitest
   runner — a one-time configuration step."
3. **Recommendation:** `post-merge-fix`.
4. **Rationale.** The user rarely changes MCP tool surfaces day-to-
   day; the regression risk in the next 24-48h (smoke window) is
   negligible. The Rust half (Gap 1-Rust) and the frontend half
   (`arch_no_v1_session_leakage`) already cover the two surfaces
   most likely to see edits. Configure the mcp-server vitest harness
   alongside the next MCP change — that batches the runner-wiring
   cost with work that already touches the area.
5. **Cost.** small (1-2 hours) — adding vitest to mcp-server's
   `package.json`, a config file, and one arch test. Not large but
   the harness setup itself is the bulk of the work, not the pin.

---

## Summary table

| Gap # | Title | Recommendation | Cost | Rationale link |
|-------|-------|----------------|------|----------------|
| 2 | Global mutable state pin | no-action | N/A | `reference_arch_app_handle_singleton.md` |
| 3 | Sidebar render structure pin | user-decides-with-default-pre-merge-fix | tiny | `feedback_dual_mount_smell.md`, `project_taskflow_v2_charter.md` |
| 6 | Retired enum members compile pin | no-action | N/A | redundant with TS pin |
| 7 | `#[allow(dead_code)]` enforcement | post-merge-fix | tiny | Wave I prerequisite; `feedback_no_deferred_subwaves_at_close_out.md` |
| 8 | DB schema additive-only pin | user-decides-with-default-no-action | N/A | constrains v2 charter freedom |
| 9 | Frontend `console.*` pin | pre-merge-fix | tiny | `feedback_no_preexisting_excuse_taskflow.md` |
| 10 | MCP retired-symbol pin | post-merge-fix | small | harness setup batched with future MCP change |

---

## Pre-merge fix queue (priority order)

Only items recommended `pre-merge-fix` (or `user-decides-with-default-pre-merge-fix`).

1. **Gap 9 — Frontend `console.*` pin.** Migrate the two
   `console.*` calls in `src/common/ptyResizeScheduler.ts` to
   `logger.debug`/`logger.warn`, then add
   `src/components/__tests__/arch_no_console.test.ts`. Cost: tiny.
   Priority: highest — closes a CLAUDE.md mandate gap with a
   trivial fix and prevents debug-driven console drift during
   walk-3. **No user opinion needed.**

2. **Gap 3 — Sidebar render structure pin (default
   pre-merge-fix).** Add
   `src/components/__tests__/arch_sidebar_jsx_shape.test.ts`
   asserting `Sidebar.tsx` root-level JSX children are a subset of
   the current 5-item allowlist. Cost: tiny. Priority: second —
   reinforces the v2 sidebar shape just-stabilized in W.1, easy to
   loosen later. **User can override to `post-merge-fix` or
   `no-action` if they want to keep the sidebar JSX shape
   uncommitted.**

---

## Final tally

- 1 pre-merge-fix (Gap 9)
- 1 user-decides-with-default-pre-merge-fix (Gap 3)
- 2 post-merge-fix (Gap 7, Gap 10)
- 2 no-action (Gap 2, Gap 6)
- 1 user-decides-with-default-no-action (Gap 8)

If the user accepts both defaults, the pre-merge queue is 2 items
totalling <1h of work. Worst case (user rejects Gap 3 default), it's
1 item totalling <30min.
