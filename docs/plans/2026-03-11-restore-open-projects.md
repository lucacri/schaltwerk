# Restore Open Project Tabs on Startup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist open project tabs across app restarts so users resume exactly where they left off.

**Architecture:** Frontend-driven restoration. Backend provides two file-based commands (`save_open_tabs_state` / `get_open_tabs_state`) and a settings toggle (`restore_open_projects`). When the app starts without a CLI arg, the frontend checks the setting, loads saved tabs, validates paths, and opens them using the existing `openProjectActionAtom`. Tab state is saved on every tab mutation (debounced).

**Tech Stack:** Rust (Tauri commands, serde JSON), TypeScript (Jotai atoms, Tauri invoke)

---

### Task 1: Backend — OpenTabsState type and persistence

**Files:**
- Modify: `src-tauri/src/projects.rs`

**Step 1: Write the failing test for save/load round-trip**

Add to the `mod tests` block in `projects.rs`:

```rust
#[test]
#[serial_test::serial]
fn test_open_tabs_state_save_and_load_round_trip() {
    use lucode::utils::env_adapter::EnvAdapter;
    let tmp = TempDir::new().unwrap();
    let prev_home = env::var("HOME").ok();
    let prev_xdg = env::var("XDG_CONFIG_HOME").ok();

    EnvAdapter::set_var("HOME", &tmp.path().to_string_lossy());
    EnvAdapter::set_var(
        "XDG_CONFIG_HOME",
        &tmp.path().join(".config").to_string_lossy(),
    );
    std::fs::create_dir_all(tmp.path().join(".config")).unwrap();

    // No file → returns None
    let loaded = OpenTabsState::load().unwrap();
    assert!(loaded.is_none());

    // Save state
    let state = OpenTabsState {
        tabs: vec!["/a/b".to_string(), "/x/y".to_string()],
        active: Some("/x/y".to_string()),
    };
    state.save().unwrap();

    // Load it back
    let loaded = OpenTabsState::load().unwrap().unwrap();
    assert_eq!(loaded.tabs, vec!["/a/b", "/x/y"]);
    assert_eq!(loaded.active, Some("/x/y".to_string()));

    // Save empty → load returns Some with empty tabs
    let empty = OpenTabsState { tabs: vec![], active: None };
    empty.save().unwrap();
    let loaded = OpenTabsState::load().unwrap().unwrap();
    assert!(loaded.tabs.is_empty());

    if let Some(p) = prev_home { EnvAdapter::set_var("HOME", &p); } else { EnvAdapter::remove_var("HOME"); }
    if let Some(p) = prev_xdg { EnvAdapter::set_var("XDG_CONFIG_HOME", &p); } else { EnvAdapter::remove_var("XDG_CONFIG_HOME"); }
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo nextest run test_open_tabs_state_save_and_load_round_trip`
Expected: FAIL — `OpenTabsState` not found

**Step 3: Write the implementation**

Add before the `pub fn is_git_repository` function in `projects.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenTabsState {
    pub tabs: Vec<String>,
    pub active: Option<String>,
}

impl OpenTabsState {
    pub fn load() -> Result<Option<Self>> {
        let path = Self::config_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let state: OpenTabsState = serde_json::from_str(&content)?;
        Ok(Some(state))
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }

    fn config_path() -> Result<PathBuf> {
        let config_dir =
            dirs::config_dir().ok_or_else(|| anyhow::anyhow!("Failed to get config directory"))?;
        Ok(config_dir.join("lucode").join("open_tabs.json"))
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo nextest run test_open_tabs_state_save_and_load_round_trip`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/projects.rs
git commit -m "feat(restore-tabs): add OpenTabsState type with save/load persistence"
```

---

### Task 2: Backend — Tauri commands for open tabs state

**Files:**
- Modify: `src-tauri/src/commands/project.rs`
- Modify: `src-tauri/src/main.rs` (register commands)

**Step 1: Add Tauri command implementations**

In `commands/project.rs`, add:

```rust
#[tauri::command]
pub fn save_open_tabs_state(tabs: Vec<String>, active: Option<String>) -> Result<(), String> {
    let state = projects::OpenTabsState { tabs, active };
    state.save().map_err(|e| format!("Failed to save open tabs state: {e}"))
}

