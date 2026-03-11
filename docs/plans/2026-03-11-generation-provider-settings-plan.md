# Generation Provider Settings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users configure which AI agent and model is used for name/commit generation, independent of the session's agent.

**Architecture:** New `GenerationSettings { agent, model }` in app settings. Backend checks this before resolving agent for all generation calls. Frontend adds an "AI Generation" section to the settings modal.

**Tech Stack:** Rust (Tauri backend), React/TypeScript (frontend), Jotai atoms, i18n JSON

---

### Task 1: Add GenerationSettings type to backend

**Files:**
- Modify: `src-tauri/src/domains/settings/types.rs`

**Step 1: Add the struct and wire it into Settings**

After `UpdaterPreferences` (around line 208), add:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GenerationSettings {
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}
```

In the `Settings` struct, add field (with `#[serde(default)]`):

```rust
#[serde(default)]
pub generation: GenerationSettings,
```

In `Settings::default()`, add:

```rust
generation: GenerationSettings::default(),
```

**Step 2: Run `bun run lint:rust`**

Expected: PASS

**Step 3: Commit**

```bash
git add src-tauri/src/domains/settings/types.rs
git commit -m "feat(settings): add GenerationSettings type"
```

---

### Task 2: Add service + manager + Tauri commands for generation settings

**Files:**
- Modify: `src-tauri/src/domains/settings/service.rs`
- Modify: `src-tauri/src/infrastructure/config/settings.rs`
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add getter/setter to SettingsService**

In `src-tauri/src/domains/settings/service.rs`, add methods to `impl SettingsService`:

```rust
pub fn get_generation_settings(&self) -> GenerationSettings {
    self.settings.generation.clone()
}

pub fn set_generation_settings(
    &mut self,
    settings: GenerationSettings,
) -> Result<(), SettingsServiceError> {
    self.settings.generation = settings;
    self.save()
}
```

Make sure `GenerationSettings` is imported from the types module.

**Step 2: Add getter/setter to SettingsManager**

In `src-tauri/src/infrastructure/config/settings.rs`, add methods to `impl SettingsManager`:

```rust
pub fn get_generation_settings(&self) -> crate::domains::settings::GenerationSettings {
    self.service.get_generation_settings()
}

pub fn set_generation_settings(
    &mut self,
    settings: crate::domains::settings::GenerationSettings,
) -> Result<(), String> {
    self.service
        .set_generation_settings(settings)
        .map_err(|e| e.to_string())
}
```

**Step 3: Add Tauri commands**

In `src-tauri/src/commands/settings.rs`, add:

```rust
#[tauri::command]
pub async fn get_generation_settings(
    app: AppHandle,
) -> Result<lucode::domains::settings::GenerationSettings, String> {
    let settings_manager = get_settings_manager(&app).await?;
    let manager = settings_manager.lock().await;
    Ok(manager.get_generation_settings())
}

#[tauri::command]
pub async fn set_generation_settings(
    app: AppHandle,
    settings: lucode::domains::settings::GenerationSettings,
) -> Result<(), String> {
    let settings_manager = get_settings_manager(&app).await?;
    let mut manager = settings_manager.lock().await;
    manager.set_generation_settings(settings)
}
```

Check how other commands in that file import/reference the types — match the pattern (some use fully-qualified paths, some import).

**Step 4: Register commands in main.rs**

In `src-tauri/src/main.rs`, add to the `invoke_handler` list:

```rust
settings::get_generation_settings,
settings::set_generation_settings,
```

**Step 5: Run `bun run lint:rust`**

Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/domains/settings/service.rs src-tauri/src/infrastructure/config/settings.rs src-tauri/src/commands/settings.rs src-tauri/src/main.rs
git commit -m "feat(settings): add generation settings service, manager, and Tauri commands"
```

---

### Task 3: Wire generation settings into name/commit generation backend

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs`

This is the core behavioral change. There are 5 call sites that resolve the agent for generation. Each needs to check generation settings first.

**Step 1: Add helper function to resolve generation agent**

Add near the existing `get_agent_env_and_cli_args_async` function (around line 113):

