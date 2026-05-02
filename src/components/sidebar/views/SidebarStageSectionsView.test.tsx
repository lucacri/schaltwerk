import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { SidebarStageSectionsView } from './SidebarStageSectionsView'
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

describe('SidebarStageSectionsView', () => {
  it('renders the empty-state placeholder when tasksAtom is empty', () => {
    const store = createStore()
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })
    expect(screen.getByTestId('sidebar-stage-sections-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-stage-sections')).toBeNull()
    expect(screen.getByText(/Create one with \+ New Task/)).toBeInTheDocument()
  })

  it('renders 8 stage sections when at least one task exists', () => {
    const store = createStore()
    store.set(setTasksAtom, [makeTask({ id: 'a', stage: 'draft' })])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })

    expect(screen.queryByTestId('sidebar-stage-sections-empty')).toBeNull()
    expect(screen.getByTestId('sidebar-stage-sections')).toBeInTheDocument()
    // All 8 stage section keys land as sections.
    for (const key of [
      'draft',
      'ready',
      'brainstormed',
      'planned',
      'implemented',
      'pushed',
      'done',
      'cancelled',
    ] as const) {
      expect(screen.getByTestId(`sidebar-stage-section-${key}`)).toBeInTheDocument()
    }
  })

  it('places a cancelled task in the Cancelled section even though it defaults collapsed', () => {
    const store = createStore()
    store.set(setTasksAtom, [
      makeTask({
        id: 'killed',
        stage: 'ready',
        cancelled_at: '2026-05-02T01:00:00Z',
      }),
    ])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })

    // Cancelled section header shows count = 1 even when collapsed.
    const cancelledSection = screen.getByTestId('sidebar-stage-section-cancelled')
    expect(cancelledSection.textContent).toMatch(/1/)
    // Ready section is empty (count = 0).
    const readySection = screen.getByTestId('sidebar-stage-section-ready')
    expect(readySection.textContent).not.toMatch(/killed/)
  })
})