#[tauri::command]
pub fn get_open_tabs_state() -> Result<Option<projects::OpenTabsState>, String> {
    projects::OpenTabsState::load()
        .map_err(|e| format!("Failed to load open tabs state: {e}"))
}
```

**Step 2: Register in main.rs**

In the `tauri::generate_handler!` block in `main.rs`, add `save_open_tabs_state` and `get_open_tabs_state` near the other project commands (around line 1350, near `get_recent_projects`).

**Step 3: Run tests**

Run: `just test`
Expected: All pass (including cargo build)

**Step 4: Commit**

```bash
git add src-tauri/src/commands/project.rs src-tauri/src/main.rs
git commit -m "feat(restore-tabs): add Tauri commands for save/load open tabs state"
```

---

### Task 3: Backend — Settings toggle `restore_open_projects`

**Files:**
- Modify: `src-tauri/src/domains/settings/types.rs`
- Modify: `src-tauri/src/domains/settings/service.rs`
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/main.rs` (register commands)

**Step 1: Write failing test for the setting default**

In `service.rs` tests, add:

```rust
#[test]
fn restore_open_projects_defaults_to_true() {
    let repo = InMemoryRepository::default();
    let service = SettingsService::new(Box::new(repo));
    assert!(service.get_restore_open_projects());
}

#[test]
fn set_restore_open_projects_persists_value() {
    let repo = InMemoryRepository::default();
    let repo_handle = repo.clone();
    let mut service = SettingsService::new(Box::new(repo));

    service.set_restore_open_projects(false).expect("should persist");
    assert!(!service.get_restore_open_projects());
    assert!(!repo_handle.snapshot().restore_open_projects);
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo nextest run restore_open_projects`
Expected: FAIL — field/method not found

**Step 3: Implement the setting**

In `types.rs`, add field to `Settings` struct (after `generation`):

```rust
#[serde(default = "default_true")]
pub restore_open_projects: bool,
```

In `Settings::default()`, add:

```rust
restore_open_projects: default_true(),
```

In `service.rs`, add getter/setter methods:

```rust
pub fn get_restore_open_projects(&self) -> bool {
    self.settings.restore_open_projects
}

pub fn set_restore_open_projects(&mut self, enabled: bool) -> Result<(), SettingsServiceError> {
    self.settings.restore_open_projects = enabled;
    self.save()
}
```

In `commands/settings.rs`, add Tauri commands:

```rust
#[tauri::command]
pub async fn get_restore_open_projects(app: AppHandle) -> Result<bool, String> {
    let settings_manager = get_settings_manager(&app).await?;
    let manager = settings_manager.lock().await;
    Ok(manager.get_restore_open_projects())
}

#[tauri::command]
pub async fn set_restore_open_projects(app: AppHandle, enabled: bool) -> Result<(), String> {
    let settings_manager = get_settings_manager(&app).await?;
    let mut manager = settings_manager.lock().await;
    manager.set_restore_open_projects(enabled)
}
```

Register both in `main.rs` `generate_handler!`.

**Step 4: Run tests**

Run: `cd src-tauri && cargo nextest run restore_open_projects`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/domains/settings/types.rs src-tauri/src/domains/settings/service.rs src-tauri/src/commands/settings.rs src-tauri/src/main.rs
git commit -m "feat(restore-tabs): add restore_open_projects setting with getter/setter"
```

---

### Task 4: Frontend — TauriCommands enum entries

**Files:**
- Modify: `src/common/tauriCommands.ts`

**Step 1: Add enum entries**

Add to `TauriCommands` (alphabetical position):

```typescript
GetOpenTabsState: 'get_open_tabs_state',
GetRestoreOpenProjects: 'get_restore_open_projects',
SaveOpenTabsState: 'save_open_tabs_state',
SetRestoreOpenProjects: 'set_restore_open_projects',
```

**Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/common/tauriCommands.ts
git commit -m "feat(restore-tabs): add TauriCommands entries for open tabs state and setting"
```

---

### Task 5: Frontend — Save tab state on mutations (debounced)

**Files:**
- Modify: `src/store/atoms/project.ts`

**Step 1: Write failing test**

