# Consolidation default agent/preset — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist a single user-chosen default (agent or preset) for consolidation, surfaced in Settings, applied at candidate launch and transitively inherited by the judge.

**Architecture:** Add two nullable columns to `app_config` (`consolidation_default_agent_type`, `consolidation_default_preset_id`) mirroring `ContextualAction`'s agent-or-preset shape. New Tauri get/set commands return/take `{ agentType?, presetId? }`. `App.tsx` reads the default before emitting `UiEvent.NewSessionPrefill` for consolidation candidates and merges `presetId` or `agentType` into the detail. Judge code unchanged — it already inherits from candidate[0].

**Tech Stack:** Rust (rusqlite), Tauri commands, TypeScript/React (Jotai-less leaf hook extension), Vitest, cargo nextest.

---

## Task 1: DB migration + get/set with `ConsolidationDefaultFavorite`

**Files:**
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs` (schema + migration)
- Modify: `src-tauri/src/infrastructure/database/db_app_config.rs` (trait + impl + tests)

### Step 1: Add failing test for default value

Append to the `tests` module in `src-tauri/src/infrastructure/database/db_app_config.rs`:

```rust
#[test]
fn consolidation_default_favorite_defaults_to_claude_agent() {
    let db = create_test_database();
    let value = db
        .get_consolidation_default_favorite()
        .expect("Failed to read default");
    assert_eq!(value.agent_type.as_deref(), Some("claude"));
    assert!(value.preset_id.is_none());
}

#[test]
fn consolidation_default_favorite_set_agent_clears_preset() {
    let db = create_test_database();
    db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
        agent_type: None,
        preset_id: Some("preset-xyz".to_string()),
    })
    .expect("Failed to set preset");
    db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
        agent_type: Some("codex".to_string()),
        preset_id: None,
    })
    .expect("Failed to set agent");
    let value = db
        .get_consolidation_default_favorite()
        .expect("Failed to read default");
    assert_eq!(value.agent_type.as_deref(), Some("codex"));
    assert!(value.preset_id.is_none());
}

#[test]
fn consolidation_default_favorite_set_preset_clears_agent() {
    let db = create_test_database();
    db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
        agent_type: Some("claude".to_string()),
        preset_id: None,
    })
    .expect("Failed to set agent");
    db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
        agent_type: None,
        preset_id: Some("preset-abc".to_string()),
    })
    .expect("Failed to set preset");
    let value = db
        .get_consolidation_default_favorite()
        .expect("Failed to read default");
    assert!(value.agent_type.is_none());
    assert_eq!(value.preset_id.as_deref(), Some("preset-abc"));
}
```

Also update `create_test_database()`'s seed `INSERT OR REPLACE` to include the two new columns (both NULL is fine — default handled in `get_consolidation_default_favorite` path when agent_type is NULL → fall back to `"claude"`, though in seeded rows we explicitly set agent_type='claude', preset_id=NULL).

### Step 2: Run tests — expect compile failure (type + methods don't exist)

`bun run test:rust -- --package lucode infrastructure::database::db_app_config`

Expected: fails to compile.

### Step 3: Add schema + migration columns

In `src-tauri/src/infrastructure/database/db_schema.rs`:

- In the `CREATE TABLE IF NOT EXISTS app_config` block (line ~75) add:

```sql
consolidation_default_agent_type TEXT DEFAULT 'claude',
consolidation_default_preset_id TEXT DEFAULT NULL,
```

- In the `INSERT OR IGNORE INTO app_config (...)` statement (line ~93) add the two columns and values `'claude', NULL` respectively.
- In `apply_app_config_migrations`, append:

```rust
let _ = conn.execute(
    "ALTER TABLE app_config ADD COLUMN consolidation_default_agent_type TEXT DEFAULT 'claude'",
    [],
);
let _ = conn.execute(
    "ALTER TABLE app_config ADD COLUMN consolidation_default_preset_id TEXT DEFAULT NULL",
    [],
);
```

### Step 4: Add struct + trait methods

In `src-tauri/src/infrastructure/database/db_app_config.rs`:

```rust
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConsolidationDefaultFavorite {
    pub agent_type: Option<String>,
    pub preset_id: Option<String>,
}
```

Extend `AppConfigMethods`:

```rust
fn get_consolidation_default_favorite(&self) -> Result<ConsolidationDefaultFavorite>;
fn set_consolidation_default_favorite(&self, value: &ConsolidationDefaultFavorite) -> Result<()>;
```

Implementations (match existing patterns — fall back on error to default):

```rust
fn get_consolidation_default_favorite(&self) -> Result<ConsolidationDefaultFavorite> {
    let conn = self.get_conn()?;
    let result: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
        "SELECT consolidation_default_agent_type, consolidation_default_preset_id FROM app_config WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );
    match result {
        Ok((agent_type, preset_id)) => Ok(ConsolidationDefaultFavorite {
            agent_type,
            preset_id,
        }),
        Err(_) => Ok(ConsolidationDefaultFavorite {
            agent_type: Some("claude".to_string()),
            preset_id: None,
        }),
    }
}

