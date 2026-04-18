# Fix Terminal Redraw Across Window / Project / Session Transitions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After any of three transitions — window foreground return, project switch, or session switch — the visible xterm surface reflects the live backend PTY output without a manual resize, through an event-driven path (no timers, polling, or periodic refresh).

**Architecture:** Two independent defects compound the symptom and must both be fixed.
1. **Seq-cursor drift on detach (fixes triggers #2 and #3).** `TerminalOutputManager.dispatch()` advances `seqCursor` for every chunk, but the registry listener drops chunks for detached top-terminals. On reattach the existing `rehydrate()` call fetches `from_seq = seqCursor = latest`, so the backend returns an empty delta. Fix: snapshot the dispatch cursor at the moment a top-terminal is detached (`detachedAtSeq`) and pass it as `from_seq` on the reattach-driven rehydrate, then clear the snapshot.
2. **No foreground-return paint (fixes trigger #1).** While the OS window is hidden, `requestAnimationFrame` is throttled and the WebGL canvas is not repainted; pending writes may land but the surface never repaints until the next layout event (resize). A new non-React `windowForegroundBus` singleton wraps the same focus / blur / visibility / Tauri events already handled by `useWindowVisibility.ts`. The registry subscribes to the bus on first acquire and, on each foreground transition, issues `record.xterm.refresh()` for every currently attached record — a pure paint refresh with no data mutation.

**Tech Stack:** TypeScript + Vitest (`bun run test` / `vitest run`), xterm.js, Tauri window API (`getCurrentWindow`), existing `terminalRegistry` / `terminalOutputManager` / `useWindowVisibility` modules. No backend changes. No new dependencies.

---

## Constraints (must all hold)

- No `setTimeout`, `setInterval`, `sleep`, retry loops, or polling introduced in application logic or test code.
- All new behaviour is driven by events already produced by the runtime (focus / blur / visibility / Tauri window / attach / detach).
- Terminal IDs stay session-scoped; no project scoping introduced.
- `#![deny(dead_code)]` is not touched; every new symbol is used.
- No new comments that narrate the change. Add a comment only if it explains WHY a non-obvious invariant exists.

---

## Files Touched (preview)

| File | Kind | Why |
|------|------|-----|
| `src/terminal/stream/terminalOutputManager.ts` | Modify | `rehydrate(id, fromSeq?)` accepts an explicit baseline; new `getSeqCursor(id)` getter |
| `src/terminal/stream/terminalOutputManager.test.ts` | Modify | Cover explicit-fromSeq rehydrate + getter semantics |
| `src/terminal/registry/windowForegroundBus.ts` | Create | Non-React singleton for foreground transitions |
| `src/terminal/registry/windowForegroundBus.test.ts` | Create | Verify fan-out + dedupe + unsubscribe |
| `src/terminal/registry/terminalRegistry.ts` | Modify | Snapshot `detachedAtSeq`; pass to rehydrate; subscribe to foreground bus and to `UiEvent.ProjectSwitchComplete` / `UiEvent.SelectionChanged`; refresh attached xterms |
| `src/terminal/registry/terminalRegistry.test.ts` | Modify | Cover cursor snapshot, rehydrate baseline, foreground refresh, project/session refresh |

---

## Task 0: Branch Hygiene

**Step 1: Confirm clean worktree**

Run: `git status`
Expected: no uncommitted changes before starting Task 1. The plan file under `plans/` is the only pending change; commit it first per the repo's TDD/commit cadence:

```bash
git add plans/2026-04-18-fix-terminal-redraw-plan.md
git commit -m "docs(plan): add terminal redraw fix plan"
```

---

## Task 1: Expose an explicit `fromSeq` on `rehydrate` (TDD)

**Files:**
- Modify: `src/terminal/stream/terminalOutputManager.ts:100-112`, add `getSeqCursor` near the other public methods
- Test: `src/terminal/stream/terminalOutputManager.test.ts` (extend the existing `rehydrate` section around lines 273-325)

### Why

The registry needs to pass a baseline that pre-dates the dropped-while-detached region. Today `rehydrate` is parameterless and always uses `stream.seqCursor`, which has already advanced past the dropped bytes. We add an optional `fromSeq` parameter and a read-only accessor so the registry can snapshot the cursor on detach.

### Step 1: Write the failing test — explicit `fromSeq` is used verbatim

Add inside `describe('terminalOutputManager')` in `src/terminal/stream/terminalOutputManager.test.ts`:

```ts
it('rehydrates from the caller-provided baseline instead of the live seqCursor', async () => {
  const unlisten = vi.fn()
  listenMock.mockResolvedValueOnce(unlisten)
  invokeMock.mockResolvedValueOnce({ seq: 20, startSeq: 0, data: 'initial' })

  const listener = vi.fn()
  terminalOutputManager.addListener(TERMINAL_ID, listener)
  await terminalOutputManager.ensureStarted(TERMINAL_ID)

  expect(terminalOutputManager.getSeqCursor(TERMINAL_ID)).toBe(20)

  invokeMock.mockResolvedValueOnce({ seq: 32, startSeq: 12, data: 'delta-from-12' })
  await terminalOutputManager.rehydrate(TERMINAL_ID, 12)

  expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
    id: TERMINAL_ID,
    from_seq: 12,
  })
  expect(listener).toHaveBeenCalledWith('delta-from-12')
  expect(terminalOutputManager.getSeqCursor(TERMINAL_ID)).toBe(32)
})

it('rehydrate without fromSeq still falls back to the live seqCursor', async () => {
  const unlisten = vi.fn()
  listenMock.mockResolvedValueOnce(unlisten)
  invokeMock.mockResolvedValueOnce({ seq: 9, startSeq: 0, data: 'initial' })

  terminalOutputManager.addListener(TERMINAL_ID, vi.fn())
  await terminalOutputManager.ensureStarted(TERMINAL_ID)

  invokeMock.mockResolvedValueOnce({ seq: 14, startSeq: 9, data: 'delta' })
  await terminalOutputManager.rehydrate(TERMINAL_ID)

  expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
    id: TERMINAL_ID,
    from_seq: 9,
  })
})

it('getSeqCursor returns null before hydration starts', () => {
  expect(terminalOutputManager.getSeqCursor('never-started')).toBeNull()
})
```

### Step 2: Run the tests to verify they fail

Run: `bun run vitest run src/terminal/stream/terminalOutputManager.test.ts`
Expected: FAIL — `getSeqCursor` undefined, or `rehydrate` ignores the second argument.

### Step 3: Implement the minimal change in `terminalOutputManager.ts`

Change the signature of `rehydrate` and add `getSeqCursor`. Modify `hydrate` so the caller-provided baseline wins over the live `seqCursor`.

```ts
async rehydrate(id: string, fromSeq?: number | null): Promise<void> {
  const stream = this.streams.get(id)
  if (!stream) return
  if (stream.starting) {
    try {
      await stream.starting
    } catch {
      return
    }
  }
  if (!stream.started) return
  await profileSwitchPhaseAsync(
    'hydration.rehydrate',
    () => this.hydrate(id, stream, fromSeq ?? undefined),
    { terminalId: id },
  )
}

getSeqCursor(id: string): number | null {
  const stream = this.streams.get(id)
  if (stream && stream.seqCursor !== null && stream.seqCursor !== undefined) {
    return stream.seqCursor
  }
  const fallback = this.lastSeqById.get(id)
  return typeof fallback === 'number' ? fallback : null
}
```

Update `hydrate` to accept an override:

```ts
private async hydrate(
  id: string,
  stream: TerminalStream,
  fromSeqOverride?: number,
): Promise<number | null> {
  const fallbackSeq =
    fromSeqOverride !== undefined
      ? fromSeqOverride
      : stream.seqCursor ?? this.lastSeqById.get(id) ?? null
  // ... existing body, unchanged otherwise ...
}
```

### Step 4: Rerun the tests

Run: `bun run vitest run src/terminal/stream/terminalOutputManager.test.ts`
Expected: PASS. Existing `rehydrate` tests also still pass.

### Step 5: Commit

```bash
git add src/terminal/stream/terminalOutputManager.ts src/terminal/stream/terminalOutputManager.test.ts
git commit -m "feat(terminal): allow rehydrate to take an explicit from_seq baseline"
```

---

## Task 2: Snapshot the dispatch cursor on detach and use it on reattach (TDD)

**Files:**
- Modify: `src/terminal/registry/terminalRegistry.ts` (`TerminalInstanceRecord`, `attach`, `detach`)
- Test: `src/terminal/registry/terminalRegistry.test.ts` (extend around the existing `rehydrates on reattach...` case at line 796)

### Why

This fixes triggers #2 and #3. The current `attach()` at lines 221-225 fires `rehydrate(id)` with no baseline, so the manager uses the live `seqCursor` — which has already advanced over the bytes the registry dropped at lines 685-687 while detached. We fix this by recording the cursor at the instant `detach()` runs and forwarding it.

### Step 1: Write the failing tests

Extend the existing mock at the top of `terminalRegistry.test.ts`:

```ts
vi.mock('../stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    ensureStarted: vi.fn(async () => {}),
    rehydrate: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    getSeqCursor: vi.fn(() => null),
  },
}))

const getSeqCursorMock = (terminalOutputManager as unknown as {
  getSeqCursor: ReturnType<typeof vi.fn>
}).getSeqCursor
```

Add these tests below the existing rehydrate tests:

```ts
it('snapshots the dispatch cursor on detach and passes it as the rehydrate baseline', async () => {
  const factory = () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 10, viewportY: 10 } },
      },
      shouldFollowOutput: () => false,
      isTuiMode: () => true,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('session-cursor-snapshot-top', factory)
  attachTerminalInstance('session-cursor-snapshot-top', document.createElement('div'))

  getSeqCursorMock.mockReturnValueOnce(4096)
  detachTerminalInstance('session-cursor-snapshot-top')

  attachTerminalInstance('session-cursor-snapshot-top', document.createElement('div'))

  expect(rehydrateMock).toHaveBeenCalledWith('session-cursor-snapshot-top', 4096)
  expect(rehydrateMock).toHaveBeenCalledTimes(1)

  removeTerminalInstance('session-cursor-snapshot-top')
})

it('clears the snapshot after the reattach rehydrate fires', async () => {
  const factory = () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 0, viewportY: 0 } },
      },
      shouldFollowOutput: () => false,
      isTuiMode: () => true,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('session-cursor-clear-top', factory)
  attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))

  getSeqCursorMock.mockReturnValueOnce(1000)
  detachTerminalInstance('session-cursor-clear-top')
  attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))
  expect(rehydrateMock).toHaveBeenLastCalledWith('session-cursor-clear-top', 1000)

  // A second detach with a fresh cursor must use the new snapshot, not the old one.
  getSeqCursorMock.mockReturnValueOnce(2500)
  detachTerminalInstance('session-cursor-clear-top')
  attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))
  expect(rehydrateMock).toHaveBeenLastCalledWith('session-cursor-clear-top', 2500)
  expect(rehydrateMock).toHaveBeenCalledTimes(2)

  removeTerminalInstance('session-cursor-clear-top')
})

it('does not snapshot a cursor for bottom (non-top) terminals', async () => {
  const factory = () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 0, viewportY: 0 } },
      },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  // Use an id that is NOT a top-terminal id (see sanitizeSessionName / isTopTerminalId);
  // pick a bottom-style id like "session-foo-bottom-0".
  acquireTerminalInstance('session-foo-bottom-0', factory)
  attachTerminalInstance('session-foo-bottom-0', document.createElement('div'))
  detachTerminalInstance('session-foo-bottom-0')
  attachTerminalInstance('session-foo-bottom-0', document.createElement('div'))

  expect(getSeqCursorMock).not.toHaveBeenCalled()
  // Bottom terminals still rehydrate, but without a snapshot baseline.
  expect(rehydrateMock).toHaveBeenCalledWith('session-foo-bottom-0', null)

  removeTerminalInstance('session-foo-bottom-0')
})
```

> **Note:** confirm a concrete bottom-style id by checking `isTopTerminalId` / `sessionTerminalBaseVariants` in `src/common/terminalIdentity.ts`. Adjust the id literal in the last test if the helper classifies `session-foo-bottom-0` differently; the intent of the test — "non-top terminals skip the snapshot" — must remain.

### Step 2: Run the tests to verify they fail

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: FAIL — `rehydrate` is still called with a single argument.

### Step 3: Implement the snapshot in `terminalRegistry.ts`

1. Extend the record type around line 105:

```ts
export interface TerminalInstanceRecord {
  // ... existing fields ...
  detachedAtSeq: number | null;
}
```

2. Initialise the field in the factory block (around line 156):

```ts
const record: TerminalInstanceRecord = {
  // ... existing fields ...
  detachedAtSeq: null,
};
```

3. Update `detach` (around lines 244-250). Keep the existing `pendingChunks = []` behaviour, then add:

```ts
if (isTopTerminalId(record.id)) {
  record.pendingChunks = [];
  record.pendingByteLength = 0;
  record.tuiHoldRedraw = false;
  record.flushAfterParse = false;
  record.hadClearInBatch = false;
  record.detachedAtSeq = terminalOutputManager.getSeqCursor(record.id);
}
```

4. Update `attach` (around lines 221-225). Replace the current `rehydrate(id)` call with:

```ts
if (shouldRehydrate) {
  const fromSeq = record.detachedAtSeq;
  record.detachedAtSeq = null;
  void terminalOutputManager.rehydrate(id, fromSeq).catch(error => {
    logger.debug(`[Registry] rehydrate failed for ${id}`, error);
  });
}
```

### Step 4: Rerun the tests

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: PASS. Also re-run `src/terminal/stream/terminalOutputManager.test.ts` to be sure.

### Step 5: Commit

```bash
git add src/terminal/registry/terminalRegistry.ts src/terminal/registry/terminalRegistry.test.ts
git commit -m "fix(terminal): rehydrate from detach-time cursor to recover dropped bytes"
```

---

## Task 3: Introduce a non-React `windowForegroundBus` (TDD)

**Files:**
- Create: `src/terminal/registry/windowForegroundBus.ts`
- Create: `src/terminal/registry/windowForegroundBus.test.ts`

### Why

The registry is not a React tree, so it cannot consume `useWindowVisibility`. We need an event-driven bus that fires once per `background → foreground` transition. It must mirror the event sources in `src/hooks/useWindowVisibility.ts:31-108` so transitions work on every supported launch surface (browser-embed, Tauri macOS, Tauri Linux).

The bus is a lazy singleton: the first subscriber attaches listeners; when the last subscriber leaves, it tears them down. No timers, no polling.

### Step 1: Write the failing tests

Create `src/terminal/registry/windowForegroundBus.test.ts`:

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { windowForegroundBus } from './windowForegroundBus'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(async () => ({
    listen: vi.fn(async () => () => {}),
  })),
}))