```rust
async fn resolve_generation_agent_and_args(
    fallback_agent: &str,
) -> (
    String,
    Vec<(String, String)>,
    String,
    Option<String>,
    lucode::domains::settings::AgentPreference,
) {
    let generation_settings = if let Some(sm) = SETTINGS_MANAGER.get() {
        sm.lock().await.get_generation_settings()
    } else {
        lucode::domains::settings::GenerationSettings::default()
    };

    let agent = generation_settings
        .agent
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| fallback_agent.to_string());

    let (env_vars, mut cli_args, binary_path, preferences) =
        get_agent_env_and_cli_args_async(&agent).await;

    if let Some(ref model) = generation_settings.model {
        if !model.is_empty() {
            let model_arg = format!("--model {model}");
            if cli_args.is_empty() {
                cli_args = model_arg;
            } else {
                cli_args = format!("{model_arg} {cli_args}");
            }
        }
    }

    (agent, env_vars, cli_args, binary_path, preferences)
}
```

**Step 2: Update `schaltwerk_core_generate_session_name` (line ~331)**

Replace the block that resolves agent and calls `get_agent_env_and_cli_args_async` (lines 343-354):

```rust
let agent = agent_type.unwrap_or_else(|| {
    db_clone
        .get_agent_type()
        .unwrap_or_else(|_| "claude".to_string())
});

let (agent, mut env_vars, cli_args, binary_path, _) =
    resolve_generation_agent_and_args(&agent).await;
```

Remove the old `get_agent_env_and_cli_args_async` call and the `agent` variable that preceded it.

**Step 3: Update `schaltwerk_core_generate_commit_message` (line ~395)**

Replace the agent resolution block (line ~395-483):

Change `agent_type_str` resolution to use generation settings:

```rust
let fallback_agent = session.original_agent_type.clone().unwrap_or_else(|| {
    db_clone
        .get_agent_type()
        .unwrap_or_else(|_| "claude".to_string())
});

// ... (commit_subjects and changed_files_summary gathering stays the same) ...

let (agent_type_str, mut env_vars, cli_args, binary_path, _) =
    resolve_generation_agent_and_args(&fallback_agent).await;
```

Remove the old `get_agent_env_and_cli_args_async` call.

**Step 4: Update `spawn_session_name_generation` (line ~141)**

In the async block, after the agent is resolved from the session, replace:

```rust
let (mut env_vars, cli_args, binary_path, _) =
    get_agent_env_and_cli_args_async(&agent).await;
```

With:

```rust
let (agent, mut env_vars, cli_args, binary_path, _) =
    resolve_generation_agent_and_args(&agent).await;
```

**Step 5: Update `spawn_spec_name_generation` (around line 260)**

Same pattern — replace the `get_agent_env_and_cli_args_async` call with `resolve_generation_agent_and_args`.

**Step 6: Update version group name generation (around line 1137)**

Same pattern.

**Step 7: Run `just test`**

Expected: All tests pass.

**Step 8: Commit**

```bash
git add src-tauri/src/commands/schaltwerk_core.rs
git commit -m "feat(generation): use generation settings to override agent and model for name/commit generation"
```

---

### Task 4: Add frontend TauriCommands and i18n

**Files:**
- Modify: `src/common/tauriCommands.ts`
- Modify: `src/types/settings.ts`
- Modify: `src/common/i18n/types.ts`
- Modify: `src/locales/en.json`
- Modify: any other locale JSON files (check with `ls src/locales/`)

**Step 1: Add commands to tauriCommands.ts**

```typescript
GetGenerationSettings: 'get_generation_settings',
SetGenerationSettings: 'set_generation_settings',
```

**Step 2: Add category to settings.ts**

Add `'generation'` to the `SettingsCategory` union type.

**Step 3: Add i18n type**

In `src/common/i18n/types.ts`, inside `settings:`, add after the last section (before the closing `}`):

```typescript
generation: {
  title: string
  description: string
  agent: string
  agentDesc: string
  agentDefault: string
  model: string
  modelDesc: string
  modelPlaceholder: string
}
```

Also add to `categories:`:

```typescript
generation: string
```

**Step 4: Add English translations**

In `src/locales/en.json`, inside `settings.categories`, add:

```json
"generation": "AI Generation"
```

Inside `settings`, add the section:

```json
"generation": {
  "title": "AI Generation",
  "description": "Configure which AI agent and model is used for generating session names and commit messages.",
  "agent": "Agent",
  "agentDesc": "Which agent CLI to use for AI generation. Default uses the session's agent.",
  "agentDefault": "Default (session agent)",
  "model": "Model",
  "modelDesc": "Override the model used for generation. Leave empty to use the agent's default model.",
  "modelPlaceholder": "e.g. gemini-2.0-flash"
}
```

**Step 5: Update other locale files**

Check `ls src/locales/` for other locale JSON files and add the same keys (can use English as placeholder).

**Step 6: Run `bun run lint`**

