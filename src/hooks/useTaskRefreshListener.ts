// Phase 7 Wave A.3: subscribe to `SchaltEvent.TasksRefreshed` and
// dispatch incoming payloads into `tasksAtom`. Mounted once at the App
// shell; survives project switches.
//
// **Why a hook rather than mounting in `App.tsx` directly:** the test
// suite wants to drive the listener with a fake event without standing
// up the entire app shell. The hook isolates the subscription logic
// behind a Jotai-friendly seam that `useTaskRefreshListener.test`
// exercises with a synthesized payload.

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'

import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { setTasksAtom } from '../store/atoms/tasks'
import type { Task } from '../types/task'
import type { TasksRefreshedEventPayload } from '../common/events'
import { logger } from '../utils/logger'

export function useTaskRefreshListener(): void {
  const setTasks = useSetAtom(setTasksAtom)

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    const attach = async () => {
      try {
        const off = await listenEvent(SchaltEvent.TasksRefreshed, (payload) => {
          // The backend always emits a payload conforming to
          // `TasksRefreshedEventPayload`. Defensive narrowing matches
          // the pattern used by the sessions listener — better to drop
          // a malformed event than to crash the consumer.
          const tasks = extractTasks(payload)
          setTasks(tasks)
        })
        if (cancelled) {
          off()
        } else {
          unlisten = off
        }
      } catch (err) {
        logger.warn('[useTaskRefreshListener] failed to attach listener', err)
      }
    }
    void attach()

    return () => {
      cancelled = true
      if (unlisten) {
        unlisten()
      }
    }
  }, [setTasks])
}

function extractTasks(payload: TasksRefreshedEventPayload | unknown): Task[] {
  if (
    payload &&
    typeof payload === 'object' &&
    'tasks' in payload &&
    Array.isArray((payload as { tasks: unknown }).tasks)
  ) {
    return (payload as TasksRefreshedEventPayload).tasks
  }
  logger.warn(
    '[useTaskRefreshListener] dropping malformed TasksRefreshed payload',
    payload,
  )
  return []
}