describe('windowForegroundBus', () => {
  beforeEach(() => {
    windowForegroundBus.__resetForTests()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    })
  })

  afterEach(() => {
    windowForegroundBus.__resetForTests()
  })

  it('fires subscribers on blur→focus transitions', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    window.dispatchEvent(new Event('blur'))
    expect(cb).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('focus'))
    expect(cb).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('does not fire on repeated focus events without an intervening blur', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    expect(cb).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    expect(cb).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('treats a visibilitychange to visible after hidden as a foreground transition', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(cb).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('fans out a single transition to every subscriber', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const u1 = windowForegroundBus.subscribe(cb1)
    const u2 = windowForegroundBus.subscribe(cb2)

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    u1()
    u2()
  })

  it('unsubscribes cleanly', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)
    unsubscribe()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(cb).not.toHaveBeenCalled()
  })
})
```

### Step 2: Run the tests to verify they fail

Run: `bun run vitest run src/terminal/registry/windowForegroundBus.test.ts`
Expected: FAIL — module does not exist.

### Step 3: Implement `windowForegroundBus.ts`

```ts
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { logger } from '../../utils/logger'

type ForegroundListener = () => void

interface BusState {
  listeners: Set<ForegroundListener>
  isForeground: boolean
  windowHandlers: {
    focus: () => void
    blur: () => void
    visibility: () => void
  } | null
  tauriUnlisten: UnlistenFn[]
  teardownInFlight: Promise<void> | null
}

