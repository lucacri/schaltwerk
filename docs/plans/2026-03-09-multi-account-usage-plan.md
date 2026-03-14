# Multi-Account Usage Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support multiple Claude Code accounts in the usage indicator — users add accounts via OAuth tokens, see usage stats for all, with smart error handling and rate limit awareness.

**Architecture:** New `usage_accounts` SQLite table stores account credentials. The `AnthropicUsageProvider` switches from Bearer auth to `x-api-key` header. A background poller fetches usage for all accounts in parallel with per-account error tracking. The frontend UsageIndicator shows worst-case usage across accounts with a multi-account popover, and a new Settings category manages accounts.

**Tech Stack:** Rust (reqwest, rusqlite, tokio::JoinSet), TypeScript/React (Jotai atoms, Tauri commands)

---

## Task 1: Fix auth method and add structured error type

**Files:**
- Modify: `src-tauri/src/domains/usage/types.rs`
- Modify: `src-tauri/src/domains/usage/anthropic.rs`

**Steps:**

1. Add `UsageFetchError` and `AccountUsageSnapshot` to `src-tauri/src/domains/usage/types.rs`:

```rust
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UsageFetchError {
    RateLimited { retry_after_secs: u64 },
    AuthFailed(String),
    NetworkError(String),
    ParseError(String),
}

impl fmt::Display for UsageFetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RateLimited { retry_after_secs } => write!(f, "Rate limited (retry after {retry_after_secs}s)"),
            Self::AuthFailed(msg) => write!(f, "Auth failed: {msg}"),
            Self::NetworkError(msg) => write!(f, "Network error: {msg}"),
            Self::ParseError(msg) => write!(f, "Parse error: {msg}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageAccount {
    pub id: String,
    pub label: String,
    pub is_auto_discovered: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountUsageSnapshot {
    pub account_id: String,
    pub account_label: String,
    pub is_auto_discovered: bool,
    pub snapshot: Option<UsageSnapshot>,
    pub error: Option<String>,
}
```

2. In `src-tauri/src/domains/usage/anthropic.rs`, replace `bearer_auth(&token)` with:
```rust
.header("x-api-key", &token)
.header("anthropic-version", "2023-06-01")
```

3. Add a new public function `fetch_usage_for_token(token: &str) -> Result<UsageSnapshot, UsageFetchError>` that takes a token parameter. It should parse the HTTP response status:
   - 429 → extract `retry-after` header → `UsageFetchError::RateLimited`
   - 401 → `UsageFetchError::AuthFailed`
   - Other non-success → `UsageFetchError::NetworkError`
   - JSON parse failure → `UsageFetchError::ParseError`

4. Keep the existing `AnthropicUsageProvider` trait impl working by having `fetch_usage()` call `fetch_usage_for_token()` internally (read token from Keychain, then delegate). Map `UsageFetchError` to `String` for the trait return type.

5. Update existing tests. Add test for `UsageFetchError::Display`.

6. Run: `cd src-tauri && cargo test --lib domains::usage` — all pass

7. Commit: `feat: fix usage API auth to use x-api-key header and add structured error types`

---

## Task 2: Add usage_accounts DB table and CRUD operations

**Files:**
- Create: `src-tauri/src/domains/usage/db.rs`
- Modify: `src-tauri/src/domains/usage/mod.rs`
- Modify: `src-tauri/src/infrastructure/database/db_schema.rs`

**Steps:**

