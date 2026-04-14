# MarkdownEditor Accessibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `MarkdownEditor` recognizable to macOS Dictation / Voice Control by exposing ARIA textbox semantics, and thread an accessible name from every caller.

**Architecture:** Add `ariaLabel` / `ariaLabelledBy` props to `MarkdownEditor`. Use `EditorView.contentAttributes.of({...})` to write `role`, `aria-multiline`, `aria-label`/`aria-labelledby`, and `aria-readonly` onto `.cm-content`. Update four callers + i18n.

**Tech Stack:** React, CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/view`, `@codemirror/state`), Vitest.

---

## Task 1: Tests for a11y attribute extension

**Files:**
- Modify: `src/components/specs/MarkdownEditor.test.tsx`

**Step 1: Add a helper that resolves `contentAttributes` from the captured extensions.**

Use `EditorState.create({ extensions }).facet(EditorView.contentAttributes)` — this returns the merged attribute object (CM resolves facet values deterministically).

**Step 2: Add these failing tests:**

```ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

function resolveContentAttributes(extensions: Extension[]): Record<string, string> {
  const state = EditorState.create({ extensions })
  const raw = state.facet(EditorView.contentAttributes)
  const merged: Record<string, string> = {}
  for (const entry of raw) {
    const value = typeof entry === 'function' ? entry(null as unknown as EditorView) : entry
    Object.assign(merged, value)
  }
  return merged
}

it('sets role=textbox and aria-multiline by default', () => {
  const attrs = resolveContentAttributes(captureExtensions())
  expect(attrs.role).toBe('textbox')
  expect(attrs['aria-multiline']).toBe('true')
})

it('uses placeholder as aria-label fallback when no ariaLabel is provided', () => {
  const attrs = resolveContentAttributes(captureExtensions({ placeholder: 'Describe…' }))
  expect(attrs['aria-label']).toBe('Describe…')
})

it('uses ariaLabel prop when provided', () => {
  const attrs = resolveContentAttributes(captureExtensions({ ariaLabel: 'Prompt and context' }))
  expect(attrs['aria-label']).toBe('Prompt and context')
})

it('prefers ariaLabelledBy over ariaLabel and omits aria-label', () => {
  const attrs = resolveContentAttributes(captureExtensions({ ariaLabel: 'x', ariaLabelledBy: 'prompt-label' }))
  expect(attrs['aria-labelledby']).toBe('prompt-label')
  expect(attrs['aria-label']).toBeUndefined()
})

it('sets aria-readonly when readOnly', () => {
  const attrs = resolveContentAttributes(captureExtensions({ readOnly: true }))
  expect(attrs['aria-readonly']).toBe('true')
})
```

**Step 3: Run tests → all 5 new tests fail.**

**Step 4: Commit the failing tests on a separate branch? No — stay on current branch; tests + impl land in a single squashed commit at the end.**

---

## Task 2: Implement a11y extension in `MarkdownEditor`

**Files:**
- Modify: `src/components/specs/MarkdownEditor.tsx`

**Step 1:** Extend props:

```ts
interface MarkdownEditorProps {
  // …existing props
  ariaLabel?: string
  ariaLabelledBy?: string
}
```

**Step 2:** Add memoised extension:

```ts
const a11yAttributes = useMemo<Extension>(() => {
  const attrs: Record<string, string> = {
    role: 'textbox',
    'aria-multiline': 'true',
  }
  if (ariaLabelledBy) {
    attrs['aria-labelledby'] = ariaLabelledBy
  } else if (ariaLabel) {
    attrs['aria-label'] = ariaLabel
  } else if (placeholder) {
    attrs['aria-label'] = placeholder
  }
  if (readOnly) {
    attrs['aria-readonly'] = 'true'
  }
  return EditorView.contentAttributes.of(attrs)
}, [ariaLabel, ariaLabelledBy, placeholder, readOnly])
```

**Step 3:** Add `a11yAttributes` to the `extensions` `useMemo` dependency array and spread into the returned array.

**Step 4:** Run tests → all pass.

---

## Task 3: Thread ariaLabel from callers + i18n

**Files:**
- Modify: `src/common/i18n/types.ts`
  - Add `promptAriaLabel: string` to `newSessionModal`
  - Add `specAriaLabel: string` to `specEditor`
  - Add `specAriaLabel: string` to `specContentView`
  - Add `setupScriptAriaLabel: string` to `settings.projectRun`
- Modify: `src/locales/en.json` — add four matching keys:
  - `newSessionModal.promptAriaLabel`: `"Prompt and context"`
  - `specEditor.specAriaLabel`: `"Spec content"`
  - `specContentView.specAriaLabel`: `"Spec content"`
  - `settings.projectRun.setupScriptAriaLabel`: `"Setup script"`
- Modify: `src/locales/zh.json` — same keys with zh translations (mirror style from neighboring strings):
  - `newSessionModal.promptAriaLabel`: `"提示与上下文"`
  - `specEditor.specAriaLabel`: `"规格内容"`
  - `specContentView.specAriaLabel`: `"规格内容"`
  - `settings.projectRun.setupScriptAriaLabel`: `"设置脚本"`
- Modify callers to pass `ariaLabel={t.…}`:
  - `src/components/modals/NewSessionModal.tsx:463`
  - `src/components/specs/SpecEditor.tsx:813`
  - `src/components/specs/SpecContentView.tsx:118`
  - `src/components/modals/SettingsModal.tsx:1359`

**Step 1:** Update types.
**Step 2:** Update locales (en, zh).
**Step 3:** Pass `ariaLabel` in each caller.
**Step 4:** Run `bun run test`.

---

## Task 4: Validation + commit

**Step 1:** Run `just test` (full suite: TS lint, Rust clippy, cargo shear, knip, vitest, cargo nextest).
**Step 2:** If everything is green, stage all modified files and create one squashed commit:

```
fix(a11y): expose MarkdownEditor as ARIA textbox for dictation
```
