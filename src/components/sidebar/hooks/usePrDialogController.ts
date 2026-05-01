import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { UnlistenFn } from '@tauri-apps/api/event'
import { TauriCommands } from '../../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../../common/eventSystem'
import { OpenPrModalPayload } from '../../../common/events'
import { logger } from '../../../utils/logger'
import { useToast } from '../../../common/toast/ToastProvider'
import { useTranslation } from '../../../common/i18n/useTranslation'
import { useSessionPrShortcut } from '../../../hooks/useSessionPrShortcut'
import { extractPrNumberFromUrl } from '../../../utils/githubUrls'
import { PrPreviewResponse, PrCreateOptions } from '../../modals/PrSessionModal'
import type { PrDialogPrefill, PrDialogState } from '../helpers/modalState'

interface UsePrDialogControllerParams {
    autoCancelAfterPr: boolean
    createSafeUnlistener: (fn: UnlistenFn) => UnlistenFn
}

interface UsePrDialogControllerResult {
    state: PrDialogState
    open: (sessionName: string, preview: PrPreviewResponse, prefill?: PrDialogPrefill) => void
    close: () => void
    confirm: (options: PrCreateOptions) => Promise<void>
    handlePrShortcut: ReturnType<typeof useSessionPrShortcut>['handlePrShortcut']
}

const CLOSED_STATE: PrDialogState = {
    isOpen: false,
    sessionName: null,
    status: 'idle',
    preview: null,
    error: null,
}

export function usePrDialogController({
    autoCancelAfterPr,
    createSafeUnlistener,
}: UsePrDialogControllerParams): UsePrDialogControllerResult {
    const { pushToast } = useToast()
    const { t } = useTranslation()
    const [state, setState] = useState<PrDialogState>(CLOSED_STATE)

    const open = useCallback((sessionName: string, preview: PrPreviewResponse, prefill?: PrDialogPrefill) => {
        setState({
            isOpen: true,
            sessionName,
            status: 'ready',
            preview,
            prefill,
            error: null,
        })
    }, [])

    const close = useCallback(() => {
        setState(CLOSED_STATE)
    }, [])

    const confirm = useCallback(async (options: PrCreateOptions) => {
        const { sessionName, preview } = state
        if (!sessionName || !preview) return

        setState(prev => ({ ...prev, status: 'running', error: null }))

        try {
            const result = await invoke<{ url: string; branch: string }>(TauriCommands.GitHubCreateSessionPr, {
                args: {
                    sessionName,
                    prTitle: options.title,
                    prBody: options.body,
                    baseBranch: options.baseBranch,
                    prBranchName: options.prBranchName,
                    commitMessage: options.commitMessage,
                    mode: options.mode,
                    cancelAfterPr: autoCancelAfterPr,
                },
            })

            close()
            if (result.url) {
                const prUrl = result.url
                const prNumber = extractPrNumberFromUrl(prUrl)
                if (prNumber) {
                    try {
                        await invoke(TauriCommands.SchaltwerkCoreLinkSessionToPr, {
                            name: sessionName,
                            prNumber,
                            prUrl,
                        })
                    } catch (linkError) {
                        logger.warn('Failed to link session to PR after creation:', linkError)
                    }
                }
                pushToast({
                    tone: 'success',
                    title: t.toasts.prCreated,
                    description: prUrl,
                    action: {
                        label: t.settings.common.open,
                        onClick: () => {
                            void invoke(TauriCommands.OpenExternalUrl, { url: prUrl }).catch((err) => {
                                logger.warn('Failed to open URL via Tauri, falling back to window.open', err)
                                window.open(prUrl, '_blank', 'noopener,noreferrer')
                            })
                        },
                    },
                })
            } else {
                pushToast({
                    tone: 'success',
                    title: t.toasts.prCreated,
                    description: t.toasts.prCreatedBranch.replace('{branch}', result.branch),
                })
            }
        } catch (error) {
            logger.error('Failed to create PR', error)
            const message = error instanceof Error ? error.message : String(error)
            setState(prev => ({ ...prev, status: 'ready', error: message }))
        }
    }, [state, autoCancelAfterPr, close, pushToast, t.toasts.prCreated, t.toasts.prCreatedBranch, t.settings.common.open])

    const { handlePrShortcut } = useSessionPrShortcut({
        onOpenModal: open,
    })

    useEffect(() => {
        let unlisten: UnlistenFn | null = null

        const attach = async () => {
            try {
                const raw = await listenEvent(SchaltEvent.OpenPrModal, async (payload: OpenPrModalPayload) => {
                    try {
                        const preview = await invoke<PrPreviewResponse>(TauriCommands.GitHubPreviewPr, {
                            sessionName: payload.sessionName,
                        })
                        open(payload.sessionName, preview, {
                            suggestedTitle: payload.prTitle,
                            suggestedBody: payload.prBody,
                            suggestedBaseBranch: payload.baseBranch,
                            suggestedPrBranchName: payload.prBranchName,
                            suggestedMode: payload.mode,
                        })
                    } catch (error) {
                        logger.error('Failed to load PR preview for MCP request:', error)
                        pushToast({
                            tone: 'error',
                            title: t.toasts.prModalFailed,
                            description: error instanceof Error ? error.message : String(error),
                        })
                    }
                })
                unlisten = createSafeUnlistener(raw)
            } catch (error) {
                logger.warn('Failed to listen for OpenPrModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [createSafeUnlistener, open, pushToast, t.toasts.prModalFailed])

    return { state, open, close, confirm, handlePrShortcut }
}
