# Phase 8 pre-smoke — arch pin gaps audit

Date: 2026-05-03
Branch: task-flow-v2

## Scope

Audit the architecture-test landscape for class-of-bug regressions that no
current `arch_*` test would catch. For each gap below: state of play,
proposed pin, action, cost/risk.

Existing arch tests (read in full first):

- `src-tauri/tests/arch_app_handle_global_singleton.rs` — pins single-handle
  AppHandle globals; struct-field uses ignored.
- `src-tauri/tests/arch_domain_isolation.rs` — pins cross-domain imports,
  legacy `schaltwerk_core` imports, layering.
- `src-tauri/tests/arch_layering_database.rs` — commands/services/domains
  layering, rusqlite restricted to repository, string-literal event names.
- `src-tauri/tests/arch_hydrator_completeness.rs` — pinned column counts
  per entity table (catches schema-add without hydrator update).
- `src/components/__tests__/arch_component_size.test.ts` — 500-line cap on
  .tsx components with ratchet allowlist.
- `src/components/__tests__/arch_no_v1_session_leakage.test.ts` — Phase 8
  retired symbols not referenced from production source under `src/`.

The audit walked the `src/`, `src-tauri/src/`, and `mcp-server/src/`
trees plus the docs site. The bracketed evidence under each gap below
records what a candidate pin would catch today.

---

## Gap 1 — Cross-target retired-symbol pin

**State of play.** `arch_no_v1_session_leakage.test.ts` only walks `src/`.
A Rust comment, command-name string, or MCP tool wrapper still
mentioning a retired Tauri command would slip through. Concrete scans
(2026-05-03):

- `src-tauri/src` greps for `lucode_task_capture_session`,
  `lucode_task_capture_version_group`, `v1_to_v2_specs_to_tasks` —
  all empty.
- `mcp-server/src` greps for the same set — empty.
- `docs-site/` greps for the same set — empty.

So the surface is clean today; a permanent pin would be additive.

**Proposed pin.**

- Rust: new `src-tauri/tests/arch_no_v1_session_leakage_rust.rs` —
  walks `src/` (the lib crate root), greps each `.rs` file for the
  retired Tauri command names + `v1_to_v2_specs_to_tasks` migration
  helper. Excludes lines whose first non-whitespace is `//` or `///`.
- MCP: new `mcp-server/test/arch_no_v1_session_leakage_mcp.test.ts` —
  walks `mcp-server/src` for the same retired Tauri command identifiers.

**Action.** IMPLEMENT (Rust pin; MCP pin would require adding a test
runner harness for `mcp-server` which is out of scope — DOCUMENTED for
that half).

**Cost/risk.** Linear file walk over a small tree; runs in <100ms. No
false-positive risk on the current source.

---

## Gap 2 — Global mutable state pin (broader than AppHandle)

**State of play.** `arch_app_handle_global_singleton` only catches
`AppHandle`-shaped statics. A broader `static`/`OnceCell`/`OnceLock`/
`Lazy`/`LazyLock`/`lazy_static!` pin would catch any new
process-singleton.

But the codebase already has many *legitimate* statics:

- `src-tauri/src/main.rs`: `GLOBAL: mimalloc::MiMalloc`,
  `SETTINGS_MANAGER`, `ATTENTION_REGISTRY`, `FILE_WATCHER_MANAGER`,
  `REQUEST_PROJECT_OVERRIDE`.
- `src-tauri/src/project_manager.rs`: `PROJECT_MANAGER`.
- `src-tauri/src/cleanup.rs`, `macos_accessibility.rs`,
  `version_check.rs`: `AtomicBool` flags, last-notified version.
- `src-tauri/src/binary_detection.rs`: `IMAGE_EXTENSIONS`,
  `BINARY_EXTENSIONS` (constant data).
- `src-tauri/src/domains/attention/mod.rs`,
  `domains/power/global_service.rs`,
  `domains/merge/lock.rs`, `domains/workspace/file_index.rs`,
  `domains/workspace/watcher.rs`: domain-internal singletons.

**Action.** DOCUMENTED. A blanket pin would either:

1. Lock the current statics as canonical (the user has not committed
   to that), or
