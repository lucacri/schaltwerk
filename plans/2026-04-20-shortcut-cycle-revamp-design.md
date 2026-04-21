# Shortcut Cycle Revamp Design

## Context

Keyboard navigation currently splits project and sidebar-item cycling across overlapping shortcuts. `Cmd+\`` and `Cmd+Shift+\`` already provide a clean next/previous project-tab pair, but `SelectPrevProject` and `SelectNextProject` also bind `Cmd+Shift+ArrowLeft` and `Cmd+Shift+ArrowRight` to the same behavior. Sidebar-item traversal uses `Cmd+ArrowUp` and `Cmd+ArrowDown`, which already walk the correct flattened sidebar list including the orchestrator anchor and version-group members.

## Approaches

1. Keep the existing action model and only add `Option+\`` bindings on top.
   This would leave duplicate project shortcuts in the settings catalog and keep extra callback wiring alive for no user benefit.

2. Reassign sidebar-item cycling to `Option+\`` / `Option+Shift+\`` by extending the existing session-navigation actions, while deleting the duplicate project-arrow actions entirely.
   This preserves the current traversal logic, keeps project cycling on `Cmd+\``, and removes dead configuration and UI rows.

3. Replace the sidebar-item actions with new dedicated backtick actions.
   This adds new action names and settings surface area even though the existing `selectPrev` / `selectNext` behavior is already the right implementation.

Recommended approach: option 2.

## Design

Update `SelectNextSession` to default to both `Mod+ArrowDown` and `Alt+\``, and `SelectPrevSession` to default to both `Mod+ArrowUp` and `Alt+Shift+\``. Keep `CycleNextProject` and `CyclePrevProject` unchanged at `Mod+\`` and `Mod+Shift+\`` so the backtick split stays mnemonic: Command for project tabs, Option for sidebar items, Shift for reverse.

Remove `SelectPrevProject` and `SelectNextProject` from the keyboard shortcut action enum, default config, metadata catalog, hook callback surface, and the `App`/`Sidebar` plumbing that only forwarded those duplicate handlers into `switchProject('prev'|'next')`. The remaining project navigation surface is `SwitchToProject1-9` plus `CycleNextProject` / `CyclePrevProject`.

Update user-facing references so settings and docs describe the new shortcut model. The sidebar-item copy should describe the flattened sidebar list rather than generic “sessions”, and the project-tab docs should stop referencing `Cmd+Shift+ArrowLeft` / `Cmd+Shift+ArrowRight`.

## Testing

- Add hook tests that prove `Option+\`` and `Option+Shift+\`` trigger the same callbacks as `Cmd+ArrowDown` and `Cmd+ArrowUp`.
- Add config/metadata assertions that the removed project-arrow actions no longer exist in the catalog and that the session-navigation defaults include both arrow and Option-backtick bindings.
- Run the affected Vitest suites first, then `just test`.