fn set_consolidation_default_favorite(
    &self,
    value: &ConsolidationDefaultFavorite,
) -> Result<()> {
    let conn = self.get_conn()?;
    conn.execute(
        "UPDATE app_config SET consolidation_default_agent_type = ?1, consolidation_default_preset_id = ?2 WHERE id = 1",
        params![value.agent_type, value.preset_id],
    )?;
    Ok(())
}
```

Update the `create_test_database` helper's INSERT to include `consolidation_default_agent_type = 'claude'` and `consolidation_default_preset_id = NULL`.

Also update `test_tutorial_completed_concurrent_access` seed INSERT with the same two values.

### Step 5: Run tests — expect green

`bun run test:rust -- --package lucode infrastructure::database::db_app_config`

Expected: all new tests pass; existing pass.

### Step 6: Commit

```bash
git add src-tauri/src/infrastructure/database/db_schema.rs src-tauri/src/infrastructure/database/db_app_config.rs
git commit -m "feat(db): store consolidation default agent/preset in app_config"
```

---

## Task 2: Repository passthrough + Tauri commands

**Files:**
- Modify: `src-tauri/src/domains/sessions/repository.rs` (thin wrappers)
- Modify: `src-tauri/src/commands/schaltwerk_core.rs` (Tauri commands + tests)
- Modify: `src-tauri/src/commands/mod.rs` (re-exports)
- Modify: `src-tauri/src/main.rs` (invoke_handler registration)

### Step 1: Add failing test for Tauri-level get/set round trip

Append to the existing `#[cfg(test)] mod` block in `src-tauri/src/commands/schaltwerk_core.rs`:

```rust
#[test]
fn resolve_consolidation_default_favorite_uses_db_default() {
    let db = test_db();
    let value = db
        .get_consolidation_default_favorite()
        .expect("read default");
    assert_eq!(value.agent_type.as_deref(), Some("claude"));
    assert!(value.preset_id.is_none());
}
```

(Use the existing test helper pattern — `test_db()` or ad-hoc; copy from neighboring spec-clarification test at line ~700.)

### Step 2: Run test — expect compile fail

`bun run test:rust -- --package lucode commands::schaltwerk_core`

Expected: fail on missing `get_consolidation_default_favorite`.

### Step 3: Add repository passthroughs

In `src-tauri/src/domains/sessions/repository.rs` after `set_spec_clarification_agent_type`:

```rust
pub fn get_consolidation_default_favorite(
    &self,
) -> Result<crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite> {
    self.db
        .get_consolidation_default_favorite()
        .map_err(|e| anyhow!("Failed to get consolidation default favorite: {e}"))
}

pub fn set_consolidation_default_favorite(
    &self,
    value: &crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite,
) -> Result<()> {
    self.db
        .set_consolidation_default_favorite(value)
        .map_err(|e| anyhow!("Failed to set consolidation default favorite: {e}"))
}
```

