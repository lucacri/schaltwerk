import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { useSidebarStageSections } from './useSidebarStageSections'
import { setTasksAtom } from '../../../store/atoms/tasks'
import type { Task } from '../../../types/task'

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

describe('useSidebarStageSections', () => {
  it('returns 8 sections initialized from tasksAtom', () => {
    const store = createStore()
    store.set(setTasksAtom, [
      makeTask({ id: 'a', stage: 'draft' }),
      makeTask({ id: 'b', stage: 'ready' }),
    ])

    const { result } = renderHook(() => useSidebarStageSections(), {
      wrapper: withStore(store),
    })
    expect(result.current.sections).toHaveLength(8)
    expect(result.current.sections.find((s) => s.key === 'draft')?.tasks.map((t) => t.id)).toEqual(['a'])
    expect(result.current.sections.find((s) => s.key === 'ready')?.tasks.map((t) => t.id)).toEqual(['b'])
  })

  it('exposes a per-section collapse state and toggle', () => {
    const store = createStore()
    const { result } = renderHook(() => useSidebarStageSections(), {
      wrapper: withStore(store),
    })

    expect(result.current.isCollapsed('draft')).toBe(false)
    act(() => result.current.toggleCollapsed('draft'))
    expect(result.current.isCollapsed('draft')).toBe(true)
    act(() => result.current.toggleCollapsed('draft'))
    expect(result.current.isCollapsed('draft')).toBe(false)
  })

  it('Done and Cancelled sections are collapsed by default to keep terminal noise out of the way', () => {
    const store = createStore()
    const { result } = renderHook(() => useSidebarStageSections(), {
      wrapper: withStore(store),
    })
    expect(result.current.isCollapsed('done')).toBe(true)
    expect(result.current.isCollapsed('cancelled')).toBe(true)
    expect(result.current.isCollapsed('draft')).toBe(false)
    expect(result.current.isCollapsed('ready')).toBe(false)
    expect(result.current.isCollapsed('brainstormed')).toBe(false)
    expect(result.current.isCollapsed('planned')).toBe(false)
    expect(result.current.isCollapsed('implemented')).toBe(false)
    expect(result.current.isCollapsed('pushed')).toBe(false)
  })

  it('reflects post-mount tasks-atom changes', () => {
    const store = createStore()
    const { result } = renderHook(() => useSidebarStageSections(), {
      wrapper: withStore(store),
    })
    expect(result.current.sections.find((s) => s.key === 'planned')?.tasks).toEqual([])

    act(() => {
      store.set(setTasksAtom, [makeTask({ id: 'late', stage: 'planned' })])
    })
    expect(
      result.current.sections.find((s) => s.key === 'planned')?.tasks.map((t) => t.id),
    ).toEqual(['late'])
  })
})