1. Write tests first in `src-tauri/src/domains/usage/db.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        Database::new(Some(
            tempfile::tempdir().unwrap().into_path().join("test.db"),
        ))
        .unwrap()
    }

    #[test]
    fn test_create_table_is_idempotent() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        create_usage_accounts_table(&conn).unwrap(); // second call must not fail
    }

    #[test]
    fn test_add_and_list_accounts() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        let account = add_account(&conn, "Work", "sk-ant-oat01-test123").unwrap();
        assert_eq!(account.label, "Work");
        assert!(!account.is_auto_discovered);
        let accounts = list_accounts(&conn).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].label, "Work");
    }

    #[test]
    fn test_remove_account() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        let account = add_account(&conn, "Test", "sk-ant-oat01-test").unwrap();
        remove_account(&conn, &account.id).unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_cannot_remove_auto_discovered() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        let account = add_auto_discovered_account(&conn, "Default (Keychain)").unwrap();
        let result = remove_account(&conn, &account.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_account() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        let account = add_account(&conn, "Old", "sk-old").unwrap();
        update_account(&conn, &account.id, "New", "sk-new").unwrap();
        let accounts = list_accounts(&conn).unwrap();
        assert_eq!(accounts[0].label, "New");
    }

    #[test]
    fn test_get_account_token() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        let account = add_account(&conn, "Test", "sk-ant-oat01-secret").unwrap();
        let token = get_account_token(&conn, &account.id).unwrap();
        assert_eq!(token, "sk-ant-oat01-secret");
    }

    #[test]
    fn test_duplicate_label_rejected() {
        let db = test_db();
        let conn = db.get_conn().unwrap();
        create_usage_accounts_table(&conn).unwrap();
        add_account(&conn, "Work", "sk-1").unwrap();
        let result = add_account(&conn, "Work", "sk-2");
        assert!(result.is_err());
    }
}
```

2. Run tests — expected: FAIL (functions not defined)

3. Implement the DB module in `src-tauri/src/domains/usage/db.rs`:

```rust
use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use super::types::UsageAccount;

pub fn create_usage_accounts_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS usage_accounts (
            id TEXT PRIMARY KEY,
            label TEXT UNIQUE NOT NULL,
            token TEXT NOT NULL DEFAULT '',
            is_auto_discovered INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn list_accounts(conn: &Connection) -> Result<Vec<UsageAccount>> {
    // query all rows, return without token
}

pub fn add_account(conn: &Connection, label: &str, token: &str) -> Result<UsageAccount> {
    // insert with is_auto_discovered = false
}

pub fn add_auto_discovered_account(conn: &Connection, label: &str) -> Result<UsageAccount> {
    // insert with is_auto_discovered = true, empty token
    // use INSERT OR IGNORE to be idempotent
}

pub fn remove_account(conn: &Connection, id: &str) -> Result<()> {
    // check is_auto_discovered first, error if true
}

pub fn update_account(conn: &Connection, id: &str, label: &str, token: &str) -> Result<()> {
    // UPDATE usage_accounts SET label = ?1, token = ?2 WHERE id = ?3
}

pub fn get_account_token(conn: &Connection, id: &str) -> Result<String> {
    // SELECT token FROM usage_accounts WHERE id = ?1
}
```

4. Add `pub mod db;` to `src-tauri/src/domains/usage/mod.rs` and add necessary re-exports.

5. In `src-tauri/src/infrastructure/database/db_schema.rs`, find the `initialize_schema()` function and add a call to `create_usage_accounts_table()` after the existing table creations. Import it from `crate::domains::usage::db`.

6. Run tests — expected: PASS

7. Commit: `feat: add usage_accounts DB table with CRUD operations`

---

## Task 3: Add orchestration service for multi-account usage fetching

**Files:**
- Create: `src-tauri/src/domains/usage/service.rs`
- Modify: `src-tauri/src/domains/usage/mod.rs`
- Modify: `src-tauri/src/services/usage.rs`

**Steps:**

1. Create `src-tauri/src/domains/usage/service.rs` with:
   - `resolve_token_for_account(conn, account) -> Result<String>` — if `is_auto_discovered`, call `read_oauth_token()` from `anthropic.rs`; otherwise call `db::get_account_token()`
   - `fetch_all_usage(conn) -> Vec<AccountUsageSnapshot>` — list all accounts, spawn parallel fetches with `tokio::JoinSet`, collect results into `Vec<AccountUsageSnapshot>`
   - `ensure_auto_discovered_account(conn)` — checks if a Keychain token exists, and if so ensures there's an `is_auto_discovered` row in the DB. Called during initialization.

