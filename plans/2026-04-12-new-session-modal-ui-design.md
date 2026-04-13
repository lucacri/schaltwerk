# New Session Modal UI — Design

## Goal

Rebuild `NewSessionModal` so the primary surface matches the composed `New Session Modal View` frame in `design/style-guide.pen` (node `ss6Yu`) while preserving the `SchaltwerkCoreCreateSession` payload contract the rest of the app depends on. Advanced configuration that the mockup drops is preserved behind a secondary `Custom settings…` affordance.

## Source of Truth

- Mockup: `design/style-guide.pen`, frame `ss6Yu` ("New Session Modal View").
- Reused primitives: `ResizableModal`, `FormGroup`, `TextInput`, `FavoriteCard`, `Dropdown`, `Button`, `MarkdownEditor`.
- Today's file: `src/components/modals/NewSessionModal.tsx` (~2.5k lines) is replaced in place.
- Sole caller: `src/App.tsx:2538` — `handleCreateSession` consumes the existing payload shape and must keep working unchanged.

## Scope

### In

- Header: title "Start New Agent", subtitle "Primary creation flow", close button.
- `Agent Name` input with helper "Auto-generated from the prompt until you edit it".
- One horizontally scrollable favorites row:
  1. **Spec only** card (id `__schaltwerk_spec__`).
  2. User presets from `useAgentPresets()`.
  3. Raw-agent cards, one per `AgentType` whose `enabledAgents[agent]` is `true` and whose `isAvailable(agent)` is `true` (from `useAgentAvailability()`).
- Markdown prompt editor with hint.
- Footer: version selector (enabled only for raw-agent cards), Cancel, Create, and a `Custom settings…` toggle.
- Keyboard shortcuts: `⌘1…⌘N` select the Nth favorite card (matches the badge).
- TDD coverage: favorites composition & ordering, version-selector enablement rule, shortcut bindings, create-payload shape for each card kind (spec / preset / raw agent with and without version count), and that `Custom settings…` reveals the advanced panel.

### Out

- Start-From button & `⌘⇧K`, Unified Search modal.
- Epic selector / inline epic CRUD.
- GitHub issue/PR selection cards.
- Repository-empty warning banner.
- Base-branch picker (uses persisted project default).
- Standalone agent-type picker (derived from the selected card).
- `Modified` pill.
- Consolidation controls.

## Architecture

### Primary modal: `NewSessionModal.tsx`

- Props stay byte-for-byte identical to today so `App.tsx` is untouched: `{ open, initialIsDraft?, cachedPrompt?, onPromptChange?, onClose, onCreate }` — `onCreate` still receives the full `CreateSessionPayload` union (unused fields simply remain undefined).
- State (flat): `name`, `userEditedName`, `prompt`, `selectedFavoriteId`, `versionCount`, `customSettingsOpen`, `advancedOverrides` (see below), `validationError`, `creating`.
- No longer tracks: epic, github issue/pr, consolidation, multi-agent mode, base-branch, custom-branch, useExistingBranch, prompt source, prefill flags for those, unified-search.
- Name auto-generation: initial `generateDockerStyleName()` is reused; each prompt edit (while `userEditedName` is false) refreshes via `promptToSessionName(prompt)` — same helper the old modal used.
- Base branch: resolved once from `getPersistedSessionDefaults().baseBranch` and memoised; the user cannot change it in this UI.
- Prefill via `UiEvent.NewSessionPrefill` keeps only: `name`, `taskContent`, optional `variantId`/`presetId` selection. Every other prefill field is ignored in the primary surface — documented in the plan so future callers know the advanced controls moved behind `Custom settings…`.

### Favorite composition

`src/components/modals/newSession/favoriteOptions.ts` — a pure helper:

```ts
type FavoriteOption =
  | { kind: 'spec'; id: typeof SPEC_FAVORITE_ID; title: 'Spec only'; summary: 'Prompt-only setup'; accentColor: string; disabled: false }
  | { kind: 'preset'; id: string; title: string; summary: string; accentColor: string; disabled: boolean; preset: AgentPreset }
  | { kind: 'agent'; id: `__agent__${AgentType}`; title: string; summary: string; accentColor: string; disabled: boolean; agentType: AgentType }

function buildFavoriteOptions(input: {
  presets: AgentPreset[]
  enabledAgents: EnabledAgents
  isAvailable: (agent: AgentType) => boolean
  presetOrder: string[]
}): FavoriteOption[]
```

