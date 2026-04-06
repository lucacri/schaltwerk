# Usage Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show Claude Code rate limit usage (5-hour session % and weekly %) as a color-coded badge in the header bar, with a click-to-expand popover showing details and a refresh button.

**Architecture:** New `usage` domain in the Rust backend fetches data from `https://api.anthropic.com/api/oauth/usage` using the OAuth token stored in macOS Keychain (service `Claude Code-credentials`). A background task polls every 5 minutes and emits `UsageUpdated` events. Frontend uses a Jotai atom + `UsageIndicator` component in `TopBar.tsx`.

**Tech Stack:** Rust (reqwest for HTTP, security-framework for Keychain), TypeScript/React (Jotai atoms, Tauri event listener)

---

### Task 1: Add reqwest dependency and usage domain skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml` (add reqwest)
- Create: `src-tauri/src/domains/usage/mod.rs`
- Create: `src-tauri/src/domains/usage/types.rs`
- Create: `src-tauri/src/domains/usage/provider.rs`
- Modify: `src-tauri/src/domains/mod.rs` (add `pub mod usage;`)

**Step 1: Add reqwest to Cargo.toml**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
```

Note: Use `rustls-tls` to avoid OpenSSL dependency issues on macOS.

**Step 2: Create types.rs**

```rust
// src-tauri/src/domains/usage/types.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub session_percent: u8,
    pub session_reset_time: Option<String>,
    pub weekly_percent: u8,
    pub weekly_reset_time: Option<String>,
    pub provider: String,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageError {
    pub provider: String,
    pub message: String,
}
```

**Step 3: Create provider.rs with trait**

```rust
// src-tauri/src/domains/usage/provider.rs
use async_trait::async_trait;
use super::types::UsageSnapshot;

#[async_trait]
pub trait UsageProvider: Send + Sync {
    fn provider_name(&self) -> &str;
    async fn fetch_usage(&self) -> Result<UsageSnapshot, String>;
}
```

**Step 4: Create mod.rs**

```rust
// src-tauri/src/domains/usage/mod.rs
pub mod provider;
pub mod types;

pub use provider::UsageProvider;
pub use types::{UsageError, UsageSnapshot};
```

**Step 5: Register domain in domains/mod.rs**

Add `pub mod usage;` to `src-tauri/src/domains/mod.rs`.

**Step 6: Run tests**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors (reqwest downloads, types are defined but unused yet — that's fine at this step since `deny(dead_code)` is in main.rs but these are `pub` types in a lib module).

**Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/domains/usage/ src-tauri/src/domains/mod.rs
git commit -m "feat: add usage domain skeleton with provider trait"
```

---

### Task 2: Implement AnthropicUsageProvider (Keychain + API)

**Files:**
- Create: `src-tauri/src/domains/usage/anthropic.rs`
- Modify: `src-tauri/src/domains/usage/mod.rs` (add `pub mod anthropic;`)

**Context — How the OAuth token works:**
- Claude Code stores its OAuth token in macOS Keychain under service name `Claude Code-credentials`
- The token is used as a Bearer token in the Authorization header
- The endpoint `https://api.anthropic.com/api/oauth/usage` returns JSON with session/weekly usage percentages
- On Linux, Claude Code stores credentials differently (check `~/.claude/` config files for a JSON with an `oauthToken` field)

