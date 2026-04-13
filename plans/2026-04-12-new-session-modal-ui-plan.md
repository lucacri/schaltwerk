# New Session Modal UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `NewSessionModal` to match the `New Session Modal View` mockup — name input, horizontally scrollable favorites row (spec → presets → enabled raw agents), markdown prompt, footer with version selector / cancel / create / custom-settings — while keeping the `SchaltwerkCoreCreateSession` payload contract the rest of the app uses.

**Architecture:** Split the old 2.5k-line modal into: a small primary modal (`NewSessionModal.tsx`), a pure favorites helper (`favoriteOptions.ts`), a pure payload helper (`buildCreatePayload.ts`), and an `NewSessionAdvancedPanel.tsx` that keeps env/cli/model/autonomy/multi-agent reachable behind a `Custom settings…` toggle. Props stay identical to today's so `App.tsx` doesn't change.

**Tech Stack:** React 18 + TypeScript, Jotai, Vitest + React Testing Library, Tailwind theme tokens, existing `ResizableModal` / `FavoriteCard` / `MarkdownEditor` / `Dropdown` primitives.

---

## Ground rules

- Follow TDD strictly: add/modify a failing test first, then the minimum code to make it pass.
- Every step must end green against `bun run lint`, `bun run test` narrowed to the file under test, or (for final-pass tasks) `just test`.
- Never weaken the `onCreate` prop signature — it must remain assignable to today's `handleCreateSession` callsite in `App.tsx:2538`.
- Don't touch `App.tsx`, `handleCreateSession`, or any other caller. The modal must remain drop-in.
- Remove upstream-only behaviour (epic, GitHub issue/PR, consolidation, unified search, base-branch picker, repository warning) — don't preserve shims.
- Update `CHANGES.md` to mirror every user-visible UI change (per project convention `feedback_changes_md.md`).

## Task 1 — Scaffolding + favorite options helper (pure)

**Files:**
- Create: `src/components/modals/newSession/favoriteOptions.ts`
- Create: `src/components/modals/newSession/favoriteOptions.test.ts`

**Step 1: Write failing tests** covering:

- Spec card is always first.
- Presets retain the order supplied via `presetOrder`, unordered presets appended alphabetically.
- Presets whose slots include an agent that's disabled in `enabledAgents` are hidden.
- Presets whose slots include an agent that is enabled-but-unavailable render as disabled (shown, greyed).
- Raw-agent cards follow presets, in `AGENT_TYPES` declaration order, filtered by `enabledAgents[agent] && isAvailable(agent)`.
- Accent colour matches `favoriteAccentColor(agentType)` for agents and `var(--color-border-strong)` for spec.
- Shortcut label is `⌘${index+1}` for the first 9 items and `undefined` for later ones.

**Step 2:** Run `bun run test src/components/modals/newSession/favoriteOptions.test.ts` — must fail.

**Step 3:** Implement `buildFavoriteOptions({ presets, enabledAgents, isAvailable, presetOrder, variantById? })` returning the typed `FavoriteOption[]` union described in the design doc. Re-export `SPEC_FAVORITE_ID` from here so the primary modal re-uses the same constant.

**Step 4:** Rerun tests — must pass.

**Step 5:** Commit (`feat(new-session): add pure favoriteOptions helper`).

## Task 2 — Pure `buildCreatePayload` helper

**Files:**
- Create: `src/components/modals/newSession/buildCreatePayload.ts`
- Create: `src/components/modals/newSession/buildCreatePayload.test.ts`

**Step 1: Write failing tests** covering:

1. Spec card → `{ name, isSpec: true, draftContent: prompt, userEditedName, baseBranch: '' }` with no agentType, no versionCount, no agentSlots.
2. Preset card → `agentType` equals first slot agentType, `agentSlots` length equals preset slot count, `versionCount === slots.length`, `baseBranch` passed through.
3. Raw-agent card with `versionCount: 3` → `{ agentType, versionCount: 3, baseBranch, userEditedName }`.
4. Advanced overrides merge in: when `advanced.multiAgentAllocations` is non-empty → `agentTypes` is populated via `normalizeAllocations`; when env vars / cli args / model prefs are set → they appear under the payload fields used by `App.handleCreateSession` today (`agentType`, `autonomyEnabled`, optional `prompt`).
5. Autonomy is forced to `false` when the selected agent is `terminal` (mirrors current logic).
6. Empty prompt on spec → throws a validation error object `{ code: 'EMPTY_SPEC' }`.
7. Whitespace-only name → throws `{ code: 'INVALID_NAME' }`.