2. Need a sprawling allowlist that adds review burden without catching
   a tighter regression class than the existing AppHandle pin.

Post-smoke, the user could revisit this gap if they want a per-domain
"no new globals without justification" guard. For now the AppHandle
pin covers the highest-risk shape (event-emit registry sprawl).

---

## Gap 3 — Sidebar render structure pin

**State of play.** Phase 8 W.1 deleted `SidebarSessionList`, but
nothing structurally prevents a future agent from re-mounting
`<SessionCard>` directly under `<Sidebar>`. `arch_no_v1_session_leakage`
catches the *import* of `SidebarSessionList`, not the *JSX
structure* of `Sidebar.tsx`.

Today (`Sidebar.tsx:127-181`), the top-level children of `<Sidebar>`
are exactly: `SidebarHeaderBar`, `OrchestratorEntry`,
`SidebarSearchBar`, conditionally `SidebarStageSectionsView`, and
`SwitchOrchestratorModal`.

**Proposed pin.** Parse `Sidebar.tsx` and assert the JSX-element names
appearing under the root `<div>` are a subset of that allowlist.

**Action.** DOCUMENTED.

The user explicitly noted this would "lock in current behavior; only
ship if the user has agreed the shape is final." Post-smoke, if the
user signs off on the current JSX structure, this pin is one
straightforward `arch_sidebar_jsx_shape.test.ts` away — match
top-level identifier names from a regex over the JSX, fail on any
unlisted child.

---

## Gap 4 — Tauri command enum drift pin

**State of play.** CLAUDE.md mandates routing every `invoke()` call
through `TauriCommands` enum; raw string literals are forbidden.
Current scans (2026-05-03):

- `invoke('...')` from `src/` — empty.
- `invoke("...")` from `src/` — empty.
- `invoke(\`...\`)` (template literal) — empty.
- `core.invoke(['"\`])` and `tauri.invoke(['"\`])` — empty.

So the surface is clean. A permanent regex pin is additive.

**Proposed pin.** New
`src/components/__tests__/arch_no_raw_invoke.test.ts` — for each `.ts`
and `.tsx` file under `src/` (excluding `__tests__/` and `*.test.*`),
match `invoke(['"\`]…)` and `(core|tauri)\.invoke(['"\`]…)`. Allow only
the helper file itself if needed.

**Action.** IMPLEMENT.

**Cost/risk.** ~50ms vitest pass over the source tree. No
false-positives expected; `TauriCommands.X` lookups are identifiers,
not literals.

---

## Gap 5 — Selection-union exhaustiveness pin

**State of play.** `selectionHelpers.ts` exposes `assertNeverKind` and
the `matchSelection` matcher. All four occurrences of `switch
(selection.kind)` in the codebase live in `selectionHelpers.ts`
itself. Other consumers go through `selectionToSessionId`,
`selectionToTaskId`, etc.

A future addition to the union without an exhaustive matcher update
would silently pass through any `switch (selection.kind)` block in
some other file. Today no such block exists.

**Proposed pin.** New
`src/components/__tests__/arch_selection_kind_exhaustiveness.test.ts`
— scan all `.ts`/`.tsx` files under `src/`, fail if any file other
than `selectionHelpers.ts` (and test files) contains
`switch (selection.kind)`.

**Action.** IMPLEMENT.

**Cost/risk.** ~50ms vitest pass. Low false-positive risk; the regex
is specific to the literal field name `kind` on the variable
`selection`. Other variable names that happen to have a `kind` field
would not trigger.

---

## Gap 6 — Compile-time pin for retired enum members

**State of play.** `KeyboardShortcutAction.NewSession` and `.NewSpec`
are retired; the TS-side pin in `arch_no_v1_session_leakage` catches
identifier references. No equivalent Rust enum exists for these
particular actions, so a Rust-side compile pin would be redundant
with the TS pin.

**Action.** DOCUMENTED. The TS pin already covers this regression
class; adding a doc test that imports the enum and asserts member
shape would not catch a different bug class. Skip.

---

## Gap 7 — `#[allow(dead_code)]` enforcement

