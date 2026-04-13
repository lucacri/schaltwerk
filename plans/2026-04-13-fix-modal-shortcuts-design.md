# Fix Modal Shortcuts Design

## Problem
Several global shortcuts in `src/hooks/useKeyboardShortcuts.ts` run even when a modal is open, stealing keys like `Cmd+1-9` (favorites in `NewSessionModal`), `Cmd+Y` (reset), and `Cmd+P` (switch model) from the active modal.

## Approach
Short-circuit the global `handleKeyDown` at the top when `isModalOpen` is true. This prevents any global shortcut from running `event.preventDefault()` or its callback while a modal owns the keyboard. Redundant `!isModalOpen &&` conditions deeper in the handler are removed.

### Alternatives considered
- Guarding each shortcut individually: verbose, easy to regress when new shortcuts are added.
- Letting each callback self-guard via `isAnyModalOpen()`: leaks modal awareness into callers and still calls `preventDefault()` — losing modal keystrokes.

The early-return is the simplest and most maintainable option.

## Testing
- TDD: new vitest cases in `src/hooks/useKeyboardShortcuts.test.tsx` assert the following are no-ops with `isModalOpen: true`:
  - `SwitchToOrchestrator` (Cmd+1)
  - `SwitchToSession` (Cmd+2)
  - `ResetSessionOrOrchestrator` (Cmd+Y)
  - `OpenSwitchModelModal` (Cmd+P)
  - `OpenDiffViewer`, `OpenSettings`, `CreatePullRequest`, `OpenMergeModal`, `UpdateSessionFromParent`, cancel variants, focus claude/terminal, refine/convert/promote spec.
- Existing modal-aware tests (arrows, project cycle) must continue to pass.
- Full suite: `just test`.
