# MarkdownEditor Accessibility — Design

## Problem

CodeMirror-backed `MarkdownEditor` (used in NewSessionModal "Prompt / Context", SpecEditor, SpecContentView, SettingsModal setup script) is not recognized as a writable text input by macOS Dictation / Voice Control. Keyboard typing works; voice input cannot target the field.

CodeMirror 6 already applies `contenteditable="true"` and (by default) `role="textbox"` + `aria-multiline="true"` to `.cm-content`. The missing piece is an **accessible name** (`aria-label` / `aria-labelledby`). Without one, macOS Voice Control does not treat the element as a focusable/dictatable text field.

## Approach

Fix inside the shared `MarkdownEditor` component so every caller benefits.

Use CodeMirror's `EditorView.contentAttributes.of({...})` extension to apply ARIA attributes directly to the editable `.cm-content` node. This is the officially supported CM6 mechanism; it writes the attributes at the DOM level where dictation/VoiceOver read them.

Apply:
- `role="textbox"` (explicit; matches CM's default but removes ambiguity)
- `aria-multiline="true"`
- `aria-label` from new prop (fallback to placeholder if not provided — better than nothing)
- `aria-labelledby` from new prop (takes precedence over aria-label when set)
- `aria-readonly="true"` when `readOnly`

Add `ariaLabel` and `ariaLabelledBy` optional props. Update all four callers to pass a meaningful label.

## Alternatives Rejected

1. **Swap to `<textarea>`** — ruled out by spec (loses CM features).
2. **Swap to a different editor** — only if CM can't expose semantics. CM supports `contentAttributes`, so unnecessary.
3. **Wrap editor in a `<label>`** — CM eats click/focus on the wrapper; attribute-level ARIA on `.cm-content` is the correct CM6 pattern.

## Components

### MarkdownEditor (src/components/specs/MarkdownEditor.tsx)

New props:
```ts
ariaLabel?: string
ariaLabelledBy?: string
```

New memoised extension:
```ts
const a11yAttributes = useMemo<Extension>(() => {
  const attrs: Record<string, string> = {
    role: 'textbox',
    'aria-multiline': 'true',
  }
  if (ariaLabelledBy) attrs['aria-labelledby'] = ariaLabelledBy
  else if (ariaLabel) attrs['aria-label'] = ariaLabel
  else if (placeholder) attrs['aria-label'] = placeholder
  if (readOnly) attrs['aria-readonly'] = 'true'
  return EditorView.contentAttributes.of(attrs)
}, [ariaLabel, ariaLabelledBy, placeholder, readOnly])
```

Add to extensions array (stable identity via `useMemo`).

### Callers

- `NewSessionModal.tsx` → `ariaLabel="Prompt and context"` (+ i18n key)
- `SpecEditor.tsx` → `ariaLabel={t.specEditor.ariaLabel}` (new i18n key)
- `SpecContentView.tsx` → `ariaLabel={t.specContentView.ariaLabel}` (new i18n key)
- `SettingsModal.tsx` setup script editor → `ariaLabel="Setup script"` (+ i18n key)

i18n strings added to translation files.

## Testing

Unit tests in `MarkdownEditor.test.tsx`:
- Default: `contentAttributes` includes `role=textbox`, `aria-multiline=true`.
- With `ariaLabel`: attributes include `aria-label` with the provided value.
- With `ariaLabelledBy`: attributes include `aria-labelledby`; no `aria-label` emitted.
- `ariaLabelledBy` takes precedence over `ariaLabel`.
- With `readOnly`: `aria-readonly="true"` present.
- Placeholder fallback: when no `ariaLabel`/`ariaLabelledBy`, `aria-label` falls back to placeholder.

Test strategy: extract the `EditorView.contentAttributes` extension from the passed `extensions` prop and resolve it against a minimal `EditorState` to read the computed attribute object. (CM's `contentAttributes` facet is resolvable via `EditorState.create({ extensions }).facet(EditorView.contentAttributes)`.)

## Out of Scope

- SettingsModal setup script is bash, not markdown — still fine to use MarkdownEditor (current behaviour) and label it "Setup script".
- No visual/UX change; pure a11y.