**State of play.** CLAUDE.md mandates zero `#[allow(dead_code)]`. A
strict pin would currently FAIL — there is one occurrence at
`src-tauri/src/infrastructure/database/db_tasks.rs:989`:

```rust
// Suppress unused-const warning while these aliases live in the file but no public
// reader is wired up yet; Wave I will reference them when porting orchestration.
#[allow(dead_code)]
const _UNUSED_COLUMN_LISTS: &[&str] = &[TASK_SELECT_COLUMNS, TASK_RUN_SELECT_COLUMNS];
```

This is intentional Phase-1-Wave-I scaffolding the user is aware of.

**Action.** DOCUMENTED. Post-Wave I (when the column lists are
referenced by their reader), the user can either:

1. Delete the marker + the const if it remains unused, then add the
   pin.
2. Add the pin with this single file/line allowlisted.

Either way, the pin is a one-liner once the prerequisite is met:
walk `src-tauri/src/`, fail on any non-doc-comment line containing
`#[allow(dead_code)]`.

---

## Gap 8 — DB schema additive-only pin

**State of play.** The W.4 migration deletion suggests the user's
preference is "v2 schema is canonical, don't migrate from v1." A pin
that ensures new migrations only ADD columns/tables (never drop) is
opinionated.

**Action.** DOCUMENTED. This is a v2-charter-level decision the user
would need to ratify before pinning. The existing
`arch_hydrator_completeness` test catches "schema added without
hydrator update," which is the higher-risk pattern.

---

## Gap 9 — Frontend `console.*` pin

**State of play.** CLAUDE.md mandates `src/utils/logger.ts`. A strict
pin would currently FAIL — there are two occurrences at
`src/common/ptyResizeScheduler.ts:21,51`:

```ts
console.log('[schedulePtyResize]', id, size, opts?.force);
console.warn('[PTY] resize ignored', err)
```

These are existing — they predate Phase 8. Removing them is a
behavior change (line 21 may be dev-mode-only debug; line 51 is an
error path). The user has not committed to converting them.

**Action.** DOCUMENTED. Post-smoke, the user can either:

1. Migrate those two lines to `logger.debug` / `logger.warn` and ship
   the pin in a single PR.
2. Keep them and ship the pin with `src/common/ptyResizeScheduler.ts`
   on an allowlist.

The pin shape is straightforward: walk `src/`, exclude
`utils/logger.ts` and tests, fail on any `console.(log|warn|error|info|debug)(`.

---

## Gap 10 — MCP server retired-symbol pin (cross-target half)

**State of play.** Same scan family as Gap 1 but for the
`mcp-server/src/` tree. Empty today.

**Action.** DOCUMENTED. The Rust half of Gap 1 ships now; the MCP
half is straightforward but requires wiring the test into
`mcp-server`'s vitest runner. That's a one-time configuration step
the user can do alongside any future MCP tool surface change.

---

## Recommendations for the user post-smoke

Prioritized list of pins worth adding once smoke testing is complete
and the user has signed off on the corresponding shape decisions:

1. **High value, additive — ALREADY IMPLEMENTED in this commit.**
   - Gap 1 (Rust half): `arch_no_v1_session_leakage_rust.rs`.
   - Gap 4: `arch_no_raw_invoke.test.ts`.
   - Gap 5: `arch_selection_kind_exhaustiveness.test.ts`.

2. **High value, single prerequisite each.**
   - Gap 7 (`#[allow(dead_code)]`): drop `db_tasks.rs:989` after Wave I,
     then pin.
   - Gap 9 (`console.*`): migrate `ptyResizeScheduler.ts:21,51` to
     `logger.debug`/`logger.warn`, then pin.

3. **High value, opinion gate (sign off post-smoke).**
   - Gap 3 (Sidebar JSX shape): pin once the sidebar structure is
     declared frozen.

4. **Lower value or redundant.**
   - Gap 2 (broad globals pin): allowlist would be sprawling; the
     AppHandle pin covers the highest-risk shape.
   - Gap 6: redundant with the TS pin.
   - Gap 8 (additive-only schema): opinionated; defer.
   - Gap 10 (MCP cross-target): configure mcp-server vitest harness
     when convenient.
