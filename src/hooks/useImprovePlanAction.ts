import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { useToast } from '../common/toast/ToastProvider'
import { useTranslation } from '../common/i18n'
import { logger } from '../utils/logger'

export interface ImprovePlanRoundResponse {
  spec: string
  round_id: string
  candidate_sessions: string[]
}

export interface UseImprovePlanActionOptions {
  logContext: string
  onBeforeStart?: () => Promise<void> | void
  onError?: (message: string) => void
}

export interface UseImprovePlanActionResult {
  start: (sessionId: string) => Promise<ImprovePlanRoundResponse | null>
  starting: boolean
  startingSessionId: string | null
}

export function useImprovePlanAction(
  options: UseImprovePlanActionOptions,
): UseImprovePlanActionResult {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null)

  const start = useCallback(async (sessionId: string) => {
    if (startingSessionId) return null
    setStartingSessionId(sessionId)
    try {
      if (options.onBeforeStart) {
        await options.onBeforeStart()
      }
      const response = await invoke<ImprovePlanRoundResponse>(
        TauriCommands.SchaltwerkCoreStartImprovePlanRound,
        { name: sessionId },
      )
      pushToast({
        tone: 'success',
        title: t.sessionActions.improvePlanStartedTitle,
        description: t.sessionActions.improvePlanStartedDescription,
      })
      return response
    } catch (error) {
      const message = String(error)
      logger.error(`[${options.logContext}] Failed to start Improve Plan round:`, {
        sessionId,
        error,
      })
      pushToast({
        tone: 'error',
        title: t.sessionActions.improvePlanFailed,
        description: message,
      })
      options.onError?.(message)
      return null
    } finally {
      setStartingSessionId(prev => (prev === sessionId ? null : prev))
    }
  }, [options, pushToast, startingSessionId, t])

  return {
    start,
    starting: startingSessionId !== null,
    startingSessionId,
  }
}
