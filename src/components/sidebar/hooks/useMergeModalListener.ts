import { useEffect } from 'react'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../../common/eventSystem'
import { OpenMergeModalPayload } from '../../../common/events'
import { logger } from '../../../utils/logger'
import { useToast } from '../../../common/toast/ToastProvider'
import { useTranslation } from '../../../common/i18n/useTranslation'

interface UseMergeModalListenerParams {
    createSafeUnlistener: (fn: UnlistenFn) => UnlistenFn
    setMergeCommitDrafts: (updater: (prev: Record<string, string>) => Record<string, string>) => void
    openMergeDialogWithPrefill: (input: { sessionId: string; prefillMode?: 'squash' | 'reapply' }) => Promise<unknown>
}

export function useMergeModalListener({
    createSafeUnlistener,
    setMergeCommitDrafts,
    openMergeDialogWithPrefill,
}: UseMergeModalListenerParams): void {
    const { pushToast } = useToast()
    const { t } = useTranslation()

    useEffect(() => {
        let unlisten: UnlistenFn | null = null

        const attach = async () => {
            try {
                const raw = await listenEvent(SchaltEvent.OpenMergeModal, async (payload: OpenMergeModalPayload) => {
                    try {
                        if (payload.commitMessage) {
                            setMergeCommitDrafts(prev => ({
                                ...prev,
                                [payload.sessionName]: payload.commitMessage!,
                            }))
                        }
                        await openMergeDialogWithPrefill({
                            sessionId: payload.sessionName,
                            prefillMode: payload.mode,
                        })
                    } catch (error) {
                        logger.error('Failed to open merge modal for MCP request:', error)
                        pushToast({
                            tone: 'error',
                            title: t.toasts.mergeModalFailed,
                            description: error instanceof Error ? error.message : String(error),
                        })
                    }
                })
                unlisten = createSafeUnlistener(raw)
            } catch (error) {
                logger.warn('Failed to listen for OpenMergeModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [createSafeUnlistener, openMergeDialogWithPrefill, pushToast, setMergeCommitDrafts, t.toasts.mergeModalFailed])
}
