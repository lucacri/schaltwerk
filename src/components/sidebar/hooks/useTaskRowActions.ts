// Phase 7 Wave C.2: action handlers for the TaskRow shell.
//
// Optimistic-flip + rollback per the §0.5 pattern (the canonical
// `optimisticallyConvertSessionToSpec` + `runConsolidationAction`
// shape). For destructive actions (cancel, reopen) the local atom flips
// immediately so the UI feels snappy; if the Tauri call fails the
// atom rolls back and the call site can surface a toast.
//
// `feedback_stamp_after_side_effect` applies: timestamps on the
// optimistic flip are speculative; the real `cancelled_at` value comes
// from the backend response and replaces the speculative one on
// success.

import { useCallback } from 'react'
import { useAtom } from 'jotai'

import { tasksAtom } from '../../../store/atoms/tasks'
import {
  cancelTask as cancelTaskService,
  cancelTaskRun as cancelTaskRunService,
  promoteTaskToReady as promoteTaskToReadyService,
  reopenTask as reopenTaskService,
} from '../../../services/taskService'
import { logger } from '../../../utils/logger'
import type { Task, TaskStage } from '../../../types/task'

export interface UseTaskRowActionsResult {
  promoteToReady: (task: Task) => Promise<Task>
  cancelTask: (task: Task) => Promise<Task>
  reopenTask: (task: Task, targetStage: TaskStage) => Promise<Task>
  cancelTaskRun: (runId: string) => Promise<void>
}

export function useTaskRowActions(
  projectPath?: string | null,
): UseTaskRowActionsResult {
  const [tasks, setTasks] = useAtom(tasksAtom)

  const replaceTask = useCallback(
    (id: string, mutator: (task: Task) => Task) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? mutator(t) : t)))
    },
    [setTasks],
  )

  const findTask = useCallback(
    (id: string): Task | null => tasks.find((t) => t.id === id) ?? null,
    [tasks],
  )

  const promoteToReady = useCallback(
    async (task: Task): Promise<Task> => {
      const updated = await promoteTaskToReadyService(task.id, projectPath ?? null)
      replaceTask(task.id, () => updated)
      return updated
    },
    [projectPath, replaceTask],
  )

  const cancelTask = useCallback(
    async (task: Task): Promise<Task> => {
      const original = findTask(task.id)
      const optimisticTimestamp = new Date().toISOString()
      replaceTask(task.id, (t) => ({ ...t, cancelled_at: optimisticTimestamp }))
      try {
        const updated = await cancelTaskService(task.id, projectPath ?? null)
        replaceTask(task.id, () => updated)
        return updated
      } catch (err) {
        if (original) {
          replaceTask(task.id, () => original)
        }
        logger.warn('[useTaskRowActions] cancelTask failed; rolled back', err)
        throw err
      }
    },
    [findTask, projectPath, replaceTask],
  )

  const reopenTask = useCallback(
    async (task: Task, targetStage: TaskStage): Promise<Task> => {
      const original = findTask(task.id)
      replaceTask(task.id, (t) => ({
        ...t,
        cancelled_at: null,
        stage: targetStage,
      }))
      try {
        const updated = await reopenTaskService(
          task.id,
          targetStage,
          projectPath ?? null,
        )
        replaceTask(task.id, () => updated)
        return updated
      } catch (err) {
        if (original) {
          replaceTask(task.id, () => original)
        }
        logger.warn('[useTaskRowActions] reopenTask failed; rolled back', err)
        throw err
      }
    },
    [findTask, projectPath, replaceTask],
  )

  const cancelTaskRun = useCallback(
    async (runId: string): Promise<void> => {
      // Run cancellation does not mutate the task envelope optimistically —
      // the next TasksRefreshed broadcast will carry the new run.cancelled_at.
      // We just await the call and let the listener do its job.
      await cancelTaskRunService(runId, projectPath ?? null)
    },
    [projectPath],
  )

  return { promoteToReady, cancelTask, reopenTask, cancelTaskRun }
}
