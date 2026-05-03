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

  // Phase 8 patch 2 regression test (mirrors smoke checklist §A.10):
  // Save the spec body, switch to Plan, switch back. The previously-
  // saved spec body must still be the textarea content — NOT undefined,
  // NOT the pre-save body. Pre-fix this would fail because
  // `updateTaskContent`'s body-less Task got smuggled into the local
  // task envelope, losing the body fields.
  it('preserves saved spec body across tab switches (no body-smuggling regression)', async () => {
    const initial = makeTask({
      current_spec_body: 'pre-save spec',
      current_plan_body: 'plan body unchanged',
    })
    const afterSave = makeTask({
      current_spec_body: 'edited spec body',
      current_plan_body: 'plan body unchanged',
    })

    // First call: initial mount.
    // Second call: refetch after save in TaskArtifactEditor.handleSave.
    getTask.mockResolvedValueOnce(initial).mockResolvedValueOnce(afterSave)
    // updateTaskContent returns body-less Task on the wire; we don't
    // care about the return value because the editor refetches.
    updateTaskContent.mockResolvedValue({ id: 'task-1' })

    render(<TaskRightPane taskId="task-1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
        'pre-save spec',
      ),
    )

    // Edit and save.
    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'edited spec body' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    // Wait for refetch to complete.
    await waitFor(() => expect(getTask).toHaveBeenCalledTimes(2))

    // Switch to Plan tab — must show the unchanged plan body, not undefined.
    fireEvent.click(screen.getByTestId('task-right-pane-tab-plan'))
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-plan')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'plan body unchanged',
    )

    // Switch back to Spec — must show the edited body, not the pre-save body, not undefined.
    fireEvent.click(screen.getByTestId('task-right-pane-tab-spec'))
    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-spec')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'edited spec body',
    )
  })
})