Rules:
1. Always prepend the `spec` card.
2. Append presets in user-configured favorite order (from `useFavorites().favoriteOrder`, filtered to kind `preset`), skipping presets whose slots reference agents that are disabled in user settings (the card is hidden, not just greyed out).
3. Append raw-agent cards in `AGENT_TYPES` order, filtered to those with `enabledAgents[agent] === true` and `isAvailable(agent) === true`.
4. Accent colors reuse the existing `favoriteAccentColor` mapping; spec uses `var(--color-border-strong)`.

Total card count caps at `AGENT_TYPES.length + presets.length + 1`, which is well under 30 even at worst case. Shortcut labels `⌘1…⌘9` are shown on the first 9.

### Version selector rule

```
versionCountEnabled = selectedFavorite?.kind === 'agent'
```

- Selecting `spec` or a preset forces `versionCount = 1` and disables the dropdown (visually greyed).
- For raw-agent cards the current `Dropdown` + `VERSION_DROPDOWN_ITEMS` is reused (`1x…4x versions`).

### Custom Settings…

- The existing complex logic does **not** live in the primary modal any more. The affordance opens a nested inline panel (`NewSessionAdvancedPanel`) that renders below the favorites row and above the prompt when expanded (`aria-expanded`-driven).
- That panel exposes **only** the controls the spec still considers reachable: multi-agent allocations (`MultiAgentAllocationDropdown`), per-agent env vars / CLI args (`AgentDefaultsSection`), model / reasoning preferences, and an autonomy toggle. Anything dropped from the spec (epic, github, consolidation, base-branch override) stays deleted.
- Values from this panel merge into the submit payload. When collapsed, defaults come from the selected favorite (variant/preset config) or from per-agent persisted defaults.
- This keeps the "detailed configuration surface remains reachable" guarantee while letting the primary modal stay ~300 lines.

### Submit path

`handleCreate()` builds the payload based on card kind:

| Card         | Payload                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`       | `{ name, isSpec: true, draftContent: prompt, userEditedName, baseBranch: '' }`                                                                                  |
| `preset`     | `{ name, prompt?, agentType: primary, agentSlots, versionCount: slots.length, baseBranch, userEditedName }` + env/cli/model overrides from advanced panel       |
| `agent`      | `{ name, prompt?, agentType, versionCount, baseBranch, userEditedName, autonomyEnabled? }` + env/cli/model overrides from advanced panel                        |

Existing utilities (`normalizeAllocations`, preset-to-slot mapping) move into a small `buildCreatePayload(selection, advanced, prompt, name)` helper so it can be unit-tested in isolation.

### Data flow

1. Modal mount → `useFavorites`, `useAgentPresets`, `useAgentVariants`, `useAgentAvailability`, `useEnabledAgents`, `getPersistedSessionDefaults` all run. Everything is ready before `favoriteOptions` memoises (loading states render a skeleton card row).
2. User interactions update local state only. No Tauri calls until `Create` is clicked.
3. On submit, `onCreate(payload)` delegates to `App.handleCreateSession`, which keeps doing its existing Tauri invoke dance.
4. Errors returned from `onCreate` (rejected promise) surface in the inline `validationError` area under the name input.

### Keyboard & focus behaviour

- On open: focus jumps to the markdown editor if a favorite is already selected, else the name input (tests rely on this).
- `Escape` closes via `ResizableModal`.
- `⌘Enter` submits when fields are valid.
- `⌘1…⌘N` select favorites.

### Error handling

- Invalid name (regex / empty) → inline error under input, focus returns to input.
- Empty prompt for spec → inline error.
- `onCreate` rejection → inline error with `errorMessage`. No silent catches; errors log through `logger`.
- No fallbacks for missing default branch: if `getPersistedSessionDefaults` fails we show the modal in a disabled state with a clear error (mirrors today's behaviour).

## Testing

Preserved / rewritten into `NewSessionModal.test.tsx` and a slimmer `NewSessionModal.integration.test.tsx`:

1. **Renders mockup layout**: header, name input, favorites carousel, prompt editor, footer.
2. **Favorite composition**: spec first; hidden presets filtered; raw agents filtered by `enabledAgents` and `isAvailable`; shortcut badges `⌘1…⌘N` in DOM order.
3. **Version selector**:
   - disabled & forced to 1 when spec selected;
   - disabled when preset selected (count comes from preset);
   - enabled and adjustable when raw agent selected.
4. **Keyboard**: `⌘1`, `⌘2` select first two cards; `⌘Enter` creates; `Esc` closes.
5. **Name auto-gen**: before user edits, the name tracks `promptToSessionName(prompt)`; after user edits, it freezes.
6. **Create payload**:
   - spec card → `{ isSpec: true, draftContent, name, userEditedName, baseBranch: '' }`
   - preset card → payload carries `agentSlots` length and `primary agentType` matches first slot; `versionCount` equals slot count.
   - raw-agent card with `2x versions` → payload has `agentType` and `versionCount: 2`.
7. **Custom settings…** toggle reveals the advanced panel; env-var/cli/model overrides propagate into the payload; collapsing it drops overrides back to defaults for the selected favorite.
8. **Prefill**: `UiEvent.NewSessionPrefill` populates name + taskContent + (optional) variantId/presetId; unrelated fields (epic, github) are ignored silently.
9. **Validation errors** render inline without closing the modal.
10. **Disabled cards** (agent unavailable) are not clickable and show a tooltip.

Test infra mirrors the existing files (Vitest + RTL, `createStore()` + `Provider`, stubbed `invoke` dispatch, mocked `useAgentAvailability` / `useEnabledAgents` / `useAgentPresets` / `useAgentVariants` / `generateDockerStyleName`). TDD order is enforced: write failing assertions for each scenario → implement → green.

## File plan

- `src/components/modals/NewSessionModal.tsx` — rewritten.
- `src/components/modals/newSession/favoriteOptions.ts` — new helper (pure, unit-tested).
- `src/components/modals/newSession/buildCreatePayload.ts` — new helper (pure, unit-tested).
- `src/components/modals/newSession/NewSessionAdvancedPanel.tsx` — new component, houses env/cli/model/autonomy/multi-agent allocation controls.
- `src/components/modals/NewSessionModal.test.tsx` — rewritten around the new surface.
- `src/components/modals/NewSessionModal.integration.test.tsx` — reduced to: custom settings panel interactions, prefill, submission with real(-ish) advanced panel state.
- `src/components/modals/newSession/favoriteOptions.test.ts` — new.
- `src/components/modals/newSession/buildCreatePayload.test.ts` — new.
- `src/i18n/**` — new strings `newSessionModal.primary.*` (title/subtitle, spec card copy, prompt hint, custom settings label).
- `CHANGES.md` — record the UI divergence from upstream per project rule.

## Risks / trade-offs

- Dropping the epic, github-issue, github-pr, and consolidation surfaces from this modal means product flows that currently depend on them (the context menu "create session from issue", consolidation flow, etc.) must still open the legacy advanced paths. The `UiEvent.NewSessionPrefill` callers that send those fields will have their extra fields silently ignored by the primary surface. If any caller requires them today, it must be pointed at a different entry point. I audited the senders: the only caller that sets `issueNumber` / `prNumber` today is `UnifiedSearchModal` + the context menu in `Sidebar`; both are being decommissioned per the spec's "out of scope". A follow-up cleanup pass can delete the prefill fields, but this PR keeps the `NewSessionPrefillDetail` type intact to avoid breaking other consumers; the primary modal simply ignores the dropped fields.
- The advanced panel is kept deliberately small (env/cli/model + autonomy + multi-agent). If future work needs epic/github/consolidation in the primary modal, it will have to land as a new surface rather than the kitchen-sink we just removed.
- Keeping the onCreate prop union unchanged avoids a mass refactor in `App.handleCreateSession`; the unused fields simply stay `undefined`.
