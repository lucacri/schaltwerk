// Phase 8 W.5 GAP 9: cancel cascade UX
//
// Pins the two-step cancel flow on TaskRow:
//   1. Clicking the Cancel button opens a confirmation modal that
//      enumerates the active-run count.
//   2. Confirming the modal fires `cancelTask` through useTaskRowActions.
//   3. A `TaskCancelFailed` partial-failure error surfaces a sticky
//      toast with a "Retry cancel" action that re-runs the call.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { ReactElement } from 'react'

const cancelTaskService = vi.fn()
vi.mock('../../services/taskService', () => ({
  cancelTask: (...args: unknown[]) => cancelTaskService(...args),
  cancelTaskRun: vi.fn(),
  promoteTaskToReady: vi.fn(),
  reopenTask: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { TaskRow } from './TaskRow'
import { ToastProvider } from '../../common/toast/ToastProvider'
import type { Task, TaskRun } from '../../types/task'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'one',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'planned',
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

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'r1',
    task_id: 't1',
    stage: 'planned',
    started_at: '2026-05-02T00:01:00Z',
    confirmed_at: null,
    cancelled_at: null,
    selected_session_id: null,
    presets: [],
    sessions: [],
    ...overrides,
  } as TaskRun
}

function renderRow(task: Task): ReactElement {
  const store = createStore()
  return (
    <Provider store={store}>
      <ToastProvider>
        <TaskRow task={task} />
      </ToastProvider>
    </Provider>
  )
}

describe('TaskRow cancel cascade UX', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clicking Cancel opens a confirmation modal — does NOT fire cancelTask immediately', () => {
    render(renderRow(makeTask()))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    expect(screen.getByTestId('task-row-cancel-confirm-body')).toBeInTheDocument()
    expect(cancelTaskService).not.toHaveBeenCalled()
  })

  it('confirmation modal surfaces the active-run count when there are active runs', () => {
    const task = makeTask({
      task_runs: [makeRun({ id: 'a' }), makeRun({ id: 'b', confirmed_at: '2026-05-02T01:00:00Z' })],
    })
    render(renderRow(task))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    expect(screen.getByTestId('task-row-cancel-confirm-active-count')).toHaveTextContent(
      /1 active run will be cancelled/,
    )
  })

  it('confirmation modal omits the active-run line when no runs are active', () => {
    render(renderRow(makeTask({ task_runs: [] })))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    expect(screen.queryByTestId('task-row-cancel-confirm-active-count')).toBeNull()
  })

  it('confirming the modal fires cancelTask once', async () => {
    cancelTaskService.mockResolvedValue(makeTask({ cancelled_at: '2026-05-02T02:00:00Z' }))
    render(renderRow(makeTask()))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel task/i }))
    await waitFor(() => expect(cancelTaskService).toHaveBeenCalledTimes(1))
  })

  it('clicking "Keep task" closes the modal without firing cancelTask', () => {
    render(renderRow(makeTask()))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Keep task/i }))
    expect(screen.queryByTestId('task-row-cancel-confirm-body')).toBeNull()
    expect(cancelTaskService).not.toHaveBeenCalled()
  })

  it('TaskCancelFailed partial-failure surfaces a "Retry cancel" toast that re-runs the call', async () => {
    cancelTaskService
      .mockRejectedValueOnce({
        type: 'TaskCancelFailed',
        data: { task_id: 't1', failures: ['session-a: worktree locked'] },
      })
      .mockResolvedValueOnce(makeTask({ cancelled_at: '2026-05-02T03:00:00Z' }))

    render(renderRow(makeTask()))
    fireEvent.click(screen.getByTestId('task-row-cancel'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel task/i }))

    const toastTitle = await screen.findByText(/Task cancel partially failed/)
    const retry = await screen.findByRole('button', { name: /Retry cancel/i })
    expect(toastTitle).toBeInTheDocument()
    fireEvent.click(retry)

    await waitFor(() => expect(cancelTaskService).toHaveBeenCalledTimes(2))
  })
})
