import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

const captureSessionAsTask = vi.fn()
vi.mock('../../../services/taskService', () => ({
  captureSessionAsTask: (...args: unknown[]) => captureSessionAsTask(...args),
}))
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { SidebarStageSectionsView } from './SidebarStageSectionsView'
import { setTasksAtom } from '../../../store/atoms/tasks'
import { allSessionsAtom } from '../../../store/atoms/sessions'
import type { EnrichedSession } from '../../../types/session'
import type { Task } from '../../../types/task'

function makeSession(overrides: { id: string; taskId?: string | null; sessionState?: 'spec' | 'running' }): EnrichedSession {
  return {
    info: {
      session_id: overrides.id,
      branch: `lucode/${overrides.id}`,
      worktree_path: `/tmp/wt-${overrides.id}`,
      base_branch: 'main',
      status: 'active',
      is_current: false,
      session_type: 'worktree',
      session_state: overrides.sessionState ?? 'running',
      ready_to_merge: false,
      task_id: overrides.taskId ?? null,
    },
    terminals: [],
  }
}

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
  beforeEach(() => {
    captureSessionAsTask.mockReset()
  })

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

  // Phase 7 Wave D.1.b — bulk capture button gating + behavior
  it('hides the bulk-capture button when no standalone non-task running sessions exist', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'task-bound', taskId: 'task-1' }),
    ])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })
    expect(screen.queryByTestId('sidebar-bulk-capture-button')).toBeNull()
  })

  it('shows the bulk-capture button with the correct count when standalone sessions exist', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a' }),
      makeSession({ id: 'b' }),
      makeSession({ id: 'c' }),
      makeSession({ id: 'task-bound', taskId: 'task-1' }),
      makeSession({ id: 'a-spec', sessionState: 'spec' }),
    ])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })
    const button = screen.getByTestId('sidebar-bulk-capture-button')
    expect(button.textContent).toMatch(/Capture 3 running sessions as tasks/i)
  })

  it('clicking bulk-capture invokes captureSessionAsTask once per eligible session', async () => {
    captureSessionAsTask.mockResolvedValue({ id: 'task-x' })
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a' }),
      makeSession({ id: 'b' }),
      makeSession({ id: 'task-bound', taskId: 'task-1' }),
    ])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })
    fireEvent.click(screen.getByTestId('sidebar-bulk-capture-button'))
    await waitFor(() => expect(captureSessionAsTask).toHaveBeenCalledTimes(2))
    expect(captureSessionAsTask.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('continues with the next session when one capture fails (partial success)', async () => {
    captureSessionAsTask
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce({ id: 'task-y' })
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a' }),
      makeSession({ id: 'b' }),
    ])
    render(<SidebarStageSectionsView />, { wrapper: withStore(store) })
    fireEvent.click(screen.getByTestId('sidebar-bulk-capture-button'))
    await waitFor(() => expect(captureSessionAsTask).toHaveBeenCalledTimes(2))
  })
})