function initialForeground(): boolean {
  if (typeof document === 'undefined') return true
  const visible = document.visibilityState !== 'hidden'
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  return visible && focused
}

const state: BusState = {
  listeners: new Set(),
  isForeground: initialForeground(),
  windowHandlers: null,
  tauriUnlisten: [],
  teardownInFlight: null,
}

function notify(): void {
  for (const listener of state.listeners) {
    try {
      listener()
    } catch (error) {
      logger.debug('[windowForegroundBus] listener error', error)
    }
  }
}

function transitionToForeground(): void {
  if (state.isForeground) return
  state.isForeground = true
  notify()
}

function transitionToBackground(): void {
  if (!state.isForeground) return
  state.isForeground = false
}

function attachDomListeners(): void {
  if (state.windowHandlers || typeof window === 'undefined') return

  const focus = () => transitionToForeground()
  const blur = () => transitionToBackground()
  const visibility = () => {
    if (typeof document === 'undefined') return
    const visible = document.visibilityState !== 'hidden'
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
    if (visible && focused) {
      transitionToForeground()
    } else {
      transitionToBackground()
    }
  }

  window.addEventListener('focus', focus)
  window.addEventListener('blur', blur)
  document.addEventListener('visibilitychange', visibility)

  state.windowHandlers = { focus, blur, visibility }

  void (async () => {
    try {
      const current = await getCurrentWindow()
      const focusEvents = ['tauri://focus', 'tauri://active', 'tauri://resumed']
      const blurEvents = ['tauri://blur', 'tauri://inactive']
      const visibilityEvents = ['tauri://visible-change', 'tauri://visibility-change']
      const register = async (names: string[], handler: () => void) => {
        for (const name of names) {
          try {
            const unlisten = await current.listen(name, handler)
            state.tauriUnlisten.push(unlisten)
            return
          } catch (error) {
            logger.debug(`[windowForegroundBus] failed to listen for ${name}`, error)
          }
        }
      }
      await register(focusEvents, () => transitionToForeground())
      await register(blurEvents, () => transitionToBackground())
      await register(visibilityEvents, () => {
        if (typeof document === 'undefined') return
        const visible = document.visibilityState !== 'hidden'
        if (visible) transitionToForeground()
        else transitionToBackground()
      })
    } catch (error) {
      logger.debug('[windowForegroundBus] tauri listener setup failed', error)
    }
  })()
}

