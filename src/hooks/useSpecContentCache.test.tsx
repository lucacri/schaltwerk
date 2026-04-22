import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpecContentCache, invalidateSpecCache, clearAllSpecCache } from './useSpecContentCache'
import * as TauriCore from '@tauri-apps/api/core'
import { flushPromises } from '../test/flushPromises'
import { Provider, createStore } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'
import { SchaltEvent } from '../common/eventSystem'

const eventHandlers = new Map<string, (payload: unknown) => void | Promise<void>>()

const advanceTimers = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await flushPromises()
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../common/eventSystem', () => ({
  SchaltEvent: {
    SessionsRefreshed: 'schaltwerk:sessions-refreshed',
  },
  listenEvent: vi.fn(async (event: string, handler: (payload: unknown) => void | Promise<void>) => {
    eventHandlers.set(String(event), handler)
    return () => {
      eventHandlers.delete(String(event))
    }
  }),
}))

function emitSessionsRefreshed(payload: unknown) {
  const handler = eventHandlers.get(String(SchaltEvent.SessionsRefreshed))
  if (!handler) {
    throw new Error('SessionsRefreshed handler not registered')
  }
  return handler(payload)
}

function createProjectWrapper(projectPath: string) {
  const store = createStore()
  store.set(projectPathAtom, projectPath)

  return function ProjectWrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }
}

