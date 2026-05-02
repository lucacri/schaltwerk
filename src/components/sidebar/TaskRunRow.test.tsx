import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { TaskRunRow } from './TaskRunRow'
import type { TaskRun, TaskRunStatus } from '../../types/task'

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1',
    task_id: 'task-1',
    stage: 'brainstormed',
    preset_id: null,
    base_branch: null,
    target_branch: null,
    selected_session_id: null,
    selected_artifact_id: null,
    selection_mode: null,
    started_at: '2026-05-02T00:00:00Z',
    completed_at: null,
    cancelled_at: null,
    confirmed_at: null,
    failed_at: null,
    failure_reason: null,
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    derived_status: 'running',
    ...overrides,
  }
}

describe('TaskRunRow status badges', () => {
  const statuses: TaskRunStatus[] = [
    'running',
    'awaiting_selection',
    'completed',
    'failed',
    'cancelled',
  ]

  for (const status of statuses) {
    it(`renders the ${status} status badge`, () => {
      render(<TaskRunRow run={makeRun({ derived_status: status })} />)
      expect(screen.getByTestId('task-run-row-status-badge')).toHaveAttribute(
        'data-status',
        status,
      )
    })
  }

  it('always renders the stage label so users can see which stage the run targets', () => {
    render(<TaskRunRow run={makeRun({ stage: 'planned' })} />)
    expect(screen.getByTestId('task-run-row-stage-badge')).toHaveTextContent(/Planned/i)
  })
})

describe('TaskRunRow cancel-run affordance', () => {
  it('renders the cancel-run button only when status is awaiting_selection', () => {
    const others: TaskRunStatus[] = ['running', 'completed', 'failed', 'cancelled']
    for (const status of others) {
      const { unmount } = render(
        <TaskRunRow run={makeRun({ derived_status: status })} />,
      )
      expect(screen.queryByTestId('task-run-row-cancel-run')).toBeNull()
      unmount()
    }

    render(<TaskRunRow run={makeRun({ derived_status: 'awaiting_selection' })} />)
    expect(screen.getByTestId('task-run-row-cancel-run')).toBeInTheDocument()
  })

  it('cancel-run button has visible text + aria-label', () => {
    render(<TaskRunRow run={makeRun({ derived_status: 'awaiting_selection' })} />)
    const button = screen.getByTestId('task-run-row-cancel-run')
    expect(button.textContent).toMatch(/Cancel run/i)
    expect(button).toHaveAttribute('aria-label')
  })

  it('invokes onCancelRun when the cancel button is clicked', () => {
    const onCancelRun = vi.fn()
    render(
      <TaskRunRow
        run={makeRun({ derived_status: 'awaiting_selection' })}
        onCancelRun={onCancelRun}
      />,
    )
    fireEvent.click(screen.getByTestId('task-run-row-cancel-run'))
    expect(onCancelRun).toHaveBeenCalledWith('run-1')
  })
})

describe('TaskRunRow null derived_status guard', () => {
  it('renders an "unknown" status badge when derived_status is null (regression surface)', () => {
    // Per assertDerivedStatus: null means a backend handler skipped
    // enrichment. The row surfaces this loudly rather than silently
    // coalescing to "running" — matches the consumer-side discipline
    // pinned by src/types/task.test.ts.
    render(<TaskRunRow run={makeRun({ derived_status: null })} />)
    const badge = screen.getByTestId('task-run-row-status-badge')
    expect(badge).toHaveAttribute('data-status', 'unknown')
    expect(badge.textContent).toMatch(/unknown/i)
  })
})
