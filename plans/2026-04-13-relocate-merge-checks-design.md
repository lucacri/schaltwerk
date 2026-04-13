# Relocate Merge Checks Design

## Context

The agents sidebar currently passes `ready_to_merge_checks` into `SessionActions` from both `SessionCard` and `CompactVersionRow`. `SessionActions` renders a labeled "Merge checks" list whenever those checks are present for a non-spec session, so the check details appear while scanning sessions.

`DiffSessionActions` already owns session-specific controls for the diff view and receives `targetSession`, which includes `info.ready_to_merge_checks`. The diff modal side panel is rendered by `DiffFileExplorer` in `UnifiedDiffView`.

## Approaches

1. Move the existing readiness list markup from `SessionActions` into `DiffSessionActions`.
   - Lowest code movement, but it would duplicate label mapping concerns if the list is ever reused again.

2. Extract a small `MergeReadinessChecks` component and render it only from `DiffSessionActions`.
   - Keeps the visual block reusable without leaving sidebar behavior behind. This is the chosen approach.

3. Move the markup directly into `DiffFileExplorer`.
   - Places the block exactly in the side panel, but couples a generic file explorer to session readiness data.

## Design

Create a small presentational component that accepts `SessionReadyToMergeCheck[]`, returns `null` for empty input, and uses the existing `sessionActions.mergeChecks` and per-check i18n strings. `SessionActions` will stop accepting and rendering `readinessChecks`.

`DiffSessionActions` will expose a new render-prop part for side panel content. It will derive that content from `targetSession.info.ready_to_merge_checks`, gated by `isSessionSelection`, and render the extracted check list.

`UnifiedDiffView` will pass the side panel content into `DiffFileExplorer`. `DiffFileExplorer` will accept an optional `footerContent` node and render it in a bottom side-panel block outside the file list, while existing review controls remain below it when active.

## Testing

Add red tests first:

- `SessionActions` does not render the "Merge checks" block even if readiness checks are passed.
- `DiffSessionActions` exposes the "Merge checks" block for session selections with readiness checks.
- `DiffSessionActions` does not expose the block for non-session selections.

Then implement the minimal UI-only changes and run targeted Vitest tests before the full suite.
