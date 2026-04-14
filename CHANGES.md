# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## MarkdownEditor: Dictation / Voice Control accessibility

`MarkdownEditor` now exposes the underlying CodeMirror contenteditable as a standard multiline textbox so macOS dictation, Voice Control, and screen readers can target it as a text input:

- The shared editor sets `role="textbox"`, `aria-multiline="true"`, `aria-label` (or `aria-labelledby`), and `aria-readonly` (when read-only) on `.cm-content` via `EditorView.contentAttributes`.
- New `ariaLabel` and `ariaLabelledBy` props are threaded through every caller (`NewSessionModal` prompt, `SpecEditor`, `SpecContentView`, `SettingsModal` setup script); the label falls back to the placeholder text when none is supplied.
- Accessible names for spec editors and the setup script are translated through the i18n layer (`en` / `zh`).
- Editing semantics, paste guard, file-reference autocomplete, and keybindings are unchanged — the fix is purely additive ARIA.

## Spec Preview: Dedicated Run Button

The spec preview toolbar now cleanly separates clarification from execution:

- **Clarify** is no longer styled as the green run/start action. It uses the neutral secondary-toolbar treatment and keeps the clarification prompt flow unchanged.
- **Run** is a new green toolbar button that opens the same Start Agent modal used by the sidebar and the empty-spec state via `UiEvent.StartAgentFromSpec`.
- Pending spec edits are flushed before Run opens the modal so the prefilled content stays in sync.
- The `Mod+Enter` shortcut now triggers Run in the preview, while `Mod+Shift+R` remains the clarification shortcut.

## New Session Modal Primary Surface Rebuild

`NewSessionModal` was trimmed from ~2.5k lines to a focused primary creation flow that matches the `New Session Modal View` mockup in `design/style-guide.pen`.

- Primary surface owns: name input (with auto-generation from prompt), one horizontally scrollable favorites row (`Spec only` → user presets → enabled raw agents filtered by `useEnabledAgents` + `useAgentAvailability`), markdown prompt, footer with version selector, Cancel, Create, and a `Custom settings…` toggle.
- Version selector is enabled only when a raw-agent card is selected; spec and preset cards force the implicit version count.
- `⌘1…⌘9` select the first nine favorite cards (badge labels match). `⌘Enter` submits.
- Advanced controls (autonomy toggle, multi-agent allocation dropdown, link to agent defaults in Settings) moved behind a `Custom settings…` affordance. The primary modal no longer renders epic selectors, GitHub issue/PR cards, consolidation controls, base-branch picker, unified-search, or repository-empty banners.
- `onCreate` payload contract is unchanged so `App.handleCreateSession` keeps working.
- Prefill via `UiEvent.NewSessionPrefill` updates the name / prompt / favorite selection that the primary surface owns, and passes through metadata it doesn't render (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `epicId`, `versionGroupId`, and consolidation fields) so existing callers — consolidation entry, contextual PR/issue actions — stay wired end-to-end.

Supporting helpers introduced: `src/components/modals/newSession/favoriteOptions.ts`, `buildCreatePayload.ts`, and `NewSessionAdvancedPanel.tsx`, each covered by unit tests.

## Quick Spec / Custom Mode in NewSessionModal

The favorites row in the New Session modal now hosts two fixed cards:

- **Spec** (always first) — switches the modal into spec-creation mode in one click. Hides Customize, branch, and agent selection. The footer button becomes "Create Spec".
- **Custom** (always last) — restores the full configuration UI, including the parallel-versions / multi-agent dropdown next to Cancel.

The "Create as spec" checkbox inside Customize is removed (its job is now owned by the Spec card). The parallel-versions dropdown is hidden whenever a real preset/variant favorite is selected, since presets already define their own slot count.

`⌘1` always picks the Spec card; the user's real favorites shift to `⌘2`–`⌘N`; the next index after the last favorite picks Custom.

## Consolidation Sessions

Adds a "consolidation" session type for reviewing and reconciling code from multiple parallel agent sessions in a version group.

- `is_consolidation` boolean flag on sessions (DB column, Rust entity, frontend types)
- "Consolidate" button on version group headers (visible when 2+ sessions are running/reviewed)
- Purple MERGE badge on consolidation session cards
- Auto-generated consolidation prompt listing each session's ID, branch, worktree path, and diff stats
- Pre-filled NewSessionModal via `ConsolidateVersionGroup` UI event
- `lucode_promote` accepts an optional `winner_session_id`: when promoting a consolidation session, the consolidated commits are atomically transplanted onto the chosen winner's branch (via a single `reset --hard` in the winner's worktree) so the winner survives with the merged work. The losing source versions are cancelled automatically, while the consolidation session stays open for manual review and cleanup. Without `winner_session_id`, promotion falls back to the legacy behavior (consolidation session survives).
- `lucode_confirm_consolidation_winner` now cancels all active candidate sessions, including the winning candidate, plus any judge sessions. The structured response now includes `judge_sessions_cancelled`.

## Codex Auto-Approve by Default

Lucode-launched Codex sessions now run with `--ask-for-approval never` so the agent no longer stops mid-run waiting for interactive command approval. Applies to fresh starts, resume-by-id, `__resume__` picker, `__continue__`, legacy `file://` URI resume, and orchestrator launches — everything that flows through `build_codex_command_with_config`. Lucode also strips user-supplied approval overrides (`--ask-for-approval`, `-a`, `--full-auto`, `--dangerously-bypass-approvals-and-sandbox`) from extra Codex CLI args so the non-interactive default stays authoritative. Sandbox mode selection is unchanged and remains the containment boundary; `danger-full-access` users lose prompts as an accepted tradeoff. No UI toggle is exposed.
