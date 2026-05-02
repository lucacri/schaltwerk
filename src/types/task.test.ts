// Phase 7 Wave A.1.b: structural pins for the v2 task type contracts.
//
// These tests defend the v2 invariants documented in `src/types/task.ts`:
// no `'queued'` literal, no `RunRole`, `TaskStage` does not include
// `'cancelled'`, and `assertDerivedStatus` surfaces backend regressions
// loudly. They are intentionally a mix of type-level pins (asserted via
// generic helpers) and runtime predicates so a future drift in either
// direction is caught.

import { describe, expect, it } from 'vitest'

import {
  STAGE_ORDER,
  type Task,
  type TaskRun,
  type TaskRunStatus,
  type TaskStage,
  type TaskWithBodies,
  assertDerivedStatus,
  isActiveTaskRun,
  isTerminalTaskRunStatus,
} from './task'

// Compile-time helper: succeed iff `T` extends `U`. Used to pin the
// shape of literal unions without leaking runtime cost.
type AssertExtends<T, U> = T extends U ? true : false
const _typeAssert = <T extends true>(): void => {
  void (null as unknown as T)
}

describe('task types — Phase 7 Wave A.1.b structural invariants', () => {
  it('TaskRunStatus does not include the v1 `queued` variant', () => {
    // Compile-time: `'queued'` must NOT be assignable to TaskRunStatus.
    // The negation is enforced by the union literal in task.ts; this
    // runtime witness pins the documented set so reviewers can grep.
    const allowed: TaskRunStatus[] = [
      'running',
      'awaiting_selection',
      'completed',
      'failed',
      'cancelled',
    ]
    expect(allowed).toHaveLength(5)
    // @ts-expect-error — 'queued' is not a v2 TaskRunStatus
    const _denied: TaskRunStatus = 'queued'
    void _denied
  })

  it('TaskStage does not include the v1 `cancelled` variant', () => {
    const allowed: TaskStage[] = [
      'draft',
      'ready',
      'brainstormed',
      'planned',
      'implemented',
      'pushed',
      'done',
    ]
    expect(allowed).toEqual(STAGE_ORDER)
    expect(STAGE_ORDER).toHaveLength(7)
    // @ts-expect-error — 'cancelled' is no longer a stage in v2
    const _denied: TaskStage = 'cancelled'
    void _denied
  })

  it('TaskRun.derived_status is required (non-optional, nullable)', () => {
    // The wire contract says: handlers always populate; null means
    // backend regression. The TS field is therefore required (always
    // present in the JSON) but nullable. This test pins both halves.
    type IsRequired = AssertExtends<
      keyof TaskRun,
      | 'id'
      | 'task_id'
      | 'stage'
      | 'derived_status'
      | 'created_at'
      | 'updated_at'
    >
    _typeAssert<IsRequired>()

    type IsNullable = AssertExtends<null, TaskRun['derived_status']>
    _typeAssert<IsNullable>()
  })

  it('Task does not carry artifact body fields (list-shape invariant)', () => {
    // The list/refresh shape is body-free per Phase 7 plan §0.3.
    // Body fields exist only on `TaskWithBodies`. A future regression
    // that adds them back to `Task` directly would fail this test.
    type TaskKeys = keyof Task
    type ForbiddenKey = 'current_spec_body' | 'current_plan_body' | 'current_summary_body'
    type IntersectionIsEmpty = TaskKeys & ForbiddenKey extends never ? true : false
    _typeAssert<IntersectionIsEmpty>()
  })

  it('TaskWithBodies extends Task with three optional body fields', () => {
    type WithBodies = AssertExtends<TaskWithBodies, Task>
    _typeAssert<WithBodies>()
    type HasSpecBody = AssertExtends<'current_spec_body', keyof TaskWithBodies>
    type HasPlanBody = AssertExtends<'current_plan_body', keyof TaskWithBodies>
    type HasSummaryBody = AssertExtends<'current_summary_body', keyof TaskWithBodies>
    _typeAssert<HasSpecBody>()
    _typeAssert<HasPlanBody>()
    _typeAssert<HasSummaryBody>()
  })
})

describe('assertDerivedStatus', () => {
  const baseRun: TaskRun = {
    id: 'run-1',
    task_id: 'task-1',
    stage: 'brainstormed',
    preset_id: null,
    base_branch: null,
    target_branch: null,
    selected_session_id: null,
    selected_artifact_id: null,
    selection_mode: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    confirmed_at: null,
    failed_at: null,
    failure_reason: null,
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    derived_status: 'running',
  }

  it('returns the status when populated', () => {
    expect(assertDerivedStatus({ ...baseRun, derived_status: 'awaiting_selection' })).toBe(
      'awaiting_selection',
    )
  })

  it('throws loudly when the handler returned null', () => {
    expect(() => assertDerivedStatus({ ...baseRun, derived_status: null })).toThrow(
      /Phase 7 invariant violation/,
    )
  })

  it('throw message includes run id and stage so regressions are diagnosable', () => {
    try {
      assertDerivedStatus({ ...baseRun, id: 'run-xyz', derived_status: null })
      throw new Error('expected throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toMatch(/run-xyz/)
      expect(message).toMatch(/brainstormed/)
    }
  })
})

describe('isActiveTaskRun', () => {
  const base: TaskRun = {
    id: 'r',
    task_id: 't',
    stage: 'planned',
    preset_id: null,
    base_branch: null,
    target_branch: null,
    selected_session_id: null,
    selected_artifact_id: null,
    selection_mode: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    confirmed_at: null,
    failed_at: null,
    failure_reason: null,
    created_at: '',
    updated_at: '',
    derived_status: 'running',
  }

  it('treats running as active', () => {
    expect(isActiveTaskRun({ ...base, derived_status: 'running' })).toBe(true)
  })

  it('treats awaiting_selection as active (stage runs awaiting confirm)', () => {
    expect(isActiveTaskRun({ ...base, derived_status: 'awaiting_selection' })).toBe(true)
  })

  it('does NOT treat completed / failed / cancelled as active', () => {
    expect(isActiveTaskRun({ ...base, derived_status: 'completed' })).toBe(false)
    expect(isActiveTaskRun({ ...base, derived_status: 'failed' })).toBe(false)
    expect(isActiveTaskRun({ ...base, derived_status: 'cancelled' })).toBe(false)
  })

  it('treats null derived_status as inactive (regression carries no false-positive)', () => {
    // Conservative: if the backend regressed, don't render the run as
    // active in case the affordances would mis-target a stale run.
    // The user-facing surface should also call `assertDerivedStatus`
    // before rendering badges, so this is the secondary guard.
    expect(isActiveTaskRun({ ...base, derived_status: null })).toBe(false)
  })
})

describe('isTerminalTaskRunStatus', () => {
  it('classifies completed / failed / cancelled as terminal', () => {
    expect(isTerminalTaskRunStatus('completed')).toBe(true)
    expect(isTerminalTaskRunStatus('failed')).toBe(true)
    expect(isTerminalTaskRunStatus('cancelled')).toBe(true)
  })

  it('classifies running and awaiting_selection as non-terminal', () => {
    expect(isTerminalTaskRunStatus('running')).toBe(false)
    expect(isTerminalTaskRunStatus('awaiting_selection')).toBe(false)
  })
})
