# New Session Modal Redesign: Favorites-First UX

**Date:** 2026-04-07
**Status:** Approved

## Problem

The current "Start new agent" modal shows all configuration options at once — agent type, permissions, model, reasoning, branch, CLI args, env vars. For users who rotate between 2-3 fixed configurations (e.g. "Claude skip-perms", "Codex GPT-5.4 skip-perms", a custom preset), this is unnecessary friction. The common flow is: pick a known config, type a prompt, go.

## Design: Favorites Bar + Collapsed Config

### Modal Layout (top to bottom)

1. **Header** — "Start new agent" + close button (unchanged)
2. **Agent name + Epic** — two-column row: name input with generate button (left), Epic dropdown (right)
3. **Favorites row** — horizontally scrollable row of large card-style buttons
4. **Prompt editor** — "Initial prompt (optional)" + "Start from..." button + markdown editor + hint text
5. **Customize accordion** — collapsed by default, contains all remaining configuration
6. **Footer** — version selector + Cancel + Start Agent (unchanged)

### Favorites Row

Each favorite card (~140×70px) shows:
- **Agent color accent** — left border bar matching the agent's theme color
- **Name** — agent name or preset name (e.g. "Claude", "Codex", "Smarts")
- **Keyboard shortcut** — `⌘1`, `⌘2`, `⌘3` etc. in a kbd badge
- **Summary line** — compact key settings: "skip perms" / "GPT-5.4 · skip" / "3 agents"

#### Behavior
- Clicking a card selects it (blue border highlight), pre-fills all agent config
- Clicking the already-selected card deselects it (reverts to manual config)
- `⌘1`–`⌘9` shortcuts work when the modal is open, **overriding any app-level shortcuts behind it**
- The first favorite is auto-selected when the modal opens — user can immediately type prompt and hit `⌘↵`
- Cards are scrollable horizontally if there are more than fit the modal width

#### Data Source
- Favorites = agent variants + agent presets, merged into one ordered list
- A new `favoriteOrder: string[]` field in settings stores display order (array of variant/preset IDs)
- Managed in the existing Settings UI (variants/presets screens) — no new settings screen needed
- Favorites without an explicit order appear after ordered ones, sorted alphabetically

### Customize Accordion

Collapsed by default when a favorite is selected. Contains:

1. **Base branch** + **Use existing branch** checkbox + **Branch name (optional)**
3. **Agent** dropdown + **Permissions toggles** (Require/Skip) + **Full autonomous**
4. **Model** + **Reasoning effort** (agent-specific, e.g. Codex)
5. **Agent | Preset** tab bar
6. **Advanced agent settings** (CLI args, env vars) — nested collapsible

#### Override Behavior
- When a favorite is selected and Customize is expanded, all fields are pre-filled from the favorite's saved config
- Changing any field shows a subtle "(modified)" badge on the selected favorite card
- Changes are session-only overrides — they do not modify the saved favorite/preset
- "Create as spec" checkbox also lives in Customize

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No favorites configured | Customize section starts expanded (full current form). Hint: "Set up favorites in Settings for quick access." |
| Agent not on PATH | Card is dimmed/disabled with tooltip. Keyboard shortcut skips it. |
| Spec mode | Favorites row stays visible (tags which agent). Start button → "Create Spec". Branch/permissions hidden. |
| Multi-agent preset | Selecting it auto-sets the version count in the footer. |
| Keyboard shortcut scoping | `⌘1`–`⌘9` captured by modal when open, released on close. |

### Wireframe Reference

The Pencil design file at `design/new-session-modal.pen` contains:
- **Left frame** (`NewSessionModal - Current`): reference of the current modal
- **Right frame** (`NewSessionModal - Redesign`): to be updated with the new layout

## Non-Goals

- New settings UI for managing favorites (reuse existing presets/variants screens)
- Changing the session creation backend (same `onCreate` payload)
- Changing the footer behavior (version selector, cancel, start)
