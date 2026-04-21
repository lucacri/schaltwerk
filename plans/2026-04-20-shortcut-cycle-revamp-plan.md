# Shortcut Cycle Revamp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Revamp keyboard cycling so `Cmd+\`` remains the canonical project-tab shortcut pair, `Option+\`` becomes the canonical sidebar-item shortcut pair, and the duplicate project-arrow shortcuts are removed.

**Architecture:** Extend the existing `SelectPrevSession` / `SelectNextSession` actions with additional default bindings instead of creating new actions, then remove the duplicate `SelectPrevProject` / `SelectNextProject` actions from config, metadata, hook wiring, and callers. Keep the existing sidebar traversal logic in `Sidebar.tsx` and update docs/settings surfaces to match the new bindings.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Mintlify docs.

---

### Task 1: Add failing shortcut config and catalog tests

**Files:**
- Modify: `src/keyboardShortcuts/metadata.test.ts`
- Create: `src/keyboardShortcuts/config.test.ts`

**Steps:**
1. Add assertions that `SelectPrevSession` and `SelectNextSession` include both arrow and Option-backtick defaults.
2. Add assertions that the navigation catalog no longer includes duplicate previous/next project actions.
3. Run `bun run vitest src/keyboardShortcuts/config.test.ts src/keyboardShortcuts/metadata.test.ts`.
4. Expected: fail because the defaults and metadata still expose the old project-arrow actions.

### Task 2: Add failing hook tests for sidebar-item backtick cycling

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.test.tsx`

**Steps:**
1. Add tests for `Option+\`` and `Option+Shift+\`` hitting the existing session-navigation callbacks.
2. Remove or replace the tests that currently expect `Cmd+Shift+ArrowLeft` / `Cmd+Shift+ArrowRight` project callbacks.
3. Add modal-gating assertions for the new Option-backtick bindings.
4. Run `bun run vitest src/hooks/useKeyboardShortcuts.test.tsx`.
5. Expected: fail because the hook still matches the deleted project actions and does not recognize the new Option-backtick bindings.

### Task 3: Implement shortcut config and metadata cleanup

**Files:**
- Modify: `src/keyboardShortcuts/config.ts`
- Modify: `src/keyboardShortcuts/metadata.ts`

**Steps:**
1. Add `Alt+\`` / `Alt+Shift+\`` to the session-navigation defaults.
2. Remove the duplicate project-arrow actions from the action enum and default config.
3. Remove the duplicate project rows from the navigation metadata.
4. Re-run `bun run vitest src/keyboardShortcuts/config.test.ts src/keyboardShortcuts/metadata.test.ts`.

### Task 4: Remove duplicate project-arrow wiring and keep sidebar traversal behavior

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/hooks/useKeyboardShortcuts.test.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/App.tsx`

**Steps:**
1. Remove `onSelectPrevProject` / `onSelectNextProject` from the shortcut hook and its call sites.
2. Keep `selectPrev` / `selectNext` as the sidebar traversal implementation for both arrow and Option-backtick bindings.
3. Delete the now-unused `handleSelectPrevProject` / `handleSelectNextProject` wrappers in `Sidebar.tsx` and `App.tsx`.
4. Re-run `bun run vitest src/hooks/useKeyboardShortcuts.test.tsx`.

### Task 5: Update docs and user-facing shortcut references

**Files:**
- Modify: `docs-site/guides/keyboard-shortcuts.mdx`
- Modify: `docs-site/guides/keyboard-navigation.mdx`
- Modify: `docs-site/guides/multi-project.mdx`
- Modify: `docs-site/workflow.mdx`
- Modify: `docs-site/guides/advanced-workflows.mdx`
- Modify: `docs-site/guides/orchestrator.mdx`

**Steps:**
1. Replace project-tab references to `Cmd+Shift+ArrowLeft` / `Cmd+Shift+ArrowRight` with the remaining supported bindings.
2. Document `Option+\`` / `Option+Shift+\`` as the canonical sidebar-item cycle pair while keeping `Cmd+ArrowUp` / `Cmd+ArrowDown` as alternates.
3. Spot-check the changed docs for wording consistency.

### Task 6: Verify, review, and commit

**Files:**
- All modified files

**Steps:**
1. Run the targeted Vitest suites again.
2. Run `just test`.
3. Perform the requested code-review pass and address any findings.
4. Create a single squashed commit with all shortcut revamp changes.
