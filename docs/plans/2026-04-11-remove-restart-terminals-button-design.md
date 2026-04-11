# Remove Restart Terminals Button Design

## Context

The manual `Restart terminals` action is currently exposed in two user-facing button surfaces:

- `src/components/session/SessionActions.tsx` for selected session cards and compact rows
- `src/components/diff/DiffSessionActions.tsx` for the diff viewer header

The backend restart command is still used elsewhere for targeted recovery, including the forge connection issue toast in `src/App.tsx`. The request is to remove the button because it is unused, not to remove the restart capability entirely.

## Approaches Considered

### 1. Remove only the session card button

This is the smallest visual change, but it leaves the same manual action in the diff header. That keeps an inconsistent UI and does not really satisfy the request.

### 2. Remove all manual restart-terminal buttons, keep non-button recovery paths

This removes the explicit action from normal workflow surfaces while preserving the backend command and the app-triggered recovery path when the app detects a connection issue. It reduces UI clutter without weakening operational recovery.

Recommended.

### 3. Hide the button behind a setting or overflow menu

This keeps the feature reachable, but adds more surface area and settings complexity for a feature the user explicitly does not want. It is unnecessary.

## Design

Remove the manual restart-terminal buttons from:

- session action rows rendered through `SessionActions`
- diff viewer header actions rendered through `DiffSessionActions`

Keep:

- `TauriCommands.RestartSessionTerminals`
- backend restart command wiring
- the forge connection issue toast action in `src/App.tsx`

Also remove now-unused prop plumbing that exists only to render the manual session action button, including the `onRestartTerminals` action passed through the sidebar session-card context.

## Testing

- Update `src/components/diff/DiffSessionActions.test.tsx` to assert the restart button is absent while the reset button remains.
- Add a `SessionActions` regression test that asserts no restart-terminals button is rendered even when the legacy callback prop is supplied.
- Run the targeted tests first, then the full project validation suite.
