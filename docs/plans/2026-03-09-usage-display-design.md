# Usage Display — Design

## Goal
Show Claude Code rate limit usage (5-hour session window % and weekly limit %) as a persistent indicator in the app header. Extensible to support other providers (OpenAI/Codex) later.

## Data Source
- **Endpoint**: `https://api.anthropic.com/api/oauth/usage` (OAuth-authenticated)
- **Auth**: Read OAuth token from `~/.claude/` config (same credentials Claude Code uses)
- **No CLI fallback** — if the API call fails, show an error state in the badge

## Architecture

### Rust Backend (`src-tauri/src/domains/usage/`)
- New domain module with a `UsageProvider` trait for extensibility
- `AnthropicUsageProvider` implements the trait, calls the OAuth endpoint
- Tauri command to fetch usage on demand
- Background task polls every 5 minutes, emits `UsageUpdated` event to frontend
- Reads OAuth token from `~/.claude/credentials.json` or macOS Keychain

### Frontend
- Jotai atom stores the latest usage snapshot
- `UsageIndicator` component in the header/top bar
- Listens for `UsageUpdated` events + manual refresh via click

## UI

### Compact Badge (header)
Format: `S:12% W:73%`

Color coding (based on higher of the two values):
- Green: < 71%
- Yellow: 71-90%
- Orange: 91-95%
- Red: > 95%

### Expanded Popover (click)
- Session usage % + reset time
- Weekly usage % + reset time
- Refresh button
- Error state if API unreachable / token missing

## Provider Extensibility
- `UsageProvider` trait in Rust with `fetch_usage()` method
- `AnthropicUsageProvider` as first implementation
- `OpenAIUsageProvider` can be added later with same interface
- Settings store which providers are enabled + credentials location

## Data Types
```rust
UsageSnapshot {
    session_percent: u8,
    session_reset_time: Option<String>,
    weekly_percent: u8,
    weekly_reset_time: Option<String>,
    provider: String,  // "anthropic" | "openai" | ...
    fetched_at: DateTime,
}
```

## Reference
- Aperant project (`github.com/AndyMik90/Aperant`) uses the same OAuth endpoint as primary data source
- Their `usage-monitor.ts` polls every 30s; we use 5 minutes + manual refresh
- Color thresholds borrowed from Aperant's `UsageIndicator.tsx`
