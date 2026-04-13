# Changes from Upstream

Features and enhancements added on top of the original schaltwerk codebase.

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

## Tmux-Backed Terminal Persistence (Breaking — Terminal Backend Generation v2)

Per-project tmux server (socket `lucode-v2-{project_hash16}`) now hosts every Lucode terminal. Agent sessions (Claude, Codex, etc.) survive Lucode restarts and reattach on next launch.

This is a generation-bumped implementation. The `lucode-v2-` socket prefix plus the crate version bump to `0.14.0` deliberately make it impossible for any pre-tmux Lucode build's state to be silently reattached by this build: the socket names no longer collide, and the version-stamped `tmux.conf` forces a server recycle on upgrade. Upgrading from an older Lucode installation without quitting its running terminals will orphan those sessions on the old socket; they must be closed manually or the old Lucode relaunched to recover them.

- Per-project tmux socket derived from a 16-char SHA-256 of the canonical project path, hoisted into `shared::project_hash::project_hash16` so both the DB folder name and the tmux socket name share the same identity. The `lucode-v2-` prefix is enforced via `project_tmux_socket_name` and regression-tested.
- Lucode-owned `tmux.conf` (status off, keys unbound, mouse off, `remain-on-exit on`, `destroy-unattached off`, `exit-empty off`, `history-limit 50000`, version-stamped with the crate version) provisioned atomically at startup; stamp mismatch on upgrade leaves stale servers to be recycled.
- Startup preflight (`tmux -V ≥ 3.6`) fails fast with a human-readable message if tmux is missing or outdated. macOS only.
- `TmuxAdapter` (in `domains::terminal::tmux`) implements `TerminalBackend` via composition over the internal `LocalPtyAdapter`: tmux owns the session and its scrollback; Lucode attaches a normal PTY client. Snapshots return `{ seq, start_seq: seq, data: [] }` — hydration is driven by the tmux attach redraw flowing through the same broadcast channel and coalescing layer as live output.
- `TerminalManager::new_for_project(path)` is the production factory; `new_local` stays for tests that don't need persistence. `LocalPtyAdapter` is sealed to `pub(crate)` — it is no longer a user-facing backend, only the shared PTY/coalescer/idle-detector core that `TmuxAdapter` composes over.
- Reattach-on-startup works implicitly: `TmuxAdapter::create_with_size` is a "create-if-missing, attach-if-exists" operation via `tmux has-session`. No explicit reconciliation loop is needed.
- Orphan GC on project open: `ProjectManager::switch_to_project` prunes any `session-*` / `orchestrator-*` / `spec-orchestrator-*` tmux sessions on the project socket whose names aren't prefixed by a live DB session's wire-ID base. Multi-generation hash schemes are covered so in-flight upgrades don't accidentally kill attached agents.
- Tmux attach clients disable Lucode's hydration buffer so tmux owns scrollback via `history-limit 50000`; direct local-PTY test paths keep their existing buffer semantics.

## Configuration & Secrets

- tmux must be installed on the host (`brew install tmux`). Lucode does not bundle tmux.
