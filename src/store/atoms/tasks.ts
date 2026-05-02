// Phase 7 Wave A.2: task atoms.
//
// **Source of truth (decided in plan §6 #7).** `tasksAtom` is the only
// writable carrier of task state. `Task.task_runs` IS the run list — there
// is no separate write atom for runs. The `taskRunsForTaskAtomFamily`
// selector is read-only and derives from `tasksAtom`. Mutations write
// through `setTasksAtom` / `upsertTaskAtom` / `removeTaskAtom`; the
// `TasksRefreshed` listener (Wave A.3) replaces the whole task object
// including its embedded runs on every refresh.
//
// At this stage the atoms are read-only from the UI's perspective — no
// Tauri invocation lives here. The listener in Wave A.3 is what populates
// `tasksAtom` from backend events.

import { atom } from 'jotai'
import type { Atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

import type { Task, TaskRun } from '../../types/task'

/**
 * Canonical task list for the active project. Replaced wholesale by the
 * `TasksRefreshed` listener; mutated incrementally via `upsertTaskAtom`
 * for optimistic flows. Defaults to `[]` so the sidebar can render an
 * empty state without a loading flicker.
 */
export const tasksAtom = atom<Task[]>([])

/**
 * The currently-selected task id (sidebar selection). `null` means
 * "nothing selected" or "selection is something other than a task" (e.g.,
 * the orchestrator). The selection-kind discriminator lives in the
 * existing `selection` atom and is broadened in Wave B.4.
 */
export const selectedTaskIdAtom = atom<string | null>(null)

/**
 * Derived selector: the `Task` matching `selectedTaskIdAtom`, or `null`.
 * Returns `null` when the id points to a task no longer in `tasksAtom`
 * (e.g., post-removal) — callers should treat that as "selection went
 * stale; clear it" rather than coalesce to a default.
 */
export const selectedTaskAtom: Atom<Task | null> = atom((get) => {
  const id = get(selectedTaskIdAtom)
  if (!id) return null
  return get(tasksAtom).find((task) => task.id === id) ?? null
})

/**
 * Read-only derived selector for a task's runs. Phase 7 source-of-truth
 * pin: this reads `task.task_runs` from `tasksAtom`; there is **no**
 * separate write atom for runs. Callers that mutate runs do so through
 * `upsertTaskAtom` with a fresh `Task` whose `task_runs` reflect the
 * change.
 */
export const taskRunsForTaskAtomFamily = atomFamily((taskId: string) =>
  atom<TaskRun[]>((get) => {
    const task = get(tasksAtom).find((t) => t.id === taskId)
    return task?.task_runs ?? []
  }),
)

/**
 * Convenience selector for the "main" task — the singleton task with
 * `variant === 'main'` if present. Mirrors v1's `mainTaskAtom`. Returns
 * `null` when no main task exists yet (a new project before the
 * orchestrator's main task is provisioned).
 */
export const mainTaskAtom: Atom<Task | null> = atom((get) => {
  for (const task of get(tasksAtom)) {
    if (task.variant === 'main') return task
  }
  return null
})

/**
 * Action atom: replace the task list wholesale. Used by the
 * `TasksRefreshed` listener (Wave A.3).
 */
export const setTasksAtom = atom(null, (_get, set, tasks: Task[]) => {
  set(tasksAtom, tasks)
})

/**
 * Action atom: insert-or-replace a task by id, preserving order on
 * replace. Used for optimistic flows that get one task back from a
 * mutation rather than a full refresh.
 */
export const upsertTaskAtom = atom(null, (get, set, task: Task) => {
  const tasks = get(tasksAtom)
  const index = tasks.findIndex((existing) => existing.id === task.id)
  if (index >= 0) {
    const next = tasks.slice()
    next[index] = task
    set(tasksAtom, next)
    return
  }
  set(tasksAtom, [...tasks, task])
})

/**
 * Action atom: remove a task by id. Clears `selectedTaskIdAtom` if the
 * removed task was the current selection, so the right pane doesn't
 * dangle on a deleted task. No-op when the id doesn't match anything.
 */
export const removeTaskAtom = atom(null, (get, set, id: string) => {
  const tasks = get(tasksAtom)
  const filtered = tasks.filter((task) => task.id !== id)
  if (filtered.length !== tasks.length) {
    set(tasksAtom, filtered)
  }
  if (get(selectedTaskIdAtom) === id) {
    set(selectedTaskIdAtom, null)
  }
})
