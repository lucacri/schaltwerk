# Terminal Rehydrate on Reattach — Design

## Problem

Switching projects (and intermittently sessions) leaves the top agent terminal with a stale xterm surface. Output that arrived while the terminal was detached is missing, and the view only refreshes after an OS-level window resize.

## Root Cause

Two compounding bugs in the shared terminal layer (`src/terminal/registry/terminalRegistry.ts` and `src/terminal/stream/terminalOutputManager.ts`):

1. **Dropped stream chunks while detached (data loss).** When a top-terminal record is in the `attached=false` state, the stream listener in `terminalRegistry.ts` short-circuits incoming chunks (`if (!record.attached && isTopTerminalId(record.id)) return;`) and `detach()` wipes any previously buffered `pendingChunks`. This is intentional — it prevents replaying stale local state — but it only makes sense if the frontend has a second mechanism to reconcile with the backend.

2. **No second hydration round.** `terminalOutputManager.startStream()` invokes `GetTerminalBuffer` exactly once per stream lifetime. Because `ensureStream()` in the registry keeps `streamRegistered=true`, `acquire()` of an existing record never re-fetches the backend buffer. The registry also carries unused `lastSeq`/`updateLastSeq`/`getLastSeq` fields, evidence that sequence-based catch-up was scaffolded but never wired up.

Together, the frontend drops live chunks while detached and never asks the backend for the delta on reattach, so the user's only recovery path is an OS-level resize (which only helps when xterm already has the bytes in its buffer — i.e. the secondary paint-only variant of the bug).

## Fix

Add a catch-up hydration round whenever an existing terminal record transitions from detached to attached.

### Change 1 — `rehydrate(id)` on `TerminalOutputManager`

New method: reads `lastSeqById.get(id)` (already maintained) and invokes `GetTerminalBuffer` with that as `from_seq`. Any returned delta is dispatched through the existing listener pipeline, which routes back into the registry's normal batching, TUI-mode guards, and write path. No-op when the stream has not been started yet (first attach is handled by the existing `ensureStarted` path).

### Change 2 — `TerminalInstanceRegistry.attach()` invokes `rehydrate`

When `attach()` runs on a record whose stream is already registered, fire `rehydrate` (fire-and-forget; errors logged at debug). This keeps the new-record path unchanged (initial hydration still happens via `ensureStarted`), and only adds a fetch on genuine reattach.

### Change 3 — Deterministic paint refresh (verification, not new behaviour)

The mount effect in `Terminal.tsx` already schedules `xtermWrapperRef.current?.refresh()` inside a `requestAnimationFrame` after attach (line 1411–1416), and this effect re-runs on `terminalId` change. Confirm ordering: rehydrated bytes are dispatched through the listener, batched, written to xterm, then the RAF refresh fires afterward, yielding a painted surface. No code change expected here beyond asserting behaviour in tests.

## Scope

- Top agent terminal (primary) and bottom user-shell tabs (secondary): both share `Terminal.tsx`, the registry, and the output manager, so a single fix at the shared layer covers both.
- Rehydrate fetch is keyed by `from_seq`; backend returns only bytes since that cursor, so duplicate writes are avoided.
- Does not touch TUI `\x1b[3J` stripping or the oscillation fixes from earlier work.

## Constraints Observed

- No timers, polling, retries, `setTimeout`, or `setInterval` introduced. Rehydrate is a single awaitable fetch triggered by the existing attach event.
- Terminal IDs remain session-scoped; no project scoping added.
- Single source of truth for sequence cursors stays inside `terminalOutputManager`'s `lastSeqById` map.

## Tests

1. `terminalOutputManager.test.ts` — new tests:
   - `rehydrate(id)` invokes `GetTerminalBuffer` with the current `seqCursor` and dispatches returned data through listeners.
   - `rehydrate(id)` is a no-op when the stream has not yet been started.
2. `terminalRegistry.test.ts` — new test:
   - `attachTerminalInstance` on an already-started record calls `terminalOutputManager.rehydrate(id)`.
   - First-time acquire still uses `ensureStarted` (not `rehydrate`) to avoid double-fetch.
3. Existing regression tests pass unchanged: bracketed paste tracking, `\x1b[3J` stripping, backpressure cap, drop-detached behaviour.

## Non-Goals

- Backend hydration transport redesign (tracked in separate tmux plans).
- Behaviour around app minimize/restore or other non-switch visibility changes.
