# IDE-Style Base Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Darcula-tuned UI control layer and migrate the legacy settings controls onto it.

**Architecture:** Add shared form-control theme tokens, implement reusable UI primitives in `src/components/ui/`, then migrate `SettingsModal` and the remaining legacy `.settings-*` consumers to those primitives. Reuse the existing dropdown geometry logic so the new custom select aligns with the rest of the app.

**Tech Stack:** React, TypeScript, Tailwind utilities, Vitest, Testing Library, existing theme CSS custom properties

---

### Task 1: Add shared control tokens and exports

**Files:**
- Modify: `src/styles/themes/base.css`
- Modify: `src/styles/themes/darcula.css`
- Modify: `src/styles/themes/dark.css`
- Modify: `src/styles/themes/light.css`
- Modify: `src/styles/themes/ayu.css`
- Modify: `src/styles/themes/catppuccin.css`
- Modify: `src/styles/themes/catppuccin-macchiato.css`
- Modify: `src/styles/themes/everforest.css`
- Modify: `src/styles/themes/gruvbox.css`
- Modify: `src/styles/themes/kanagawa.css`
- Modify: `src/styles/themes/tokyonight.css`
- Modify: `src/common/theme.ts`

- [ ] Write a failing test expectation in a UI component test that references `theme.control.height.md` so TypeScript fails before the token exists.
- [ ] Run the targeted test to verify the missing `theme.control` export fails as expected.
- [ ] Add the control size/spacing tokens to `src/styles/themes/base.css` and the per-theme control color aliases to each theme CSS file.
- [ ] Export the new tokens from `src/common/theme.ts` under `theme.control`.
- [ ] Re-run the targeted test until it passes.

### Task 2: Build the shared UI primitives with tests first

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Button.test.tsx`
- Create: `src/components/ui/Checkbox.tsx`
- Create: `src/components/ui/Checkbox.test.tsx`
- Create: `src/components/ui/Toggle.tsx`
- Create: `src/components/ui/Toggle.test.tsx`
- Create: `src/components/ui/Label.tsx`
- Create: `src/components/ui/FormGroup.tsx`
- Create: `src/components/ui/FormGroup.test.tsx`
- Create: `src/components/ui/SectionHeader.tsx`
- Create: `src/components/ui/TextInput.tsx`
- Create: `src/components/ui/TextInput.test.tsx`
- Create: `src/components/ui/Textarea.tsx`
- Create: `src/components/ui/Textarea.test.tsx`
- Create: `src/components/ui/Select.tsx`
- Create: `src/components/ui/Select.test.tsx`
- Create: `src/components/ui/index.ts`

- [ ] Add failing tests for each primitive covering its key contract before implementation.
- [ ] Run `bun vitest run src/components/ui/*.test.tsx` and confirm the suite fails for missing modules/components.
- [ ] Implement the primitives with a shared Darcula-focused style foundation and accessible roles/attributes.
- [ ] Re-run `bun vitest run src/components/ui/*.test.tsx` until all primitive tests pass.
- [ ] Refactor any repeated control styling into a small shared helper inside `src/components/ui/` if duplication appears during implementation.

### Task 3: Migrate `SettingsModal`

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`
- Modify: `src/components/modals/SettingsModal.test.tsx`

- [ ] Update `SettingsModal` tests first to assert against the new control semantics where current expectations rely on native classes or browser select behavior.
- [ ] Run `bun vitest run src/components/modals/SettingsModal.test.tsx` and confirm the affected cases fail.
- [ ] Replace the raw settings controls in `src/components/modals/SettingsModal.tsx` with `Button`, `Checkbox`, `Toggle`, `TextInput`, `Textarea`, `Select`, `FormGroup`, and `SectionHeader` where they reduce duplicated styling.
- [ ] Re-run `bun vitest run src/components/modals/SettingsModal.test.tsx` until the modal passes again.
- [ ] Do a quick Darcula pass on spacing and hierarchy while keeping the existing tab structure intact.

### Task 4: Migrate remaining legacy settings control consumers

**Files:**
- Modify: `src/components/settings/MCPConfigPanel.tsx`
- Modify: `src/components/settings/ContextualActionsSettings.tsx`
- Modify: `src/components/settings/AgentVariantsSettings.tsx`
- Modify: `src/components/settings/AgentPresetsSettings.tsx`
- Modify: `src/components/settings/GithubProjectIntegrationCard.tsx`
- Modify: `src/components/settings/GitlabProjectIntegrationCard.tsx`
- Modify: `src/components/gitlab/GitlabSourcesSettings.tsx`
- Modify: any directly related tests that fail after the migration

- [ ] Search for remaining `.settings-btn*` and `.settings-select` usages and capture the exact caller list before editing.
- [ ] Update or add targeted tests for any migrated settings surface that already has coverage.
- [ ] Replace the legacy buttons/selects/inputs/textareas in those settings-oriented files with the new primitives.
- [ ] Re-run the smallest relevant Vitest commands for each touched area and fix any regressions immediately.
- [ ] Confirm no `.settings-btn*` or `.settings-select` usages remain in `src/components`.

### Task 5: Remove obsolete CSS and run full verification

**Files:**
- Modify: `src/index.css`

- [ ] Delete the obsolete `.settings-btn*` and `.settings-select` CSS from `src/index.css` once no callers remain.
- [ ] Run `bun vitest run src/components/ui/*.test.tsx src/components/modals/SettingsModal.test.tsx` as a focused regression pass.
- [ ] Run `just test` for the full validation suite.
- [ ] Review the final diff for consistency, especially Darcula-tuned spacing, border weight, and focus behavior.
- [ ] Prepare the branch for handoff without committing unless the user explicitly requests a commit.
