# Improve AI Generation Settings UX - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bare AI Generation settings with a richer UX that uses CLI args instead of a rigid model field, and adds customizable prompts for name/commit generation.

**Architecture:** Expand `GenerationSettings` struct to include `cli_args`, `name_prompt`, and `commit_prompt` fields (replacing the `model` field). Migrate existing `model` values to `cli_args` with `--model` prefix. Update the frontend to match the Agent Configuration page pattern. Wire custom prompts through to naming.rs and commit_message.rs.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), Jotai (state), i18n (en.json, zh.json)

---

### Task 1: Expand GenerationSettings struct and add migration

**Files:**
- Modify: `src-tauri/src/domains/settings/types.rs:210-216`
- Modify: `src-tauri/src/domains/settings/service.rs:532-542`
- Test: `src-tauri/src/domains/settings/service.rs` (existing test module)

**Step 1: Write failing tests for expanded GenerationSettings**

Add to `src-tauri/src/domains/settings/service.rs` test module:

```rust
#[test]
fn generation_settings_cli_args_persists() {
    let repo = InMemoryRepository::default();
    let repo_handle = repo.clone();
    let mut service = SettingsService::new(Box::new(repo));

    let settings = GenerationSettings {
        agent: Some("gemini".to_string()),
        cli_args: Some("--model gemini-2.0-flash".to_string()),
        name_prompt: None,
        commit_prompt: None,
    };

    service.set_generation_settings(settings).expect("should save");
    let loaded = service.get_generation_settings();
    assert_eq!(loaded.cli_args, Some("--model gemini-2.0-flash".to_string()));
    assert_eq!(loaded.agent, Some("gemini".to_string()));
    assert_eq!(repo_handle.snapshot().generation.cli_args, Some("--model gemini-2.0-flash".to_string()));
}

#[test]
fn generation_settings_custom_prompts_persist() {
    let repo = InMemoryRepository::default();
    let mut service = SettingsService::new(Box::new(repo));

    let settings = GenerationSettings {
        agent: None,
        cli_args: None,
        name_prompt: Some("Custom name prompt: {task}".to_string()),
        commit_prompt: Some("Custom commit prompt: {commits}\n{files}".to_string()),
    };

    service.set_generation_settings(settings).expect("should save");
    let loaded = service.get_generation_settings();
    assert_eq!(loaded.name_prompt, Some("Custom name prompt: {task}".to_string()));
    assert_eq!(loaded.commit_prompt, Some("Custom commit prompt: {commits}\n{files}".to_string()));
}
```

**Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo nextest run --lib settings::service::tests`
Expected: Compilation error — `GenerationSettings` doesn't have `cli_args`, `name_prompt`, `commit_prompt` fields.

**Step 3: Update GenerationSettings struct**

In `src-tauri/src/domains/settings/types.rs`, replace `GenerationSettings`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GenerationSettings {
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub cli_args: Option<String>,
    #[serde(default)]
    pub name_prompt: Option<String>,
    #[serde(default)]
    pub commit_prompt: Option<String>,
}
```

Note: Keep `model` field for backward compatibility with existing settings.json files (serde will just ignore it on load, and we handle migration in the service layer).

**Step 4: Add migration in SettingsService::new**

In `src-tauri/src/domains/settings/service.rs`, add migration after `clean_invalid_binary_paths`:

```rust
pub fn new(repository: Box<dyn SettingsRepository>) -> Self {
    let mut settings = repository.load().unwrap_or_default();
    clean_invalid_binary_paths(&mut settings);
    migrate_generation_model_to_cli_args(&mut settings);

    Self {
        repository,
        settings,
    }
}
```

Add the migration function (before the `impl SettingsService` block or as a module-level fn):

```rust
fn migrate_generation_model_to_cli_args(settings: &mut Settings) {
    if let Some(model) = settings.generation.model.take() {
        if !model.is_empty() && settings.generation.cli_args.as_deref().unwrap_or("").is_empty() {
            settings.generation.cli_args = Some(format!("--model {model}"));
        }
    }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo nextest run --lib settings::service::tests`
Expected: All PASS

**Step 6: Add migration test**

```rust
#[test]
fn generation_settings_migrates_model_to_cli_args() {
    let repo = InMemoryRepository::default();
    {
        let mut state = repo.state.lock().unwrap();
        state.generation.model = Some("gemini-2.0-flash".to_string());
    }

    let service = SettingsService::new(Box::new(repo));
    let loaded = service.get_generation_settings();
    assert_eq!(loaded.cli_args, Some("--model gemini-2.0-flash".to_string()));
    assert!(loaded.model.is_none());
}

#[test]
fn generation_settings_migration_skips_when_cli_args_set() {
    let repo = InMemoryRepository::default();
    {
        let mut state = repo.state.lock().unwrap();
        state.generation.model = Some("old-model".to_string());
        state.generation.cli_args = Some("--model new-model".to_string());
    }

    let service = SettingsService::new(Box::new(repo));
    let loaded = service.get_generation_settings();
    assert_eq!(loaded.cli_args, Some("--model new-model".to_string()));
}
```

