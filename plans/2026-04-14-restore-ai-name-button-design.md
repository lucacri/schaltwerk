# Restore AI Name Generation Button in NewSessionModal

## Problem

The backend Tauri command `SchaltwerkCoreGenerateSessionName` and its supporting
`GenerationSettings` (agent, model, CLI args, custom `name_prompt`) remain fully
wired. The corresponding UI affordance — a magic-wand button next to the Agent
Name field — was removed from `NewSessionModal` during the "Consolidate session
card and new session modal polish" pass (commit `d5be0def`). The sibling
AI-commit-message button in `MergeSessionModal` still works and serves as the
reference design. Users currently have no way to invoke the AI naming feature.

## Goal

Re-add a magic-wand button inside the "Agent Name" FormGroup that calls the
existing command, replaces the input's value with the generated name, and flips
`userEditedName` so subsequent prompt edits do not clobber it. Visual + loading +
error behavior must match the button already present in `MergeSessionModal`.

## Design

### UI

- Mount the magic-wand button inside `TextInput` via its existing `rightElement`
  prop, matching the sibling button in `MergeSessionModal`.
- The button uses the same magic-wand SVG, idle/loading swap, and
  `hover:bg-[rgba(var(--color-bg-hover-rgb),0.45)]` hover treatment as the
  commit-message button. `data-testid="generate-name-button"`.
- Tooltip copy is already present in the locale files
  (`newSessionModal.tooltips.generateName` / `generatingName`) and the types are
  declared. Surface them via `useTranslation()`.

### State & handler

- New `generatingName: boolean` state.
- Disabled when `generatingName` is true or the prompt is empty.
- `handleGenerateName`:
  - Reads `prompt` (the current markdown editor content).
  - Resolves `agentType`:
    - If `selectedFavorite.kind === 'agent'` use `selectedFavorite.agentType`.
    - Else use `persistedDefaults.agentType`.
  - Invokes `TauriCommands.SchaltwerkCoreGenerateSessionName` with
    `{ content, agentType }`.
  - On success with a non-empty result: `setName(result)`,
    `setUserEditedName(true)`, update `lastGeneratedNameRef.current`.
  - On failure: `logger.warn('[NewSessionModal] Failed to generate name:', err)`
    — matching the sibling handler's silent-fallback pattern. No inline error
    UI (consistent with commit-message button).
  - `finally { setGeneratingName(false) }`.

### Content source

Use the current `prompt` state. GitHub issue/PR prefills already populate
`prompt` via `NewSessionPrefill`, so we don't need separate branching on
`promptSource` (that field no longer exists in the current modal).

### Reset behavior

On modal open (the existing `useEffect` that resets name/prompt), reset
`generatingName` to `false` for safety.

## Tests (TDD)

Add to `NewSessionModal.test.tsx`:

1. Renders the button with `data-testid="generate-name-button"`.
2. Button is disabled when the prompt is empty.
3. Button becomes enabled once the prompt has content.
4. Clicking invokes `SchaltwerkCoreGenerateSessionName` with
   `{ content, agentType }` and replaces the name input's value with the result.
5. After a successful generation, subsequent prompt edits do NOT overwrite the
   generated name (userEditedName flip).
6. Clicking while the command is pending shows a spinner and disables the
   button; after failure, button returns to idle and name is unchanged.

Mock invoke extends the existing switch to handle
`TauriCommands.SchaltwerkCoreGenerateSessionName`.

## Out of Scope

- Spec-start / convert-to-session flows.
- Changes to `GenerationSettings`, prompt templates, or backend code.
- Other fields or modals.
