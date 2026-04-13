# Spec Preview Run/Clarify Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate Run and Clarify in the spec preview so the toolbar and keyboard shortcuts match the existing spec workflow.

**Architecture:** Keep clarification in `SpecEditor` as-is, add a preview-only run handler that emits `UiEvent.StartAgentFromSpec`, and update keyboard routing so `RunSpecAgent` opens Run while `RefineSpec` still submits clarification.

**Tech Stack:** React, Vitest, Testing Library, Tauri event wiring, JSON locale files

---

### Task 1: Write failing editor tests

**Files:**
- Modify: `src/components/specs/SpecEditor.test.tsx`

**Step 1: Write the failing tests**

- Assert the preview toolbar renders both `Clarify` and `Run`.
- Assert clicking `Run` emits `UiEvent.StartAgentFromSpec`.
- Assert pending edits flush before `Run` emits the event.
- Assert `Mod+Enter` triggers `Run`.
- Assert `Mod+Shift+R` remains clarification-only and respects readiness.

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/specs/SpecEditor.test.tsx`

Expected: FAIL because the current editor still treats `Clarify` as the green run action and routes `Mod+Enter` to clarification.

### Task 2: Implement the toolbar split

**Files:**
- Modify: `src/components/specs/SpecEditor.tsx`
- Modify: `src/common/i18n/types.ts`
- Modify: `src/locales/en.json`
- Modify: `src/locales/zh.json`

**Step 1: Write minimal implementation**

- Rename the clarification handler to reflect its purpose.
- Add a run handler that flushes pending edits before emitting `UiEvent.StartAgentFromSpec`.
- Route `KeyboardShortcutAction.RunSpecAgent` to the new run handler.
- Route `KeyboardShortcutAction.RefineSpec` to clarification.
- Render a neutral `Clarify` button and a separate green `Run` button.

**Step 2: Run test to verify it passes**

Run: `bunx vitest run src/components/specs/SpecEditor.test.tsx`

Expected: PASS

### Task 3: Verify and document

**Files:**
- Modify: `CHANGES.md`

**Step 1: Update change log**

- Document the preview toolbar split and the new `Mod+Enter` behavior.

**Step 2: Run full validation**

Run: `just test`

Expected: PASS
