# Per-Project Agent Plugin Toggles (Design)

## Problem

Lucode injects Claude hook JSON into every worktree's `.claude/settings.local.json`. That file is tracked in this repo, so every Lucode-created worktree shows a permanent git diff. The merge-to-main flow breaks on this noise. There is no user toggle, and the pattern does not generalize to other agents.

## Target

1. Lucode's Claude hook logic lives in a bundled Claude Code plugin, not per-worktree JSON.
2. A per-project toggle decides whether the plugin is enabled for that project.
3. The toggle writes to `{worktree}/.claude/settings.json` (tracked, already contains `enabledPlugins`) — never to `.claude/settings.local.json`.
4. A migration path scrubs legacy hook entries from `.claude/settings.local.json` on first open.

## Architecture

### Plugin shipped with the app

Repo layout (new):

```
plugins/lucode-terminal-hooks/
  .claude-plugin/plugin.json
  hooks/hooks.json           # Elicitation/Notification/Stop/… → OSC \e]9;lucode:waiting_for_input:(enter|clear)\a
```

At app startup (main.rs `setup()`), Lucode installs the plugin into the user's Claude plugins directory, organized as a minimal marketplace named `lucode-plugins`:

```
~/.claude/plugins/lucode-plugins/
  .claude-plugin/marketplace.json          # marketplace name = "lucode-plugins"
  lucode-terminal-hooks/
    .claude-plugin/plugin.json
    hooks/hooks.json
```

Install is idempotent and version-checked: if the plugin directory already contains the same version string, we skip. On upgrade, the directory is replaced atomically.

Plugin identifier everywhere: **`lucode-terminal-hooks@lucode-plugins`**.

### Per-project config

New DB column on `project_config`:

```sql
ALTER TABLE project_config ADD COLUMN agent_plugins_json TEXT
```

Serialized struct:

```rust
#[serde(rename_all = "camelCase")]
pub struct AgentPluginConfig {
    #[serde(default = "default_true")]
    pub claude_lucode_terminal_hooks: bool,
}
```

Default when column is `NULL` or blank: `{ claudeLucodeTerminalHooks: true }`.

Tauri commands:
- `get_project_agent_plugin_config` → `AgentPluginConfig`
- `set_project_agent_plugin_config(config)`

Enum entries in `src/common/tauriCommands.ts`:
- `GetProjectAgentPluginConfig`
- `SetProjectAgentPluginConfig`

### Bootstrap + runtime propagation

In `bootstrapper.rs`:

- Delete `ensure_lucode_claude_hooks()` and `merge_claude_settings_local()` in their entirety.
- Replace with `apply_agent_plugins(worktree_path, &AgentPluginConfig)`.
  - Merges `{ "enabledPlugins": { "lucode-terminal-hooks@lucode-plugins": <bool> } }` into `{worktree}/.claude/settings.json` (create file if missing; preserve other keys).
  - Removes legacy Lucode hook entries from `{worktree}/.claude/settings.local.json` if present (see migration).
- `copy_claude_locals` stops calling the old hook writer; instead it calls `apply_agent_plugins` using the project's current `AgentPluginConfig`.
- `ensure_worktree_git_exclude` call for `.claude/settings.local.json` is removed — we no longer write that file, so it doesn't need excluding. Keep the helper for other callers if any; otherwise delete.

When the toggle changes from the UI:
1. `set_project_agent_plugin_config` persists to DB.
2. For each active worktree of the current project, re-run `apply_agent_plugins` to update `.claude/settings.json`.
3. No restart needed — Claude Code reads `.claude/settings.json` on next spawn.

### Migration

On first worktree bootstrap (or any `apply_agent_plugins` call), Lucode:

1. Reads `{worktree}/.claude/settings.local.json` if it exists.
2. Finds entries under `hooks.*` whose `hooks[].command` contains `lucode:waiting_for_input:`.
3. Removes those entries. If an event array becomes empty, drops the key. If the `hooks` object becomes empty, drops it. If the root becomes `{}`, deletes the file.
4. Writes the cleaned file back (or deletes it).
5. Logs one `info!` line per migrated file.

Same migration runs against the main repo path (the project root) once per project open, so the user's own checkout also gets cleaned.

### UI

`src/components/settings/AgentPluginsPanel.tsx` (new) — parallel to `MCPConfigPanel`.

- Accepts `{ projectPath, agent }`. Currently only renders content for `agent === 'claude'`.
- Reads/writes `AgentPluginConfig` through the two new Tauri commands.
- Presents one row: checkbox `Lucode terminal hooks` with a short description. Uses shared `SectionHeader` + `Checkbox` components, same styling tokens as MCPConfigPanel.
- Not on Jotai (matches MCP panel's local-state pattern).

`SettingsModal.tsx` mounts `<AgentPluginsPanel>` above `<MCPConfigPanel>` when `projectPath && activeAgentTab === 'claude'`.

### Tests

Rust (under `domains::sessions::lifecycle::bootstrapper`):
- `apply_agent_plugins_writes_enabled_flag_true`
- `apply_agent_plugins_preserves_other_settings_keys`
- `apply_agent_plugins_writes_false_when_disabled`
- `migrate_legacy_hooks_removes_only_lucode_entries`
- `migrate_legacy_hooks_deletes_file_when_becomes_empty`
- `hooks_json_in_sync_with_terminal_osc_payloads` (golden — reads `plugins/lucode-terminal-hooks/hooks/hooks.json`, asserts each printed command contains one of the payloads the terminal listens for).

Rust (under `commands::settings`):
- `project_agent_plugin_config_roundtrip_default_is_enabled`
- `project_agent_plugin_config_persists_disable`

Frontend (`src/components/settings/__tests__/AgentPluginsPanel.test.tsx`):
- Initial render shows Enabled state from backend.
- Checkbox toggle invokes `SetProjectAgentPluginConfig` with updated value.
- Error path shows error message.

### Out of scope

- Codex / Droid / Gemini / OpenCode plugin mechanisms. UI leaves room (`agent` prop already switchable), but only `claude` is wired.
- Global (user-level) plugin toggles. Per-project only.
- Automatic marketplace registration via the `claude` CLI. The marketplace dir is created on disk; Claude Code discovers it on next launch.

## Acceptance Criteria

1. Fresh worktree on `main`: `git status` is clean; no `.claude/settings.local.json` diff.
2. Waiting-for-input terminal signal fires when plugin is enabled (verified by the hooks.json golden test + OSC payload match).
3. Toggle off in settings → subsequent Claude spawn in that project shows no hook firing. Toggle on → resumes.
4. Fresh install copies plugin into `~/.claude/plugins/lucode-plugins/...` exactly once per version.
5. Projects with legacy hook entries in `.claude/settings.local.json` auto-migrate (entries removed, file deleted if empty).
