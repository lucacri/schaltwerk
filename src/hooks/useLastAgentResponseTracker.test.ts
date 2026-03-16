import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { createElement, type ReactNode } from 'react'
import { terminalOutputManager } from '../terminal/stream/terminalOutputManager'
import { allSessionsAtom } from '../store/atoms/sessions'
import { lastAgentResponseMapAtom, agentResponseTickAtom } from '../store/atoms/lastAgentResponse'
import { sessionTerminalGroup } from '../common/terminalIdentity'
import type { EnrichedSession } from '../types/session'
import { useLastAgentResponseTracker } from './useLastAgentResponseTracker'

vi.mock('../terminal/stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
}))

vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockAddListener = terminalOutputManager.addListener as ReturnType<typeof vi.fn>
const mockRemoveListener = terminalOutputManager.removeListener as ReturnType<typeof vi.fn>

function createSession(
  overrides: Partial<EnrichedSession['info']> = {}
): EnrichedSession {
  return {
    info: {
      session_id: overrides.session_id ?? 'test-session',
      branch: overrides.branch ?? 'feature',
      worktree_path: overrides.worktree_path ?? '/tmp/test',
      base_branch: overrides.base_branch ?? 'main',
      status: overrides.status ?? 'active',
      is_current: overrides.is_current ?? false,
      session_type: overrides.session_type ?? 'worktree',
      session_state: overrides.session_state ?? 'running',
      ready_to_merge: overrides.ready_to_merge ?? false,
      attention_required: overrides.attention_required ?? false,
    },
    status: undefined,
    terminals: [],
  }
}

describe('useLastAgentResponseTracker', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    store = createStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createWrapper = () => {
    return ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store }, children)
  }

  it('registers listeners for running sessions', () => {
    const sessions = [
      createSession({ session_id: 'alpha', session_state: 'running' }),
      createSession({ session_id: 'beta', session_state: 'running' }),
    ]
    store.set(allSessionsAtom, sessions)

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    const alphaTopId = sessionTerminalGroup('alpha').top
    const betaTopId = sessionTerminalGroup('beta').top
    expect(mockAddListener).toHaveBeenCalledWith(alphaTopId, expect.any(Function))
    expect(mockAddListener).toHaveBeenCalledWith(betaTopId, expect.any(Function))
  })

  it('does NOT register listeners for spec sessions', () => {
    const sessions = [
      createSession({ session_id: 'spec-session', session_state: 'spec' }),
    ]
    store.set(allSessionsAtom, sessions)

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    expect(mockAddListener).not.toHaveBeenCalled()
  })

  it('registers listeners for reviewed sessions (they still have terminals)', () => {
    const sessions = [
      createSession({ session_id: 'reviewed-one', session_state: 'reviewed' }),
    ]
    store.set(allSessionsAtom, sessions)

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    const topId = sessionTerminalGroup('reviewed-one').top
    expect(mockAddListener).toHaveBeenCalledWith(topId, expect.any(Function))
  })

  it('updates atom when listener callback fires', () => {
    const sessions = [
      createSession({ session_id: 'alpha', session_state: 'running' }),
    ]
    store.set(allSessionsAtom, sessions)

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    const callback = mockAddListener.mock.calls[0][1] as (chunk: string) => void
    act(() => {
      callback('some output')
    })

    const map = store.get(lastAgentResponseMapAtom)
    expect(map.has('alpha')).toBe(true)
    expect(typeof map.get('alpha')).toBe('number')
  })

  it('cleans up listeners on unmount', () => {
    const sessions = [
      createSession({ session_id: 'alpha', session_state: 'running' }),
    ]
    store.set(allSessionsAtom, sessions)

    const { unmount } = renderHook(() => useLastAgentResponseTracker(), {
      wrapper: createWrapper(),
    })

    const alphaTopId = sessionTerminalGroup('alpha').top
    const callback = mockAddListener.mock.calls[0][1]

    unmount()

    expect(mockRemoveListener).toHaveBeenCalledWith(alphaTopId, callback)
  })

  it('cleans up old listeners and registers new ones when sessions change', () => {
    const sessionsV1 = [
      createSession({ session_id: 'alpha', session_state: 'running' }),
    ]
    store.set(allSessionsAtom, sessionsV1)

    const { rerender } = renderHook(() => useLastAgentResponseTracker(), {
      wrapper: createWrapper(),
    })

    const alphaTopId = sessionTerminalGroup('alpha').top
    const alphaCallback = mockAddListener.mock.calls[0][1]

    vi.clearAllMocks()

    const sessionsV2 = [
      createSession({ session_id: 'beta', session_state: 'running' }),
    ]
    act(() => {
      store.set(allSessionsAtom, sessionsV2)
    })
    rerender()

    expect(mockRemoveListener).toHaveBeenCalledWith(alphaTopId, alphaCallback)
    const betaTopId = sessionTerminalGroup('beta').top
    expect(mockAddListener).toHaveBeenCalledWith(betaTopId, expect.any(Function))
  })

  it('increments tick every 30 seconds', () => {
    store.set(allSessionsAtom, [])

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    expect(store.get(agentResponseTickAtom)).toBe(0)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(store.get(agentResponseTickAtom)).toBe(1)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(store.get(agentResponseTickAtom)).toBe(2)
  })

  it('clears tick interval on unmount', () => {
    store.set(allSessionsAtom, [])

    const { unmount } = renderHook(() => useLastAgentResponseTracker(), {
      wrapper: createWrapper(),
    })

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(store.get(agentResponseTickAtom)).toBe(1)

    unmount()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(store.get(agentResponseTickAtom)).toBe(1)
  })

  it('cleans up stale session entries when sessions change', () => {
    const sessionsV1 = [
      createSession({ session_id: 'alpha', session_state: 'running' }),
      createSession({ session_id: 'beta', session_state: 'running' }),
    ]
    store.set(allSessionsAtom, sessionsV1)

    renderHook(() => useLastAgentResponseTracker(), { wrapper: createWrapper() })

    const alphaCallback = mockAddListener.mock.calls[0][1] as (chunk: string) => void
    const betaCallback = mockAddListener.mock.calls[1][1] as (chunk: string) => void
    act(() => {
      alphaCallback('output')
      betaCallback('output')
    })

    expect(store.get(lastAgentResponseMapAtom).size).toBe(2)

    act(() => {
      store.set(allSessionsAtom, [
        createSession({ session_id: 'alpha', session_state: 'running' }),
      ])
    })

    expect(store.get(lastAgentResponseMapAtom).has('alpha')).toBe(true)
    expect(store.get(lastAgentResponseMapAtom).has('beta')).toBe(false)
  })
})
