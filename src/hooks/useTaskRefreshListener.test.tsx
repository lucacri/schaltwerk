import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { tasksAtom } from '../store/atoms/tasks'
import type { Task } from '../types/task'

// Capture the listener handler installed by listenEvent so tests can drive it.
type TasksRefreshedHandler = (payload: unknown) => void
let registeredHandler: TasksRefreshedHandler | null = null
const unlistenSpy = vi.fn()

vi.mock('../common/eventSystem', () => ({
  SchaltEvent: { TasksRefreshed: 'schaltwerk:tasks-refreshed' },
  listenEvent: vi.fn(async (_event: string, handler: TasksRefreshedHandler) => {
    registeredHandler = handler
    return unlistenSpy
  }),
}))

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useTaskRefreshListener } from './useTaskRefreshListener'
import { logger } from '../utils/logger'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'one',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: 'do one',
    source_kind: null,
    source_url: null,
    task_host_session_id: null,
    task_branch: null,
    base_branch: null,
    issue_number: null,
    issue_url: null,
    pr_number: null,
    pr_url: null,
    pr_state: null,
    failure_flag: false,
    epic_id: null,
    attention_required: false,
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    cancelled_at: null,
    task_runs: [],
    ...overrides,
  }
}

function withStore(store: ReturnType<typeof createStore>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store, children })
}

describe('useTaskRefreshListener', () => {
  beforeEach(() => {
    registeredHandler = null
    unlistenSpy.mockReset()
    vi.clearAllMocks()
  })

  it('dispatches incoming TasksRefreshed payloads to tasksAtom', async () => {
    const store = createStore()
    renderHook(() => useTaskRefreshListener(), { wrapper: withStore(store) })

    await waitFor(() => expect(registeredHandler).toBeTruthy())

    const payload = {
      project_path: '/tmp/repo',
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
    }

    act(() => {
      registeredHandler!(payload)
    })

    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('drops a malformed payload (no tasks array) and warns', async () => {
    const store = createStore()
    store.set(tasksAtom, [makeTask({ id: 'pre-existing' })])
    renderHook(() => useTaskRefreshListener(), { wrapper: withStore(store) })

    await waitFor(() => expect(registeredHandler).toBeTruthy())

    act(() => {
      registeredHandler!({ project_path: '/tmp/repo' })
    })

    // Atom replaces with empty array (the safe path), not crash.
    expect(store.get(tasksAtom)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed TasksRefreshed'),
      expect.anything(),
    )
  })

  it('cleans up the listener on unmount', async () => {
    const store = createStore()
    const { unmount } = renderHook(() => useTaskRefreshListener(), {
      wrapper: withStore(store),
    })

    await waitFor(() => expect(registeredHandler).toBeTruthy())
    unmount()

    expect(unlistenSpy).toHaveBeenCalledTimes(1)
  })

  it('overwrites previous task list on subsequent payloads (refresh semantics)', async () => {
    const store = createStore()
    renderHook(() => useTaskRefreshListener(), { wrapper: withStore(store) })

    await waitFor(() => expect(registeredHandler).toBeTruthy())

    act(() => {
      registeredHandler!({
        project_path: '/tmp/repo',
        tasks: [makeTask({ id: 'first' })],
      })
    })
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['first'])

    act(() => {
      registeredHandler!({
        project_path: '/tmp/repo',
        tasks: [makeTask({ id: 'second' }), makeTask({ id: 'third' })],
      })
    })
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['second', 'third'])
  })
})
