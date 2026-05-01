import { useCallback, useEffect, useState } from 'react'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../../common/eventSystem'
import { OpenGitlabMrModalPayload } from '../../../common/events'
import { logger } from '../../../utils/logger'
import type { GitlabMrDialogPrefill, GitlabMrDialogState } from '../helpers/modalState'

interface UseGitlabMrDialogControllerParams {
    createSafeUnlistener: (fn: UnlistenFn) => UnlistenFn
}

interface UseGitlabMrDialogControllerResult {
    state: GitlabMrDialogState
    open: (sessionName: string, prefill?: GitlabMrDialogPrefill) => void
    close: () => void
}

export function useGitlabMrDialogController({
    createSafeUnlistener,
}: UseGitlabMrDialogControllerParams): UseGitlabMrDialogControllerResult {
    const [state, setState] = useState<GitlabMrDialogState>({
        isOpen: false,
        sessionName: null,
    })

    const open = useCallback((sessionName: string, prefill?: GitlabMrDialogPrefill) => {
        setState({ isOpen: true, sessionName, prefill })
    }, [])

    const close = useCallback(() => {
        setState({ isOpen: false, sessionName: null })
    }, [])

    useEffect(() => {
        let unlisten: UnlistenFn | null = null

        const attach = async () => {
            try {
                const raw = await listenEvent(SchaltEvent.OpenGitlabMrModal, (payload: OpenGitlabMrModalPayload) => {
                    open(payload.sessionName, {
                        suggestedTitle: payload.suggestedTitle,
                        suggestedBody: payload.suggestedBody,
                        suggestedBaseBranch: payload.suggestedBaseBranch,
                        suggestedSourceProject: payload.suggestedSourceProject,
                    })
                })
                unlisten = createSafeUnlistener(raw)
            } catch (error) {
                logger.warn('Failed to listen for OpenGitlabMrModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [createSafeUnlistener, open])

    return { state, open, close }
}