2. Add `pub mod service;` to `src-tauri/src/domains/usage/mod.rs`.

3. Update `src-tauri/src/services/usage.rs` to:
   - Re-export new types: `AccountUsageSnapshot`, `UsageAccount`, `UsageFetchError`
   - Add functions that open the app config DB and delegate to domain service:
     - `fetch_all_usage() -> Result<Vec<AccountUsageSnapshot>, String>`
     - `list_usage_accounts() -> Result<Vec<UsageAccount>, String>`
     - `add_usage_account(label, token) -> Result<UsageAccount, String>`
     - `remove_usage_account(id) -> Result<(), String>`
     - `update_usage_account(id, label, token) -> Result<(), String>`
   - Each function calls `open_app_config_db()` (a helper that mirrors the `open_global_app_config_db()` pattern from `main.rs`) to get a DB handle, then delegates to the domain layer.

4. Run: `cd src-tauri && cargo check` — should compile

5. Write a unit test for `ensure_auto_discovered_account` (creates DB, calls it twice, verify only one row with `is_auto_discovered = true`).

6. Run: `cd src-tauri && cargo test --lib domains::usage` — all pass

7. Commit: `feat: add multi-account usage orchestration service`

---

## Task 4: Update Tauri commands and background poller for multi-account

**Files:**
- Modify: `src-tauri/src/commands/usage.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/common/tauriCommands.ts`
- Modify: `src-tauri/src/infrastructure/events/mod.rs` (if needed)
- Modify: `src/common/events.ts`

**Steps:**

1. Replace `src-tauri/src/commands/usage.rs` content with new commands:

```rust
use lucode::services::usage::{
    AccountUsageSnapshot, UsageAccount,
    fetch_all_usage as fetch_all_usage_service,
    list_usage_accounts as list_usage_accounts_service,
    add_usage_account as add_usage_account_service,
    remove_usage_account as remove_usage_account_service,
    update_usage_account as update_usage_account_service,
};

#[tauri::command]
pub async fn fetch_all_usage() -> Result<Vec<AccountUsageSnapshot>, String> {
    fetch_all_usage_service().await
}

#[tauri::command]
pub async fn list_usage_accounts() -> Result<Vec<UsageAccount>, String> {
    list_usage_accounts_service().await
}

#[tauri::command]
pub async fn add_usage_account(label: String, token: String) -> Result<UsageAccount, String> {
    add_usage_account_service(&label, &token).await
}

#[tauri::command]
pub async fn remove_usage_account(id: String) -> Result<(), String> {
    remove_usage_account_service(&id).await
}

#[tauri::command]
pub async fn update_usage_account(id: String, label: String, token: String) -> Result<(), String> {
    update_usage_account_service(&id, &label, &token).await
}
```

2. Update `src-tauri/src/commands/mod.rs` — the `pub use usage::*` already re-exports, but verify the old `fetch_usage` is gone and replaced by `fetch_all_usage`.

3. In `src-tauri/src/main.rs`:
   - Replace `fetch_usage` with `fetch_all_usage, list_usage_accounts, add_usage_account, remove_usage_account, update_usage_account` in `generate_handler![]`
   - Update background poller to call `fetch_all_usage_service()` and use smart error handling:
     - Track per-account skip-until timestamps in a `HashMap<String, Instant>`
     - On `RateLimited` error in a snapshot, set skip-until for that account
     - On other errors, remove account from poll set (manual refresh re-enables)
   - Call `ensure_auto_discovered_account()` during app startup (in the deferred services block)

4. In `src/common/tauriCommands.ts`:
   - Replace `FetchUsage: 'fetch_usage'` with:
   ```typescript
   FetchAllUsage: 'fetch_all_usage',
   ListUsageAccounts: 'list_usage_accounts',
   AddUsageAccount: 'add_usage_account',
   RemoveUsageAccount: 'remove_usage_account',
   UpdateUsageAccount: 'update_usage_account',
   ```

