# Reorder Raw Agents in Start New Agent Modal — Design

## Problem

The Start New Agent modal composes its option list as: `[spec, ...userPresets, ...rawAgents]`.
Preset order is user-configurable (`favoriteOrder` atom + `get/set_favorite_order` Tauri commands).
Raw agents (Claude, Copilot, OpenCode, Gemini, Codex, Droid, Qwen, Amp, KiloCode, Terminal)
are emitted in the hardcoded order of `AGENT_TYPES` in `src/types/session.ts` and cannot be
reordered. Since `⌘1`–`⌘9` shortcuts are assigned by composed-list position, users cannot
place their preferred raw agents in the fastest-to-reach slots.

## Goal

Let the user reorder raw agents — as an independent list from presets — and persist that
order globally. Spec remains pinned first.

## Approach

Mirror the existing preset-order pattern end to end. This is the recommended approach
because the preset-order infrastructure is the closest analog and already proven:

- **Rust settings**: add `raw_agent_order: Vec<String>` to `Settings` alongside `favorite_order`.
- **Tauri commands**: add `get_raw_agent_order` / `set_raw_agent_order` mirroring the favorite-order pair.
- **Frontend atom**: add `rawAgentOrder` atom + loader/saver mirroring `favoriteOrder.ts`.
- **Composition**: in `favoriteOptions.ts`, sort the raw agents slice by `rawAgentOrder` (known agents first in saved order, then any agent not yet in the saved order in `AGENT_TYPES` order). Enabled filter still applies afterward.
- **Settings UI**: add a reorderable list of the *enabled* raw agents to the existing Agent Configuration tab. Reuse whatever drag/move UX the preset list uses for consistency.
- **Shortcuts**: unchanged — `⌘1`–`⌘9` continue to follow composed-list position, which now reflects user ordering.

## Data Flow

1. User opens Settings → Agent Configuration, sees enabled raw agents listed in current order.
2. User drags/moves to reorder. UI calls `saveRawAgentOrderAtom` → `invoke('set_raw_agent_order', …)`.
3. Rust writes `settings.json`.
4. On next Start New Agent modal open, `buildFavoriteOptions()` reads `rawAgentOrder` and emits raw agents in the saved order.
5. Shortcut indices (⌘1–⌘9) are re-derived from composed-list position — no explicit mapping needed.

## Ordering Semantics

`rawAgentOrder: string[]` stores agent type identifiers. When composing raw agents:
1. Start with enabled agents filtered from `AGENT_TYPES`.
2. Partition into "ordered" (appears in `rawAgentOrder`) and "unordered" (doesn't).
3. Emit ordered agents in `rawAgentOrder` sequence (skipping any that are no longer enabled or no longer valid agent types), then emit unordered agents in `AGENT_TYPES` sequence.

This means newly added agent types automatically appear at the end without requiring migration, and orphaned entries are ignored gracefully.

## Error Handling

- Load failure → fall back to empty order (i.e., `AGENT_TYPES` default order). Log via `logger`.
- Save failure → hook surfaces the error to the settings UI (mirror existing pattern).
- Invalid entries in persisted order (unknown agent string, duplicates) → filtered/deduplicated at compose time; no throw.

## Testing

- **Atom**: load success/failure, save success/failure, Tauri command called with correct args.
- **Composition**: `buildFavoriteOptions()` with (a) empty order → matches current behavior, (b) partial order → saved agents first, rest fall back to `AGENT_TYPES` order, (c) order containing disabled agent → disabled filtered out, (d) order containing unknown string → ignored.
- **Shortcut assignment**: after reorder, first 9 composed items receive ⌘1–⌘9 in new sequence.
- **Rust service**: round-trip persistence for `raw_agent_order`.
- **Tauri commands**: smoke test the two new handlers.
- **Settings UI**: user can reorder; only enabled agents appear in the list.

## Out of Scope

- Preset ordering UX changes
- Enable/disable UX changes
- Adding new agent types
- Reordering Spec