Create test in `src/store/atoms/project.test.ts` (if it exists, add to it; otherwise create):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStore } from 'jotai'
import {
  projectTabsAtom,
  openProjectActionAtom,
  closeProjectActionAtom,
  __resetProjectsTestingState,
} from './project'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('open tabs state persistence', () => {
  beforeEach(() => {
    __resetProjectsTestingState()
    mockInvoke.mockReset()
  })

  it('calls save_open_tabs_state after opening a project', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const store = createStore()

    await store.set(openProjectActionAtom, { path: '/test/project' })

    const saveCall = mockInvoke.mock.calls.find(
      ([cmd]) => cmd === 'save_open_tabs_state'
    )
    expect(saveCall).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun run vitest run src/store/atoms/project.test.ts`
Expected: FAIL — save_open_tabs_state never called

**Step 3: Implement debounced save**

In `src/store/atoms/project.ts`, add after the imports:

```typescript
let saveDebounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null

function debouncedSaveOpenTabsState(get: GetAtomFunction): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
  }
  saveDebounceTimer = globalThis.setTimeout(() => {
    saveDebounceTimer = null
    const tabs = get(projectTabsInternalAtom)
    const activePath = get(baseProjectPathAtom)
    invoke(TauriCommands.SaveOpenTabsState, {
      tabs: tabs.map(t => t.projectPath),
      active: activePath,
    }).catch(error => {
      logger.warn('[projects] Failed to save open tabs state', { error })
    })
  }, 500)
}
```

Then call `debouncedSaveOpenTabsState(get as GetAtomFunction)` at the end of:
- `openProjectActionAtom` (after the `recordRecentProject` call, before returning true)
- `selectProjectActionAtom` (after updating tab status to 'ready', before returning true)
- `closeProjectActionAtom` (after removing tab from array, before returning the result)
- `deactivateProjectActionAtom` (after setting project path to null)

Also export a test helper:

```typescript
export function __flushSaveDebounce(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
    saveDebounceTimer = null
  }
}
```

**Step 4: Run test**

Run: `bun run vitest run src/store/atoms/project.test.ts`
Expected: PASS (may need to flush timer in test with `vi.runAllTimers()`)

**Step 5: Run full validation**

Run: `just test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/store/atoms/project.ts src/store/atoms/project.test.ts
git commit -m "feat(restore-tabs): debounced save of open tabs state on tab mutations"
```

---

### Task 6: Frontend — Restore tabs on startup

**Files:**
- Modify: `src/App.tsx`

**Step 1: Write failing test**

In `src/App.test.tsx`, add a test (follow existing test patterns):

```typescript
it('restores open tabs on startup when setting is enabled', async () => {
  // Mock GetRestoreOpenProjects → true
  // Mock GetOpenTabsState → { tabs: ['/a', '/b'], active: '/b' }
  // Mock directory validation → valid
  // Assert: openProject called for both paths, showHome stays false
})
```

**Step 2: Implement restoration logic**

In `App.tsx`, in the `useEffect` that handles `OpenHome` and `GetActiveProjectPath` (around line 1146–1201), modify the `OpenHome` handler:

Instead of immediately setting `showHome(true)`, add logic:

```typescript
const unlistenHomePromise = listenEvent(SchaltEvent.OpenHome, async (directoryPath) => {
  logger.info('Received open-home event for non-Git directory:', directoryPath)

  // Try restoring open tabs before showing home screen
  try {
    const restoreEnabled = await invoke<boolean>(TauriCommands.GetRestoreOpenProjects)
    if (restoreEnabled) {
      const state = await invoke<{ tabs: string[]; active: string | null } | null>(TauriCommands.GetOpenTabsState)
      if (state && state.tabs.length > 0) {
        logger.info('[App] Restoring open tabs:', state.tabs.length)
        let restoredAny = false

        for (const tabPath of state.tabs) {
          try {
            const exists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: tabPath })
            const isGit = exists && await invoke<boolean>(TauriCommands.IsGitRepository, { path: tabPath })
            if (isGit) {
              await openProjectOnce(tabPath, 'restore-tabs')
              restoredAny = true
            } else {
              logger.info('[App] Skipping invalid tab path during restore:', tabPath)
            }
          } catch (error) {
            logger.warn('[App] Failed to validate tab path during restore:', tabPath, error)
          }
        }

        if (restoredAny) {
          // Activate the previously active tab
          if (state.active) {
            const tabs = store.get(projectTabsAtom)
            if (tabs.some(t => t.projectPath === state.active)) {
              await store.set(selectProjectActionAtom, { path: state.active! })
            }
          }
          return // Don't show home screen
        }
      }
    }
  } catch (error) {
    logger.warn('[App] Failed to restore open tabs:', error)
  }

  setShowHome(true)
  logger.info('Opened home screen because', directoryPath, 'is not a Git repository')
})
```

Note: `openProjectOnce` already calls `handleOpenProject` which sets `showHome(false)` on success. So if any tab restores successfully, home won't be shown.

**Step 3: Run tests**

Run: `just test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(restore-tabs): restore open project tabs on startup"
```

---

### Task 7: Frontend — Settings UI toggle

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx`
- Modify: `src/common/i18n/types.ts` (if i18n keys are needed)

**Step 1: Add the toggle**

Follow the `autoUpdateEnabled` pattern exactly. In the SettingsModal:

1. Add state: `const [restoreOpenProjects, setRestoreOpenProjects] = useState(true)` and `const [loadingRestoreOpenProjects, setLoadingRestoreOpenProjects] = useState(true)`