**Step 2:** Run the test file; all cases fail.

**Step 3:** Implement `buildCreatePayload({ selection, name, prompt, userEditedName, baseBranch, advanced, variantById })` delegating to existing `normalizeAllocations`.

**Step 4:** Tests pass.

**Step 5:** Commit (`feat(new-session): add pure buildCreatePayload helper`).

## Task 3 — Advanced panel component

**Files:**
- Create: `src/components/modals/newSession/NewSessionAdvancedPanel.tsx`
- Create: `src/components/modals/newSession/NewSessionAdvancedPanel.test.tsx`

**Step 1: Failing tests:**

1. Renders `MultiAgentAllocationDropdown`, `AgentDefaultsSection`, autonomy toggle, and model/reasoning inputs when given a raw-agent selection.
2. For spec selection the panel is hidden (returns `null`) — the primary modal won't even render the toggle.
3. For preset selection the autonomy toggle and multi-agent dropdown are hidden; env/cli/model overrides remain.
4. Emits `onChange(advancedState)` whenever any nested control changes.

**Step 2:** Tests fail (component doesn't exist).

**Step 3:** Implement the component, reusing `AgentDefaultsSection` + `MultiAgentAllocationDropdown` + the existing autonomy control pattern.

**Step 4:** Tests pass.

**Step 5:** Commit.

## Task 4 — Primary modal skeleton (structure + favorites + version selector)

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx` (full rewrite)
- Modify: `src/components/modals/NewSessionModal.test.tsx`

**Step 1 — failing tests (partial rewrite of existing suite):**

- Modal renders header text ("Start New Agent" / "Primary creation flow"), `Agent Name` input with docker-style default, prompt editor, and the favorites carousel.
- Favorites row shows Spec card first then raw-agent cards in the configured order (use mocked `useAgentPresets` returning one preset, `useEnabledAgents` enabling only claude + codex, `useAgentAvailability` returning all available).
- Version selector shows "1x versions" by default, is disabled for Spec and presets, enabled for raw agents.
- `⌘1` selects the first card; `⌘2` the second; subsequent selection updates both the visual state and the stored agent.
- Cancel calls `onClose`; Create on spec card with non-empty prompt calls `onCreate` with an `isSpec: true` payload.

**Step 2:** Run the test file — confirm new tests fail.

**Step 3:** Rewrite `NewSessionModal.tsx` using the two helpers from Tasks 1–2, reusing existing primitives. Strip out epic/github/consolidation/multi-agent/base-branch/unified-search. Keep the `Props` interface exactly as it is today (including the full `onCreate` payload union).

**Step 4:** Tests pass.

**Step 5:** Commit.

## Task 5 — Name auto-generation & prompt change behaviour

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx`
- Modify: `src/components/modals/NewSessionModal.test.tsx`

**Step 1: Failing tests:**

- Typing in the prompt while the name is untouched updates the name via `promptToSessionName`.
- Editing the name freezes the auto-generation — further prompt edits don't overwrite.
- Clearing the name re-enables auto-generation from the current prompt.
- Submitting sets `userEditedName` on the payload based on whether the user edited.

**Step 2:** Tests fail.

**Step 3:** Wire `promptToSessionName` into the name input `onChange` + prompt `onChange` pipeline with a single `userEditedName` flag (ref + state).

**Step 4:** Tests pass.

**Step 5:** Commit.

## Task 6 — Custom Settings toggle + advanced panel integration

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx`
- Modify: `src/components/modals/NewSessionModal.test.tsx`

**Step 1: Failing tests:**

- `Custom settings…` button is not rendered for spec selection.
- Clicking `Custom settings…` reveals the advanced panel (`NewSessionAdvancedPanel`) and sets `aria-expanded=true`.
- Setting a CLI arg in the panel and hitting Create forwards it via the payload.
- Collapsing the panel drops the override — the next Create uses defaults for the selected favorite.

**Step 2:** Tests fail.

**Step 3:** Render `NewSessionAdvancedPanel` controlled by `customSettingsOpen` state; thread its `onChange` into the `advanced` bag used by `buildCreatePayload`.

**Step 4:** Tests pass.

**Step 5:** Commit.

## Task 7 — Prefill handling

**Files:**
- Modify: `src/components/modals/NewSessionModal.tsx`
- Modify: `src/components/modals/NewSessionModal.test.tsx`

**Step 1: Failing tests:**

- Emitting `UiEvent.NewSessionPrefill` with `{ name, taskContent, presetId }` while the modal is open updates the name, prompt, and selected favorite.
- Prefills with `variantId` matching a raw-agent-mapped variant select the corresponding agent card.
- Prefill fields that no longer exist on this surface (`epicId`, `issueNumber`, `prNumber`, `isConsolidation`, …) are silently ignored — they don't show up in the payload when Create is clicked.

**Step 2:** Tests fail.

**Step 3:** Implement the reduced prefill handler.

**Step 4:** Tests pass.

**Step 5:** Commit.

## Task 8 — Integration test rewrite

**Files:**
- Modify: `src/components/modals/NewSessionModal.integration.test.tsx`

**Step 1:** Rewrite the integration suite around the new surface. Retain only: end-to-end submission for each card kind (spec, preset, raw agent), advanced panel toggle flow, and prefill + submit. Delete the GitHub/Issue/PR integration blocks; delete the multi-agent/consolidation integration blocks.

**Step 2:** Run `bun run test src/components/modals/NewSessionModal.integration.test.tsx` — expect failures to converge on the new implementation (fix any gaps by adjusting the component rather than the tests; the tests describe target behaviour).

**Step 3:** Once green, commit.

## Task 9 — Clean up dead imports & helper files

**Files:**
- Delete if now unreferenced: `src/components/modals/UnifiedSearchModal.tsx` call-path from inside NewSessionModal only (do not delete the file itself unless `knip` flags it; just remove the import and related state).
- Keep `EpicSelect`, `CustomizeAccordion`, `GithubIntegrationContext` imports out of the new modal (don't touch the files themselves).
- Ensure no `#[allow(dead_code)]` or commented-out blocks remain in the TSX.

**Step 1:** Run `bun run lint` — fix anything.
**Step 2:** Run `knip` (part of `bun run test`) — address any new dead-code findings caused by the rewrite (e.g., unused utilities); if `knip` flags a helper that the old modal was the only caller for, delete it.
**Step 3:** Commit any cleanup as `chore(new-session): drop unreferenced helpers`.

## Task 10 — CHANGES.md + styleguide touch-up

**Files:**
- Modify: `CHANGES.md`
- Optional: `design/new-session-modal.pen` screenshot update (skip unless canvas drifts).

**Step 1:** Add an entry describing the primary-modal rewrite and the advanced panel escape hatch.

**Step 2:** Commit (`docs: record new session modal UI redesign`).

## Task 11 — Full validation suite

**Step 1:** Run `just test` (or `bun run test`).
**Step 2:** Fix any TS / Rust / knip / nextest failures without weakening the tests written earlier.
**Step 3:** Confirm output shows "tests green" end-to-end.
**Step 4:** No commit if nothing changes; otherwise commit the fixes.

## Task 12 — Code review + squash

**Step 1:** Invoke `superpowers:requesting-code-review` via the subagent.
**Step 2:** Address blocking feedback; each fix is its own commit with failing test first.
**Step 3:** Once review is clean, squash all commits on this branch into a single conventional commit:

```bash
git reset --soft $(git merge-base HEAD main)
git commit -m "feat(new-session-modal): streamline primary creation surface"
```

---

## Reference pointers for the executor

- Primitive props:
  - `ResizableModal` → `src/components/shared/ResizableModal.tsx:4`
  - `FavoriteCard` → `src/components/shared/FavoriteCard.tsx:4`
  - `MarkdownEditor` → `src/components/specs/MarkdownEditor.tsx:24` (forwardRef with `focus()` / `focusEnd()`)
  - `Dropdown` → `src/components/inputs/Dropdown.tsx:13`
  - `FormGroup` / `TextInput` → `src/components/ui/*`
  - `Button` → `src/components/ui/Button.tsx`
- State hooks:
  - `useFavorites()` → `src/hooks/useFavorites.ts`
  - `useAgentPresets()` / `useAgentVariants()` / `useAgentAvailability()` / `useEnabledAgents()`
  - `getPersistedSessionDefaults()` → `src/utils/sessionConfig.ts`
- Name helpers: `promptToSessionName`, `generateDockerStyleName` (unchanged).
- Event: `listenUiEvent(UiEvent.NewSessionPrefill, …)` — see `src/common/uiEvents.ts`.
- Payload shape must match the `onCreate` union in today's `NewSessionModal.tsx:134-160`.
- Tauri commands accessed by the submit path (only via `onCreate` → App.tsx): `SchaltwerkCoreCreateSession`, `SchaltwerkCoreCreateSpecSession`. Not invoked directly inside the modal.
