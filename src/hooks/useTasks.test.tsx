import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { useTasks } from './useTasks'
import {
  setTasksAtom,
  selectedTaskIdAtom,
} from '../store/atoms/tasks'
import type { Task } from '../types/task'

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

describe('useTasks', () => {
  it('returns empty tasks when the store is fresh', () => {
    const store = createStore()
    const { result } = renderHook(() => useTasks(), {
      wrapper: withStore(store),
    })
    expect(result.current.tasks).toEqual([])
    expect(result.current.selectedTask).toBeNull()
    expect(result.current.mainTask).toBeNull()
  })

  it('returns the populated task list and resolves selectedTask', () => {
    const store = createStore()
    store.set(setTasksAtom, [makeTask({ id: 'a' }), makeTask({ id: 'b' })])
    store.set(selectedTaskIdAtom, 'b')

    const { result } = renderHook(() => useTasks(), {
      wrapper: withStore(store),
    })
    expect(result.current.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(result.current.selectedTask?.id).toBe('b')
  })

  it('discovers the variant=main task as mainTask', () => {
    const store = createStore()
    store.set(setTasksAtom, [
      makeTask({ id: 'a', variant: 'regular' }),
      makeTask({ id: 'main', variant: 'main' }),
    ])

    const { result } = renderHook(() => useTasks(), {
      wrapper: withStore(store),
    })
    expect(result.current.mainTask?.id).toBe('main')
  })

  it('reflects post-mount atom updates', () => {
    const store = createStore()
    const { result } = renderHook(() => useTasks(), {
      wrapper: withStore(store),
    })
    expect(result.current.tasks).toEqual([])

    act(() => {
      store.set(setTasksAtom, [makeTask({ id: 'late' })])
    })
    expect(result.current.tasks.map((t) => t.id)).toEqual(['late'])
  })
})