**Context — Expected API response format (from Aperant's code):**
The response contains sections for "session" and "weekly" usage, each with a percentage and optional reset time. The exact JSON schema should be discovered by examining the actual response. The parser should be resilient to unknown fields.

**Step 1: Write a test for the Anthropic provider credential reading**

In `src-tauri/src/domains/usage/anthropic.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_usage_response_full() {
        let json = serde_json::json!({
            "session": {
                "usage_percent": 12,
                "reset_time": "11:59pm"
            },
            "weekly": {
                "usage_percent": 73,
                "reset_time": "Mar 15, 10:59am"
            }
        });
        let snapshot = parse_usage_response(&json).unwrap();
        assert_eq!(snapshot.session_percent, 12);
        assert_eq!(snapshot.session_reset_time, Some("11:59pm".to_string()));
        assert_eq!(snapshot.weekly_percent, 73);
        assert_eq!(snapshot.weekly_reset_time, Some("Mar 15, 10:59am".to_string()));
        assert_eq!(snapshot.provider, "anthropic");
    }

    #[test]
    fn test_parse_usage_response_missing_reset() {
        let json = serde_json::json!({
            "session": { "usage_percent": 0 },
            "weekly": { "usage_percent": 50 }
        });
        let snapshot = parse_usage_response(&json).unwrap();
        assert_eq!(snapshot.session_percent, 0);
        assert_eq!(snapshot.session_reset_time, None);
        assert_eq!(snapshot.weekly_percent, 50);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib domains::usage::anthropic::tests`
Expected: FAIL — `parse_usage_response` not defined

**Step 3: Implement AnthropicUsageProvider**

```rust
// src-tauri/src/domains/usage/anthropic.rs
use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;

use super::provider::UsageProvider;
use super::types::UsageSnapshot;

const ANTHROPIC_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

pub struct AnthropicUsageProvider {
    client: Client,
}

impl AnthropicUsageProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    fn read_oauth_token() -> Result<String, String> {
        #[cfg(target_os = "macos")]
        {
            read_token_from_keychain()
        }
        #[cfg(target_os = "linux")]
        {
            read_token_from_file()
        }
        #[cfg(target_os = "windows")]
        {
            read_token_from_file()
        }
    }
}

#[cfg(target_os = "macos")]
fn read_token_from_keychain() -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .map_err(|e| format!("Failed to run security command: {e}"))?;

    if !output.status.success() {
        return Err("Claude Code OAuth token not found in Keychain. Is Claude Code authenticated?".to_string());
    }

    let token = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid token encoding: {e}"))?
        .trim()
        .to_string();

    if token.is_empty() {
        return Err("Claude Code OAuth token is empty".to_string());
    }

    Ok(token)
}

#[cfg(not(target_os = "macos"))]
fn read_token_from_file() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let credentials_path = home.join(".claude").join(".credentials.json");

    if credentials_path.exists() {
        let content = std::fs::read_to_string(&credentials_path)
            .map_err(|e| format!("Failed to read credentials: {e}"))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse credentials: {e}"))?;
        if let Some(token) = json.get("oauthToken").and_then(|v| v.as_str()) {
            return Ok(token.to_string());
        }
    }

    Err("Claude Code OAuth token not found. Is Claude Code authenticated?".to_string())
}

pub fn parse_usage_response(json: &serde_json::Value) -> Result<UsageSnapshot, String> {
    let session = json.get("session").ok_or("Missing 'session' field")?;
    let weekly = json.get("weekly").ok_or("Missing 'weekly' field")?;

    let session_percent = session
        .get("usage_percent")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;

    let session_reset_time = session
        .get("reset_time")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let weekly_percent = weekly
        .get("usage_percent")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;

    let weekly_reset_time = weekly
        .get("reset_time")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(UsageSnapshot {
        session_percent,
        session_reset_time,
        weekly_percent,
        weekly_reset_time,
        provider: "anthropic".to_string(),
        fetched_at: Utc::now(),
    })
}

#[async_trait]
impl UsageProvider for AnthropicUsageProvider {
    fn provider_name(&self) -> &str {
        "anthropic"
    }

    async fn fetch_usage(&self) -> Result<UsageSnapshot, String> {
        let token = Self::read_oauth_token()?;

        let response = self
            .client
            .get(ANTHROPIC_USAGE_URL)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch usage: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Usage API returned status {}",
                response.status()
            ));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse usage response: {e}"))?;

        parse_usage_response(&json)
    }
}
```

**Important:** The exact JSON response format from `https://api.anthropic.com/api/oauth/usage` may differ from the assumed structure above. After the first successful API call, inspect the actual response and update `parse_usage_response()` accordingly. The test fixtures should also be updated to match the real format.

**Step 4: Update mod.rs**

Add `pub mod anthropic;` to `src-tauri/src/domains/usage/mod.rs`.

**Step 5: Run tests**

Run: `cd src-tauri && cargo test --lib domains::usage::anthropic::tests`
Expected: PASS

**Step 6: Commit**

```bash
git add src-tauri/src/domains/usage/
git commit -m "feat: implement AnthropicUsageProvider with Keychain token reading"
```

---

### Task 3: Add UsageUpdated event and Tauri command

**Files:**
- Modify: `src-tauri/src/infrastructure/events/mod.rs` (add `UsageUpdated` variant)
- Modify: `src/common/events.ts` (add `UsageUpdated` to frontend enum + payload)
- Modify: `src/common/tauriCommands.ts` (add `FetchUsage` command)
- Create: `src-tauri/src/commands/usage.rs` (Tauri command)
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod usage;`)
- Modify: `src-tauri/src/main.rs` (register command + start background poller)

**Step 1: Add backend event variant**

In `src-tauri/src/infrastructure/events/mod.rs`:
- Add `UsageUpdated` to the `SchaltEvent` enum (after `SelectAllRequested`)
- Add `SchaltEvent::UsageUpdated => "schaltwerk:usage-updated"` to `as_str()`
- Add a test assertion in the test module

**Step 2: Add frontend event + payload**

In `src/common/events.ts`:
- Add `UsageUpdated = 'schaltwerk:usage-updated'` to the `SchaltEvent` enum
- Add the payload interface:
```typescript
export interface UsageUpdatedPayload {
  session_percent: number
  session_reset_time: string | null
  weekly_percent: number
  weekly_reset_time: string | null
  provider: string
  fetched_at: string
  error?: string
}
```
- Add to `EventPayloadMap`: `[SchaltEvent.UsageUpdated]: UsageUpdatedPayload`

**Step 3: Add Tauri command name**

In `src/common/tauriCommands.ts`, add:
```typescript
FetchUsage: 'fetch_usage',
```

**Step 4: Create the Tauri command**

Create `src-tauri/src/commands/usage.rs`:

```rust
use lucode::domains::usage::anthropic::AnthropicUsageProvider;
use lucode::domains::usage::provider::UsageProvider;
use lucode::domains::usage::types::UsageSnapshot;

#[tauri::command]
pub async fn fetch_usage() -> Result<UsageSnapshot, String> {
    let provider = AnthropicUsageProvider::new();
    provider.fetch_usage().await
}
```

**Step 5: Register command in mod.rs**

Add `pub mod usage;` to `src-tauri/src/commands/mod.rs`.

**Step 6: Register in main.rs**

- Import: `use commands::usage::fetch_usage;`
- Add `fetch_usage` to the `tauri::generate_handler![]` macro

**Step 7: Add background polling in main.rs**

After the app setup (near other `tauri::async_runtime::spawn` calls), add:

```rust
// Usage monitoring - polls every 5 minutes
let usage_app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    use lucode::domains::usage::anthropic::AnthropicUsageProvider;
    use lucode::domains::usage::provider::UsageProvider;
    use lucode::infrastructure::events::{emit_event, SchaltEvent};

    let provider = AnthropicUsageProvider::new();
    loop {
        match provider.fetch_usage().await {
            Ok(snapshot) => {
                let _ = emit_event(&usage_app_handle, SchaltEvent::UsageUpdated, &snapshot);
            }
            Err(err) => {
                log::warn!("Usage fetch failed: {err}");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
    }
});
```

**Step 8: Run tests**

Run: `just test`
Expected: All pass (including the new event name test)

**Step 9: Commit**

```bash
git add src-tauri/src/infrastructure/events/mod.rs src/common/events.ts src/common/tauriCommands.ts src-tauri/src/commands/usage.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat: add UsageUpdated event, fetch_usage command, and background poller"
```

---

### Task 4: Create usage Jotai atom

**Files:**
- Create: `src/store/atoms/usage.ts`

**Step 1: Create the atom file**

```typescript
// src/store/atoms/usage.ts
import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'

export interface UsageSnapshot {
  session_percent: number
  session_reset_time: string | null
  weekly_percent: number
  weekly_reset_time: string | null
  provider: string
  fetched_at: string
  error?: string
}

export const usageAtom = atom<UsageSnapshot | null>(null)
export const usageLoadingAtom = atom(false)

export const fetchUsageActionAtom = atom(null, async (_get, set) => {
  set(usageLoadingAtom, true)
  try {
    const snapshot = await invoke<UsageSnapshot>(TauriCommands.FetchUsage)
    set(usageAtom, snapshot)
  } catch (error) {
    logger.warn('Failed to fetch usage', error)
    set(usageAtom, {
      session_percent: 0,
      session_reset_time: null,
      weekly_percent: 0,
      weekly_reset_time: null,
      provider: 'anthropic',
      fetched_at: new Date().toISOString(),
      error: String(error),
    })
  } finally {
    set(usageLoadingAtom, false)
  }
})

export const registerUsageEventListenerActionAtom = atom(null, (_get, set) => {
  return listenEvent(SchaltEvent.UsageUpdated, (payload) => {
    const snapshot = payload as UsageSnapshot
    set(usageAtom, snapshot)
  })
})
```

**Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/store/atoms/usage.ts
git commit -m "feat: add usage Jotai atom with event listener"
```

---

### Task 5: Create UsageIndicator component

**Files:**
- Create: `src/components/UsageIndicator.tsx`

**Step 1: Create the component**

Follow the `GlobalKeepAwakeButton` / `GithubMenuButton` patterns. The component should:

- Show a compact badge: `S:12% W:73%` with color-coded text
- On click, toggle a dropdown/popover (use `useOutsideDismiss` + conditional render)
- Popover shows:
  - Session usage: `12%` + reset time (or "N/A")
  - Weekly usage: `73%` + reset time (or "N/A")
  - Refresh button that calls `fetchUsageActionAtom`
  - If `error` is set, show error message
- Color coding based on `Math.max(session_percent, weekly_percent)`:
  - `< 71` → green (`var(--color-accent-green)`)
  - `71-90` → yellow (`var(--color-accent-yellow)`)
  - `91-95` → orange (`var(--color-accent-orange)`)
  - `> 95` → red (`var(--color-accent-red)`)

```typescript
// src/components/UsageIndicator.tsx
import { useState, useRef, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { VscRefresh } from 'react-icons/vsc'
import { usageAtom, usageLoadingAtom, fetchUsageActionAtom } from '../store/atoms/usage'
import { useOutsideDismiss } from '../hooks/useOutsideDismiss'

function getUsageColor(percent: number): string {
  if (percent > 95) return 'var(--color-accent-red)'
  if (percent >= 91) return 'var(--color-accent-orange)'
  if (percent >= 71) return 'var(--color-accent-yellow)'
  return 'var(--color-accent-green)'
}

export function UsageIndicator() {
  const usage = useAtomValue(usageAtom)
  const loading = useAtomValue(usageLoadingAtom)
  const fetchUsage = useSetAtom(fetchUsageActionAtom)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useOutsideDismiss(menuRef, () => setOpen(false))

  const maxPercent = useMemo(() => {
    if (!usage) return 0
    return Math.max(usage.session_percent, usage.weekly_percent)
  }, [usage])

  const color = getUsageColor(maxPercent)

  if (!usage) return null

  if (usage.error) {
    return (
      <div ref={menuRef} className="relative" data-no-drag>
        <button
          type="button"
          onClick={() => fetchUsage()}
          className="h-6 px-1.5 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors cursor-pointer"
          style={{ fontSize: 'var(--font-caption)' }}
          title="Usage unavailable — click to retry"
        >
          <span style={{ color: 'var(--color-accent-red)' }}>Usage N/A</span>
        </button>
      </div>
    )
  }

  return (
    <div ref={menuRef} className="relative" data-no-drag>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="h-6 px-1.5 inline-flex items-center gap-1 justify-center rounded text-text-tertiary hover:bg-bg-elevated/50 transition-colors cursor-pointer"
        style={{ fontSize: 'var(--font-caption)' }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Claude usage"
      >
        <span style={{ color }}>
          S:{usage.session_percent}% W:{usage.weekly_percent}%
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[200px] z-30 rounded-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div className="px-3 py-2 space-y-2" style={{ fontSize: 'var(--font-body)' }}>
            <div className="text-text-secondary" style={{ fontSize: 'var(--font-caption)' }}>
              Claude Usage
            </div>

            <div className="flex justify-between items-center">
              <span className="text-text-tertiary">Session (5hr)</span>
              <span style={{ color: getUsageColor(usage.session_percent) }}>
                {usage.session_percent}%
              </span>
            </div>
            {usage.session_reset_time && (
              <div className="text-text-tertiary" style={{ fontSize: 'var(--font-caption)' }}>
                Resets {usage.session_reset_time}
              </div>
            )}

            <div
              style={{
                height: '1px',
                backgroundColor: 'var(--color-border-subtle)',
              }}
            />

            <div className="flex justify-between items-center">
              <span className="text-text-tertiary">Weekly</span>
              <span style={{ color: getUsageColor(usage.weekly_percent) }}>
                {usage.weekly_percent}%
              </span>
            </div>
            {usage.weekly_reset_time && (
              <div className="text-text-tertiary" style={{ fontSize: 'var(--font-caption)' }}>
                Resets {usage.weekly_reset_time}
              </div>
            )}

            <div
              style={{
                height: '1px',
                backgroundColor: 'var(--color-border-subtle)',
              }}
            />

            <button
              type="button"
              onClick={() => {
                fetchUsage()
              }}
              disabled={loading}
              className="w-full h-7 inline-flex items-center justify-center gap-1 rounded text-text-secondary hover:bg-bg-elevated/80 transition-colors cursor-pointer disabled:opacity-50"
              style={{ fontSize: 'var(--font-caption)' }}
            >
              <VscRefresh className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/UsageIndicator.tsx
git commit -m "feat: add UsageIndicator component with popover"
```

---

### Task 6: Wire UsageIndicator into TopBar and App initialization

**Files:**
- Modify: `src/components/TopBar.tsx` (add `UsageIndicator`)
- Modify: `src/App.tsx` (initialize usage atom + register event listener)

**Step 1: Add UsageIndicator to TopBar**

In `src/components/TopBar.tsx`, import `UsageIndicator` and add it before the `GlobalKeepAwakeButton` (around line 203):

```tsx
{/* Usage indicator */}
<div className="mr-2" data-no-drag>
  <UsageIndicator />
</div>

{/* Global keep-awake toggle */}
```

**Step 2: Initialize usage in App.tsx**

In `src/App.tsx`, in the `AppContent` function:

1. Import the atoms:
```typescript
import { fetchUsageActionAtom, registerUsageEventListenerActionAtom } from './store/atoms/usage'
```

2. Add initialization (following the existing pattern with `initializeFontSizes`, `registerKeepAwakeListener`):
```typescript
const fetchUsage = useSetAtom(fetchUsageActionAtom)
const registerUsageListener = useSetAtom(registerUsageEventListenerActionAtom)
```

3. In the appropriate `useEffect`, add:
```typescript
void fetchUsage()
```

4. Add a separate `useEffect` for the listener (following existing pattern):
```typescript
useEffect(() => {
  let unlisten: (() => void) | undefined
  void (async () => {
    try {
      unlisten = await registerUsageListener()
    } catch (error) {
      logger.debug('Failed to register usage listener', error)
    }
  })()
  return () => { if (unlisten) unlisten() }
}, [registerUsageListener])
```

**Step 3: Run full test suite**

Run: `just test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/components/TopBar.tsx src/App.tsx
git commit -m "feat: wire UsageIndicator into TopBar with event listener"
```

---

### Task 7: Verify end-to-end with dev server

**Step 1: Start the dev server**

Run: `RUST_LOG=lucode=debug bun run tauri:dev`

**Step 2: Verify**

- Check that the usage badge appears in the header bar
- Check Rust logs for the initial usage fetch (success or auth error)
- If the API response format differs from assumed, update `parse_usage_response()` and its tests in `anthropic.rs`
- Click the badge to verify the popover opens/closes
- Click refresh to verify manual fetch works

**Step 3: Fix any API response format issues**

The `parse_usage_response()` function assumes a specific JSON structure. If the actual response differs, update the parser and tests. This is the most likely adjustment needed.

**Step 4: Run full test suite**

Run: `just test`
Expected: All pass

**Step 5: Final commit (if needed)**

```bash
git add -A
git commit -m "fix: adjust usage response parsing for actual API format"
```

---

### Task 8: Add knip/dead-code compliance

**Step 1: Run knip**

Run: `bun run knip` (or it runs as part of `just test`)

If the new atoms/component/types are flagged as unused (shouldn't happen if wired correctly), verify the imports.

**Step 2: Run cargo shear**

Part of `just test` — verify no unused Rust dependencies.

**Step 3: Final validation**

Run: `just test`
Expected: All pass — clean build, no dead code, no lint errors.
