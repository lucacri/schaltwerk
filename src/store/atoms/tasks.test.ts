// Phase 7 Wave A.2: pinning tests for the task atoms.
//
// These tests defend the source-of-truth contract: `tasksAtom` is the
// only writable carrier of task state; `Task.task_runs` IS the run
// list; the `taskRunsForTaskAtomFamily` selector is read-only and
// derives from `tasksAtom`. There is no separate write atom for runs,
// per the Phase 7 plan §6 decision and CLAUDE.md "single source of
// truth" rule.

import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'jotai'

import {
  tasksAtom,
  selectedTaskIdAtom,
  selectedTaskAtom,
  taskRunsForTaskAtomFamily,
  setTasksAtom,
  upsertTaskAtom,
  removeTaskAtom,
  mainTaskAtom,
} from './tasks'
import type { Task, TaskRun } from '../../types/task'

function makeRun(id: string, taskId: string): TaskRun {
  return {
    id,
    task_id: taskId,
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
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-a',
    name: 'alpha',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: 'do alpha',
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

describe('tasks atom — defaults', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('tasksAtom defaults to empty array', () => {
    expect(store.get(tasksAtom)).toEqual([])
  })

  it('selectedTaskIdAtom defaults to null', () => {
    expect(store.get(selectedTaskIdAtom)).toBeNull()
  })

  it('selectedTaskAtom returns null when nothing is selected', () => {
    expect(store.get(selectedTaskAtom)).toBeNull()
  })

  it('selectedTaskAtom returns null when selectedId points to a missing task', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' })])
    store.set(selectedTaskIdAtom, 'does-not-exist')
    expect(store.get(selectedTaskAtom)).toBeNull()
  })

  it('mainTaskAtom returns null when no task has variant=main', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a', variant: 'regular' })])
    expect(store.get(mainTaskAtom)).toBeNull()
  })
})

describe('setTasksAtom', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('replaces the full task list', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' }), makeTask({ id: 'b' })])
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['a', 'b'])

    store.set(setTasksAtom, [makeTask({ id: 'c' })])
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['c'])
  })

  it('selectedTaskAtom reflects the new list when the selected id still matches', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' })])
    store.set(selectedTaskIdAtom, 'a')
    expect(store.get(selectedTaskAtom)?.id).toBe('a')

    store.set(setTasksAtom, [makeTask({ id: 'a', display_name: 'Alpha v2' })])
    expect(store.get(selectedTaskAtom)?.display_name).toBe('Alpha v2')
  })
})

describe('upsertTaskAtom', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('inserts a task when its id is new', () => {
    store.set(upsertTaskAtom, makeTask({ id: 'a' }))
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['a'])
  })

  it('replaces a task in place when its id already exists', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a', display_name: 'old' })])
    store.set(upsertTaskAtom, makeTask({ id: 'a', display_name: 'new' }))
    const tasks = store.get(tasksAtom)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].display_name).toBe('new')
  })

  it('preserves order when replacing an existing task', () => {
    store.set(setTasksAtom, [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ])
    store.set(upsertTaskAtom, makeTask({ id: 'b', display_name: 'Bravo!' }))
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(store.get(tasksAtom)[1].display_name).toBe('Bravo!')
  })
})

describe('removeTaskAtom', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('removes the matching task', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' }), makeTask({ id: 'b' })])
    store.set(removeTaskAtom, 'a')
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['b'])
  })

  it('clears selectedTaskIdAtom when the removed task was selected', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' })])
    store.set(selectedTaskIdAtom, 'a')
    store.set(removeTaskAtom, 'a')
    expect(store.get(selectedTaskIdAtom)).toBeNull()
  })

  it('does not clear selection when removing a non-selected task', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' }), makeTask({ id: 'b' })])
    store.set(selectedTaskIdAtom, 'a')
    store.set(removeTaskAtom, 'b')
    expect(store.get(selectedTaskIdAtom)).toBe('a')
  })

  it('is a no-op for an unknown id', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' })])
    store.set(removeTaskAtom, 'does-not-exist')
    expect(store.get(tasksAtom).map((t) => t.id)).toEqual(['a'])
  })
})

describe('taskRunsForTaskAtomFamily — single source of truth', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('reads runs from tasksAtom (no separate write atom)', () => {
    const runA = makeRun('run-1', 'a')
    const runB = makeRun('run-2', 'a')
    store.set(setTasksAtom, [makeTask({ id: 'a', task_runs: [runA, runB] })])

    const runs = store.get(taskRunsForTaskAtomFamily('a'))
    expect(runs.map((r) => r.id)).toEqual(['run-1', 'run-2'])
  })

  it('returns empty when the task does not exist', () => {
    expect(store.get(taskRunsForTaskAtomFamily('missing'))).toEqual([])
  })

  it('reflects upsert changes to the embedded run list', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a', task_runs: [makeRun('r1', 'a')] })])
    expect(store.get(taskRunsForTaskAtomFamily('a'))).toHaveLength(1)

    store.set(
      upsertTaskAtom,
      makeTask({
        id: 'a',
        task_runs: [makeRun('r1', 'a'), makeRun('r2', 'a')],
      }),
    )
    expect(store.get(taskRunsForTaskAtomFamily('a'))).toHaveLength(2)
  })
})

describe('mainTaskAtom', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('returns the first task with variant=main', () => {
    store.set(setTasksAtom, [
      makeTask({ id: 'a', variant: 'regular' }),
      makeTask({ id: 'm', variant: 'main' }),
      makeTask({ id: 'b', variant: 'regular' }),
    ])
    expect(store.get(mainTaskAtom)?.id).toBe('m')
  })

  it('returns null when no main task is present', () => {
    store.set(setTasksAtom, [makeTask({ id: 'a' })])
    expect(store.get(mainTaskAtom)).toBeNull()
  })
})
