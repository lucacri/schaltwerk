import { useCallback, type RefObject } from 'react'
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts'
import { emitUiEvent, UiEvent } from '../../../common/uiEvents'
import { getSessionLifecycleState } from '../../../utils/sessionState'
import type { EnrichedSession, AgentType } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { TerminalIds, SessionSelection } from '../../../hooks/useSessionManagement'
import type { SwitchOrchestratorModalState } from '../helpers/modalState'

type FocusArea = 'claude' | 'terminal' | 'diff' | 'sidebar'

interface UseSidebarKeyboardShortcutsParams {
    sessions: EnrichedSession[]
    allSessions: EnrichedSession[]
    selection: Selection
    terminals: TerminalIds
    isResetting: boolean
    inlineDiffDefault: boolean
    isAnyModalOpen: () => boolean
    isDiffViewerOpen?: boolean
    forge: 'github' | 'gitlab' | 'unknown'
    githubCanCreatePr: boolean
    flattenedSessionsCount: number
    openTabsCount: number
    sidebarRef: RefObject<HTMLDivElement | null>
    resetSession: (selection: SessionSelection, terminals: TerminalIds) => Promise<void>
    setSwitchModelSessionId: (id: string | null) => void
    setSwitchOrchestratorModal: (next: SwitchOrchestratorModalState) => void
    getOrchestratorAgentType: () => Promise<string | AgentType | null>
    normalizeAgentType: (value: string | AgentType | undefined | null) => AgentType
    setFocusForSession: (sessionKey: string, focus: FocusArea) => void
    setCurrentFocus: (focus: FocusArea | null) => void
    handleSelectOrchestrator: () => void | Promise<void>
    handleSelectSession: (sessionOrIndex: string | number) => void | Promise<void>
    handleCancelSelectedSession: (immediate: boolean) => void
    handlePromoteSelectedVersion: () => void
    handleSpecSelectedSession: () => void
    handleRefineSpecShortcut: () => void
    handleMergeShortcut: (sessionId?: string) => void | Promise<unknown>
    handlePrShortcut: () => void | Promise<unknown>
    handleOpenGitlabMrModal: (sessionName: string) => void
    updateAllSessionsFromParent: () => void | Promise<unknown>
    selectPrev: () => void | Promise<void>
    selectNext: () => void | Promise<void>
    onSwitchToProject?: (index: number) => void
    onCycleNextProject?: () => void
    onCyclePrevProject?: () => void
}

