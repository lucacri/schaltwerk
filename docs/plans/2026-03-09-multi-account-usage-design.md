# Multi-Account Usage Display

## Goal

Support multiple Claude Code accounts in the usage indicator. Users can add accounts via OAuth tokens (from `claude setup-token`), see usage stats for all accounts, and eventually select which account to use per session runner.

## Data Model

### `usage_accounts` table (app config database)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `label` | TEXT UNIQUE NOT NULL | User-chosen name ("Personal", "Work") |
| `token` | TEXT NOT NULL | `sk-ant-oat01-...` OAuth token |
| `is_auto_discovered` | INTEGER DEFAULT 0 | 1 for Keychain-sourced account |
| `created_at` | TEXT NOT NULL | ISO 8601 timestamp |

The Keychain account is a special row with `is_auto_discovered = 1`. Its token is read fresh from Keychain on each fetch (DB stores empty string as placeholder). Manually added accounts store their token directly in the DB.

### Types

```rust
pub struct UsageAccount {
    pub id: String,
    pub label: String,
    pub is_auto_discovered: bool,
    pub created_at: String,
}

pub struct AccountUsageSnapshot {
    pub account_id: String,
    pub account_label: String,
    pub is_auto_discovered: bool,
    pub snapshot: Option<UsageSnapshot>,
    pub error: Option<String>,
}
```

`UsageSnapshot` (existing) stays unchanged — `session_percent`, `session_reset_time`, `weekly_percent`, `weekly_reset_time`, `provider`, `fetched_at`.

## API Authentication

The Anthropic usage endpoint (`https://api.anthropic.com/api/oauth/usage`) requires:
- `x-api-key` header with the token (NOT `Authorization: Bearer`)
- `anthropic-version: 2023-06-01` header

Both Keychain OAuth tokens and `setup-token` tokens use the same `sk-ant-oat01-...` format and the same `x-api-key` auth mechanism.

## Backend Architecture

### Domain layer (`domains/usage/`)

**`db.rs`** — SQLite operations:
- `create_usage_accounts_table(conn)` — idempotent migration
- `list_accounts(conn) -> Vec<UsageAccount>`
- `add_account(conn, label, token) -> UsageAccount`
- `remove_account(conn, id)` — errors if `is_auto_discovered`
- `update_account(conn, id, label, token)`

**`anthropic.rs`** — modified:
- `fetch_usage_for_token(token: &str) -> Result<UsageSnapshot, UsageFetchError>` — takes token as parameter
- Uses `x-api-key` header instead of `bearer_auth()`
- Adds `anthropic-version: 2023-06-01` header
- Returns structured error type that distinguishes rate limit (with retry-after) from auth errors

**`types.rs`** — add `UsageFetchError`:
```rust
pub enum UsageFetchError {
    RateLimited { retry_after_secs: u64 },
    AuthFailed(String),
    NetworkError(String),
    ParseError(String),
}
```

**`service.rs`** — new orchestration layer:
- `fetch_all_usage(conn) -> Vec<AccountUsageSnapshot>` — loads all accounts, resolves tokens (Keychain for auto-discovered, DB for manual), fetches in parallel via `tokio::JoinSet`

### Service layer (`services/usage.rs`)

Re-exports domain types and provides command-facing functions:
- `fetch_all_usage() -> Vec<AccountUsageSnapshot>`
- `list_usage_accounts() -> Vec<UsageAccount>`
- `add_usage_account(label, token) -> UsageAccount`
- `remove_usage_account(id)`
- `update_usage_account(id, label, token)`

### Commands (`commands/usage.rs`)

Tauri commands wrapping service functions:
- `fetch_all_usage` — replaces `fetch_usage`
- `list_usage_accounts`
- `add_usage_account`
- `remove_usage_account`
- `update_usage_account`

### Background Poller (in `main.rs`)

Polls every 5 minutes. Smart failure handling per account:
- **429 rate limit:** Parse `retry-after` header, skip that account until the time elapses. No retry loop.
- **Any other error (401, network, parse):** Stop auto-polling for that account. Set error state.
- **Manual refresh:** Always works regardless of error state. On success, resumes auto-polling.
- Emits single `UsageUpdated` event with `Vec<AccountUsageSnapshot>` payload.

### Events

`UsageUpdated` payload changes from single `UsageSnapshot` to `Vec<AccountUsageSnapshot>`.

### TauriCommands additions

```typescript
FetchAllUsage: 'fetch_all_usage',
ListUsageAccounts: 'list_usage_accounts',
AddUsageAccount: 'add_usage_account',
RemoveUsageAccount: 'remove_usage_account',
UpdateUsageAccount: 'update_usage_account',
```

## Frontend Architecture

### Jotai Atoms (`store/atoms/usage.ts`)

- `usageAccountsAtom: AccountUsageSnapshot[]` — replaces `usageAtom`
- `usageLoadingAtom: boolean`
- `worstUsageAtom` (derived) — computes highest session % and weekly % across all non-errored accounts for badge display
- `fetchAllUsageActionAtom` — replaces `fetchUsageActionAtom`
- `registerUsageEventListenerActionAtom` — updated for new payload shape
- `addUsageAccountActionAtom`, `removeUsageAccountActionAtom`, `updateUsageAccountActionAtom`

### UsageIndicator Component (`components/UsageIndicator.tsx`)

**Badge:** Shows worst-case usage across all accounts: `S:73% W:85%`. Color based on worst percentage. If all accounts errored, shows "Usage N/A".

**Popover:** Lists each account as a card:
- Account label (bold), auto-discovered badge if applicable
- Session % and weekly % with color coding and reset times
- Error state inline: "Rate limited (retrying in 42m)", "Auth failed"
- Per-account refresh button
- "Refresh All" button at bottom
- "Manage Accounts" link → opens Settings

### Settings Panel

New "Usage Accounts" category or subsection in Settings:
- Table/list of accounts: label, redacted token (`sk-ant-...xxxx`), status indicator
- Auto-discovered (Keychain) account shown with lock icon, non-deletable
- "Add Account" button → inline form: label input + token paste input
- Edit button per manual account (change label or token)
- Delete button per manual account with confirmation
- Token validation on add: attempt a usage fetch, show success/error before saving

## Migration Path

The current single-account implementation transforms into multi-account:
1. Add `usage_accounts` table migration
2. Auto-discover Keychain account on first run, insert as `is_auto_discovered = 1`
3. Replace `fetch_usage` command with `fetch_all_usage`
4. Update `UsageUpdated` event payload to array
5. Update frontend atoms and component
6. Add account management UI in settings
7. Remove old single-account `FetchUsage` command

## Future: Account Selection Per Runner

Not in this iteration, but the data model supports it. A future change would:
- Add `account_id` column to the sessions table
- Add account picker dropdown in the session creation flow
- Inject `CLAUDE_CODE_OAUTH_TOKEN` env var with the selected account's token when starting the agent
