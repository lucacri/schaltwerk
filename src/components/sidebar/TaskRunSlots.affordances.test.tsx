// Phase 7 Wave C.3: state-table affordance pin for TaskRunSlots.
//
// Generalizes the SessionVersionGroup.affordances.test.tsx pattern
// to the v2 multi-candidate-stage-run surface. Rows are the canonical
// states a multi-candidate run can be in; columns are the affordances
// that should appear / disappear per state.
//
// Critical row: 'merge-failed-mid-confirm'. Commit f759cef0 fixed
// the merge-before-confirm-selection ordering; if the merge step
// fails, the run stays in awaiting_selection with no winner persisted.
// The affordance must reflect that — confirm-winner stays available,
// the failure is reported via the run badge.

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TaskRunSlots, type TaskRunSlotPresentation } from './TaskRunSlots'

interface StateRow {
  name: string
  slots: TaskRunSlotPresentation[]
  runStatus: 'running' | 'awaiting_selection' | 'completed' | 'failed' | 'cancelled'
  judgeFiled?: boolean
  mergeFailed?: boolean
  expectedAffordances: ReadonlyArray<AffordanceTestId>
}

type AffordanceTestId =
  | 'task-run-slots-list'
  | 'task-run-slots-confirm-winner'
  | 'task-run-slots-nudge-banner'
  | 'task-run-slots-merge-failed-banner'

const ALL_AFFORDANCES: ReadonlyArray<AffordanceTestId> = [
  'task-run-slots-list',
  'task-run-slots-confirm-winner',
  'task-run-slots-nudge-banner',
  'task-run-slots-merge-failed-banner',
]

const slot = (
  id: string,
  status: TaskRunSlotPresentation['status'],
  overrides: Partial<TaskRunSlotPresentation> = {},
): TaskRunSlotPresentation => ({
  sessionId: id,
  slotKey: id.split('-').pop() ?? id,
  status,
  isWinner: false,
  ...overrides,
})

const TABLE: ReadonlyArray<StateRow> = [
  {
    name: 'pre-candidates: empty slot list, run is queued',
    slots: [],
    runStatus: 'running',
    expectedAffordances: [],
  },
  {
    name: 'all slots running: no nudge banner, no confirm winner yet',
    slots: [
      slot('a', 'running'),
      slot('b', 'running'),
      slot('c', 'running'),
    ],
    runStatus: 'running',
    expectedAffordances: ['task-run-slots-list'],
  },
  {
    name: 'all slots idle, no judge: nudge banner appears, confirm-winner available',
    slots: [
      slot('a', 'idle'),
      slot('b', 'idle'),
      slot('c', 'idle'),
    ],
    runStatus: 'awaiting_selection',
    expectedAffordances: [
      'task-run-slots-list',
      'task-run-slots-nudge-banner',
      'task-run-slots-confirm-winner',
    ],
  },
  {
    name: 'judge filed: nudge banner gone, confirm-winner remains',
    slots: [
      slot('a', 'idle'),
      slot('b', 'idle'),
    ],
    runStatus: 'awaiting_selection',
    judgeFiled: true,
    expectedAffordances: [
      'task-run-slots-list',
      'task-run-slots-confirm-winner',
    ],
  },
  {
    name: 'merge-failed-mid-confirm: error banner; run stays in awaiting_selection',
    slots: [
      slot('a', 'idle'),
      slot('b', 'idle'),
    ],
    runStatus: 'awaiting_selection',
    mergeFailed: true,
    expectedAffordances: [
      'task-run-slots-list',
      'task-run-slots-confirm-winner',
      'task-run-slots-merge-failed-banner',
    ],
  },
  {
    name: 'completed: list shows winner; no further action affordances',
    slots: [
      slot('a', 'idle', { isWinner: true }),
      slot('b', 'idle'),
    ],
    runStatus: 'completed',
    expectedAffordances: ['task-run-slots-list'],
  },
  {
    name: 'cancelled: list shows; no nudge, no confirm',
    slots: [slot('a', 'idle'), slot('b', 'idle')],
    runStatus: 'cancelled',
    expectedAffordances: ['task-run-slots-list'],
  },
  {
    name: 'failed (one slot exited non-zero): list shows; no confirm-winner',
    slots: [
      slot('a', 'failed'),
      slot('b', 'idle'),
    ],
    runStatus: 'failed',
    expectedAffordances: ['task-run-slots-list'],
  },
]

describe('TaskRunSlots affordance state table', () => {
  for (const row of TABLE) {
    describe(`state: ${row.name}`, () => {
      for (const affordance of ALL_AFFORDANCES) {
        const shouldShow = row.expectedAffordances.includes(affordance)
        it(`${shouldShow ? 'renders' : 'does not render'} ${affordance}`, () => {
          render(
            <TaskRunSlots
              runId="run-x"
              runStatus={row.runStatus}
              slots={row.slots}
              judgeFiled={row.judgeFiled ?? false}
              mergeFailureReason={row.mergeFailed ? 'merge conflict' : null}
            />,
          )
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

describe('TaskRunSlots labeled-affordance discipline', () => {
  it('confirm-winner button has visible "Confirm winner" text + aria-label', () => {
    render(
      <TaskRunSlots
        runId="run-x"
        runStatus="awaiting_selection"
        slots={[slot('a', 'idle'), slot('b', 'idle')]}
        judgeFiled={false}
        mergeFailureReason={null}
      />,
    )
    const button = screen.getByTestId('task-run-slots-confirm-winner')
    expect(button.textContent).toMatch(/Confirm winner/i)
    expect(button).toHaveAttribute('aria-label')
  })

  it('nudge banner carries actionable copy', () => {
    render(
      <TaskRunSlots
        runId="run-x"
        runStatus="awaiting_selection"
        slots={[slot('a', 'idle'), slot('b', 'idle')]}
        judgeFiled={false}
        mergeFailureReason={null}
      />,
    )
    const banner = screen.getByTestId('task-run-slots-nudge-banner')
    expect(banner.textContent).toMatch(/idle|stuck|judge|winner/i)
  })

  it('merge-failed banner carries the failure reason', () => {
    render(
      <TaskRunSlots
        runId="run-x"
        runStatus="awaiting_selection"
        slots={[slot('a', 'idle'), slot('b', 'idle')]}
        judgeFiled={false}
        mergeFailureReason="merge conflict in src/foo.rs"
      />,
    )
    const banner = screen.getByTestId('task-run-slots-merge-failed-banner')
    expect(banner.textContent).toMatch(/merge/i)
    expect(banner.textContent).toMatch(/src\/foo\.rs/)
  })
})
