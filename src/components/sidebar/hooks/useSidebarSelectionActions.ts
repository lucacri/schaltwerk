import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { emitUiEvent, UiEvent } from '../../../common/uiEvents'
import { isSpec } from '../../../utils/sessionFilters'
import { getSessionDisplayName } from '../../../utils/sessionDisplayName'
import { getSessionLifecycleState } from '../../../utils/sessionState'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'

interface UseSidebarSelectionActionsParams {
    sessions: EnrichedSession[]
    flattenedSessions: EnrichedSession[]
    selection: Selection
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    setSessionsWithNotifications: Dispatch<SetStateAction<Set<string>>>
}

interface UseSidebarSelectionActionsResult {
    handleSelectOrchestrator: () => Promise<void>
    handleSelectSession: (sessionOrIndex: string | number) => Promise<void>
    handleCancelSelectedSession: (immediate: boolean) => void
    selectPrev: () => Promise<void>
    selectNext: () => Promise<void>
}

export function useSidebarSelectionActions({
    sessions,
    flattenedSessions,
    selection,
    setSelection,
    setSessionsWithNotifications,
}: UseSidebarSelectionActionsParams): UseSidebarSelectionActionsResult {
    const handleSelectOrchestrator = useCallback(async () => {
        await setSelection({ kind: 'orchestrator' }, false, true)
    }, [setSelection])

    const handleSelectSession = useCallback(async (sessionOrIndex: string | number) => {
        const session = typeof sessionOrIndex === 'number'
            ? flattenedSessions[sessionOrIndex]
            : flattenedSessions.find(s => s.info.session_id === sessionOrIndex)

        if (!session) return

        const s = session.info

        setSessionsWithNotifications(prev => {
            const updated = new Set(prev)
            updated.delete(s.session_id)
            return updated
        })

        await setSelection({
            kind: 'session',
            payload: s.session_id,
            worktreePath: s.worktree_path,
            sessionState: getSessionLifecycleState(s),
        }, false, true)
    }, [flattenedSessions, setSelection, setSessionsWithNotifications])

    const handleCancelSelectedSession = useCallback((immediate: boolean) => {
        if (selection.kind !== 'session') return
        const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
        if (!selectedSession) return

        const sessionDisplayName = getSessionDisplayName(selectedSession.info)

        if (isSpec(selectedSession.info)) {
            emitUiEvent(UiEvent.SessionAction, {
                action: 'delete-spec',
                sessionId: selectedSession.info.session_id,
                sessionName: selectedSession.info.session_id,
                sessionDisplayName,
                branch: selectedSession.info.branch,
                hasUncommittedChanges: false,
            })
            return
        }

        emitUiEvent(UiEvent.SessionAction, {
            action: immediate ? 'cancel-immediate' : 'cancel',
            sessionId: selectedSession.info.session_id,
            sessionName: selectedSession.info.session_id,
            sessionDisplayName,
            branch: selectedSession.info.branch,
            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false,
        })
    }, [selection, sessions])

    const selectPrev = useCallback(async () => {
        if (sessions.length === 0) return
        if (selection.kind !== 'session') return

        const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
        if (currentIndex <= 0) {
            await handleSelectOrchestrator()
            return
        }
        await handleSelectSession(currentIndex - 1)
    }, [sessions.length, selection, flattenedSessions, handleSelectOrchestrator, handleSelectSession])

    const selectNext = useCallback(async () => {
        if (sessions.length === 0) return

        if (selection.kind === 'orchestrator') {
            await handleSelectSession(0)
            return
        }

        if (selection.kind !== 'session') return

        const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
        const nextIndex = Math.min(currentIndex + 1, flattenedSessions.length - 1)
        if (nextIndex !== currentIndex) {
            await handleSelectSession(nextIndex)
        }
    }, [sessions.length, selection, flattenedSessions, handleSelectSession])

    return {
        handleSelectOrchestrator,
        handleSelectSession,
        handleCancelSelectedSession,
        selectPrev,
        selectNext,
    }
}
