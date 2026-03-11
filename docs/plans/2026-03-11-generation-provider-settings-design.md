# Configurable AI Provider for Generation

## Problem

Name and commit message generation use the session's agent (defaulting to Claude Opus via CLI), which is slow for simple tasks like generating a 2-4 word kebab-case name. Users need independent control over which agent and model handles generation.

## Design

Add a `GenerationSettings` struct to the application settings that lets users pick a different agent and model specifically for AI generation features (session name generation, commit message generation).

### Data Model

```rust
pub struct GenerationSettings {
    pub agent: Option<String>,   // e.g. "gemini" — None means use session's agent (current behavior)
    pub model: Option<String>,   // e.g. "gemini-2.0-flash" — injected as --model CLI override
}
```

### Behavior

1. When generation is triggered, check `settings.generation.agent`
2. If `Some(agent)`, use that agent's binary path and env vars from existing agent settings, but override CLI args to include `--model <model>` if `generation.model` is set
3. If `None`, fall back to current behavior (session's agent type)

### Backend Changes

- `src-tauri/src/domains/settings/types.rs`: Add `GenerationSettings` struct, add `generation` field to `Settings`
- `src-tauri/src/domains/settings/service.rs`: Add getter/setter for generation settings
- `src-tauri/src/infrastructure/config/settings.rs`: Expose through `SettingsManager`
- `src-tauri/src/commands/settings.rs`: Add Tauri get/set commands
- `src-tauri/src/commands/schaltwerk_core.rs`: In `schaltwerk_core_generate_session_name` and `schaltwerk_core_generate_commit_message`, check generation settings before resolving agent type and CLI args
- `src-tauri/src/main.rs`: Register new commands

### Frontend Changes

- `src/common/tauriCommands.ts`: Add `GetGenerationSettings` / `SetGenerationSettings`
- `src/types/settings.ts`: Add `generation` category
- `src/components/modals/SettingsModal.tsx`: Add "AI Generation" settings section with agent dropdown and model text input

### Model Override Injection

When `generation.model` is set, prepend `--model <value>` to the agent's CLI args for the generation call. This works because:
- Claude CLI: `--model <model>` supported
- Gemini CLI: `--model <model>` supported via CLI args
- Codex: `--model <model>` supported
- OpenCode/Kilocode: model passed via CLI args

### UI

Settings section "AI Generation" under application scope:
- **Agent**: Dropdown — "Default (use session agent)" / Claude / Gemini / Codex / OpenCode / Kilocode
- **Model**: Text input — optional override, placeholder shows example like "gemini-2.0-flash"
