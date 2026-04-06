# Standalone Style Guide Page Design

## Goal

Add a browser-only component gallery at `style-guide.html` so `bun run dev` can render Lucode UI primitives, settings panels, modal content, and theme tokens without starting the Tauri backend.

## Chosen Approach

Use a second root HTML entry handled by the main Vite config and a dedicated `src/style-guide.tsx` entry module. The style-guide entry will import the normal app CSS, mount a minimal Jotai store, and install a browser-only Tauri shim that answers the specific frontend commands needed by the showcased components.

This keeps the main app untouched while letting the gallery render the real primitive and settings components. For components that rely on fixed overlays or integration contexts, the style guide will render inline preview compositions that preserve the visual treatment without taking over the page.

## Architecture

### Entry points

- Add `style-guide.html` beside `index.html` with the same anti-flash structure and a `/src/style-guide.tsx` script entry.
- Update `vite.config.ts` to include both `index.html` and `style-guide.html` in `rollupOptions.input`.

### Browser-only runtime

- `src/style-guide.tsx` will:
  - import `src/index.css`
  - create a dedicated Jotai store
  - install `window.__TAURI_INTERNALS__` with an `invoke` implementation that returns mock data for theme, language, agent variants, presets, and contextual actions
  - initialize the theme atom from the URL query param or local storage fallback
  - render the gallery inside `JotaiProvider`

### Gallery composition

- `src/style-guide/StyleGuide.tsx` will own the page shell, sticky toolbar, and section layout.
- Section files under `src/style-guide/sections/` will keep the gallery readable and isolated.
- `src/style-guide/mocks.tsx` will centralize mock datasets and shared helpers for theme options and command responses.

## Component strategy

### Real components

Render the real implementations for:

- UI primitives in `src/components/ui`
- `InlineEditableText`, `IconButton`, `LoadingSpinner`, `SearchBox`
- `AgentPresetsSettings`, `AgentVariantsSettings`, `ContextualActionsSettings`, `ThemeSettings`

The settings panels can use their real code because their hooks read Jotai atoms backed by Tauri `invoke`, which the style guide can satisfy through the browser shim.

### Inline preview wrappers

Render inline preview content instead of live fullscreen overlays for:

- `ConfirmResetDialog`
- `ConfirmDiscardDialog`
- `ConfirmModal`
- `LinkPrModal`

These components use fixed positioning or external integration hooks that are not worth reproducing in a dev-only gallery. Inline preview wrappers will preserve the actual typography, spacing, and hardcoded slate styling the spec wants to inspect.

## Theme handling

- Supported gallery themes: `dark`, `light`, `tokyonight`, `gruvbox`, `catppuccin`, `catppuccin-macchiato`, `everforest`, `ayu`, `kanagawa`, `darcula`
- The sticky toolbar will expose a themed `Select` for switching themes.
- Theme changes will update `data-theme` on `<html>` and persist to local storage via the mock `SetTheme` command path.

## Testing

- Add an entry test for `src/style-guide.tsx` similar to `src/main.test.tsx`.
- Add a focused gallery test for `src/style-guide/StyleGuide.tsx` that verifies the required sections and theme selector options render.
- Rely on the full existing validation suite afterward for lint, type-check, build, and architecture rules.
