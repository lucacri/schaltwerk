# Spec Preview Run/Clarify Design

## Problem

The spec preview toolbar currently presents `Clarify` as the primary green play action and routes `Mod+Enter` to clarification. Elsewhere in the product, the green play affordance means "start the spec", so the preview surface is visually and behaviorally inconsistent.

## Decision

Split the preview toolbar into two distinct actions:

- `Run` opens the existing start-from-spec flow via `UiEvent.StartAgentFromSpec`.
- `Clarify` keeps the existing clarification behavior and remains gated on clarification-agent readiness.
- `Mod+Enter` triggers `Run`.
- `Mod+Shift+R` remains the clarification shortcut.

## Scope

Modify only the preview/editor surface:

- `src/components/specs/SpecEditor.tsx`
- `src/components/specs/SpecEditor.test.tsx`
- `src/common/i18n/types.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `CHANGES.md`

## Test Strategy

- Add preview-toolbar tests for distinct `Clarify` and `Run` actions.
- Verify `Run` emits `UiEvent.StartAgentFromSpec`.
- Verify `Run` flushes pending spec edits before emitting the event.
- Verify `Mod+Enter` triggers `Run`.
- Verify `Mod+Shift+R` remains clarification-only and still respects clarification readiness.
