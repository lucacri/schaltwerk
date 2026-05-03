// Phase 8 W.5 GAP 10: confirm_stage trigger + Retry merge toast.
//
// The backend orchestrator emits typed errors when confirm_stage fails:
//   - MergeConflictDuringConfirm (mapped to SchaltError::MergeConflict)
//   - StageAdvanceFailedAfterMerge (mapped to TaskFlowError of same name)
// Both are recoverable — the user can resolve the conflict (or fix the
// underlying issue) and retry the same call. Surfacing a sticky toast
// with a "Retry merge" action gives the user that affordance without
// drilling into logs.
//
// The hook returns a single function `confirmStage(runId, sessionId)`
// that:
//  1. Looks up the session's branch from `allSessionsAtom` (slots only
//     carry a sessionId; the orchestrator wants the branch name).
//  2. Calls the backend command.
//  3. On a typed merge-failure error, dispatches a sticky error toast
//     with a "Retry merge" action that re-runs the same call.
//  4. On any other error, dispatches a generic error toast.

import { useCallback } from 'react'
import { useAtomValue } from 'jotai'

import { allSessionsAtom } from '../../../store/atoms/sessions'
import { confirmStage as confirmStageService } from '../../../services/taskService'
import { useOptionalToast } from '../../../common/toast/ToastProvider'
import {
  isSchaltError,
  isTaskFlowError,
  getErrorMessage,
} from '../../../types/errors'
import { logger } from '../../../utils/logger'
import type { Task } from '../../../types/task'

export interface UseConfirmStageResult {
  confirmStage: (runId: string, winningSessionId: string) => Promise<Task | null>
}

export function useConfirmStage(projectPath?: string | null): UseConfirmStageResult {
  const sessions = useAtomValue(allSessionsAtom)
  const toast = useOptionalToast()

  const confirmStage = useCallback(
    async (runId: string, winningSessionId: string): Promise<Task | null> => {
      const slot = sessions.find(
        (s) => s.info.session_id === winningSessionId,
      )
      const branch = slot?.info.branch
      if (!branch) {
        const message = `Cannot confirm stage: no branch for session '${winningSessionId}'`
        logger.warn(`[useConfirmStage] ${message}`)
        toast?.pushToast({
          tone: 'error',
          title: 'Confirm stage failed',
          description: message,
        })
        return null
      }

      const run = async (): Promise<Task | null> => {
        try {
          return await confirmStageService(runId, winningSessionId, branch, {
            projectPath: projectPath ?? null,
          })
        } catch (err) {
          logger.warn('[useConfirmStage] confirmStage failed', err)
          const message = getErrorMessage(err)
          const isMergeFailure =
            (isSchaltError(err) && err.type === 'MergeConflict') ||
            (isTaskFlowError(err) &&
              err.type === 'StageAdvanceFailedAfterMerge') ||
            (isTaskFlowError(err) &&
              err.type === 'Schalt' &&
              err.data.type === 'MergeConflict')

          if (toast) {
            if (isMergeFailure) {
              toast.pushToast({
                tone: 'error',
                title: 'Merge failed during confirm',
                description: message,
                durationMs: 0,
                action: {
                  label: 'Retry merge',
                  onClick: () => {
                    void run()
                  },
                },
              })
            } else {
              toast.pushToast({
                tone: 'error',
                title: 'Confirm stage failed',
                description: message,
              })
            }
          }
          return null
        }
      }

      return run()
    },
    [projectPath, sessions, toast],
  )

  return { confirmStage }
}
