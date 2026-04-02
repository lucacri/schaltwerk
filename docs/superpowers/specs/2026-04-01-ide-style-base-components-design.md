# IDE-Style Base Components Design

## Goal

Replace the current mix of native browser form controls and ad-hoc `.settings-*` styling with a shared UI component layer that feels like a JetBrains Darcula settings panel: compact, flat, quiet, and visually consistent.

## Existing Context

- `src/components/modals/SettingsModal.tsx` contains the largest concentration of raw `<input>`, `<select>`, `<textarea>`, and legacy `.settings-btn*` classes.
- `src/index.css` still owns the old settings button and select styles, which are reused by multiple files under `src/components/settings/` and a few modal/integration screens.
- `src/components/inputs/Dropdown.tsx` already solves the hardest part of the custom select: viewport-relative positioning in a portal and global keyboard handling patterns.
- Theme tokens already exist for panel, text, border, accent, and typography; form-control-specific tokens do not.

## Design Principles

- Tune the look for `darcula` first; other themes keep working by consuming the same CSS variables.
- Make controls share one visual rhythm: default inline height `30px`, smaller actions `24px`, larger slots only when explicitly needed.
- Prefer flat surfaces with muted contrast shifts rather than shadows or gradients.
- Keep components accessible by default: proper roles, labels, keyboard support, disabled semantics, and error announcements.
- Keep migration pragmatic: replace legacy settings styling everywhere it is currently shared, and only leave native controls in genuinely specialized flows that should not collapse into the new base layer yet.

## Approaches Considered

### 1. Thin wrappers around native elements

- Lowest implementation cost.
- Works well for `TextInput`, `Textarea`, and `Button`.
- Fails the request for a truly custom checkbox and select, and keeps too much browser-specific behavior.

### 2. Full custom primitives for every control

- Maximum visual control.
- Highest implementation and regression risk, especially for text editing and accessibility.
- Overkill for text fields that already behave correctly when restyled.

### 3. Hybrid component layer (recommended)

- Use styled native elements for text entry.
- Build custom interaction layers only where native UI is the core problem (`Checkbox`, `Toggle`, `Select`).
- Reuse the existing dropdown geometry/portal approach so the select behaves like the rest of the app.

This gives the Darcula polish the feature needs without replacing reliable browser behavior unnecessarily.

## Component Architecture

### Shared Foundation

- Add control tokens to `src/styles/themes/base.css` for height, padding, and radius.
- Add per-theme aliases for `--control-bg`, `--control-bg-hover`, `--control-border`, `--control-border-focus`, and `--control-border-error` in every theme file.
- Expose those tokens in `src/common/theme.ts` as `theme.control.*` so TS-only styling can reference the same values.
- Create a small shared style helper in `src/components/ui/` to keep spacing, border, and focus behavior consistent across components.

### `Button`

- One primitive with `default`, `primary`, `danger`, `ghost`, and `dashed` variants.
- `sm` and `md` sizes map directly to control height tokens.
- Loading state swaps content for a compact spinner and prevents duplicate clicks.

### `Checkbox`

- Hidden native checkbox for semantics plus a styled visual box.
- Supports `checked`, `disabled`, and `indeterminate` states.
- Visual mark is an SVG check or mixed bar inside a compact 14px box.

### `Toggle`

- Button with `role="switch"`.
- Uses muted track + sliding knob, with deterministic CSS transition only.
- Optional inline label for settings rows.

### `TextInput` and `Textarea`

- Styled wrappers around native controls.
- Support inline icon/right-slot layout for search and action affordances.
- Error state controls border + message rendering without changing markup structure in every caller.

### `Select`

- Custom trigger + portal listbox built with dropdown geometry utilities.
- Keyboard support: open via Enter/Space/Arrow keys, navigate with arrows, select with Enter, close with Escape, prefix type-ahead while open.
- Placeholder rendering when no value is selected.
- Highlighted and selected states tuned for Darcula elevated surfaces.

### `Label`, `FormGroup`, `SectionHeader`

- Lightweight layout primitives used to normalize settings rows and reduce repeated typography classes.
- `FormGroup` owns helper/error copy so consumers stop hand-authoring the same caption stack.

## Migration Plan

### Wave 1: Infrastructure and primitives

- Add theme tokens.
- Build `src/components/ui/*` components.
- Add focused Vitest coverage for rendering, disabled states, keyboard interaction, and accessibility contracts.

### Wave 2: `SettingsModal`

- Replace raw inputs, selects, textareas, checkbox rows, and button classes in `src/components/modals/SettingsModal.tsx`.
- Use `SectionHeader`/`FormGroup` selectively where they remove repeated label/help scaffolding without forcing a broad layout rewrite.
- Keep the existing layout structure and tab architecture intact.

### Wave 3: Shared settings surfaces

- Replace `.settings-btn*` and `.settings-select` usages in supporting settings/integration components under `src/components/settings/` and related modal helpers.
- Sweep for now-redundant settings CSS and delete it from `src/index.css`.
- Leave highly specialized controls (for example CodeMirror-backed editors) on their existing implementation when the new base primitives would not be a clear upgrade.

## Testing Strategy

- Follow TDD for each primitive: write component tests first, verify failure, then implement.
- `Select` tests cover mouse open/select, arrow navigation, Escape close, disabled options, and type-ahead.
- `Checkbox`, `Toggle`, and `Button` tests cover ARIA roles, disabled behavior, and callback contracts.
- `FormGroup` tests cover label/help/error wiring.
- Existing modal tests get updated where selectors or interaction semantics change.
- Final validation uses `just test`, with Darcula as the primary visual target.

## Risks and Mitigations

- Custom select regressions: mitigate by reusing the established portal/geometry model instead of inventing a second positioning system.
- Broad migration churn: keep callers close to existing control semantics and migrate legacy settings CSS users first.
- Theme breakage outside Darcula: avoid hardcoded values and keep all styling derived from theme variables.

## Success Criteria

- Settings surfaces no longer rely on `.settings-btn*` or `.settings-select`.
- `SettingsModal` reads as one coherent IDE-style UI in Darcula.
- New controls are reusable from `src/components/ui/index.ts`.
- Component and modal tests cover the new behaviors.