5. In `src/common/events.ts`:
   - Update `UsageUpdatedPayload` to be an array type:
   ```typescript
   export interface AccountUsageSnapshotPayload {
     account_id: string
     account_label: string
     is_auto_discovered: boolean
     snapshot: {
       session_percent: number
       session_reset_time: string | null
       weekly_percent: number
       weekly_reset_time: string | null
       provider: string
       fetched_at: string
     } | null
     error: string | null
   }
   ```
   - Change `[SchaltEvent.UsageUpdated]` payload type to `AccountUsageSnapshotPayload[]`

6. Run: `just test` — all pass

7. Commit: `feat: update commands and poller for multi-account usage`

---

## Task 5: Update Jotai atoms for multi-account

**Files:**
- Modify: `src/store/atoms/usage.ts`

**Steps:**

1. Rewrite `src/store/atoms/usage.ts`:
   - `AccountUsageSnapshot` interface matching the Rust type
   - `usageAccountsAtom = atom<AccountUsageSnapshot[]>([])` — replaces `usageAtom`
   - `usageLoadingAtom = atom(false)` — unchanged
   - `worstUsageAtom = atom((get) => ...)` — derived read-only atom computing max session_percent and max weekly_percent across non-errored accounts
   - `fetchAllUsageActionAtom` — invokes `TauriCommands.FetchAllUsage`, sets `usageAccountsAtom`
   - `addUsageAccountActionAtom` — invokes `TauriCommands.AddUsageAccount`, then refetches all
   - `removeUsageAccountActionAtom` — invokes `TauriCommands.RemoveUsageAccount`, then refetches all
   - `updateUsageAccountActionAtom` — invokes `TauriCommands.UpdateUsageAccount`, then refetches all
   - `registerUsageEventListenerActionAtom` — listens for `UsageUpdated`, sets `usageAccountsAtom` with the array payload

2. Run: `bun run lint` — PASS

3. Commit: `feat: update usage atoms for multi-account support`

---

## Task 6: Update UsageIndicator component for multi-account

**Files:**
- Modify: `src/components/UsageIndicator.tsx`

**Steps:**

1. Rewrite `UsageIndicator.tsx`:
   - Import `usageAccountsAtom`, `worstUsageAtom`, `usageLoadingAtom`, `fetchAllUsageActionAtom`
   - **Badge**: Use `worstUsageAtom` for display. Show `S:X% W:Y%` from the worst values. If all accounts have errors, show "Usage N/A".
   - **Popover**: Map over `usageAccountsAtom` to render each account as a card:
     - Account label (bold), "(Keychain)" suffix if `is_auto_discovered`
     - If `snapshot` present: session % and weekly % with `percentColor()`, reset times
     - If `error` present: show error text in muted color
     - Per-account refresh button (calls `fetchAllUsageActionAtom` — fetches all, simpler than per-account)
   - **Footer**: "Refresh All" button + "Manage Accounts" link that calls the `onOpenSettings` callback (if available) or similar pattern
   - Keep all existing styling patterns (CSS variables, theme.fontSize, useOutsideDismiss)

2. Run: `bun run lint` — PASS

3. Commit: `feat: update UsageIndicator for multi-account display`

---

## Task 7: Update App.tsx wiring

**Files:**
- Modify: `src/App.tsx`

**Steps:**

1. Replace imports from `store/atoms/usage`:
   - `fetchUsageActionAtom` → `fetchAllUsageActionAtom`
   - `registerUsageEventListenerActionAtom` stays (same name, updated behavior)

2. Update the variable names in the hook calls:
   - `const fetchUsage = useSetAtom(fetchAllUsageActionAtom)`
   - The useEffect body stays the same pattern (call fetch, register listener)

3. Run: `bun run lint` — PASS

4. Commit: `feat: wire multi-account usage into App initialization`

---

## Task 8: Add "Usage Accounts" settings category

**Files:**
- Modify: `src/types/settings.ts` (add `'usageAccounts'` to `SettingsCategory`)
- Modify: `src/components/modals/SettingsModal.tsx`

**Steps:**

1. Add `| 'usageAccounts'` to `SettingsCategory` type union in `src/types/settings.ts`.