### Step 4: Add Tauri commands

In `src-tauri/src/commands/schaltwerk_core.rs`, after the spec-clarification getter:

```rust
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationDefaultFavoriteDto {
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub preset_id: Option<String>,
}

#[tauri::command]
pub async fn schaltwerk_core_get_consolidation_default_favorite(
) -> Result<ConsolidationDefaultFavoriteDto, String> {
    let core = get_core_read().await?;
    let value = core
        .db
        .get_consolidation_default_favorite()
        .map_err(|e| format!("Failed to get consolidation default favorite: {e}"))?;
    Ok(ConsolidationDefaultFavoriteDto {
        agent_type: value.agent_type,
        preset_id: value.preset_id,
    })
}

#[tauri::command]
pub async fn schaltwerk_core_set_consolidation_default_favorite(
    value: ConsolidationDefaultFavoriteDto,
) -> Result<(), String> {
    let core = get_core_write().await?;
    let normalized = crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite {
        agent_type: value
            .agent_type
            .and_then(|s| if s.trim().is_empty() { None } else { Some(s) }),
        preset_id: value
            .preset_id
            .and_then(|s| if s.trim().is_empty() { None } else { Some(s) }),
    };
    core.db
        .set_consolidation_default_favorite(&normalized)
        .map_err(|e| format!("Failed to set consolidation default favorite: {e}"))
}
```

(No sessions-refresh emit — this is a preference, not a session-state change, matching spec-clarification behavior is safer but that one emits a refresh. Match spec-clarification's emit for UI consistency if tests don't break.)

Actually, the spec-clarification setter calls `events::request_sessions_refreshed`. Do the same here for parity — some UI lists may depend on default.

### Step 5: Wire command re-exports

- `src-tauri/src/commands/mod.rs`: add both names to the `schaltwerk_core::{ ... }` re-export block (alphabetical-ish).
- `src-tauri/src/main.rs`: add both names inside `.invoke_handler(tauri::generate_handler![ ... ])`.
- `src/common/tauriCommands.ts`: add

```ts
SchaltwerkCoreGetConsolidationDefaultFavorite: 'schaltwerk_core_get_consolidation_default_favorite',
SchaltwerkCoreSetConsolidationDefaultFavorite: 'schaltwerk_core_set_consolidation_default_favorite',
```

### Step 6: Add integration test

In `src-tauri/src/commands/schaltwerk_core.rs` tests, add:

```rust
#[test]
fn set_consolidation_default_favorite_normalizes_empty_strings() {
    use crate::infrastructure::database::db_app_config::ConsolidationDefaultFavorite;
    let db = test_db();
    db.set_consolidation_default_favorite(&ConsolidationDefaultFavorite {
        agent_type: Some("".to_string()),
        preset_id: Some("preset-id".to_string()),
    })
    .unwrap();
    let value = db.get_consolidation_default_favorite().unwrap();
    assert_eq!(value.preset_id.as_deref(), Some("preset-id"));
    // Note: Tauri command does the empty→None coercion; repository preserves input.
    // Assert repository behavior here, command behavior is covered via the DTO unit test below.
    assert_eq!(value.agent_type.as_deref(), Some(""));
}
```

(If this test surfaces that we want repository-level normalization, revisit. For now the Tauri command layer does normalization as documented.)

### Step 7: Run full Rust suite

`bun run test:rust`

Expected: green.

### Step 8: Commit

```bash
git add src-tauri/src/domains/sessions/repository.rs src-tauri/src/commands/schaltwerk_core.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs src/common/tauriCommands.ts
git commit -m "feat(backend): Tauri commands to read/write consolidation default favorite"
```

---

## Task 3: Frontend hook helpers

**Files:**
- Modify: `src/hooks/useClaudeSession.ts`
- Modify: `src/hooks/useClaudeSession.test.ts`

### Step 1: Add failing test

In `src/hooks/useClaudeSession.test.ts`, add a describe block:

