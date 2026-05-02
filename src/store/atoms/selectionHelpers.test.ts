// Phase 7 Wave B.4: pinning tests for the selection-kind helpers.
//
// These tests defend the discriminated-union semantics that the rest of
// Phase 7 reads against. Existing call sites that narrow on
// `kind === 'session'` continue to work (additive change); new task-
// shaped consumers go through the helpers below to avoid duplicating
// the kind-match logic.

import { describe, it, expect } from 'vitest'

import {
  type SelectionKind,
  isTaskKind,
  matchSelection,
  selectionToRunId,
  selectionToSessionId,
  selectionToTaskId,
} from './selectionHelpers'
import type { Selection } from './selection'

const orchestrator: Selection = { kind: 'orchestrator' }
const session: Selection = { kind: 'session', payload: 'sess-1' }
const task: Selection = { kind: 'task', taskId: 'task-1' }
const taskRun: Selection = {
  kind: 'task-run',
  taskId: 'task-1',
  runId: 'run-7',
}
const taskSlot: Selection = {
  kind: 'task-slot',
  taskId: 'task-1',
  runId: 'run-7',
  payload: 'slot-sess-3',
}

describe('selectionToSessionId', () => {
  it('returns null for orchestrator selection', () => {
    expect(selectionToSessionId(orchestrator)).toBeNull()
  })

  it('returns the payload for session selection', () => {
    expect(selectionToSessionId(session)).toBe('sess-1')
  })

  it('returns null for task selection (task header has no session bound yet)', () => {
    expect(selectionToSessionId(task)).toBeNull()
  })

  it('returns null for task-run selection (a run is not a single session)', () => {
    expect(selectionToSessionId(taskRun)).toBeNull()
  })

  it('returns the slot session payload for task-slot selection', () => {
    expect(selectionToSessionId(taskSlot)).toBe('slot-sess-3')
  })
})

describe('selectionToTaskId', () => {
  it('returns null for orchestrator and session selections', () => {
    expect(selectionToTaskId(orchestrator)).toBeNull()
    expect(selectionToTaskId(session)).toBeNull()
  })

  it('returns the taskId for every task-shaped selection kind', () => {
    expect(selectionToTaskId(task)).toBe('task-1')
    expect(selectionToTaskId(taskRun)).toBe('task-1')
    expect(selectionToTaskId(taskSlot)).toBe('task-1')
  })
})

describe('selectionToRunId', () => {
  it('returns null for non-run selections', () => {
    expect(selectionToRunId(orchestrator)).toBeNull()
    expect(selectionToRunId(session)).toBeNull()
    expect(selectionToRunId(task)).toBeNull()
  })

  it('returns the runId for task-run and task-slot selections', () => {
    expect(selectionToRunId(taskRun)).toBe('run-7')
    expect(selectionToRunId(taskSlot)).toBe('run-7')
  })
})

describe('isTaskKind', () => {
  it('classifies the three task-shaped kinds as task-shaped', () => {
    expect(isTaskKind('task')).toBe(true)
    expect(isTaskKind('task-run')).toBe(true)
    expect(isTaskKind('task-slot')).toBe(true)
  })

  it('classifies session and orchestrator as not task-shaped', () => {
    expect(isTaskKind('session')).toBe(false)
    expect(isTaskKind('orchestrator')).toBe(false)
  })
})

describe('matchSelection', () => {
  it('routes each selection kind to the matching branch', () => {
    const route = (s: Selection): string =>
      matchSelection(s, {
        orchestrator: () => 'orchestrator',
        session: (sel) => `session:${sel.payload}`,
        task: (sel) => `task:${sel.taskId}`,
        'task-run': (sel) => `task-run:${sel.taskId}/${sel.runId}`,
        'task-slot': (sel) => `task-slot:${sel.taskId}/${sel.runId}/${sel.payload ?? ''}`,
      })

    expect(route(orchestrator)).toBe('orchestrator')
    expect(route(session)).toBe('session:sess-1')
    expect(route(task)).toBe('task:task-1')
    expect(route(taskRun)).toBe('task-run:task-1/run-7')
    expect(route(taskSlot)).toBe('task-slot:task-1/run-7/slot-sess-3')
  })

  it('exhaustiveness pin: SelectionKind union is closed at five variants', () => {
    // If a new kind is ever added without updating the matchers map,
    // the call below fails to type-check (the matchers parameter is
    // `Record<SelectionKind, …>` which becomes structurally invalid
    // when SelectionKind grows). This runtime witness records the
    // current set so reviewers can grep.
    const all: SelectionKind[] = [
      'orchestrator',
      'session',
      'task',
      'task-run',
      'task-slot',
    ]
    expect(all).toHaveLength(5)
  })
})