describe('useSpecContentCache', () => {
  const mockInvoke = vi.mocked(TauriCore.invoke)

  beforeEach(() => {
    vi.clearAllMocks()
    clearAllSpecCache()
    eventHandlers.clear()
  })

  afterEach(() => {
    clearAllSpecCache()
    eventHandlers.clear()
  })

  it('fetches content from backend on first load', async () => {
    mockInvoke.mockResolvedValue(['Draft content', 'Initial prompt'])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.content).toBe('')

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.content).toBe('Draft content')
    expect(result.current.error).toBe(null)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith(
      'schaltwerk_core_get_session_agent_content',
      { name: 'test-session' }
    )
  })

  it('uses draft content over initial prompt when both are present', async () => {
    mockInvoke.mockResolvedValue(['Draft content', 'Initial prompt'])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.content).toBe('Draft content')
  })

  it('falls back to initial prompt when draft content is null', async () => {
    mockInvoke.mockResolvedValue([null, 'Initial prompt'])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.content).toBe('Initial prompt')
  })

  it('uses empty string when both draft and prompt are null', async () => {
    mockInvoke.mockResolvedValue([null, null])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.content).toBe('')
  })

  it('caches content for running sessions and skips backend on second load', async () => {
    mockInvoke.mockResolvedValue(['Cached content', null])

    const { result: result1 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result1.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    mockInvoke.mockClear()

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    expect(result2.current.loading).toBe(false)
    expect(result2.current.content).toBe('Cached content')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('caches content for reviewed sessions and skips backend on second load', async () => {
    mockInvoke.mockResolvedValue(['Reviewed content', null])

    const { result: result1 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result1.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    mockInvoke.mockClear()

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    expect(result2.current.loading).toBe(false)
    expect(result2.current.content).toBe('Reviewed content')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('always fetches content for spec sessions (not cached)', async () => {
    mockInvoke.mockResolvedValueOnce(['First fetch', null])
    mockInvoke.mockResolvedValueOnce(['Second fetch', null])

    const { result: result1 } = renderHook(() =>
      useSpecContentCache('test-session', 'spec')
    )

    await flushPromises()
    expect(result1.current.loading).toBe(false)

    expect(result1.current.content).toBe('First fetch')
    expect(mockInvoke).toHaveBeenCalledTimes(1)

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('test-session', 'spec')
    )

    await flushPromises()
    expect(result2.current.loading).toBe(false)

    expect(result2.current.content).toBe('Second fetch')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('handles backend errors gracefully', async () => {
    const errorMessage = 'Backend error'
    mockInvoke.mockRejectedValue(new Error(errorMessage))

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.error).toBe(`Error: ${errorMessage}`)
    expect(result.current.content).toBe('')
  })

  it('updateContent updates content and cache', async () => {
    mockInvoke.mockResolvedValue(['Initial content', null])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(result.current.content).toBe('Initial content')

    act(() => {
      result.current.updateContent('Updated content')
    })

    expect(result.current.content).toBe('Updated content')

    mockInvoke.mockClear()

    expect(result.current.content).toBe('Updated content')
  })

  it('invalidateCache removes session from cache', async () => {
    mockInvoke.mockResolvedValue(['Cached content', null])

    const { result: result1 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result1.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    act(() => {
      result1.current.invalidateCache()
    })

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue(['Fresh content', null])

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result2.current.loading).toBe(false)

    expect(result2.current.content).toBe('Fresh content')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('invalidateSpecCache function removes specific session from cache', async () => {
    mockInvoke.mockResolvedValue(['Cached content', null])

    const { result } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    invalidateSpecCache('test-session')

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue(['Fresh content', null])

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('test-session', 'running')
    )

    await flushPromises()
    expect(result2.current.loading).toBe(false)

    expect(result2.current.content).toBe('Fresh content')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('clearAllSpecCache clears entire cache', async () => {
    mockInvoke.mockResolvedValue(['Session 1 content', null])

    const { result: result1 } = renderHook(() =>
      useSpecContentCache('session-1', 'running')
    )

    await flushPromises()
    expect(result1.current.loading).toBe(false)

    mockInvoke.mockResolvedValue(['Session 2 content', null])

    const { result: result2 } = renderHook(() =>
      useSpecContentCache('session-2', 'running')
    )

    await flushPromises()
    expect(result2.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(2)

    clearAllSpecCache()

    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue(['Fresh session 1', null])

    const { result: result3 } = renderHook(() =>
      useSpecContentCache('session-1', 'running')
    )

    await flushPromises()
    expect(result3.current.loading).toBe(false)

    expect(result3.current.content).toBe('Fresh session 1')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('handles race conditions with multiple renders', async () => {
    vi.useFakeTimers()
    try {
      mockInvoke.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(['Content', null]), 10)
          })
      )

      const { result, rerender } = renderHook(
        ({ sessionName }) => useSpecContentCache(sessionName, 'running'),
        { initialProps: { sessionName: 'session-1' } }
      )

      rerender({ sessionName: 'session-2' })

      await advanceTimers(10)
      expect(result.current.loading).toBe(false)

      expect(mockInvoke).toHaveBeenCalledWith(
        'schaltwerk_core_get_session_agent_content',
        { name: 'session-2' }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles switching between sessionStates correctly', async () => {
    mockInvoke.mockResolvedValue(['Content', null])

    const { result, rerender } = renderHook(
      ({ sessionState }: { sessionState: 'spec' | 'processing' | 'running' }) =>
        useSpecContentCache('test-session', sessionState),
      { initialProps: { sessionState: 'spec' as 'spec' | 'processing' | 'running' } }
    )

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    mockInvoke.mockClear()

    rerender({ sessionState: 'running' as 'spec' | 'processing' | 'running' })

    await flushPromises()
    expect(result.current.loading).toBe(false)

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    mockInvoke.mockClear()

    rerender({ sessionState: 'running' as 'spec' | 'processing' | 'running' })

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('updates mounted spec content when SessionsRefreshed changes the active session', async () => {
    mockInvoke.mockResolvedValue(['Initial content', null])

    const wrapper = createProjectWrapper('/projects/alpha')
    const { result } = renderHook(
      () => useSpecContentCache('test-session', 'spec'),
      { wrapper }
    )

    await flushPromises()
    expect(result.current.content).toBe('Initial content')

    await act(async () => {
      await emitSessionsRefreshed({
        projectPath: '/projects/alpha',
        sessions: [
          {
            info: {
              session_id: 'test-session',
              branch: 'test-session',
              spec_content: 'Refreshed from backend',
              current_task: 'Refreshed from backend',
            },
            terminals: [],
          },
        ],
      })
    })

    expect(result.current.content).toBe('Refreshed from backend')
  })

  it('ignores SessionsRefreshed payloads for other projects and sessions', async () => {
    mockInvoke.mockResolvedValue(['Initial content', null])

    const wrapper = createProjectWrapper('/projects/alpha')
    const { result } = renderHook(
      () => useSpecContentCache('test-session', 'spec'),
      { wrapper }
    )

    await flushPromises()
    expect(result.current.content).toBe('Initial content')

    await act(async () => {
      await emitSessionsRefreshed({
        projectPath: '/projects/beta',
        sessions: [
          {
            info: {
              session_id: 'test-session',
              branch: 'test-session',
              spec_content: 'Wrong project update',
              current_task: 'Wrong project update',
            },
            terminals: [],
          },
        ],
      })
    })

    expect(result.current.content).toBe('Initial content')

    await act(async () => {
      await emitSessionsRefreshed({
        projectPath: '/projects/alpha',
        sessions: [
          {
            info: {
              session_id: 'other-session',
              branch: 'other-session',
              spec_content: 'Other session update',
              current_task: 'Other session update',
            },
            terminals: [],
          },
        ],
      })
    })

    expect(result.current.content).toBe('Initial content')
  })

  it('does not let an in-flight fetch overwrite fresher SessionsRefreshed content', async () => {
    let resolveFetch!: (value: [string | null, string | null]) => void
    mockInvoke.mockImplementation(
      () =>
        new Promise<[string | null, string | null]>((resolve) => {
          resolveFetch = resolve
        })
    )

    const wrapper = createProjectWrapper('/projects/alpha')
    const { result } = renderHook(
      () => useSpecContentCache('test-session', 'spec'),
      { wrapper }
    )

    await act(async () => {
      await emitSessionsRefreshed({
        projectPath: '/projects/alpha',
        sessions: [
          {
            info: {
              session_id: 'test-session',
              branch: 'test-session',
              spec_content: 'Refreshed from backend',
              current_task: 'Refreshed from backend',
            },
            terminals: [],
          },
        ],
      })
    })

    expect(result.current.content).toBe('Refreshed from backend')

    resolveFetch(['Stale fetch result', null])
    await flushPromises()

    expect(result.current.content).toBe('Refreshed from backend')
  })

  it('ignores SessionsRefreshed updates for running sessions', async () => {
    mockInvoke.mockResolvedValue(['Running session content', null])

    const wrapper = createProjectWrapper('/projects/alpha')
    const { result } = renderHook(
      () => useSpecContentCache('test-session', 'running'),
      { wrapper }
    )

    await flushPromises()
    expect(result.current.content).toBe('Running session content')
    expect(eventHandlers.has(String(SchaltEvent.SessionsRefreshed))).toBe(false)
    expect(result.current.content).toBe('Running session content')
  })
})
