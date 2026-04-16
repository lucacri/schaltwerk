# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

## Consolidation: surface candidate verdict immediately

A consolidation candidate filing its report now acts as the round's initial recommendation, so the sidebar shows "Judge recommends …" and enables the confirm-winner banner the moment the agent finishes — no waiting for an optional judge session.

- `update_consolidation_report` on the candidate branch now flips the candidate's `ready_to_merge` via `mark_session_ready` and calls `update_consolidation_round_recommendation` with the candidate id as both `recommended_session_id` and `recommended_by_session_id`, moving the round to `awaiting_confirmation`. The auto-judge kick-off still runs afterwards (when configured) but its failure is logged and does not tear down the verdict update.
- `SessionVersionGroup` now derives the recommendation from the latest reported candidate (report + base_session_id present) when no judge verdict exists yet, so the banner, confirm button, dimming and round-id wiring all work before any judge session spins up. A judge verdict continues to take precedence as soon as one arrives.
- Added the `candidate_consolidation_report_records_initial_verdict` Rust test and the `surfaces a reported consolidation candidate as the initial recommendation before a judge exists` UI test to lock the behavior in.

## macOS: activate WKWebView accessibility tree for external dictation tools

Lucode now injects three `NSAccessibility` override methods onto NSApp's runtime class from the Tauri `.setup()` hook, teaching the app to advertise and accept the `AXManualAccessibility` and `AXEnhancedUserInterface` attributes. Without these overrides, the stock `tao` NSApplication returns `kAXErrorNotImplemented` (-25208) when any AX client tries to set those attributes, so WKWebView never populates its accessibility tree — and third-party dictation tools like Mac Whisper silently fail across every Lucode input surface (native `<input>`, CodeMirror, xterm, URL bar).