Expected: PASS

**Step 7: Commit**

```bash
git add src/common/tauriCommands.ts src/types/settings.ts src/common/i18n/types.ts src/locales/
git commit -m "feat(settings): add frontend types and i18n for generation settings"
```

---

### Task 5: Add Generation settings UI to SettingsModal

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`

**Step 1: Add category to CATEGORIES array**

Add to the CATEGORIES array (before 'sessions' or after 'environment' — logical grouping):

```typescript
{
    id: 'generation',
    label: t.settings.categories.generation,
    scope: 'application',
    icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    ),
},
```

Note: The CATEGORIES array uses `t` from i18n. Check how other categories reference their labels and match the pattern. The icon is a lightning bolt (Heroicons "bolt").

**Step 2: Add state and load/save logic**

Add state for generation settings near other settings state:

```typescript
const [generationAgent, setGenerationAgent] = useState<string>('')
const [generationModel, setGenerationModel] = useState<string>('')
```

Add load effect (or add to existing settings load effect):

```typescript
useEffect(() => {
    invoke<{ agent: string | null; model: string | null }>(TauriCommands.GetGenerationSettings)
        .then((settings) => {
            setGenerationAgent(settings.agent ?? '')
            setGenerationModel(settings.model ?? '')
        })
        .catch((e) => logger.error('Failed to load generation settings:', e))
}, [])
```

Add save handler:

```typescript
const handleSaveGenerationSettings = useCallback(async (agent: string, model: string) => {
    try {
        await invoke(TauriCommands.SetGenerationSettings, {
            settings: {
                agent: agent || null,
                model: model || null,
            },
        })
    } catch (e) {
        logger.error('Failed to save generation settings:', e)
    }
}, [])
```

**Step 3: Add render function**

```typescript
const renderGenerationSettings = () => (
    <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
                <div>
                    <h3 className="text-heading font-medium text-text-primary mb-1">
                        {t.settings.generation.title}
                    </h3>
                    <p className="text-body text-text-tertiary mb-4">
                        {t.settings.generation.description}
                    </p>
                </div>

                <div>
                    <label className="text-body font-medium text-text-primary block mb-1">
                        {t.settings.generation.agent}
                    </label>
                    <p className="text-caption text-text-tertiary mb-2">
                        {t.settings.generation.agentDesc}
                    </p>
                    <select
                        className="w-full bg-bg-elevated text-text-primary border border-border-subtle rounded px-3 py-2 text-body"
                        value={generationAgent}
                        onChange={(e) => {
                            setGenerationAgent(e.target.value)
                            handleSaveGenerationSettings(e.target.value, generationModel)
                        }}
                    >
                        <option value="">{t.settings.generation.agentDefault}</option>
                        <option value="claude">Claude</option>
                        <option value="gemini">Gemini</option>
                        <option value="codex">Codex</option>
                        <option value="opencode">OpenCode</option>
                        <option value="kilocode">Kilocode</option>
                    </select>
                </div>

                <div>
                    <label className="text-body font-medium text-text-primary block mb-1">
                        {t.settings.generation.model}
                    </label>
                    <p className="text-caption text-text-tertiary mb-2">
                        {t.settings.generation.modelDesc}
                    </p>
                    <input
                        type="text"
                        className="w-full bg-bg-elevated text-text-primary border border-border-subtle rounded px-3 py-2 text-body"
                        placeholder={t.settings.generation.modelPlaceholder}
                        value={generationModel}
                        onChange={(e) => setGenerationModel(e.target.value)}
                        onBlur={() => handleSaveGenerationSettings(generationAgent, generationModel)}
                    />
                </div>
            </div>
        </div>
    </div>
)
```

Match exact class names and styling from existing render functions (e.g., `renderSessionSettings`).

**Step 4: Add case to renderSettingsContent switch**

```typescript
case 'generation':
    return renderGenerationSettings()
```

**Step 5: Run `bun run lint`**

Expected: PASS

**Step 6: Commit**

```bash
git add src/components/modals/SettingsModal.tsx
git commit -m "feat(settings): add AI Generation section to settings modal"
```

---

### Task 6: Run full test suite and verify

**Step 1: Run `just test`**

Expected: ALL green — TypeScript lint, Rust clippy, cargo shear, knip, Rust tests, Rust build.

**Step 2: Fix any issues found**

If knip reports unused exports, fix. If clippy warns, fix.

**Step 3: Final commit if fixes needed**

```bash
git commit -m "fix: address lint/test issues from generation settings"
```
