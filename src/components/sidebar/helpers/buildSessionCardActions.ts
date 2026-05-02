import { type SessionCardActions } from '../../../contexts/SessionCardActionsContext'
import { type EnrichedSession, type AgentType } from '../../../types/session'
import { emitUiEvent, UiEvent } from '../../../common/uiEvents'
import { logger } from '../../../utils/logger'
import { getSessionDisplayName } from '../../../utils/sessionDisplayName'
import type { Selection } from '../../../store/atoms/selection'
import type { TerminalIds, SessionSelection } from '../../../hooks/useSessionManagement'
import type { ConvertToSpecModalState, SwitchOrchestratorModalState } from './modalState'

interface ImprovePlanActionShape {
    start: (sessionId: string) => Promise<unknown>
    startingSessionId: string | null
}

export interface BuildSessionCardActionsDeps {
    sessions: EnrichedSession[]
    selection: Selection
    terminals: TerminalIds
    projectPathRef: { current: string | null }
    setConvertToDraftModal: (next: ConvertToSpecModalState) => void
    setSwitchModelSessionId: (id: string | null) => void
    setSwitchOrchestratorModal: (next: SwitchOrchestratorModalState) => void
    setForgeWritebackSessionId: (id: string | null) => void
    runRefineSpecFlow: (sessionId: string) => void
    improvePlanAction: ImprovePlanActionShape
    resetSession: (selection: SessionSelection, terminals: TerminalIds) => Promise<void>
    normalizeAgentType: (value: string | AgentType | undefined | null) => AgentType
    handleSelectSession: (sessionOrIndex: string | number) => void | Promise<void>
    handlePrShortcut: (sessionId: string) => void | Promise<unknown>
    handleOpenGitlabMrModal: (sessionName: string) => void
    handleMergeSession: (sessionId: string) => void
    handleMergeShortcut: (sessionId: string) => void | Promise<unknown>
    handleRenameSession: (sessionId: string, newName: string) => Promise<void>
    handleLinkPr: (sessionId: string, prNumber: number, prUrl: string) => Promise<void>
    /** Phase 7 Wave D.1.b: optional capture-as-task handler. */
    handleCaptureAsTask?: (sessionId: string) => void | Promise<void>
}

export function buildSessionCardActions(deps: BuildSessionCardActionsDeps): SessionCardActions {
    const {
        sessions,
        selection,
        terminals,
        projectPathRef,
        setConvertToDraftModal,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        setForgeWritebackSessionId,
        runRefineSpecFlow,
        improvePlanAction,
        resetSession,
        normalizeAgentType,
        handleSelectSession,
        handlePrShortcut,
        handleOpenGitlabMrModal,
        handleMergeSession,
        handleMergeShortcut,
        handleRenameSession,
        handleLinkPr,
        handleCaptureAsTask,
    } = deps

    return {
        onSelect: (sessionId) => { void handleSelectSession(sessionId) },
        onCancel: (sessionId, hasUncommitted) => {
            const session = sessions.find(s => s.info.session_id === sessionId)
            if (session) {
                const sessionDisplayName = getSessionDisplayName(session.info)
                emitUiEvent(UiEvent.SessionAction, {
                    action: 'cancel',
                    sessionId,
                    sessionName: sessionId,
                    sessionDisplayName,
                    branch: session.info.branch,
                    hasUncommittedChanges: hasUncommitted,
                })
            }
        },
        onConvertToSpec: (sessionId) => {
            const session = sessions.find(s => s.info.session_id === sessionId)
            if (session) {
                setConvertToDraftModal({
                    open: true,
                    sessionName: sessionId,
                    projectPath: projectPathRef.current,
                    sessionDisplayName: getSessionDisplayName(session.info),
                    hasUncommitted: session.info.has_uncommitted_changes || false,
                })
            }
        },
        onRunDraft: (sessionId) => {
            try {
                emitUiEvent(UiEvent.StartAgentFromSpec, { name: sessionId })
            } catch (err) {
                logger.error('Failed to open start modal from spec:', err)
            }
        },
        onRefineSpec: (sessionId) => {
            runRefineSpecFlow(sessionId)
        },
        onDeleteSpec: (sessionId) => {
            const session = sessions.find(s => s.info.session_id === sessionId)
            const sessionDisplayName = session ? getSessionDisplayName(session.info) : sessionId
            emitUiEvent(UiEvent.SessionAction, {
                action: 'delete-spec',
                sessionId,
                sessionName: sessionId,
                sessionDisplayName,
                branch: session?.info.branch,
                hasUncommittedChanges: false,
            })
        },
        onImprovePlanSpec: (sessionId) => {
            void improvePlanAction.start(sessionId)
        },
        onReset: (sessionId) => {
            void (async () => {
                const currentSelection = selection.kind === 'session' && selection.payload === sessionId
                    ? selection
                    : { kind: 'session' as const, payload: sessionId }
                await resetSession(currentSelection, terminals)
            })()
        },
        onSwitchModel: (sessionId) => {
            setSwitchModelSessionId(sessionId)
            const session = sessions.find(s => s.info.session_id === sessionId)
            const initialAgentType = normalizeAgentType(session?.info.original_agent_type)
            setSwitchOrchestratorModal({ open: true, initialAgentType, targetSessionId: sessionId })
        },
        onCreatePullRequest: (sessionId) => { void handlePrShortcut(sessionId) },
        onCreateGitlabMr: (sessionId) => { handleOpenGitlabMrModal(sessionId) },
        onMerge: handleMergeSession,
        onQuickMerge: (sessionId) => { void handleMergeShortcut(sessionId) },
        onRename: handleRenameSession,
        onLinkPr: (sessionId, prNumber, prUrl) => { void handleLinkPr(sessionId, prNumber, prUrl) },
        onPostToForge: (sessionId) => {
            setForgeWritebackSessionId(sessionId)
        },
        improvePlanStartingSessionId: improvePlanAction.startingSessionId,
        onCaptureAsTask: handleCaptureAsTask
            ? (sessionId) => { void handleCaptureAsTask(sessionId) }
            : undefined,
    }
}
