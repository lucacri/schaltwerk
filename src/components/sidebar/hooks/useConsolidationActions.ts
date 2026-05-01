import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../../common/tauriCommands'
import { logger } from '../../../utils/logger'
import { useToast } from '../../../common/toast/ToastProvider'

interface UseConsolidationActionsResult {
    triggerJudge: (roundId: string, early?: boolean) => Promise<void>
    confirmWinner: (roundId: string, winnerSessionId: string) => Promise<void>
}

export function useConsolidationActions(): UseConsolidationActionsResult {
    const { pushToast } = useToast()

    const triggerJudge = useCallback(async (roundId: string, early = false) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreTriggerConsolidationJudge, {
                roundId,
                early,
            })
            pushToast({
                tone: 'success',
                title: 'Consolidation judge started',
                description: early ? 'Judge launched before all candidates completed.' : 'Judge launched for completed consolidation candidates.',
            })
        } catch (error) {
            logger.error('Failed to trigger consolidation judge:', error)
            pushToast({
                tone: 'error',
                title: 'Failed to start judge',
                description: String(error),
            })
        }
    }, [pushToast])

    const confirmWinner = useCallback(async (roundId: string, winnerSessionId: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreConfirmConsolidationWinner, {
                roundId,
                winnerSessionId,
            })
            pushToast({
                tone: 'success',
                title: 'Consolidation winner confirmed',
                description: `Confirmed ${winnerSessionId} for round ${roundId}.`,
            })
        } catch (error) {
            logger.error('Failed to confirm consolidation winner:', error)
            pushToast({
                tone: 'error',
                title: 'Failed to confirm winner',
                description: String(error),
            })
        }
    }, [pushToast])

    return { triggerJudge, confirmWinner }
}