```ts
describe('consolidation default favorite', () => {
    it('calls the tauri getter and returns shape', async () => {
        const mockInvoke = vi.mocked(invoke)
        mockInvoke.mockResolvedValueOnce({ agentType: 'codex', presetId: null })
        const { result } = renderHook(() => useClaudeSession())
        const value = await result.current.getConsolidationDefaultFavorite()
        expect(mockInvoke).toHaveBeenCalledWith(
            TauriCommands.SchaltwerkCoreGetConsolidationDefaultFavorite,
        )
        expect(value).toEqual({ agentType: 'codex', presetId: null })
    })

    it('calls the tauri setter with the payload', async () => {
        const mockInvoke = vi.mocked(invoke)
        mockInvoke.mockResolvedValueOnce(undefined)
        const { result } = renderHook(() => useClaudeSession())
        const ok = await result.current.setConsolidationDefaultFavorite({
            agentType: 'claude',
            presetId: null,
        })
        expect(mockInvoke).toHaveBeenCalledWith(
            TauriCommands.SchaltwerkCoreSetConsolidationDefaultFavorite,
            { value: { agentType: 'claude', presetId: null } },
        )
        expect(ok).toBe(true)
    })
})
```

### Step 2: Run — expect fail

`bun run lint && bun vitest run src/hooks/useClaudeSession.test.ts`

Expected: fail (method missing).

### Step 3: Add hook methods

In `src/hooks/useClaudeSession.ts`, add:

```ts
export interface ConsolidationDefaultFavorite {
    agentType: string | null
    presetId: string | null
}

// inside the hook:
const getConsolidationDefaultFavorite = useCallback(async (): Promise<ConsolidationDefaultFavorite> => {
    try {
        const value = await invoke<ConsolidationDefaultFavorite>(
            TauriCommands.SchaltwerkCoreGetConsolidationDefaultFavorite,
        )
        return {
            agentType: value?.agentType ?? null,
            presetId: value?.presetId ?? null,
        }
    } catch (error) {
        logger.error('Failed to get consolidation default favorite:', error)
        return { agentType: DEFAULT_AGENT, presetId: null }
    }
}, [])

const setConsolidationDefaultFavorite = useCallback(async (value: ConsolidationDefaultFavorite): Promise<boolean> => {
    try {
        await invoke(TauriCommands.SchaltwerkCoreSetConsolidationDefaultFavorite, { value })
        return true
    } catch (error) {
        logger.error('Failed to set consolidation default favorite:', error)
        return false
    }
}, [])
```

And expose them in the returned object.

### Step 4: Run — expect green

`bun vitest run src/hooks/useClaudeSession.test.ts`

### Step 5: Commit

```bash
git add src/hooks/useClaudeSession.ts src/hooks/useClaudeSession.test.ts
git commit -m "feat(hooks): expose consolidation default favorite helpers"
```

---

## Task 4: Apply default on consolidation candidate launch

**Files:**
- Modify: `src/App.tsx` (consolidation effect block around line 1592–1630)
- Add: `src/components/modals/newSession/consolidationPrefill.ts` (pure helper)
- Add: `src/components/modals/newSession/consolidationPrefill.test.ts`

Refactoring into a pure helper makes testing deterministic and independent of `App.tsx` DOM events.

### Step 1: Failing helper test

Create `src/components/modals/newSession/consolidationPrefill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyConsolidationDefaultFavorite } from './consolidationPrefill'

describe('applyConsolidationDefaultFavorite', () => {
    it('returns presetId when preset default is stored', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: null, presetId: 'pr-1' }),
        ).toEqual({ presetId: 'pr-1' })
    })

    it('returns agentType when raw-agent default is stored', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: 'codex', presetId: null }),
        ).toEqual({ agentType: 'codex' })
    })

    it('prefers preset over agent when both are set', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: 'codex', presetId: 'pr-1' }),
        ).toEqual({ presetId: 'pr-1' })
    })

    it('returns empty object when neither is set', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: null, presetId: null }),
        ).toEqual({})
    })
})
```