**Step 7: Run tests, verify pass**

Run: `cd src-tauri && cargo nextest run --lib settings::service::tests`
Expected: All PASS

**Step 8: Commit**

```bash
git add src-tauri/src/domains/settings/types.rs src-tauri/src/domains/settings/service.rs
git commit -m "feat(settings): expand GenerationSettings with cli_args and custom prompts"
```

---

### Task 2: Update resolve_generation_agent_and_args to use cli_args

**Files:**
- Modify: `src-tauri/src/commands/schaltwerk_core.rs:141-174`

**Step 1: Update resolve_generation_agent_and_args**

Replace the model injection logic with cli_args merging:

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

    if let Some(gen_cli_args) = generation_settings.cli_args.as_deref().filter(|a| !a.is_empty()) {
        if cli_args.is_empty() {
            cli_args = gen_cli_args.to_string();
        } else {
            cli_args = format!("{gen_cli_args} {cli_args}");
        }
    }

    (agent, env_vars, cli_args, binary_path, preferences)
}
```

**Step 2: Run full test suite**

Run: `just test`
Expected: All PASS

**Step 3: Commit**

```bash
git add src-tauri/src/commands/schaltwerk_core.rs
git commit -m "refactor(generation): use cli_args instead of model injection"
```

---

### Task 3: Wire custom prompts to name generation

**Files:**
- Modify: `src-tauri/src/domains/agents/naming.rs:15-26` (SessionRenameContext), `28-36` (NameGenerationArgs)
- Modify: `src-tauri/src/commands/schaltwerk_core.rs:176+` (spawn_session_name_generation)

**Step 1: Add custom_name_prompt to context structs**

In `naming.rs`, add field to both `SessionRenameContext` and `NameGenerationArgs`:

```rust
pub struct SessionRenameContext<'a> {
    pub db: &'a Database,
    pub session_id: &'a str,
    pub worktree_path: &'a Path,
    pub repo_path: &'a Path,
    pub current_branch: &'a str,
    pub agent_type: &'a str,
    pub initial_prompt: Option<&'a str>,
    pub cli_args: Option<String>,
    pub env_vars: Vec<(String, String)>,
    pub binary_path: Option<String>,
    pub custom_name_prompt: Option<String>,
}

pub struct NameGenerationArgs<'a> {
    pub db: &'a Database,
    pub target_id: &'a str,
    pub worktree_path: &'a Path,
    pub agent_type: &'a str,
    pub initial_prompt: Option<&'a str>,
    pub cli_args: Option<&'a str>,
    pub env_vars: &'a [(String, String)],
    pub binary_path: Option<&'a str>,
    pub custom_name_prompt: Option<&'a str>,
}
```

**Step 2: Use custom prompt when available in generate_display_name_core**

In `naming.rs`, in `generate_display_name_core`, after line ~217 where `prompt_plain` is built, add a check:

```rust
let prompt_plain = if let Some(custom) = custom_name_prompt.filter(|p| !p.is_empty()) {
    custom.replace("{task}", &truncated)
} else {
    format!(/* existing prompt_plain */)
};