2. In `src/components/modals/SettingsModal.tsx`:

   a. Add a new category config entry in the `CATEGORIES` array (after `'sessions'`, before `'version'`):
   ```typescript
   {
       id: 'usageAccounts',
       label: 'Usage Accounts',
       scope: 'application',
       icon: (/* chart bar or meter icon SVG */),
   }
   ```

   b. Add `case 'usageAccounts': return renderUsageAccountsSettings()` to the `switch` in the render function.

   c. Implement `renderUsageAccountsSettings()`:
   - Import `useAtomValue`, `useSetAtom` from jotai
   - Import `usageAccountsAtom`, `addUsageAccountActionAtom`, `removeUsageAccountActionAtom`, `updateUsageAccountActionAtom`, `fetchAllUsageActionAtom`
   - **Account list**: Map over accounts, showing label, redacted token (`token.slice(0, 14) + '...' + token.slice(-4)`), status dot (green/red)
   - **Auto-discovered row**: Lock icon, non-deletable, "(Keychain)" badge
   - **Manual account rows**: Edit button (opens inline form), Delete button with confirmation
   - **Add form**: Two inputs (label + token), "Add" button that calls `addUsageAccountActionAtom`
   - **Token validation**: On add, the backend service attempts a usage fetch; error is returned if token is invalid
   - Follow existing SettingsModal patterns: `settings-input` class for inputs, `settings-btn` class for buttons, CSS variables for all colors

3. Run: `bun run lint` — PASS

4. Run: `just test` — all pass

5. Commit: `feat: add Usage Accounts settings category`

---

## Task 9: Full validation and cleanup

**Steps:**

1. Run: `just test` — all 1232+ tests must pass

2. Check for dead code: `cd src-tauri && cargo clippy` — no warnings from our code

3. Run: `bun run lint` — clean

4. Remove the old `UsageSnapshot` type from `store/atoms/usage.ts` if it's no longer used (replaced by `AccountUsageSnapshot`)

5. Remove old `FetchUsage` from `tauriCommands.ts` if still present

6. Verify the `UsageProvider` trait in `provider.rs` is still used. If `AnthropicUsageProvider` only uses `fetch_usage_for_token()` directly now, remove the trait if unused.

7. Run: `just test` — final confirmation all green

8. Commit any cleanup: `chore: remove unused single-account usage code`

---

## Task 10: Manual E2E verification

**Steps:**

1. Run: `RUST_LOG=lucode=debug bun run tauri:dev`
2. Verify Keychain auto-discovered account appears in the usage badge
3. Open Settings → Usage Accounts, verify Keychain account shows
4. Add a manual account using a `setup-token` token
5. Verify both accounts show in the popover with their usage stats
6. Verify error handling: add an invalid token, confirm error state displays
7. Verify delete works for manual accounts, blocked for auto-discovered
8. Check Rust logs for proper rate limit handling
9. **If API response format differs from assumed**: update `parse_usage_response()` and test fixtures
10. Run: `just test` — all pass
11. Commit any fixes: `fix: adjust usage parsing for actual API response format`

---

## Key Patterns to Follow

**Architecture layering**: Commands import from `services/`, never from `domains/` directly. Services re-export domain types.

**DB access in commands**: Use `open_global_app_config_db()` pattern from `main.rs` — or better, create a shared helper in `services/usage.rs` since commands shouldn't access DB directly.

**Theme colors**: CSS variables only — `var(--color-accent-green)`, `var(--color-accent-amber)`, `var(--color-accent-red)`.

**Settings categories**: Add to `SettingsCategory` type → add config to `CATEGORIES` array → add `case` in render switch → implement `render*Settings()` function.

**TauriCommands**: Always add to enum in `src/common/tauriCommands.ts`. Never use raw strings.

**Events**: Type-safe enums, update both Rust and TypeScript sides.

**Dead code**: `#![deny(dead_code)]` in main.rs + knip for frontend. All code must be used.

**Tests**: Run `just test` before every commit.
