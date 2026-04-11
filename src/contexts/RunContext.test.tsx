import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { RunProvider, useRun } from './RunContext'
import type { EnrichedSession } from '../types/session'
import { listenEvent } from '../common/eventSystem'

let mockAllSessions: EnrichedSession[] = []
const listeners: Record<string, (payload: any) => void> = {}

vi.mock('../hooks/useSessions', () => ({
  useSessions: () => ({
    allSessions: mockAllSessions,
    sessions: mockAllSessions,
    filteredSessions: mockAllSessions,
    sortedSessions: mockAllSessions,
    loading: false,
    filterMode: 'running',
    setFilterMode: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isSearchVisible: false,
    setIsSearchVisible: vi.fn(),
    setCurrentSelection: vi.fn(),
    reloadSessions: vi.fn(),
  }),
}))

vi.mock('../common/eventSystem', () => ({
  SchaltEvent: {
    TerminalAgentStarted: 'schaltwerk:terminal-agent-started',
    TerminalClosed: 'schaltwerk:terminal-closed',
  },
  listenEvent: vi.fn(async (event: string, handler: (payload: any) => void) => {
    listeners[event] = handler
    return () => {
      delete listeners[event]
    }
  }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <RunProvider>{children}</RunProvider>
}

function makeSession(
  id: string,
  state: 'running' | 'spec',
  overrides: Partial<EnrichedSession['info']> = {},
): EnrichedSession {
  return {
    info: {
      session_id: id,
      display_name: id,
      branch: `branch-${id}`,
      worktree_path: `/path/${id}`,
      base_branch: 'main',
      status: state === 'spec' ? 'spec' : 'active',
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree',
      session_state: state,
      clarification_started: false,
      attention_required: false,
      ...overrides,
    },
    terminals: [],
  }
}

describe('RunContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAllSessions = []
    Object.keys(listeners).forEach(key => delete listeners[key])
  })

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useRun())
    }).toThrow('useRun must be used within a RunProvider')
  })

  it('starts with an empty set of running sessions', () => {
    const { result } = renderHook(() => useRun(), { wrapper })
    expect(result.current.runningSessions.size).toBe(0)
  })

  it('adds and removes running sessions', () => {
    const { result } = renderHook(() => useRun(), { wrapper })

    act(() => result.current.addRunningSession('sess-1'))
    expect(result.current.isSessionRunning('sess-1')).toBe(true)

    act(() => result.current.removeRunningSession('sess-1'))
    expect(result.current.isSessionRunning('sess-1')).toBe(false)
  })

  it('reports false for sessions not in the running set', () => {
    const { result } = renderHook(() => useRun(), { wrapper })
    expect(result.current.isSessionRunning('unknown')).toBe(false)
  })

  it('preserves orchestrator flag when sessions are empty', () => {
    const { result, rerender } = renderHook(() => useRun(), { wrapper })

    act(() => result.current.addRunningSession('orchestrator'))
    expect(result.current.isSessionRunning('orchestrator')).toBe(true)

    mockAllSessions = []
    rerender()

    expect(result.current.isSessionRunning('orchestrator')).toBe(true)
  })

  it('prunes sessions that are no longer running in allSessions', () => {
    mockAllSessions = [makeSession('a', 'running'), makeSession('b', 'running')]
    const { result, rerender } = renderHook(() => useRun(), { wrapper })

    act(() => {
      result.current.addRunningSession('a')
      result.current.addRunningSession('b')
    })
    expect(result.current.isSessionRunning('a')).toBe(true)
    expect(result.current.isSessionRunning('b')).toBe(true)

    mockAllSessions = [makeSession('a', 'running')]
    rerender()

    expect(result.current.isSessionRunning('a')).toBe(true)
    expect(result.current.isSessionRunning('b')).toBe(false)
  })

  it('tracks session starts from terminal-agent-started events', async () => {
    mockAllSessions = [makeSession('alpha', 'running')]
    const { result } = renderHook(() => useRun(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      listeners['schaltwerk:terminal-agent-started']?.({
        session_name: 'alpha',
        terminal_id: 'session-alpha~12345678-top',
      })
    })

    expect(result.current.isSessionRunning('alpha')).toBe(true)
  })

  it('drops tracked sessions once they become idle', async () => {
    mockAllSessions = [makeSession('alpha', 'running')]
    const { result, rerender } = renderHook(() => useRun(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      listeners['schaltwerk:terminal-agent-started']?.({
        session_name: 'alpha',
        terminal_id: 'session-alpha~12345678-top',
      })
    })
    expect(result.current.isSessionRunning('alpha')).toBe(true)

    mockAllSessions = [
      makeSession('alpha', 'running', {
        attention_required: true,
      }),
    ]
    rerender()

    expect(result.current.isSessionRunning('alpha')).toBe(false)
  })

  it('keeps terminal listeners stable across session refreshes', async () => {
    mockAllSessions = [makeSession('alpha', 'running')]
    const { rerender } = renderHook(() => useRun(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })

    expect(vi.mocked(listenEvent)).toHaveBeenCalledTimes(2)

    mockAllSessions = [
      makeSession('alpha', 'running'),
      makeSession('beta', 'running'),
    ]
    rerender()

    await act(async () => {
      await Promise.resolve()
    })

    expect(vi.mocked(listenEvent)).toHaveBeenCalledTimes(2)
  })
})
