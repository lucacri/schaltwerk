import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const getTask = vi.fn()
const updateTaskContent = vi.fn()

vi.mock('../../services/taskService', () => ({
  getTask: (...args: unknown[]) => getTask(...args),
  updateTaskContent: (...args: unknown[]) => updateTaskContent(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { TaskRightPane } from './TaskRightPane'
import type { TaskWithBodies } from '../../types/task'

function makeTask(overrides: Partial<TaskWithBodies> = {}): TaskWithBodies {
  return {
    id: 'task-1',
    name: 'one',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: 'request',
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
    current_spec_body: 'spec body',
    current_plan_body: 'plan body',
    current_summary_body: null,
    ...overrides,
  }
}

describe('TaskRightPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a loading state while lucode_task_get is in flight', async () => {
    let resolve: (value: TaskWithBodies) => void = () => {}
    getTask.mockReturnValue(
      new Promise<TaskWithBodies>((r) => {
        resolve = r
      }),
    )
    render(<TaskRightPane taskId="task-1" />)
    expect(screen.getByTestId('task-right-pane-loading')).toBeInTheDocument()
    resolve(makeTask())
    await waitFor(() =>
      expect(screen.queryByTestId('task-right-pane-loading')).toBeNull(),
    )
  })

  it('renders an error state when lucode_task_get fails', async () => {
    getTask.mockRejectedValue(new Error('task missing'))
    render(<TaskRightPane taskId="bad" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-right-pane-error')).toHaveTextContent(
        /task missing/,
      ),
    )
  })

  it('defaults to the Spec tab and mounts TaskArtifactEditor for spec kind', async () => {
    getTask.mockResolvedValue(makeTask())
    render(<TaskRightPane taskId="task-1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-spec')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'spec body',
    )
  })

  it('switches to the Plan tab when the Plan button is clicked', async () => {
    getTask.mockResolvedValue(makeTask())
    render(<TaskRightPane taskId="task-1" />)

    await waitFor(() =>
      expect(screen.getByTestId('task-right-pane-tab-plan')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByTestId('task-right-pane-tab-plan'))

    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-plan')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'plan body',
    )
  })

  it('switches to the Summary tab and renders read-only', async () => {
    getTask.mockResolvedValue(makeTask({ current_summary_body: 'summary body' }))
    render(<TaskRightPane taskId="task-1" />)

    await waitFor(() =>
      expect(screen.getByTestId('task-right-pane-tab-summary')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByTestId('task-right-pane-tab-summary'))

    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-summary')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'summary body',
    )
    expect(screen.queryByTestId('task-artifact-editor-save')).toBeNull()
  })

  it('refetches when taskId changes (selection swap)', async () => {
    getTask.mockResolvedValueOnce(makeTask({ id: 'first', current_spec_body: 'first body' }))
    const { rerender } = render(<TaskRightPane taskId="first" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
        'first body',
      ),
    )

    getTask.mockResolvedValueOnce(makeTask({ id: 'second', current_spec_body: 'second body' }))
    rerender(<TaskRightPane taskId="second" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
        'second body',
      ),
    )
    expect(getTask).toHaveBeenCalledTimes(2)
  })

  it('all three tab buttons render and have visible labels + aria-labels', async () => {
    getTask.mockResolvedValue(makeTask())
    render(<TaskRightPane taskId="task-1" />)

    await waitFor(() =>
      expect(screen.getByTestId('task-right-pane-tab-spec')).toBeInTheDocument(),
    )
    for (const kind of ['spec', 'plan', 'summary']) {
      const tab = screen.getByTestId(`task-right-pane-tab-${kind}`)
      expect(tab.textContent?.toLowerCase()).toContain(kind)
      expect(tab).toHaveAttribute('aria-label')
    }
  })
})
