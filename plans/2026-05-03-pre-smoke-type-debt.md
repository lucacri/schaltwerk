# Phase 8 Pre-Smoke Type Debt Audit

**Scope:** weakly-typed escape hatches *introduced* in Phase 7 or Phase 8
commits (taskflow-v2 Wave A.1 through Phase 8 W.6). Pre-existing escape
hatches in untouched files are out of scope; pre-existing escape hatches
in *touched* files are noted only when they materially intersect with
the v2 wire shape.

**Methodology:**
- File scope: union of files modified by commits matching `phase7|phase8|taskflow-v2.*Wave|task-flow-v2.*Wave` (102 files).
- Patterns: `: any`, `as any`, `as unknown as <T>`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `Record<string, any>`, bare `Function` / `Object` types (TS); `#[allow(...)]`, new `unsafe` blocks (Rust).
- Introduction filter: `git blame` line-level; only escapes whose introducing commit hash matches the Phase 7/8 set are surfaced.
- Cosmetic fixes (rename-only, zero behavior change, outside hot paths): would be applied directly. None found in the introduced set.

**Counts:**
- Cosmetic-applied: 0
- Logic-gap (documented): 1
- Legitimate (documented): 2

---

## Logic-gap — escape hatch hides a real wire-shape mismatch

| file:line | snippet | recommendation |
| --- | --- | --- |
| `src/components/right-panel/TaskArtifactEditor.tsx:75` | `const updated = (await updateTaskContent(task.id, kind, body, { projectPath: projectPath ?? null })) as unknown as TaskWithBodies` | The cast hides a real shape mismatch. `updateTaskContent` (and the backend `lucode_task_update_content`) return `Task` — base task without artifact bodies. `onSaved(updated)` flows into `TaskRightPane.handleSaved` which calls `setTask(updated)` on local state typed as `TaskWithBodies`. After save, switching tabs reads `current_spec_body` / `current_plan_body` / `current_summary_body` as `undefined`, so the textarea empties on tab switch. The header comment claims the canonical body comes back via the `TasksRefreshed` broadcast — if that's actually true, the simple fix is **drop the `onSaved` call here** and rely on the broadcast (the hook already re-keys on `task.id` and the parent owns refetching). If the broadcast pathway isn't reliable across tab switches in practice, instead **chain a `getTask(task.id)` (which calls `lucode_task_get` and returns true `TaskWithBodies`) before invoking `onSaved`**. Either way the cast must die. Add a vitest pin that asserts `current_spec_body` survives a save→tab-switch cycle to lock the fix. |

---

## Legitimate — escape hatch is the correct tool

| file:line | snippet | recommendation |
| --- | --- | --- |
| `src/types/task.test.ts:44`, `src/types/task.test.ts:61` | `// @ts-expect-error — 'queued' is not a v2 TaskRunStatus` (and the `TaskStage` 'cancelled' twin at line 61) | Negative compile-time pins for the v1→v2 union narrowing. The `@ts-expect-error` is the canonical way to assert that a literal is *rejected* by the type system. Keep as-is. |
| `src/components/right-panel/TaskArtifactEditor.tsx:64` | `// eslint-disable-next-line react-hooks/exhaustive-deps` (the `useEffect` over `[task.id, kind]` that intentionally omits `body`) | Hot path (right-panel). The disable is justified by the inline comment: depending on `body` would re-fire the effect on every keystroke (any keystroke that triggered a re-render via the parent `TasksRefreshed` listener), clobbering the user's in-flight edit with the latest broadcast `initial`. The current key set (`task.id`, `kind`) is the minimum that resets the buffer on selection or tab swap. Keep as-is. |

---

## Out-of-scope (predates Phase 7/8) — recorded for completeness

The following escapes were surfaced by the broad regex pass but `git blame` confirms they were introduced **before** Phase 7. They are not part of this audit's deliverable and are not Phase 8 pre-smoke debt:

- `src-tauri/src/infrastructure/database/db_tasks.rs:989` — `#[allow(dead_code)]` on `_UNUSED_COLUMN_LISTS` (commit `d554e9ec`, pre-Phase-7 db scaffold). The comment promises Wave I (Phase 6) wiring; the consts remain unreferenced. **Hot path (DB schema)** — leave alone for the smoke walk; revisit post-merge as a knip/dead-code clean-up.
- `src-tauri/src/commands/tasks.rs:204` — `#[allow(clippy::too_many_arguments)]` on `lucode_task_create` (commit `17a9044f`, pre-Phase-7 command port). Hot path (Tauri command body) — leave alone.
- `src/components/terminal/Terminal.tsx:1996` — `eslint-disable-next-line react-hooks/exhaustive-deps` (pre-Phase-7).
- `src/components/modals/SettingsModal.tsx:718` — `as unknown as Record<string, unknown>` for snake/camel coercion (pre-existing, Nov 2025).
- All `unsafe` blocks in `src-tauri/src/macos_*.rs`, `domains/terminal/local.rs`, `domains/sessions/process_cleanup.rs`, etc. — platform FFI, predate the v2 charter.

---

## Verification

- `git log --pretty=format:"%H" --grep="phase7|phase8|taskflow-v2.*Wave|task-flow-v2.*Wave"` enumerates the introducing-commit set; line-level `git blame` was checked against that set for every escape surfaced.
- No commit was made in this audit pass — there were zero rename-only cosmetic fixes among the introduced escapes.
