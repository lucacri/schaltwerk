import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const updateTaskContent = vi.fn()
const getTask = vi.fn()

vi.mock('../../services/taskService', () => ({
  updateTaskContent: (...args: unknown[]) => updateTaskContent(...args),
  getTask: (...args: unknown[]) => getTask(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { TaskArtifactEditor } from './TaskArtifactEditor'
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
    current_spec_body: 'initial spec body',
    current_plan_body: null,
    current_summary_body: null,
    ...overrides,
  }
}

describe('TaskArtifactEditor — spec kind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the current spec body', () => {
    render(<TaskArtifactEditor task={makeTask()} kind="spec" />)
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'initial spec body',
    )
  })

  it('renders an empty placeholder when no spec body exists', () => {
    render(
      <TaskArtifactEditor
        task={makeTask({ current_spec_body: null })}
        kind="spec"
      />,
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue('')
    expect(screen.getByText(/empty/i)).toBeInTheDocument()
  })

  it('saves on submit and routes through lucode_task_update_content with the right kind', async () => {
    updateTaskContent.mockResolvedValue(makeTask({ current_spec_body: 'edited' }))
    getTask.mockResolvedValue(makeTask({ current_spec_body: 'edited' }))
    render(<TaskArtifactEditor task={makeTask()} kind="spec" projectPath="/tmp/proj" />)

    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'edited spec' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() => expect(updateTaskContent).toHaveBeenCalledTimes(1))
    expect(updateTaskContent).toHaveBeenCalledWith(
      'task-1',
      'spec',
      'edited spec',
      { projectPath: '/tmp/proj' },
    )
  })

  it('refetches the body-bearing task via getTask AFTER updateTaskContent succeeds and propagates that to onSaved', async () => {
    // Phase 8 patch 2: the wire-shape split means updateTaskContent
    // returns a body-less Task. The fix refetches via getTask (the
    // body-bearing endpoint) so the parent doesn't end up with a
    // TaskWithBodies whose body fields are undefined. Per
    // feedback_stamp_after_side_effect — refetch after save succeeds.
    const callOrder: string[] = []
    updateTaskContent.mockImplementation(async () => {
      callOrder.push('updateTaskContent')
      // Body-less Task shape — what the real Tauri command returns.
      return { id: 'task-1', stage: 'draft', request_body: 'request' }
    })
    getTask.mockImplementation(async () => {
      callOrder.push('getTask')
      return makeTask({ current_spec_body: 'edited spec' })
    })

    const onSaved = vi.fn()
    render(
      <TaskArtifactEditor
        task={makeTask()}
        kind="spec"
        projectPath="/tmp/proj"
        onSaved={onSaved}
      />,
    )

    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'edited spec' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() => expect(getTask).toHaveBeenCalled())
    expect(callOrder).toEqual(['updateTaskContent', 'getTask'])
    expect(getTask).toHaveBeenCalledWith('task-1', '/tmp/proj')
    expect(onSaved).toHaveBeenCalledTimes(1)
    // The TaskWithBodies passed to onSaved must carry body fields, not
    // be a body-less Task smuggled in via `as unknown as`.
    const passed = onSaved.mock.calls[0][0]
    expect(passed.current_spec_body).toBe('edited spec')
  })

  it('does NOT refetch if updateTaskContent fails (avoids stomping the parent state on error)', async () => {
    updateTaskContent.mockRejectedValue(new Error('backend explode'))

    const onSaved = vi.fn()
    render(
      <TaskArtifactEditor
        task={makeTask()}
        kind="spec"
        onSaved={onSaved}
      />,
    )

    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'edited spec' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-error')).toHaveTextContent(
        /backend explode/,
      ),
    )
    expect(getTask).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('surfaces backend errors and keeps the user input in the textarea', async () => {
    updateTaskContent.mockRejectedValue(new Error('save failed'))
    render(<TaskArtifactEditor task={makeTask()} kind="spec" />)

    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'attempted edit' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-error')).toHaveTextContent(
        /save failed/,
      ),
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'attempted edit',
    )
  })

  it('disables save while submitting', async () => {
    let resolveCall: (value: TaskWithBodies) => void = () => {}
    updateTaskContent.mockReturnValue(
      new Promise<TaskWithBodies>((resolve) => {
        resolveCall = resolve
      }),
    )
    render(<TaskArtifactEditor task={makeTask()} kind="spec" />)

    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() =>
      expect(screen.getByTestId('task-artifact-editor-save')).toBeDisabled(),
    )

    resolveCall(makeTask())
  })
})

describe('TaskArtifactEditor — plan kind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads from current_plan_body for the plan kind', () => {
    render(
      <TaskArtifactEditor
        task={makeTask({ current_plan_body: 'plan body' })}
        kind="plan"
      />,
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'plan body',
    )
  })

  it('saves with kind=plan in the Tauri call', async () => {
    updateTaskContent.mockResolvedValue(makeTask())
    getTask.mockResolvedValue(makeTask({ current_plan_body: 'plan v1' }))
    render(<TaskArtifactEditor task={makeTask()} kind="plan" />)

    fireEvent.change(screen.getByTestId('task-artifact-editor-textarea'), {
      target: { value: 'plan v1' },
    })
    fireEvent.click(screen.getByTestId('task-artifact-editor-save'))

    await waitFor(() => expect(updateTaskContent).toHaveBeenCalled())
    expect(updateTaskContent.mock.calls[0][1]).toBe('plan')
  })
})

describe('TaskArtifactEditor — summary kind read-only', () => {
  it('reads current_summary_body and disables the save button (summary is generated, not user-edited)', () => {
    render(
      <TaskArtifactEditor
        task={makeTask({ current_summary_body: 'summary body' })}
        kind="summary"
      />,
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveValue(
      'summary body',
    )
    expect(screen.getByTestId('task-artifact-editor-textarea')).toHaveAttribute(
      'readonly',
    )
    // Read-only mode: no save button at all.
    expect(screen.queryByTestId('task-artifact-editor-save')).toBeNull()
  })
})