export function useSidebarKeyboardShortcuts(params: UseSidebarKeyboardShortcutsParams): void {
    const {
        sessions,
        allSessions,
        selection,
        terminals,
        isResetting,
        inlineDiffDefault,
        isAnyModalOpen,
        isDiffViewerOpen,
        forge,
        githubCanCreatePr,
        flattenedSessionsCount,
        openTabsCount,
        sidebarRef,
        resetSession,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        getOrchestratorAgentType,
        normalizeAgentType,
        setFocusForSession,
        setCurrentFocus,
        handleSelectOrchestrator,
        handleSelectSession,
        handleCancelSelectedSession,
        handlePromoteSelectedVersion,
        handleSpecSelectedSession,
        handleRefineSpecShortcut,
        handleMergeShortcut,
        handlePrShortcut,
        handleOpenGitlabMrModal,
        updateAllSessionsFromParent,
        selectPrev,
        selectNext,
        onSwitchToProject,
        onCycleNextProject,
        onCyclePrevProject,
    } = params

    const findSessionById = useCallback((sessionId?: string | null) => {
        if (!sessionId) return null
        return sessions.find(s => s.info.session_id === sessionId)
            || allSessions.find(s => s.info.session_id === sessionId)
            || null
    }, [sessions, allSessions])

    const getSelectedSessionState = useCallback((): ('spec' | 'processing' | 'running') | null => {
        if (selection.kind !== 'session') return null
        if (selection.sessionState) return selection.sessionState
        const session = findSessionById(selection.payload || null)
        return session ? getSessionLifecycleState(session.info) : null
    }, [selection, findSessionById])

    const handleResetSelectionShortcut = useCallback(() => {
        if (isResetting) return
        if (isAnyModalOpen()) return

        if (selection.kind === 'orchestrator') {
            void resetSession({ kind: 'orchestrator' }, terminals)
            return
        }

        if (selection.kind !== 'session' || !selection.payload) return

        const state = getSelectedSessionState()
        if (state !== 'running') return

        void resetSession({ kind: 'session', payload: selection.payload }, terminals)
    }, [isResetting, isAnyModalOpen, selection, resetSession, terminals, getSelectedSessionState])

    const handleOpenSwitchModelShortcut = useCallback(() => {
        if (isAnyModalOpen()) return

        if (selection.kind === 'orchestrator') {
            setSwitchModelSessionId(null)
            void getOrchestratorAgentType().then((initialAgentType) => {
                setSwitchOrchestratorModal({
                    open: true,
                    initialAgentType: normalizeAgentType(initialAgentType),
                    targetSessionId: null,
                })
            })
            return
        }

        if (selection.kind !== 'session' || !selection.payload) return

        const state = getSelectedSessionState()
        if (state !== 'running') return

        setSwitchModelSessionId(selection.payload)
        const session = sessions.find(s => s.info.session_id === selection.payload)
        const initialAgentType = normalizeAgentType(session?.info.original_agent_type)
        setSwitchOrchestratorModal({ open: true, initialAgentType, targetSessionId: selection.payload })
    }, [
        isAnyModalOpen,
        selection,
        getSelectedSessionState,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        getOrchestratorAgentType,
        sessions,
        normalizeAgentType,
    ])

    const handleCreatePullRequestShortcut = useCallback(() => {
        if (forge === 'gitlab') {
            if (selection.kind !== 'session' || !selection.payload) return
            handleOpenGitlabMrModal(selection.payload)
            return
        }
        if (!githubCanCreatePr) return
        void handlePrShortcut()
    }, [forge, selection, githubCanCreatePr, handlePrShortcut, handleOpenGitlabMrModal])

    useKeyboardShortcuts({
        onSelectOrchestrator: () => { void handleSelectOrchestrator() },
        onSelectSession: (index) => { void handleSelectSession(index) },
        onCancelSelectedSession: handleCancelSelectedSession,
        onRefineSpec: handleRefineSpecShortcut,
        onSpecSession: handleSpecSelectedSession,
        onPromoteSelectedVersion: () => { void handlePromoteSelectedVersion() },
        sessionCount: flattenedSessionsCount,
        onSelectPrevSession: () => { void selectPrev() },
        onSelectNextSession: () => { void selectNext() },
        onFocusSidebar: () => {
            setCurrentFocus('sidebar')
            setTimeout(() => {
                const button = sidebarRef.current?.querySelector('button')
                if (button instanceof HTMLElement) {
                    button.focus()
                }
            }, 50)
        },
        onFocusClaude: () => {
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'claude')
            setCurrentFocus('claude')
        },
        onOpenDiffViewer: () => {
            if (selection.kind !== 'session' && selection.kind !== 'orchestrator') return
            if (inlineDiffDefault) {
                emitUiEvent(UiEvent.OpenInlineDiffView)
            } else {
                emitUiEvent(UiEvent.OpenDiffView)
            }
        },
        onFocusTerminal: () => {
            if (isAnyModalOpen()) return

            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
            emitUiEvent(UiEvent.FocusTerminal)
        },
        projectCount: openTabsCount,
        onSwitchToProject,
        onCycleNextProject,
        onCyclePrevProject,
        onResetSelection: handleResetSelectionShortcut,
        onOpenSwitchModel: handleOpenSwitchModelShortcut,
        onOpenMergeModal: () => { void handleMergeShortcut() },
        onUpdateSessionFromParent: () => { void updateAllSessionsFromParent() },
        onCreatePullRequest: handleCreatePullRequestShortcut,
        onOpenSettings: () => { emitUiEvent(UiEvent.OpenSettings) },
        isDiffViewerOpen,
        isModalOpen: isAnyModalOpen(),
    })

}