let prompt_json = if custom_name_prompt.is_some_and(|p| !p.is_empty()) {
    // For custom prompts, use the same prompt for JSON-based agents
    // but append the JSON instruction
    format!("{prompt_plain}\n\nRespond with JSON: {{\"name\": \"short-kebab-case-name\"}}")
} else {
    format!(/* existing prompt_json */)
};
```

**Step 3: Pass custom_name_prompt from resolve_generation_agent_and_args**

Update `resolve_generation_agent_and_args` to also return the custom prompts:

```rust
async fn resolve_generation_agent_and_args(
    fallback_agent: &str,
) -> (
    String,
    Vec<(String, String)>,
    String,
    Option<String>,
    lucode::domains::settings::AgentPreference,
    Option<String>,  // custom_name_prompt
    Option<String>,  // custom_commit_prompt
) {
    // ... existing code ...
    (agent, env_vars, cli_args, binary_path, preferences,
     generation_settings.name_prompt, generation_settings.commit_prompt)
}
```

Update all call sites in `schaltwerk_core.rs` to destructure the two new values and pass `custom_name_prompt` into `SessionRenameContext` / `NameGenerationArgs`.

**Step 4: Fix all call sites that construct SessionRenameContext/NameGenerationArgs**

Search for all places that construct these structs and add `custom_name_prompt: None` or the actual value.

**Step 5: Run tests**

Run: `just test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src-tauri/src/domains/agents/naming.rs src-tauri/src/commands/schaltwerk_core.rs
git commit -m "feat(generation): support custom name generation prompts"
```

---

### Task 4: Wire custom prompts to commit message generation

**Files:**
- Modify: `src-tauri/src/domains/agents/commit_message.rs:4-11` (CommitMessageArgs)
- Modify: `src-tauri/src/commands/schaltwerk_core.rs:530+`

**Step 1: Add custom_commit_prompt to CommitMessageArgs**

```rust
pub struct CommitMessageArgs<'a> {
    pub agent_type: &'a str,
    pub commit_subjects: &'a [String],
    pub changed_files_summary: &'a str,
    pub cli_args: Option<&'a str>,
    pub env_vars: &'a [(String, String)],
    pub binary_path: Option<&'a str>,
    pub custom_commit_prompt: Option<&'a str>,
}
```

**Step 2: Use custom prompt in build_prompt**

Modify `build_prompt` (or add a conditional before it) to use the custom prompt with `{commits}` and `{files}` template variables if provided.

**Step 3: Pass custom_commit_prompt from schaltwerk_core.rs**

Use the value from `resolve_generation_agent_and_args`.

**Step 4: Run tests**

Run: `just test`
Expected: All PASS

**Step 5: Commit**

```bash
git add src-tauri/src/domains/agents/commit_message.rs src-tauri/src/commands/schaltwerk_core.rs
git commit -m "feat(generation): support custom commit message prompts"
```

---

### Task 5: Update frontend - i18n types and strings

**Files:**
- Modify: `src/common/i18n/types.ts:301-310`
- Modify: `src/locales/en.json:299-308`
- Modify: `src/locales/zh.json` (corresponding section)

**Step 1: Update i18n types**

Replace the `generation` section in `types.ts`:

```typescript
generation: {
  title: string
  description: string
  agent: string
  agentDesc: string
  agentDefault: string
  cliArgs: string
  cliArgsDesc: string
  cliArgsPlaceholder: string
  customPrompts: string
  customPromptsDesc: string
  namePrompt: string
  namePromptDesc: string
  namePromptPlaceholder: string
  commitPrompt: string
  commitPromptDesc: string
  commitPromptPlaceholder: string
}
```

**Step 2: Update en.json**

```json
"generation": {
  "title": "AI Generation",
  "description": "Configure which AI agent is used for generating session names and commit messages.",
  "agent": "Agent",
  "agentDesc": "Which agent CLI to use for AI generation. Default uses the session's agent.",
  "agentDefault": "Default (session agent)",
  "cliArgs": "CLI Arguments",
  "cliArgsDesc": "Extra command-line arguments passed to the agent for generation (e.g., --model gemini-2.0-flash).",
  "cliArgsPlaceholder": "e.g., --model gemini-2.0-flash",
  "customPrompts": "Custom Prompts",
  "customPromptsDesc": "Override the default prompts used for AI generation. Leave empty to use defaults.",
  "namePrompt": "Name Generation Prompt",
  "namePromptDesc": "Prompt for generating session names. Use {task} as placeholder for the task description.",
  "namePromptPlaceholder": "Default prompt generates a short kebab-case name from the task description",
  "commitPrompt": "Commit Message Prompt",
  "commitPromptDesc": "Prompt for generating commit messages. Use {commits} for commit subjects and {files} for changed files.",
  "commitPromptPlaceholder": "Default prompt generates a conventional commit message from the changes"
}
```

**Step 3: Update zh.json similarly**

**Step 4: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/common/i18n/types.ts src/locales/en.json src/locales/zh.json
git commit -m "feat(i18n): update generation settings translations"
```

---