function detachDomListeners(): void {
  if (state.windowHandlers && typeof window !== 'undefined') {
    window.removeEventListener('focus', state.windowHandlers.focus)
    window.removeEventListener('blur', state.windowHandlers.blur)
    document.removeEventListener('visibilitychange', state.windowHandlers.visibility)
  }
  state.windowHandlers = null
  for (const unlisten of state.tauriUnlisten) {
    try {
      const result = unlisten()
      if (result instanceof Promise) {
        result.catch(error =>
          logger.debug('[windowForegroundBus] async unlisten error', error),
        )
      }
    } catch (error) {
      logger.debug('[windowForegroundBus] unlisten error', error)
    }
  }
  state.tauriUnlisten = []
}

export const windowForegroundBus = {
  subscribe(listener: ForegroundListener): () => void {
    if (state.listeners.size === 0) {
      attachDomListeners()
    }
    state.listeners.add(listener)
    return () => {
      state.listeners.delete(listener)
      if (state.listeners.size === 0) {
        detachDomListeners()
      }
    }
  },
  isForeground(): boolean {
    return state.isForeground
  },
  __resetForTests(): void {
    state.listeners.clear()
    detachDomListeners()
    state.isForeground = initialForeground()
  },
}
```

### Step 4: Rerun the tests

Run: `bun run vitest run src/terminal/registry/windowForegroundBus.test.ts`
Expected: PASS.

### Step 5: Commit

```bash
git add src/terminal/registry/windowForegroundBus.ts src/terminal/registry/windowForegroundBus.test.ts
git commit -m "feat(terminal): add non-react window foreground bus"
```

---

## Task 4: Refresh attached xterms on foreground transition (TDD)

**Files:**
- Modify: `src/terminal/registry/terminalRegistry.ts` (lazy subscribe to `windowForegroundBus`, iterate records, call `record.xterm.refresh()` on each attached record)
- Test: `src/terminal/registry/terminalRegistry.test.ts` (mock `windowForegroundBus`, assert refresh fan-out)

### Why

Trigger #1. The backend PTY bytes have already been dispatched and written; what is stale is the rendered surface. `XtermTerminal.refresh()` at `src/terminal/xterm/XtermTerminal.ts:391-396` marks every row dirty so the next render cycle repaints the canvas. Calling it on foreground transition, only for attached records, is the targeted fix.

We subscribe the first time a terminal instance is acquired, and unsubscribe when the registry becomes empty. This keeps the bus subscription lifetime tied to real work.

### Step 1: Write the failing tests

Add to the top of `src/terminal/registry/terminalRegistry.test.ts`:

```ts
vi.mock('./windowForegroundBus', () => {
  let subscriber: (() => void) | null = null
  return {
    windowForegroundBus: {
      subscribe: vi.fn((cb: () => void) => {
        subscriber = cb
        return () => {
          if (subscriber === cb) subscriber = null
        }
      }),
      __fireForTests: () => subscriber?.(),
      isForeground: () => true,
    },
  }
})