- New module `src-tauri/src/macos_accessibility.rs` using `objc2` + `objc2-app-kit` + `objc2-foundation`. A compile-time subclass `LucodeAccessibleApplication : NSApplication` (via `define_class!`) is used only as a well-typed source for IMPs/type-encodings; at runtime the three IMPs are added onto NSApp's live class (`TaoApp`) via `class_addMethod` — tao's own `sendEvent:` override for Cmd+keyUp delivery stays in the dispatch chain.
- Install runs from Tauri's `.setup()` callback (after `[TaoApp sharedApplication]` has bound NSApp), not from early `main()`. The self-directed `AXUIElementSetAttributeValue(selfPid, "AXManualAccessibility", true)` call that follows returns `0` (was `-25208`), eagerly activating the AX tree without needing the external AX client to set it first.
- Approach mirrors Electron's `AtomApplication` override pattern (`electron/electron#38102`) adapted for stock `tao` / wry.
- Complements the April 14 per-surface ARIA hardening on `MarkdownEditor` and the xterm helper `<textarea>`; those remain useful once the AX tree is actually live.
- Covered by a live-NSApp integration test that asserts the three selectors on the live `NSApp` instance advertise the attribute, report it settable, and round-trip via `accessibilitySetValue:forAttribute:` / `accessibilityAttributeValue:` (inspired by the sibling branch's contract test).

## Contextual action: one-click issue → spec with auto-clarify

Forge issues can now be turned into a spec whose clarification agent is already investigating, in a single gesture. A new `spec-clarify` `ContextualActionMode` is available alongside `spec` and `session`: selecting an action with this mode from the issue detail view's Actions dropdown creates the spec (preserving `issueNumber` / `issueUrl`), spawns the spec clarification PTY in the background, and submits the clarification prompt automatically once the agent is ready. The user stays on the issue view; the new spec surfaces in the sidebar with the existing `clarification_started` indicator lit.

- Frontend-only orchestration via `src/hooks/contextualSpecClarify.ts` chains the existing `SchaltwerkCoreCreateSpecSession`, `startSpecOrchestratorTop`, and `SchaltwerkCoreSubmitSpecClarificationPrompt` — no new backend commands.
- The helper uses the backend-returned `Session.name` and `Session.id` for subsequent calls, so name collisions (`find_unique_session_paths` rename) do not break the chain, and the terminal ID matches the one `SpecEditor` later derives so opening the spec rebinds to the running PTY rather than respawning.
- Errors during orchestrator start or prompt submission surface as an error toast; the partially-created spec remains in the sidebar so the user can open it and click Clarify manually to retry.
- `ContextualActionMode` enum extended on both sides; serde `rename_all` switched to `kebab-case` (`"spec"` / `"session"` unchanged, `"spec-clarify"` added).

## Per-project agent plugin toggles (Claude terminal hooks)

Lucode no longer injects its Claude terminal-signal hooks into each worktree's `.claude/settings.local.json`. The hook definitions now live in a bundled Claude Code plugin under `plugins/lucode-plugins/lucode-terminal-hooks/`, which Lucode installs once to `~/.claude/plugins/lucode-plugins/` on startup. Per-project enablement is written to `.claude/settings.json` as `"enabledPlugins": { "lucode-terminal-hooks@lucode-plugins": true }`.

- New DB column `project_config.agent_plugins_json` and struct `AgentPluginConfig { claudeLucodeTerminalHooks: bool }`, default `true`, with Tauri commands `get_project_agent_plugin_config` / `set_project_agent_plugin_config`.
- New UI panel in `SettingsModal` (under Agents → Claude) lists "Lucode terminal hooks" with a per-project enable checkbox; toggling writes to the project root and every existing worktree's `.claude/settings.json`.
- Bootstrap runs a migration: if `.claude/settings.local.json` contains legacy `lucode:waiting_for_input:*` hook entries, those are removed (file deleted when empty) and the plugin enable flag is written to `.claude/settings.json`. Fresh worktrees without legacy entries are untouched, keeping `git status` clean.
- The same migration runs against the main project root on project open, so the user's own checkout also gets cleaned once without needing to spawn a new worktree.
- Plugin `hooks.json` also clears the waiting-for-input signal on `SessionStart`, so resuming a Claude session never leaves a stale waiting badge.
- `ensure_lucode_claude_hooks`, `merge_claude_settings_local`, and the per-worktree `.claude/settings.local.json` git-exclude code were removed.

## Sidebar: Consolidation action feedback

Every consolidation action button in `SessionVersionGroup` now gives immediate busy feedback and blocks concurrent clicks:

- Clicking "Consolidate versions", the consolidation judge trigger, either confirm-winner button (header or judge banner), or the group terminate-all button shows an inline spinner over the button icon for the full duration of the triggered work.
- While any action in a consolidation group is in flight, every other action button in that group is disabled, so the same action can't be double-triggered and collisions between actions are prevented. Success and failure are still surfaced via the existing toast system.
- `onTriggerConsolidationJudge` / `onConfirmConsolidationWinner` in `Sidebar` now return their backend promise so the group can await the real request; the modal-opening callbacks resolve immediately because the subsequent UX lives in their respective modals.

## MarkdownEditor: Dictation / Voice Control accessibility

`MarkdownEditor` now exposes the underlying CodeMirror contenteditable as a standard multiline textbox so macOS dictation, Voice Control, and screen readers can target it as a text input:

- The shared editor sets `role="textbox"`, `aria-multiline="true"`, `aria-label` (or `aria-labelledby`), and `aria-readonly` (when read-only) on `.cm-content` via `EditorView.contentAttributes`.
- New `ariaLabel` and `ariaLabelledBy` props are threaded through every caller (`NewSessionModal` prompt, `SpecEditor`, `SpecContentView`, `SettingsModal` setup script); the label falls back to the placeholder text when none is supplied.
- Accessible names for spec editors and the setup script are translated through the i18n layer (`en` / `zh`).
- Editing semantics, paste guard, file-reference autocomplete, and keybindings are unchanged — the fix is purely additive ARIA.

## Reorderable Raw Agents in Start New Agent Modal

Raw agents (Claude, Copilot, OpenCode, Gemini, Codex, Droid, Qwen, Amp, KiloCode, Terminal) in the `NewSessionModal` can now be reordered from **Settings → Agent Configuration → Raw Agent Order**. The reorder list shows only *enabled* agents; disabled agents never appear in the modal anyway.

- Persisted globally as `raw_agent_order: Vec<String>` in the main settings file, alongside `favorite_order`.
- Surfaced via new Tauri commands `get_raw_agent_order` / `set_raw_agent_order`, a Jotai atom (`rawAgentOrder`), and the `useRawAgentOrder` hook.
- `buildFavoriteOptions` orders the raw-agent slice by the saved order, then falls back to the `AGENT_TYPES` default for any agent not yet in the saved order. Unknown or duplicate entries are filtered at compose time.
- Spec stays pinned first and presets keep their existing independent ordering.
- `⌘1`–`⌘9` continue to follow composed-list position, so reordering raw agents directly shifts which agent owns which shortcut.

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