2. Add handler following `handleAutoUpdateToggle` pattern:
```typescript
const handleRestoreOpenProjectsToggle = useCallback(async () => {
  const previous = restoreOpenProjects
  const next = !previous
  setRestoreOpenProjects(next)
  setLoadingRestoreOpenProjects(true)
  try {
    await invoke(TauriCommands.SetRestoreOpenProjects, { enabled: next })
  } catch (error) {
    logger.error('Failed to update restore open projects preference:', error)
    setRestoreOpenProjects(previous)
  } finally {
    setLoadingRestoreOpenProjects(false)
  }
}, [restoreOpenProjects])
```

3. Load initial value in the existing `useEffect` that loads settings metadata:
```typescript
try {
  const enabled = await invoke<boolean>(TauriCommands.GetRestoreOpenProjects)
  if (!cancelled) setRestoreOpenProjects(enabled)
} catch (error) {
  logger.warn('Failed to load restore open projects preference:', error)
} finally {
  if (!cancelled) setLoadingRestoreOpenProjects(false)
}
```

4. Render toggle in the Version/Updates section (near auto-update toggle), using same HTML structure:
```tsx
<div className="flex items-center justify-between py-3 px-4 bg-bg-elevated/50 rounded-lg">
  <div className="flex flex-col">
    <span className="text-body font-medium text-text-primary">Restore open projects on startup</span>
    <span className="text-caption text-text-tertiary mt-1">
      Reopen the projects you had open when you last quit
    </span>
  </div>
  <label className="flex items-center gap-3" htmlFor="restore-open-projects-toggle">
    <input
      id="restore-open-projects-toggle"
      type="checkbox"
      className="w-4 h-4 text-accent-blue bg-bg-elevated border-border-strong rounded focus:ring-accent-blue focus:ring-2"
      checked={restoreOpenProjects}
      disabled={loadingRestoreOpenProjects}
      onChange={() => { void handleRestoreOpenProjectsToggle() }}
    />
    <span className="text-caption text-text-secondary">
      {loadingRestoreOpenProjects ? 'Loading...' : restoreOpenProjects ? 'Enabled' : 'Disabled'}
    </span>
  </label>
</div>
```

**Step 2: Run tests**

Run: `just test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/components/modals/SettingsModal.tsx
git commit -m "feat(restore-tabs): add settings toggle for restore open projects on startup"
```

---

### Task 8: Save tab state on window close

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add beforeunload handler**

In `App.tsx`, add a `useEffect` that listens for `beforeunload` to do a synchronous save:

```typescript
useEffect(() => {
  const handleBeforeUnload = () => {
    const tabs = store.get(projectTabsAtom)
    const activePath = store.get(projectPathAtom)
    // Fire-and-forget synchronous write via navigator.sendBeacon isn't available for Tauri.
    // The debounced save should have already written the latest state.
    // But force a final save by calling invoke (it won't complete but the debounced one should be fine).
    invoke(TauriCommands.SaveOpenTabsState, {
      tabs: tabs.map(t => t.projectPath),
      active: activePath,
    }).catch(() => {})
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [store])
```

Note: Since `std::process::exit(0)` is called in the backend on close, the invoke may not complete. But the debounced save from the last mutation will have already persisted the state. This `beforeunload` is a best-effort safety net.

**Step 2: Run tests**

Run: `just test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(restore-tabs): best-effort save on window close"
```

---

### Task 9: Final validation and squash

**Step 1: Run full validation**

Run: `just test`
Expected: All green

**Step 2: Manual smoke test points** (for human testing)

1. Open app → open 3 projects → quit → reopen → should see all 3 tabs
2. Open app → open 2 projects → close 1 → quit → reopen → should see 1 tab
3. Delete a project folder while app is closed → reopen → skips that tab, shows remaining
4. Turn off setting → quit → reopen → home screen shown
5. Turn off setting → turn back on → quit → reopen → tabs restored
6. Start with `--dir /some/path` → CLI arg takes precedence, saved tabs ignored

**Step 3: Squash commits**

Squash all feature commits into one:
```
feat(restore-tabs): restore open project tabs on startup

Persist the set of open project tabs to ~/.config/lucode/open_tabs.json
and restore them on startup when no --dir CLI argument is provided.

- Add OpenTabsState save/load persistence in projects.rs
- Add save_open_tabs_state / get_open_tabs_state Tauri commands
- Add restore_open_projects setting (default: true)
- Frontend saves tab state on every tab mutation (debounced 500ms)
- Frontend restores tabs on OpenHome event, validating each path
- Settings toggle in SettingsModal
```