### Task 6: Update frontend - SettingsModal UI

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx:357-358` (state), `923-933` (save), `2391-2447` (render)

**Step 1: Update state variables**

Replace `generationModel` state with `generationCliArgs`, add `generationNamePrompt` and `generationCommitPrompt`:

```typescript
const [generationCliArgs, setGenerationCliArgs] = useState<string>('')
const [generationNamePrompt, setGenerationNamePrompt] = useState<string>('')
const [generationCommitPrompt, setGenerationCommitPrompt] = useState<string>('')
const [showCustomPrompts, setShowCustomPrompts] = useState<boolean>(false)
```

**Step 2: Update load logic**

In the settings loading section (around line 744-767), update to load the new fields:

```typescript
loadedGenerationCliArgs = genSettings.cli_args ?? ''
loadedGenerationNamePrompt = genSettings.name_prompt ?? ''
loadedGenerationCommitPrompt = genSettings.commit_prompt ?? ''
```

**Step 3: Update saveGenerationSettings**

```typescript
const saveGenerationSettings = useCallback(async (
    agent: string,
    cliArgs: string,
    namePrompt: string,
    commitPrompt: string
) => {
    try {
        await invoke(TauriCommands.SetGenerationSettings, {
            settings: {
                agent: agent || null,
                cli_args: cliArgs || null,
                name_prompt: namePrompt || null,
                commit_prompt: commitPrompt || null,
            },
        })
    } catch (error) {
        logger.error('Failed to save generation settings:', error)
    }
}, [])
```

**Step 4: Update renderGenerationSettings**

Replace the current render with:
- Agent dropdown (same as current)
- CLI Arguments text input (mono font, matching agent config page style)
- Collapsible "Custom Prompts" section with:
  - Name prompt textarea
  - Commit prompt textarea

```tsx
const renderGenerationSettings = () => (
    <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
                <div>
                    <h3 className="text-body font-medium text-text-primary mb-1">
                        {t.settings.generation.title}
                    </h3>
                    <p className="text-body text-text-tertiary mb-4">
                        {t.settings.generation.description}
                    </p>
                </div>

                {/* Agent dropdown - same as current */}
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
                            void saveGenerationSettings(e.target.value, generationCliArgs, generationNamePrompt, generationCommitPrompt)
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

                {/* CLI Arguments */}
                <div>
                    <label className="text-body font-medium text-text-primary block mb-1">
                        {t.settings.generation.cliArgs}
                    </label>
                    <p className="text-caption text-text-tertiary mb-2">
                        {t.settings.generation.cliArgsDesc}
                    </p>
                    <input
                        type="text"
                        value={generationCliArgs}
                        onChange={(e) => setGenerationCliArgs(e.target.value)}
                        onBlur={() => void saveGenerationSettings(generationAgent, generationCliArgs, generationNamePrompt, generationCommitPrompt)}
                        placeholder={t.settings.generation.cliArgsPlaceholder}
                        className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 placeholder-text-muted font-mono text-body"
                    />
                </div>

                {/* Custom Prompts - Collapsible */}
                <div className="border-t border-border-subtle pt-6">
                    <button
                        onClick={() => setShowCustomPrompts(!showCustomPrompts)}
                        className="flex items-center gap-2 text-body font-medium text-text-primary cursor-pointer"
                    >
                        <svg
                            className={`w-4 h-4 transition-transform ${showCustomPrompts ? 'rotate-90' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {t.settings.generation.customPrompts}
                    </button>
                    <p className="text-caption text-text-tertiary mt-1 ml-6">
                        {t.settings.generation.customPromptsDesc}
                    </p>

                    {showCustomPrompts && (
                        <div className="mt-4 ml-6 space-y-4">
                            <div>
                                <label className="text-body font-medium text-text-primary block mb-1">
                                    {t.settings.generation.namePrompt}
                                </label>
                                <p className="text-caption text-text-tertiary mb-2">
                                    {t.settings.generation.namePromptDesc}
                                </p>
                                <textarea
                                    value={generationNamePrompt}
                                    onChange={(e) => setGenerationNamePrompt(e.target.value)}
                                    onBlur={() => void saveGenerationSettings(generationAgent, generationCliArgs, generationNamePrompt, generationCommitPrompt)}
                                    placeholder={t.settings.generation.namePromptPlaceholder}
                                    className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 placeholder-text-muted font-mono text-body min-h-[100px] resize-y"
                                    rows={4}
                                />
                            </div>

                            <div>
                                <label className="text-body font-medium text-text-primary block mb-1">
                                    {t.settings.generation.commitPrompt}
                                </label>
                                <p className="text-caption text-text-tertiary mb-2">
                                    {t.settings.generation.commitPromptDesc}
                                </p>
                                <textarea
                                    value={generationCommitPrompt}
                                    onChange={(e) => setGenerationCommitPrompt(e.target.value)}
                                    onBlur={() => void saveGenerationSettings(generationAgent, generationCliArgs, generationNamePrompt, generationCommitPrompt)}
                                    placeholder={t.settings.generation.commitPromptPlaceholder}
                                    className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 placeholder-text-muted font-mono text-body min-h-[100px] resize-y"
                                    rows={4}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
)
```

**Step 5: Run lint and tests**

Run: `just test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/components/modals/SettingsModal.tsx
git commit -m "feat(settings): redesign AI generation settings UI with CLI args and custom prompts"
```

---

### Task 7: Final validation and cleanup

**Step 1: Run full test suite**

Run: `just test`
Expected: All PASS

**Step 2: Remove old model field references from frontend**

Search for any remaining references to `generationModel` or `settings.generation.model` in the frontend and remove them.

**Step 3: Run full test suite again**

Run: `just test`
Expected: All PASS

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: clean up old generation model references"
```
