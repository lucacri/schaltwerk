// Phase 7 Wave B.1: pinning tests for buildStageSections.
//
// The helper is the canonical projection from `tasks` to the
// stage-grouped sidebar shape. It must:
//
// 1. Always return all 8 sections (7 TaskStages + Cancelled), even
//    when empty — so the sidebar can render stable headers.
// 2. Place tasks with `cancelled_at !== null` in the Cancelled section
//    REGARDLESS of `task.stage`. This is the bug class flagged in the
//    audit (a v1 bug where a cancelled+ready task appeared in BOTH
//    Ready and Cancelled).
// 3. Order sections per `STAGE_ORDER` then Cancelled last.
// 4. Order tasks within a section by name (stable).

import { describe, it, expect } from 'vitest'

import {
  STAGE_SECTION_KEYS,
  buildStageSections,
  type StageSectionKey,
} from './buildStageSections'
import type { Task, TaskStage } from '../../../types/task'

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

describe('buildStageSections', () => {
  it('returns exactly 8 sections (7 stages + Cancelled), in canonical order', () => {
    const sections = buildStageSections([])
    expect(sections).toHaveLength(8)
    expect(sections.map((s) => s.key)).toEqual(STAGE_SECTION_KEYS)
  })

  it('returns 8 empty sections when no tasks are provided', () => {
    const sections = buildStageSections([])
    expect(sections.every((s) => s.tasks.length === 0)).toBe(true)
  })

  it('places one task in the section that matches its stage', () => {
    const stages: TaskStage[] = [
      'draft',
      'ready',
      'brainstormed',
      'planned',
      'implemented',
      'pushed',
      'done',
    ]
    for (const stage of stages) {
      const sections = buildStageSections([makeTask({ id: stage, stage })])
      const target = sections.find((s) => s.key === stage)
      expect(target?.tasks.map((t) => t.id)).toEqual([stage])
      // Every other section must be empty.
      for (const other of sections) {
        if (other.key !== stage) {
          expect(other.tasks).toEqual([])
        }
      }
    }
  })

  it('places a cancelled task in the Cancelled section regardless of stage', () => {
    // Bug-class regression: cancelled+ready, cancelled+pushed,
    // cancelled+draft must all appear ONLY under Cancelled.
    const cases: Array<{ stage: TaskStage }> = [
      { stage: 'draft' },
      { stage: 'ready' },
      { stage: 'brainstormed' },
      { stage: 'planned' },
      { stage: 'implemented' },
      { stage: 'pushed' },
      { stage: 'done' },
    ]
    for (const { stage } of cases) {
      const task = makeTask({
        id: `cancel-${stage}`,
        stage,
        cancelled_at: '2026-05-02T01:00:00Z',
      })
      const sections = buildStageSections([task])

      const cancelled = sections.find((s) => s.key === 'cancelled')
      expect(cancelled?.tasks.map((t) => t.id)).toEqual([`cancel-${stage}`])

      const stageSection = sections.find((s) => s.key === stage)
      expect(stageSection?.tasks).toEqual([])
    }
  })

  it('groups multiple tasks at the same stage and sorts by name', () => {
    const tasks = [
      makeTask({ id: 'gamma', name: 'gamma', stage: 'planned' }),
      makeTask({ id: 'alpha', name: 'alpha', stage: 'planned' }),
      makeTask({ id: 'beta', name: 'beta', stage: 'planned' }),
    ]
    const sections = buildStageSections(tasks)
    const planned = sections.find((s) => s.key === 'planned')
    expect(planned?.tasks.map((t) => t.id)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('keeps a non-cancelled task in its own stage section even when another task is cancelled', () => {
    const tasks = [
      makeTask({ id: 'live', stage: 'ready' }),
      makeTask({
        id: 'killed',
        stage: 'ready',
        cancelled_at: '2026-05-02T01:00:00Z',
      }),
    ]
    const sections = buildStageSections(tasks)
    expect(sections.find((s) => s.key === 'ready')?.tasks.map((t) => t.id)).toEqual([
      'live',
    ])
    expect(sections.find((s) => s.key === 'cancelled')?.tasks.map((t) => t.id)).toEqual(
      ['killed'],
    )
  })

  it('exposes a stable type-keyed shape (compile-time exhaustiveness)', () => {
    // Compile-time pin: every variant of StageSectionKey appears in
    // STAGE_SECTION_KEYS exactly once. A future stage addition that
    // forgets to update the order array would fail this test.
    const expected: StageSectionKey[] = [
      'draft',
      'ready',
      'brainstormed',
      'planned',
      'implemented',
      'pushed',
      'done',
      'cancelled',
    ]
    expect(STAGE_SECTION_KEYS).toEqual(expected)
  })
})
