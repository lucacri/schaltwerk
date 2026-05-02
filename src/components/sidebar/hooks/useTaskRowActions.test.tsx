import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { tasksAtom } from '../../../store/atoms/tasks'
import type { Task } from '../../../types/task'

const promoteTaskToReady = vi.fn()
const startStageRun = vi.fn()
const cancelTask = vi.fn()
const reopenTask = vi.fn()
const cancelTaskRun = vi.fn()

vi.mock('../../../services/taskService', () => ({
  promoteTaskToReady: (...args: unknown[]) => promoteTaskToReady(...args),
  startStageRun: (...args: unknown[]) => startStageRun(...args),
  cancelTask: (...args: unknown[]) => cancelTask(...args),
  reopenTask: (...args: unknown[]) => reopenTask(...args),
  cancelTaskRun: (...args: unknown[]) => cancelTaskRun(...args),
}))

vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useTaskRowActions } from './useTaskRowActions'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'one',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: '',
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

describe('useTaskRowActions — cancelTask optimistic + rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flips cancelled_at optimistically before the Tauri call resolves', async () => {
    const store = createStore()
    const task = makeTask({ id: 'a', stage: 'planned', cancelled_at: null })
    store.set(tasksAtom, [task])

    let resolveCancel: (value: Task) => void = () => {}
    cancelTask.mockReturnValue(
      new Promise<Task>((resolve) => {
        resolveCancel = resolve
      }),
    )

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    let actionPromise: Promise<unknown>
    act(() => {
      actionPromise = result.current.cancelTask(task)
    })

    // Optimistic flip is synchronous — the atom should reflect the
    // change before the awaited promise resolves.
    await waitFor(() =>
      expect(store.get(tasksAtom)[0].cancelled_at).not.toBeNull(),
    )

    resolveCancel({ ...task, cancelled_at: '2026-05-02T01:00:00Z' })
    await act(async () => {
      await actionPromise!
    })

    // After resolution the atom carries the backend's authoritative value.
    expect(store.get(tasksAtom)[0].cancelled_at).toBe('2026-05-02T01:00:00Z')
    expect(cancelTask).toHaveBeenCalledWith('a', null)
  })

  it('rolls back cancelled_at when the Tauri call rejects', async () => {
    const store = createStore()
    const task = makeTask({ id: 'a', stage: 'planned', cancelled_at: null })
    store.set(tasksAtom, [task])

    cancelTask.mockRejectedValue(new Error('backend exploded'))

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    await act(async () => {
      await result.current.cancelTask(task).catch(() => undefined)
    })

    // Atom returned to the pre-flip state.
    expect(store.get(tasksAtom)[0].cancelled_at).toBeNull()
  })
})

describe('useTaskRowActions — reopenTask optimistic + rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears cancelled_at and resets stage optimistically', async () => {
    const store = createStore()
    const task = makeTask({
      id: 'a',
      stage: 'planned',
      cancelled_at: '2026-05-02T01:00:00Z',
    })
    store.set(tasksAtom, [task])

    reopenTask.mockResolvedValue({
      ...task,
      stage: 'draft',
      cancelled_at: null,
    })

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    await act(async () => {
      await result.current.reopenTask(task, 'draft')
    })

    expect(store.get(tasksAtom)[0].cancelled_at).toBeNull()
    expect(store.get(tasksAtom)[0].stage).toBe('draft')
    expect(reopenTask).toHaveBeenCalledWith('a', 'draft', null)
  })

  it('rolls back when reopen fails', async () => {
    const store = createStore()
    const task = makeTask({
      id: 'a',
      stage: 'planned',
      cancelled_at: '2026-05-02T01:00:00Z',
    })
    store.set(tasksAtom, [task])
    reopenTask.mockRejectedValue(new Error('reopen failed'))

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    await act(async () => {
      await result.current.reopenTask(task, 'draft').catch(() => undefined)
    })

    expect(store.get(tasksAtom)[0].cancelled_at).toBe('2026-05-02T01:00:00Z')
    expect(store.get(tasksAtom)[0].stage).toBe('planned')
  })
})

describe('useTaskRowActions — promoteToReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces the task with the backend response on success', async () => {
    const store = createStore()
    const task = makeTask({ id: 'a', stage: 'draft' })
    store.set(tasksAtom, [task])
    promoteTaskToReady.mockResolvedValue({ ...task, stage: 'ready' })

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    await act(async () => {
      await result.current.promoteToReady(task)
    })
    expect(store.get(tasksAtom)[0].stage).toBe('ready')
  })

  it('passes through service errors so the call site can toast', async () => {
    const store = createStore()
    const task = makeTask({ id: 'a', stage: 'draft' })
    store.set(tasksAtom, [task])
    promoteTaskToReady.mockRejectedValue(new Error('promote blew up'))

    const { result } = renderHook(() => useTaskRowActions(), {
      wrapper: withStore(store),
    })

    await expect(
      act(async () => {
        await result.current.promoteToReady(task)
      }),
    ).rejects.toThrow(/promote blew up/)
  })
})
