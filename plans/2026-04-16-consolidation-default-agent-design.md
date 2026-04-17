# Consolidation default agent / preset — design

## Problem

Launching a consolidation round has no persisted user preference for the driving agent. Two moments have no default today:

- **Candidate launch** — `src/App.tsx:1606` emits a `NewSessionPrefill` with `isConsolidation: true, consolidationRole: 'candidate'` but no `agentType`/`presetId`; `NewSessionModal` forces the user to re-pick the favorite every time.
- **Judge launch** — `create_and_start_judge_session` (`src-tauri/src/mcp_api.rs:6210`) chooses `agent_type` as `candidate_sessions.iter().find_map(|s| s.original_agent_type.clone())`.

Goal: a single persisted preference drives both moments.

## Decision

- One shared setting. Applies to candidate launch and (transitively) to judge launch.
- Supports either a **raw agent** (`AgentType`) or a **preset** (`AgentPreset.id`). Mirrors the existing `ContextualAction` shape (`src-tauri/src/domains/settings/types.rs:395`) which also accepts either.
- Persisted globally in `app_config`, alongside `spec_clarification_agent_type`. Tauri commands mirror that pattern.
- Judge resolution unchanged: it inherits `original_agent_type` from candidate[0]. For an agent default, all candidates share that agent → judge uses it. For a preset default, candidate[0] carries slot[0]'s agent → judge uses slot[0]'s agent. Matches the requirement.

## Storage

`app_config` gets two nullable columns (at most one non-null; both null = unset):

```
consolidation_default_agent_type TEXT DEFAULT 'claude'
consolidation_default_preset_id TEXT DEFAULT NULL
```

Default `agent_type = 'claude'` so a fresh install has a sensible baseline, matching `spec_clarification_agent_type`.

Setter normalizes: writing a preset clears `agent_type`; writing an agent clears `preset_id`.

## Tauri surface

```
schaltwerk_core_get_consolidation_default_favorite() -> { agentType?: string, presetId?: string }
schaltwerk_core_set_consolidation_default_favorite({ agentType?, presetId? }) -> ()
```

Added to `src/common/tauriCommands.ts` as `SchaltwerkCoreGetConsolidationDefaultFavorite` / `SchaltwerkCoreSetConsolidationDefaultFavorite`.

`AppConfigMethods` gains `get_consolidation_default_favorite` / `set_consolidation_default_favorite` returning/taking a small `ConsolidationDefaultFavorite { agent_type: Option<String>, preset_id: Option<String> }` struct.

## Frontend wiring

### SettingsModal (project general tab)

New `FormGroup` row directly below the spec-clarification agent row (`src/components/modals/SettingsModal.tsx:1261`). A `Dropdown` lists every `FavoriteOption` except the spec option — i.e., all presets (when all slots are enabled + available) and all raw agents. Stored value = `{ agentType }` or `{ presetId }`. Label: "Default consolidation agent". Help: "Pre-selects this agent or preset when launching a consolidation round."

Hook additions (`src/hooks/useClaudeSession.ts`): `getConsolidationDefaultFavorite` / `setConsolidationDefaultFavorite`.

### App.tsx consolidation prefill

Before emitting `UiEvent.NewSessionPrefill` for `consolidationRole: 'candidate'` (`src/App.tsx:1613`), load the default favorite. Merge into the detail:

- If `presetId` → `{ presetId }`
- Else if `agentType` → `{ agentType }`
- Else → no extra keys (preserves today's behavior)

`NewSessionModal` already honors both (`src/components/modals/NewSessionModal.tsx:206-214`).

### Judge

No code change. Judge inherits from candidate[0]'s `original_agent_type`, which now reflects the default.

## i18n

Add `projectGeneral.consolidationDefaultAgent` + `consolidationDefaultAgentDesc` to `src/common/i18n/types.ts`, `src/locales/en.json`, `src/locales/zh.json`.

## Tests (TDD order)

1. `db_app_config` — default returns `{ agent_type: Some("claude"), preset_id: None }`; set+get round-trips agent; set+get round-trips preset (clearing the other side); missing-column fallback.
2. `db_schema` — migration adds both columns idempotently.
3. Tauri commands — `get` returns shape; `set` with `{agentType}` clears preset_id; `set` with `{presetId}` clears agent_type; `set` with both empty clears both.
4. `useClaudeSession` — new getter/setter helpers call the right Tauri commands (matches existing test pattern for spec clarification).
5. `SettingsModal` — renders the new row under project general; selecting an agent or preset triggers save via the new setter on confirm (extends existing SettingsModal tests).
6. `App.tsx` consolidation effect — dispatching `UiEvent.ConsolidateVersionGroup` emits `NewSessionPrefill` whose detail includes `agentType` when the stored default is an agent, `presetId` when it's a preset, and neither when unset (test-only selector around the prefill emitter or via a small extracted helper).

## Out of scope

- A separate judge-only default.
- Exposing this in the MCP API.
- Per-project scoping (global like spec clarification).
- CHANGES.md automation (will be added as part of implementation, not design).