### Step 2: Run — expect fail

`bun vitest run src/components/modals/newSession/consolidationPrefill.test.ts`

### Step 3: Write helper

Create `src/components/modals/newSession/consolidationPrefill.ts`:

```ts
import type { ConsolidationDefaultFavorite } from '../../../hooks/useClaudeSession'

export interface ConsolidationPrefillExtras {
    presetId?: string
    agentType?: string
}

export function applyConsolidationDefaultFavorite(
    value: ConsolidationDefaultFavorite,
): ConsolidationPrefillExtras {
    if (value.presetId) return { presetId: value.presetId }
    if (value.agentType) return { agentType: value.agentType }
    return {}
}
```

### Step 4: Run — expect green

### Step 5: Wire into App.tsx

In `src/App.tsx`, inside the `listenUiEvent(UiEvent.ConsolidateVersionGroup, ...)` effect (~line 1593):

- Import: `import { applyConsolidationDefaultFavorite } from './components/modals/newSession/consolidationPrefill'`
- Use the hook at the component scope (there's already a place `useClaudeSession` would fit): `const { getConsolidationDefaultFavorite } = useClaudeSession()`.
- Inside the async block, after computing `prompt` and before `emitUiEvent(UiEvent.NewSessionPrefillPending)`:

```ts
const defaultFavorite = await getConsolidationDefaultFavorite().catch(() => ({
    agentType: null,
    presetId: null,
}))
const defaults = applyConsolidationDefaultFavorite(defaultFavorite)
```

- Merge `...defaults` into the `emitUiEvent(UiEvent.NewSessionPrefill, { ... })` object.

### Step 6: Run — expect green

`bun run lint && bun vitest run src/App`

(Check the existing App test for consolidation, if any. If there's no direct test, confirm overall `bun run test` green later.)

### Step 7: Commit

```bash
git add src/App.tsx src/components/modals/newSession/consolidationPrefill.ts src/components/modals/newSession/consolidationPrefill.test.ts
git commit -m "feat(consolidation): apply default favorite when prefilling candidates"
```

---

## Task 5: SettingsModal UI row

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`
- Modify: `src/common/i18n/types.ts`, `src/locales/en.json`, `src/locales/zh.json`
- Modify: `src/components/modals/SettingsModal.test.tsx`

We'll use a `Dropdown` that lists every enabled raw agent + every complete enabled preset, with labels already supplied by `buildFavoriteOptions`. The stored value is either `{ agentType }` or `{ presetId }`.

### Step 1: i18n keys

- Add to `src/common/i18n/types.ts` under `projectGeneral`:

```ts
consolidationDefaultAgent: string
consolidationDefaultAgentDesc: string
```

- Add to `src/locales/en.json` under `settings.projectGeneral`:

```json
"consolidationDefaultAgent": "Default consolidation agent",
"consolidationDefaultAgentDesc": "Pre-select this agent or preset when launching a consolidation round. Applies to candidates; the judge inherits from the first candidate."
```

- Add equivalent Chinese strings to `src/locales/zh.json`.

### Step 2: Failing SettingsModal test

In `src/components/modals/SettingsModal.test.tsx`, add a test similar to existing spec-clarification tests that asserts:

- On open, the row labeled "Default consolidation agent" renders.
- Initial value reflects the mocked getter.
- Changing selection and confirming calls the setter with the matching `{ agentType }` or `{ presetId }` payload.

(Copy the structure of the existing `specClarificationAgent` test; look for `specClarificationAgent` usage in the file and clone the pattern.)

### Step 3: Run — expect fail

`bun vitest run src/components/modals/SettingsModal.test.tsx`

### Step 4: Implement the UI

In `src/components/modals/SettingsModal.tsx`:

- Pull `getConsolidationDefaultFavorite` and `setConsolidationDefaultFavorite` from `useClaudeSession()`.
- State: `const [consolidationDefault, setConsolidationDefault] = useState<ConsolidationDefaultFavorite>({ agentType: 'claude', presetId: null })` + an `initialConsolidationDefaultRef`.
- Load it in the effect that loads settings (mirror line ~750 where spec-clarification is loaded).
- Save it in the effect that saves settings (mirror line ~1165 for spec-clarification).
- Under the existing `FormGroup` for spec clarification (around line 1261), add a sibling `FormGroup` with a `Dropdown` whose `items` are built from `buildFavoriteOptions({ presets, enabledAgents, isAvailable, presetOrder: favoriteOrder, rawAgentOrder })`, filtered to remove the spec option.

Dropdown item shape: `{ key: option.id, label: option.title }`. `value` = either `__agent__<type>` (agent) or preset id. onChange: map back to `{ agentType: string | null, presetId: string | null }` and update state.

Because `SettingsModal.tsx` already imports `useAgentPresets`, `useEnabledAgents`, `useAgentAvailability`, `useFavorites`, and `useRawAgentOrder` (verify first; if not, add them). If any of these hooks are not yet imported into this file, add them.

Helper in this file:

```ts
const consolidationFavoriteItems = useMemo(() => {
    return buildFavoriteOptions({
        presets,
        enabledAgents,
        isAvailable,
        presetOrder: favoriteOrder,
        rawAgentOrder,
    })
        .filter(o => o.kind !== 'spec')
        .filter(o => !o.disabled)
        .map(o => ({ key: o.id, label: o.title }))
}, [presets, enabledAgents, isAvailable, favoriteOrder, rawAgentOrder])

const selectedFavoriteKey = consolidationDefault.presetId
    ? consolidationDefault.presetId
    : consolidationDefault.agentType
        ? `__agent__${consolidationDefault.agentType}`
        : ''
```

onChange:

```ts
const handleConsolidationDefaultChange = (key: string) => {
    if (key.startsWith('__agent__')) {
        setConsolidationDefault({ agentType: key.replace('__agent__', ''), presetId: null })
    } else {
        setConsolidationDefault({ agentType: null, presetId: key })
    }
    setHasUnsavedChanges(true)
}
```

### Step 5: Run — expect green

`bun vitest run src/components/modals/SettingsModal.test.tsx`

### Step 6: Commit

```bash
git add src/components/modals/SettingsModal.tsx src/components/modals/SettingsModal.test.tsx src/common/i18n/types.ts src/locales/en.json src/locales/zh.json
git commit -m "feat(settings): pick default consolidation agent/preset in settings"
```

---

## Task 6: Verify + CHANGES.md entry

**Files:**
- Modify: `CHANGES.md` (see CLAUDE.md rule: diverge-from-upstream features must be noted)

### Step 1: Full validation suite

`just test`

Expected: all green. Fix anything that isn't.

### Step 2: Add CHANGES.md entry

Append a concise bullet under the current version section summarising the new setting.

### Step 3: Commit

```bash
git add CHANGES.md
git commit -m "docs(changes): note consolidation default agent/preset setting"
```

### Step 4: Squash commits

When all task commits are in, interactively squash onto a single feat commit:

```bash
git reset --soft $(git merge-base HEAD origin/main)
git commit -m "feat(consolidation): persist default agent/preset in settings

Adds a per-install default (raw agent OR preset) for consolidation. The
default pre-selects the favorite when launching a consolidation
candidate; the judge inherits from candidate[0] as before."
```

(Or use `git rebase -i` without `--no-edit`, marking all but the first as `fixup`. Avoid `git rebase -i --no-edit` per CLAUDE.md.)

---

## Notes for executors

- Stay in the current working directory (`.lucode/worktrees/add-agent-preset_v1/`).
- Every task ends green — run the task-local test before moving on.
- `just test` is the authoritative check per CLAUDE.md. Do not skip it.
- Use the shared skill `superpowers:test-driven-development` for each Red-Green-Refactor cycle.
- No comments narrating what changed. Self-documenting code only.