const foregroundBusModule = await import('./windowForegroundBus')
const fireForeground = (foregroundBusModule.windowForegroundBus as unknown as {
  __fireForTests: () => void
}).__fireForTests
```

Add the tests:

```ts
it('subscribes to the foreground bus and refreshes every attached xterm', async () => {
  const refreshA = vi.fn()
  const refreshB = vi.fn()

  const makeFactory = (refresh: () => void) => () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 0, viewportY: 0 } },
      },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh,
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('foreground-a', makeFactory(refreshA))
  acquireTerminalInstance('foreground-b', makeFactory(refreshB))
  attachTerminalInstance('foreground-a', document.createElement('div'))
  attachTerminalInstance('foreground-b', document.createElement('div'))

  fireForeground()

  expect(refreshA).toHaveBeenCalledTimes(1)
  expect(refreshB).toHaveBeenCalledTimes(1)

  removeTerminalInstance('foreground-a')
  removeTerminalInstance('foreground-b')
})

it('does not refresh xterms that are currently detached', async () => {
  const refresh = vi.fn()
  const factory = () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 0, viewportY: 0 } },
      },
      shouldFollowOutput: () => false,
      isTuiMode: () => true,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh,
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('foreground-detached', factory)
  attachTerminalInstance('foreground-detached', document.createElement('div'))
  detachTerminalInstance('foreground-detached')

  fireForeground()
  expect(refresh).not.toHaveBeenCalled()

  removeTerminalInstance('foreground-detached')
})

