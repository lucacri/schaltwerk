import { useCallback } from 'react'
import { logger } from '../../../utils/logger'
import { isSpec } from '../../../utils/sessionFilters'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'

type FocusArea = 'claude' | 'terminal' | 'diff' | 'sidebar'

interface UseRefineSpecFlowParams {
    sessions: EnrichedSession[]
    selection: Selection
    isAnyModalOpen: () => boolean
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    setFocusForSession: (sessionKey: string, focus: FocusArea) => void
    setCurrentFocus: (focus: FocusArea | null) => void
}

interface UseRefineSpecFlowResult {
    runRefineSpecFlow: (sessionId: string) => void
    handleRefineSpecShortcut: () => void
}

export function useRefineSpecFlow({
    sessions,
    selection,
    isAnyModalOpen,
    setSelection,
    setFocusForSession,
    setCurrentFocus,
}: UseRefineSpecFlowParams): UseRefineSpecFlowResult {
    const runRefineSpecFlow = useCallback((sessionId: string) => {
        void (async () => {
            try {
                await setSelection({ kind: 'session', payload: sessionId, sessionState: 'spec' }, false, true)
                setFocusForSession(sessionId, 'claude')
                setCurrentFocus('claude')
            } catch (error) {
                logger.warn('[Sidebar] Failed to open spec clarification workspace', { sessionId, error })
            }
        })()
    }, [setCurrentFocus, setFocusForSession, setSelection])

    const handleRefineSpecShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !isSpec(session.info)) return
        runRefineSpecFlow(selection.payload)
    }, [isAnyModalOpen, selection, sessions, runRefineSpecFlow])

    return { runRefineSpecFlow, handleRefineSpecShortcut }
}
