// Phase 7 Wave C.1: state-table affordance pin for TaskRow.
//
// Generalizes the SessionVersionGroup.affordances.test.tsx pattern
// (Phase 6 / commit 67411e00) to the task surface. Rows are
// representative (TaskStage × cancelled × failure_flag) combinations;
// columns are the action affordances we ship in the C.1 shell.
//
// Each cell is a presence/absence + label assertion. Failure on
// revert is the structural signal — the test enumerates state, the
// component is a pure function over state, so a behavior change
// without a test update fails CI.

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { TaskRow } from './TaskRow'
import type { Task, TaskStage } from '../../types/task'

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

interface StateRow {
  name: string
  task: Task
  expected: ReadonlyArray<AffordanceTestId>
}

type AffordanceTestId =
  | 'task-row-stage-action'
  | 'task-row-cancel'
  | 'task-row-reopen'

const ALL_AFFORDANCES: ReadonlyArray<AffordanceTestId> = [
  'task-row-stage-action',
  'task-row-cancel',
  'task-row-reopen',
]

const TABLE: ReadonlyArray<StateRow> = [
  {
    name: 'draft live: stage-action and cancel; no reopen',
    task: makeTask({ id: 'd1', stage: 'draft' }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'ready live: stage-action and cancel',
    task: makeTask({ id: 'r1', stage: 'ready' }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'brainstormed live: stage-action and cancel',
    task: makeTask({ id: 'b1', stage: 'brainstormed' }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'planned live: stage-action and cancel',
    task: makeTask({ id: 'p1', stage: 'planned' }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'implemented live: stage-action and cancel',
    task: makeTask({ id: 'i1', stage: 'implemented' }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'pushed live: cancel only (no progressing action remaining)',
    task: makeTask({ id: 'pu1', stage: 'pushed' }),
    expected: ['task-row-cancel'],
  },
  {
    name: 'done terminal: no progressing action and no cancel',
    task: makeTask({ id: 'do1', stage: 'done' }),
    expected: [],
  },
  {
    name: 'draft cancelled: reopen only, never stage-action and never cancel',
    task: makeTask({
      id: 'dc1',
      stage: 'draft',
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
  {
    name: 'ready cancelled: reopen only',
    task: makeTask({
      id: 'rc1',
      stage: 'ready',
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
  {
    name: 'planned cancelled: reopen only (cancellation is orthogonal to stage)',
    task: makeTask({
      id: 'pc1',
      stage: 'planned',
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
  {
    name: 'pushed cancelled: reopen only',
    task: makeTask({
      id: 'puc1',
      stage: 'pushed',
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
  {
    name: 'failure_flag does NOT hide cancel on a live task',
    task: makeTask({ id: 'fl1', stage: 'planned', failure_flag: true }),
    expected: ['task-row-stage-action', 'task-row-cancel'],
  },
  {
    name: 'failure_flag with cancelled stays in reopen-only mode',
    task: makeTask({
      id: 'fl2',
      stage: 'planned',
      failure_flag: true,
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
  {
    name: 'done cancelled (terminal + cancelled overlap is well-defined)',
    task: makeTask({
      id: 'dc2',
      stage: 'done',
      cancelled_at: '2026-05-02T01:00:00Z',
    }),
    expected: ['task-row-reopen'],
  },
]

describe('TaskRow affordance state table', () => {
  for (const row of TABLE) {
    describe(`state: ${row.name}`, () => {
      for (const affordance of ALL_AFFORDANCES) {
        const shouldShow = row.expected.includes(affordance)
        it(`${shouldShow ? 'renders' : 'does not render'} ${affordance}`, () => {
          render(<TaskRow task={row.task} />)
          if (shouldShow) {
            expect(screen.queryByTestId(affordance)).not.toBeNull()
          } else {
            expect(screen.queryByTestId(affordance)).toBeNull()
          }
        })
      }
    })
  }
})

describe('TaskRow affordance labels (visible text + aria)', () => {
  it('stage-action button has visible text per stage', () => {
    const labels: Array<{ stage: TaskStage; label: RegExp }> = [
      { stage: 'draft', label: /Promote to Ready/i },
      { stage: 'ready', label: /Run Brainstorm/i },
      { stage: 'brainstormed', label: /Run Plan/i },
      { stage: 'planned', label: /Run Implement/i },
      { stage: 'implemented', label: /Open PR/i },
    ]
    for (const { stage, label } of labels) {
      const { unmount } = render(<TaskRow task={makeTask({ id: stage, stage })} />)
      const button = screen.getByTestId('task-row-stage-action')
      expect(within(button).getByText(label)).toBeInTheDocument()
      // Labeled-affordance discipline: aria-label must be present.
      expect(button).toHaveAttribute('aria-label')
      unmount()
    }
  })

  it('cancel button has visible "Cancel" text + aria-label', () => {
    render(<TaskRow task={makeTask({ stage: 'planned' })} />)
    const cancel = screen.getByTestId('task-row-cancel')
    expect(within(cancel).getByText(/Cancel/)).toBeInTheDocument()
    expect(cancel).toHaveAttribute('aria-label')
  })

  it('reopen button has visible "Reopen" text + aria-label', () => {
    render(
      <TaskRow
        task={makeTask({ stage: 'ready', cancelled_at: '2026-05-02T01:00:00Z' })}
      />,
    )
    const reopen = screen.getByTestId('task-row-reopen')
    expect(within(reopen).getByText(/Reopen/)).toBeInTheDocument()
    expect(reopen).toHaveAttribute('aria-label')
  })
})