it('swallows refresh errors so one bad xterm does not skip the rest', async () => {
  const refreshBad = vi.fn(() => { throw new Error('boom') })
  const refreshGood = vi.fn()
  const makeFactory = (refresh: () => void) => () =>
    ({
      raw: {
        write: vi.fn(),
        scrollToBottom: vi.fn(),
        buffer: { active: { baseY: 0, viewportY: 0 } },
      },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh,
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('foreground-bad', makeFactory(refreshBad))
  acquireTerminalInstance('foreground-good', makeFactory(refreshGood))
  attachTerminalInstance('foreground-bad', document.createElement('div'))
  attachTerminalInstance('foreground-good', document.createElement('div'))

  fireForeground()
  expect(refreshBad).toHaveBeenCalledTimes(1)
  expect(refreshGood).toHaveBeenCalledTimes(1)

  removeTerminalInstance('foreground-bad')
  removeTerminalInstance('foreground-good')
})
```

### Step 2: Run the tests to verify they fail

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: FAIL — subscribe never called, refresh never invoked.

### Step 3: Implement the foreground subscription in `terminalRegistry.ts`

1. At the top of the file, add the import:

```ts
import { windowForegroundBus } from './windowForegroundBus';
```

2. Inside `TerminalInstanceRegistry`, add a private field and helpers:

```ts
private foregroundUnsubscribe: (() => void) | null = null;

private ensureForegroundSubscription(): void {
  if (this.foregroundUnsubscribe) return;
  this.foregroundUnsubscribe = windowForegroundBus.subscribe(() => {
    this.refreshAttached();
  });
}

private tearDownForegroundSubscription(): void {
  if (!this.foregroundUnsubscribe) return;
  try {
    this.foregroundUnsubscribe();
  } catch (error) {
    logger.debug('[Registry] Failed to unsubscribe from foreground bus', error);
  }
  this.foregroundUnsubscribe = null;
}

private refreshAttached(): void {
  for (const record of this.instances.values()) {
    if (!record.attached) continue;
    try {
      record.xterm.refresh();
    } catch (error) {
      logger.debug(`[Registry] refresh failed for ${record.id}`, error);
    }
  }
}
```

3. In `acquire`, call `this.ensureForegroundSubscription()` before returning — for both the reuse branch (after line 151's `ensureStream`) and the new-record branch (after line 175's `ensureStream`). Consolidate by placing the call just before each `return`.

4. In `release`, after `this.instances.delete(id)` (line 198), add:

```ts
if (this.instances.size === 0) {
  this.tearDownForegroundSubscription();
}
```

5. In `forceRemove` and `clear` (lines 329-342, 356-362), also call `this.tearDownForegroundSubscription()` when the map becomes empty. The simplest way: at the end of `clear()`, call it unconditionally (map is empty by then); `forceRemove` already routes through `release`, so no extra change is needed.

### Step 4: Rerun the tests

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: PASS. Also re-run `windowForegroundBus.test.ts` (still green) and `terminalOutputManager.test.ts` (unchanged).

### Step 5: Commit

```bash
git add src/terminal/registry/terminalRegistry.ts src/terminal/registry/terminalRegistry.test.ts
git commit -m "fix(terminal): refresh attached xterms on window foreground return"
```

---

## Task 5: Extend the same refresh path to project-switch and session-switch UI events (TDD)

**Files:**
- Modify: `src/terminal/registry/terminalRegistry.ts` (subscribe lazily to `UiEvent.ProjectSwitchComplete` and `UiEvent.SelectionChanged`, both calling the same `refreshAttached()` method introduced in Task 4)
- Test: `src/terminal/registry/terminalRegistry.test.ts`

### Why

Triggers #2 and #3 are largely covered by the detach/reattach cursor snapshot from Task 2 (since session switching unmounts/remounts the top terminal). Two cases slip past that path:

1. **Surviving rebinds.** Per `CLAUDE.md`: "changing projects should rebind, not recreate, existing IDs." Any terminal that stays attached across a project switch never hits `detach`/`attach`, so it never re-fetches the backend or repaints. A foreground transition does not always coincide with the project switch.
2. **Bottom user-shell tabs.** They are not detached on session switch (only top terminals are swapped). They benefit from a paint refresh on selection change so the visible tab reflects current PTY state immediately.

Routing `ProjectSwitchComplete` and `SelectionChanged` through the same `refreshAttached()` method that the foreground bus already calls keeps every transition on a single shared path — the architectural insight from the v2 candidate. No new reconciliation API is added; the registry just gains two more event sources for the same fan-out it already implements.

### Step 1: Write the failing tests

Extend `terminalRegistry.test.ts`. Mock `listenUiEvent` so the test can fire UI events synchronously:

```ts
vi.mock('../../common/uiEvents', async () => {
  const actual = await vi.importActual<typeof import('../../common/uiEvents')>('../../common/uiEvents')
  const subscribers = new Map<string, Set<(detail: unknown) => void>>()
  return {
    ...actual,
    listenUiEvent: vi.fn((event: string, handler: (detail: unknown) => void) => {
      const set = subscribers.get(event) ?? new Set()
      set.add(handler)
      subscribers.set(event, set)
      return () => set.delete(handler)
    }),
    __fireUiEventForTests: (event: string, detail: unknown) => {
      subscribers.get(event)?.forEach(handler => handler(detail))
    },
  }
})

const uiEventsModule = await import('../../common/uiEvents')
const fireUiEvent = (uiEventsModule as unknown as {
  __fireUiEventForTests: (event: string, detail: unknown) => void
}).__fireUiEventForTests
```

Add the assertions:

```ts
it('refreshes attached xterms when a project switch completes', async () => {
  const refresh = vi.fn()
  const factory = () =>
    ({
      raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh,
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('proj-rebind', factory)
  attachTerminalInstance('proj-rebind', document.createElement('div'))

  fireUiEvent('schaltwerk:project-switch-complete', { projectPath: '/repo' })

  expect(refresh).toHaveBeenCalledTimes(1)
  removeTerminalInstance('proj-rebind')
})

it('refreshes attached xterms when the selection changes to a session or orchestrator', async () => {
  const refresh = vi.fn()
  const factory = () =>
    ({
      raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh,
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('bottom-tab-survives', factory)
  attachTerminalInstance('bottom-tab-survives', document.createElement('div'))

  fireUiEvent('schaltwerk:selection-changed', { kind: 'session', payload: 's1', sessionState: 'running' })
  expect(refresh).toHaveBeenCalledTimes(1)

  fireUiEvent('schaltwerk:selection-changed', { kind: 'orchestrator', payload: 'orch' })
  expect(refresh).toHaveBeenCalledTimes(2)

  removeTerminalInstance('bottom-tab-survives')
})

it('tears down ui-event subscriptions when the registry empties', async () => {
  const factory = () =>
    ({
      raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
      shouldFollowOutput: () => true,
      isTuiMode: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
    } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

  acquireTerminalInstance('cleanup-temp', factory)
  removeTerminalInstance('cleanup-temp')

  expect(() =>
    fireUiEvent('schaltwerk:project-switch-complete', { projectPath: '/repo' }),
  ).not.toThrow()
})
```

### Step 2: Run the tests to verify they fail

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: FAIL — registry does not subscribe to UI events.

### Step 3: Extend the lazy subscription in `terminalRegistry.ts`

1. Import the UI event helpers at the top:

```ts
import { listenUiEvent, UiEvent } from '../../common/uiEvents';
```

2. Reuse the same lazy lifecycle pattern Task 4 introduced. Add companion fields/helpers next to the foreground bus subscription:

```ts
private uiEventUnsubscribers: Array<() => void> = [];

private ensureUiEventSubscriptions(): void {
  if (this.uiEventUnsubscribers.length > 0) return;
  this.uiEventUnsubscribers.push(
    listenUiEvent(UiEvent.ProjectSwitchComplete, () => this.refreshAttached()),
    listenUiEvent(UiEvent.SelectionChanged, detail => {
      if (detail?.kind === 'session' || detail?.kind === 'orchestrator') {
        this.refreshAttached();
      }
    }),
  );
}

private tearDownUiEventSubscriptions(): void {
  for (const unsub of this.uiEventUnsubscribers) {
    try { unsub(); } catch (error) {
      logger.debug('[Registry] Failed to unsubscribe ui event', error);
    }
  }
  this.uiEventUnsubscribers = [];
}
```

3. Call `ensureUiEventSubscriptions()` from the same place(s) as `ensureForegroundSubscription()` in `acquire`. Call `tearDownUiEventSubscriptions()` from the same place(s) as `tearDownForegroundSubscription()` (`release` when the map empties, and unconditionally at the end of `clear`).

### Step 4: Rerun the tests

Run: `bun run vitest run src/terminal/registry/terminalRegistry.test.ts`
Expected: PASS. Foreground tests from Task 4 still pass; the new project/selection tests pass.

### Step 5: Commit

```bash
git add src/terminal/registry/terminalRegistry.ts src/terminal/registry/terminalRegistry.test.ts
git commit -m "fix(terminal): refresh attached xterms on project and session transitions"
```

---

## Task 6: Full-suite verification

Per `CLAUDE.md`, every change must run the full validation suite before handoff.

**Step 1: Run the full suite**

Run: `just test`
Expected: all green. If anything fails:
- Test failures are never "unrelated" per repo policy — fix them.
- Common suspects after these changes: existing tests in `terminalRegistry.test.ts` that rely on the mocked `terminalOutputManager` shape (extend the mock to include `getSeqCursor`) and tests that instantiate the `XtermTerminal` test double without a `refresh` method (add `refresh: vi.fn()`).
- If `knip` flags a newly added export as unused, either wire it up to a real consumer or remove it.

**Step 2: Confirm behaviour in the `fix-terminal-redraw` worktree**

Run: `bun run tauri:dev` in this worktree (only if the user asks for a live run — plan policy does not require it). If run, manually exercise:
1. Start an agent session that streams output, then `cmd+tab` away for ≥30 s and return — surface should show current state without resize.
2. Switch between two projects that both have running agent sessions — surface should show the live backend state immediately on each re-entry.
3. Rapidly switch between two sessions inside one project while the agent is emitting output — surface should show the live state every time.

**Step 3: Inspect logs if a trigger still fails**

`tail -n 200 "$(ls -t ~/Library/Application\ Support/lucode/logs/lucode-*.log | head -1)"`
Look for `[Registry] rehydrate failed`, `[TerminalOutput] hydration failed`, or absent `rehydrate` calls on reattach — each points to a specific integration gap.

**Step 4: No commit in this task.** Verification is complete when `just test` is green and, if a live run was executed, all three triggers behave correctly.

---

## Task 7: Finalise as a single squashed commit

The per-task commits produced above give the reviewer a readable TDD history. Per the user instruction ("Complete the work by creating a squashed commit"), collapse them into one commit on the branch tip before hand-off.

**Step 1: Identify the diverge point**

Run: `git merge-base HEAD main`
Capture the SHA — call it `BASE`.

**Step 2: Soft-reset and re-commit as one**

Run:
```bash
git reset --soft "$BASE"
git status
```
Expected: all changes under `plans/`, `src/terminal/registry/`, and `src/terminal/stream/` are staged.

Create the squash commit with a conventional message that captures both fixes:

```bash
git commit -m "$(cat <<'EOF'
fix(terminal): keep xterm surface live across window/project/session transitions

Two compounding defects made the terminal pane show stale content until a manual resize:

- TerminalOutputManager.dispatch() advanced seqCursor for every chunk, but the registry listener drops chunks for detached top-terminals. The April 17 reattach rehydrate therefore fetched from_seq = latest and got back an empty delta. Snapshot the cursor at detach time and pass it as the rehydrate baseline on reattach.
- While the window was backgrounded, requestAnimationFrame stalled and the WebGL canvas stopped repainting. A new non-React windowForegroundBus mirrors useWindowVisibility for module-level consumers; the registry subscribes lazily and calls xterm.refresh() on every attached record when the window returns to the foreground.
- Project switches that rebind (instead of recreating) terminal IDs and bottom user-shell tabs that survive session swaps never hit detach/attach, so they never repaint on transition. The registry now also subscribes lazily to UiEvent.ProjectSwitchComplete and UiEvent.SelectionChanged, calling the same refreshAttached fan-out.

All new behaviour is event-driven (focus/blur/visibility/tauri window/attach/detach/UI events). No timers, polling, or periodic refresh introduced.
EOF
)"
```

**Step 3: Verify**

Run: `git log --oneline -1` and `just test`
Expected: one commit on top of `BASE`, full suite green.

---

## Open Questions / Risks

- **Bottom-terminal parity.** The registry currently only drops chunks for top-terminal ids while detached, so the seq-drift defect does not apply to bottom user-shell tabs; they still rehydrate with `fromSeq = null`, falling back to the live cursor (a no-op delta) — acceptable because no bytes were dropped. The foreground-refresh fix covers them uniformly.
- **Chrome RAF throttling.** Hidden-tab RAF still fires at ~1 Hz, so the backlog usually drains before the user sees the window. The symptom we target is stale pixels after xterm *has* written bytes; `refresh()` is sufficient. If a future report shows data that never reached xterm, the defensive follow-up is a foreground-triggered `scheduleFlush('foreground')` for every attached record with non-empty `pendingChunks` — additive to this plan, still event-driven.
- **WebGL context loss.** macOS can revoke the WebGL context after extended sleep; the fallback path at `src/terminal/gpu/` already handles `webglcontextlost`. Confirmed out-of-scope here.
- **`useWindowVisibility` duplication.** The bus duplicates the event wiring in `src/hooks/useWindowVisibility.ts`. A later refactor could have the hook delegate to the bus; this plan intentionally leaves both in place to avoid churn in a fix-scope change.
- **Seq-cursor getter semantics with `hasBeenAttached` races.** Dispatch runs on the microtask queue; the `detach()` snapshot is synchronous with the React unmount. If a chunk is dispatched in the same tick as the detach, the snapshot includes it — the `rehydrate` round fetches an empty delta for that boundary byte, which is safe (zero double-write).

---

## Summary of Contract

- Triggers #2 and #3 (data path): `terminalRegistry` snapshots the dispatch cursor at the moment a top-terminal is detached and passes it as the explicit baseline on the reattach-driven `rehydrate`. The bytes dropped while detached are pulled from the backend buffer and dispatched through the existing listener pipeline.
- Trigger #1 (paint path): `windowForegroundBus` fires once per `background → foreground` transition. The registry subscribes lazily (first `acquire`, last `release`) and calls `xterm.refresh()` for every currently attached record.
- Surviving rebinds and bottom-tab parity: the registry also subscribes lazily to `UiEvent.ProjectSwitchComplete` and `UiEvent.SelectionChanged`, calling the same `refreshAttached()` fan-out so terminals that remain attached across project switches and bottom shells that survive session swaps get an immediate paint refresh.
- All three transitions converge on one shared registry method (`refreshAttached`). No timers, polling, periodic refresh, or new reconciliation API; only added event sources for the existing fan-out.

---

## Consolidation Notes

This plan is the consolidated output of three parallel candidates.

- **Base (kept verbatim):** `fix-terminal-redraw_v1`. Adopted in full for the seq-cursor snapshot fix (Task 2), the non-React `windowForegroundBus` (Task 3), the `xterm.refresh()` fan-out on foreground return (Task 4), and the squashed-commit finalisation. v1 was selected because it is the only candidate that names the actual root cause (dispatch advancing `seqCursor` past bytes the registry dropped while detached) and offers a TDD path with concrete failing tests, file:line references, and minimal blast radius.
- **Grafted from `fix-terminal-redraw_v2`:** the architectural insight that all three triggers should converge on one shared registry path. Realised here as Task 5 — registry-level lazy subscriptions to `UiEvent.ProjectSwitchComplete` and `UiEvent.SelectionChanged`, calling the same `refreshAttached()` method that the foreground bus already invokes. v2's deeper rework (carrying backend `seq` through Tauri events, splitting received-vs-applied cursors, adding a hook-level reconciler) was rejected for this round because it requires Rust payload-shape changes and a new `markApplied` API across the manager — a much larger refactor than the smallest correct fix. It is documented below as the principled follow-up if the cursor-snapshot approach proves insufficient.
- **Considered from `fix-terminal-redraw_v3`:** rejected. v3 wires `Terminal.tsx` to `useWindowVisibility` and `projectPathAtom`, but never addresses the seq-drift root cause and adds no tests; its `rehydrate(id)` method would re-fetch from the same already-advanced cursor and return an empty delta, leaving the original bug unfixed.

### Deferred follow-up (if cursor snapshot proves insufficient)

If a future report shows that the snapshot-at-detach baseline still misses bytes (e.g. because dispatch lands in the same microtask as the detach for a chunk that xterm has not yet parsed), promote v2's applied-cursor approach: add `markApplied(id, seq)` to `terminalOutputManager`, have the registry call it from the xterm write callback, and have `rehydrate()` use the applied cursor instead of the live `seqCursor`. That removes the boundary-byte race called out in this plan's Open Questions section.
