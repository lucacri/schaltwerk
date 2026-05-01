import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../../common/tauriCommands'
import { useToast } from '../../../common/toast/ToastProvider'
import { useSessionMergeShortcut } from '../../../hooks/useSessionMergeShortcut'
import { logger } from '../../../utils/logger'
import { getErrorMessage } from '../../../types/errors'
import { buildResolveMergeInAgentRequest } from '../helpers/routeMergeConflictPrompt'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { TerminalIds } from '../../../hooks/useSessionManagement'
import type { MergeDialogState } from '../../../store/atoms/sessions'

type FocusArea = 'claude' | 'terminal' | 'diff' | 'sidebar'

interface UseSidebarMergeOrchestrationParams {
    allSessions: EnrichedSession[]
    selection: Selection
    terminals: TerminalIds
    mergeDialogState: MergeDialogState
    openMergeDialog: (sessionId: string) => Promise<unknown>
    closeMergeDialog: () => void
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    setFocusForSession: (sessionKey: string, focus: FocusArea) => void
    setCurrentFocus: (focus: FocusArea | null) => void
}

interface UseSidebarMergeOrchestrationResult {
    mergeCommitDrafts: Record<string, string>
    setMergeCommitDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
    activeMergeCommitDraft: string
    updateActiveMergeCommitDraft: (value: string) => void
    handleMergeShortcut: ReturnType<typeof useSessionMergeShortcut>['handleMergeShortcut']
    isSessionMerging: ReturnType<typeof useSessionMergeShortcut>['isSessionMerging']
    handleMergeSession: (sessionId: string) => void
    handleResolveMergeInAgentSession: () => Promise<void>
}

export function useSidebarMergeOrchestration({
    allSessions,
    selection,
    terminals,
    mergeDialogState,
    openMergeDialog,
    closeMergeDialog,
    setSelection,
    setFocusForSession,
    setCurrentFocus,
}: UseSidebarMergeOrchestrationParams): UseSidebarMergeOrchestrationResult {
    const { pushToast } = useToast()
    const [mergeCommitDrafts, setMergeCommitDrafts] = useState<Record<string, string>>({})

    const getCommitDraftForSession = useCallback(
        (sessionId: string) => mergeCommitDrafts[sessionId],
        [mergeCommitDrafts],
    )

    const { handleMergeShortcut, isSessionMerging } = useSessionMergeShortcut({
        getCommitDraftForSession,
    })

    const activeMergeSessionId = mergeDialogState.sessionName
    const activeMergeCommitDraft = activeMergeSessionId ? mergeCommitDrafts[activeMergeSessionId] ?? '' : ''

    const updateActiveMergeCommitDraft = useCallback((value: string) => {
        if (!activeMergeSessionId) return
        setMergeCommitDrafts(prev => {
            if (!value) {
                if (!(activeMergeSessionId in prev)) return prev
                const { [activeMergeSessionId]: _removed, ...rest } = prev
                return rest
            }
            if (prev[activeMergeSessionId] === value) return prev
            return { ...prev, [activeMergeSessionId]: value }
        })
    }, [activeMergeSessionId])

    const handleMergeSession = useCallback((sessionId: string) => {
        if (isSessionMerging(sessionId)) return
        void openMergeDialog(sessionId)
    }, [isSessionMerging, openMergeDialog])

    const handleResolveMergeInAgentSession = useCallback(async () => {
        const sessionName = mergeDialogState.sessionName
        const preview = mergeDialogState.preview
        if (!sessionName || !preview) return

        const session = allSessions.find(candidate => candidate.info.session_id === sessionName)
        if (!session) return

        const { terminalId, prompt, useBracketedPaste, needsDelayedSubmit } = buildResolveMergeInAgentRequest({
            sessionName,
            session,
            conflictingPaths: preview.conflictingPaths,
            parentBranch: preview.parentBranch,
            selection,
            topTerminalId: terminals.top,
        })

        try {
            await setSelection({ kind: 'session', payload: sessionName }, false, true)
            await invoke(TauriCommands.PasteAndSubmitTerminal, {
                id: terminalId,
                data: prompt,
                useBracketedPaste,
                needsDelayedSubmit,
            })
            setFocusForSession(sessionName, 'claude')
            setCurrentFocus('claude')
            closeMergeDialog()
        } catch (error) {
            logger.error('[Sidebar] Failed to route merge conflict into agent session', error)
            pushToast({
                tone: 'error',
                title: 'Unable to route conflicts to agent',
                description: getErrorMessage(error),
            })
        }
    }, [
        allSessions,
        closeMergeDialog,
        mergeDialogState.preview,
        mergeDialogState.sessionName,
        pushToast,
        selection,
        setCurrentFocus,
        setFocusForSession,
        setSelection,
        terminals.top,
    ])

    return {
        mergeCommitDrafts,
        setMergeCommitDrafts,
        activeMergeCommitDraft,
        updateActiveMergeCommitDraft,
        handleMergeShortcut,
        isSessionMerging,
        handleMergeSession,
        handleResolveMergeInAgentSession,
    }
}
