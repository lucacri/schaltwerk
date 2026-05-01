import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useFocus } from '../../contexts/FocusContext'
import { useSelection } from '../../hooks/useSelection'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { useSessions } from '../../hooks/useSessions'
import { buildConsolidationGroupDetail } from './helpers/consolidationGroupDetail'
import { SidebarModalsTrailer } from './views/SidebarModalsTrailer'
import { SidebarHeaderBar } from './views/SidebarHeaderBar'
import { OrchestratorEntry } from './views/OrchestratorEntry'
import { SidebarSearchBar } from './views/SidebarSearchBar'
import { SidebarSessionList } from './views/SidebarSessionList'
import { buildSessionCardActions } from './helpers/buildSessionCardActions'
import { useSidebarCollapsePersistence } from './hooks/useSidebarCollapsePersistence'
import { useConsolidationActions } from './hooks/useConsolidationActions'
import { useConvertToSpecController } from './hooks/useConvertToSpecController'
import { useGitlabMrDialogController } from './hooks/useGitlabMrDialogController'
import { createSafeUnlistener } from './helpers/createSafeUnlistener'
import { useMergeModalListener } from './hooks/useMergeModalListener'
import { useVersionPromotionController } from './hooks/useVersionPromotionController'
import { useOrchestratorBranch } from './hooks/useOrchestratorBranch'
import { usePrDialogController } from './hooks/usePrDialogController'
import { useSidebarBackendEvents } from './hooks/useSidebarBackendEvents'
import { useSessionScrollIntoView } from './hooks/useSessionScrollIntoView'
import { useSidebarSelectionMemory } from './hooks/useSidebarSelectionMemory'
import { useSidebarKeyboardShortcuts } from './hooks/useSidebarKeyboardShortcuts'
import { buildSidebarModalSlots } from './helpers/buildSidebarModalSlots'
import { useSidebarSelectionActions } from './hooks/useSidebarSelectionActions'
import { useOrchestratorEntryActions } from './hooks/useOrchestratorEntryActions'
import { useSidebarMergeOrchestration } from './hooks/useSidebarMergeOrchestration'
import { useSidebarSectionedSessions } from './hooks/useSidebarSectionedSessions'
import { useSessionEditCallbacks } from './hooks/useSessionEditCallbacks'
import { useRefineSpecFlow } from './hooks/useRefineSpecFlow'
import {
    SwitchOrchestratorModalState,
} from './helpers/modalState'

export { buildConsolidationGroupDetail }
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { AGENT_TYPES, AgentType, type Epic } from '../../types/session'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useRun } from '../../contexts/RunContext'
import { useModal } from '../../contexts/ModalContext'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { projectPathAtom } from '../../store/atoms/project'
import { openMergeDialogActionAtom } from '../../store/atoms/sessions'
import { useUpdateSessionFromParent } from '../../hooks/useUpdateSessionFromParent'
import { DEFAULT_AGENT } from '../../constants/agents'
import { useEpics } from '../../hooks/useEpics'
import { projectForgeAtom } from '../../store/atoms/forge'
import { useImprovePlanAction } from '../../hooks/useImprovePlanAction'
import { sidebarViewModeAtom } from '../../store/atoms/sidebarViewMode'
import { useForgeIntegrationContext } from '../../contexts/ForgeIntegrationContext'

// Removed legacy terminal-stuck idle handling; we rely on last-edited timestamps only

interface SidebarProps {
    isDiffViewerOpen?: boolean
    openTabs?: Array<{projectPath: string, projectName: string}>
    onSwitchToProject?: (index: number) => void
    onCycleNextProject?: () => void
    onCyclePrevProject?: () => void
    isCollapsed?: boolean
    onExpandRequest?: () => void
    onToggleSidebar?: () => void
}

export const Sidebar = memo(function Sidebar({ isDiffViewerOpen, openTabs = [], onSwitchToProject, onCycleNextProject, onCyclePrevProject, isCollapsed = false, onExpandRequest, onToggleSidebar }: SidebarProps) {
    const { selection, setSelection, terminals, clearTerminalTracking } = useSelection()
    const projectPath = useAtomValue(projectPathAtom)
    const { setFocusForSession, setCurrentFocus } = useFocus()
    const { isSessionRunning } = useRun()
    const { isAnyModalOpen } = useModal()
    const github = useGithubIntegrationContext()
    const forge = useAtomValue(projectForgeAtom)
    const [sidebarViewMode, setSidebarViewMode] = useAtom(sidebarViewModeAtom)
    const forgeIntegration = useForgeIntegrationContext()
    const [forgeWritebackSessionId, setForgeWritebackSessionId] = useState<string | null>(null)
    const {
        sessions,
        allSessions,
        loading,
        filterMode,
        searchQuery,
        isSearchVisible,
        setSearchQuery,
        setIsSearchVisible,
        optimisticallyConvertSessionToSpec,
        mergeDialogState,
        openMergeDialog,
        closeMergeDialog,
        confirmMerge,
        getMergeStatus,
        autoCancelAfterMerge,
        updateAutoCancelAfterMerge,
        autoCancelAfterPr,
        updateAutoCancelAfterPr,
        isSessionMutating,
    } = useSessions()
    const { isResetting, resettingSelection, resetSession, switchModel } = useSessionManagement()
    const { getOrchestratorAgentType } = useClaudeSession()
    const { updateEpic, deleteEpic } = useEpics()

    // Get dynamic shortcut for Orchestrator
    const orchestratorShortcut = useShortcutDisplay(KeyboardShortcutAction.SwitchToOrchestrator)

    const normalizeAgentType = useCallback((value: string | AgentType | undefined | null): AgentType => {
        if (value && AGENT_TYPES.includes(value as AgentType)) {
            return value as AgentType
        }
        return DEFAULT_AGENT
    }, [])

    const [sessionsWithNotifications, setSessionsWithNotifications] = useState<Set<string>>(new Set())
    const [editingEpic, setEditingEpic] = useState<Epic | null>(null)
    const [deleteEpicTarget, setDeleteEpicTarget] = useState<Epic | null>(null)
    const [deleteEpicLoading, setDeleteEpicLoading] = useState(false)
    const [epicMenuOpenId, setEpicMenuOpenId] = useState<string | null>(null)
    const inlineDiffDefault = useAtomValue(inlineSidebarDefaultPreferenceAtom)
    const projectPathRef = useRef(projectPath)

    useEffect(() => {
        projectPathRef.current = projectPath
    }, [projectPath])
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState<SwitchOrchestratorModalState>({ open: false })
    const [switchModelSessionId, setSwitchModelSessionId] = useState<string | null>(null)
    const orchestratorResetting = resettingSelection?.kind === 'orchestrator'
    const orchestratorRunning = isSessionRunning('orchestrator')
    const leftSidebarShortcut = useShortcutDisplay(KeyboardShortcutAction.ToggleLeftSidebar)

    const { updateAllSessionsFromParent } = useUpdateSessionFromParent()
    const openMergeDialogWithPrefill = useSetAtom(openMergeDialogActionAtom)

    const {
        state: prDialogState,
        close: handleClosePrModal,
        confirm: handleConfirmPr,
        handlePrShortcut,
    } = usePrDialogController({ autoCancelAfterPr, createSafeUnlistener })

    const {
        state: gitlabMrDialogState,
        open: handleOpenGitlabMrModal,
        close: handleCloseGitlabMrModal,
    } = useGitlabMrDialogController({ createSafeUnlistener })

    const {
        setMergeCommitDrafts,
        activeMergeCommitDraft,
        updateActiveMergeCommitDraft,
        handleMergeShortcut,
        isSessionMerging,
        handleMergeSession,
        handleResolveMergeInAgentSession,
    } = useSidebarMergeOrchestration({
        allSessions,
        selection,
        terminals,
        mergeDialogState,
        openMergeDialog,
        closeMergeDialog,
        setSelection,
        setFocusForSession,
        setCurrentFocus,
    })

    const sidebarRef = useRef<HTMLDivElement>(null)
    const sessionListRef = useRef<HTMLDivElement>(null)
    const sessionScrollTopRef = useRef(0)
    const latestSessionsRef = useRef(allSessions)
    const lastRemovedSessionRef = useRef<string | null>(null)
    const lastMergedReadySessionRef = useRef<string | null>(null)

    useEffect(() => { latestSessionsRef.current = allSessions }, [allSessions])

    const {
        collapsedEpicIds,
        collapsedSections,
        getCollapsedEpicKey,
        toggleEpicCollapsed,
        toggleSectionCollapsed,
    } = useSidebarCollapsePersistence(projectPath)

    const {
        modalState: convertToSpecModal,
        setModalState: setConvertToDraftModal,
        closeModal: closeConvertToSpecModal,
        openFromShortcut: openConvertToSpecModalFromShortcut,
    } = useConvertToSpecController({ sessions, selection, projectPathRef })

    const { sectionGroups, flattenedSessions, selectionScopedSessions } = useSidebarSectionedSessions({
        sessions,
        collapsedSections,
        collapsedEpicIds,
        getCollapsedEpicKey,
    })

    useMergeModalListener({
        createSafeUnlistener,
        setMergeCommitDrafts,
        openMergeDialogWithPrefill,
    })

    useSidebarSelectionMemory({
        projectPath,
        selection,
        setSelection,
        allSessions,
        selectionScopedSessions,
        filterMode,
        latestSessionsRef,
        lastRemovedSessionRef,
        lastMergedReadySessionRef,
    })

    const { orchestratorBranch } = useOrchestratorBranch({
        selection,
        projectPathRef,
        createSafeUnlistener,
    })

    const {
        handleSelectOrchestrator,
        handleSelectSession,
        handleCancelSelectedSession,
        selectPrev,
        selectNext,
    } = useSidebarSelectionActions({
        sessions,
        flattenedSessions,
        selection,
        setSelection,
        setSessionsWithNotifications,
    })

    const { handleRenameSession, handleLinkPr } = useSessionEditCallbacks()

    const handleSpecSelectedSession = openConvertToSpecModalFromShortcut

    const {
        modalState: promoteVersionModal,
        selectBestVersion: handleSelectBestVersion,
        promoteSelected: handlePromoteSelectedVersion,
        closeModal: closePromoteVersionModal,
        confirmModal: confirmPromoteVersionModal,
    } = useVersionPromotionController({ sessions, selection, projectPathRef })

    const {
        triggerJudge: handleTriggerConsolidationJudge,
        confirmWinner: handleConfirmConsolidationWinner,
    } = useConsolidationActions()

    const orchestratorEntryActions = useOrchestratorEntryActions({
        selection,
        terminals,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        getOrchestratorAgentType,
        normalizeAgentType,
        resetSession,
    })

    const { runRefineSpecFlow, handleRefineSpecShortcut } = useRefineSpecFlow({
        sessions,
        selection,
        isAnyModalOpen,
        setSelection,
        setFocusForSession,
        setCurrentFocus,
    })

    const improvePlanAction = useImprovePlanAction({ logContext: 'Sidebar' })

    useSidebarKeyboardShortcuts({
        sessions,
        allSessions,
        selection,
        terminals,
        isResetting,
        inlineDiffDefault,
        isAnyModalOpen,
        isDiffViewerOpen,
        forge,
        githubCanCreatePr: github.canCreatePr,
        flattenedSessionsCount: flattenedSessions.length,
        openTabsCount: openTabs.length,
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
    })

    const { handleSessionScroll } = useSessionScrollIntoView({
        selection,
        isCollapsed,
        sidebarRef,
        sessionListRef,
        sessionScrollTopRef,
    })

    useSidebarBackendEvents({
        createSafeUnlistener,
        latestSessionsRef,
        lastRemovedSessionRef,
        lastMergedReadySessionRef,
        setSessionsWithNotifications,
        setSelection,
        setFocusForSession,
        setCurrentFocus,
    })

    const sessionCardActions = useMemo(() => buildSessionCardActions({
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
    }), [
        sessions,
        selection,
        terminals,
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
    ])

    return (
        <div
            ref={sidebarRef}
            className="h-full flex flex-col min-h-0"
            onDoubleClick={() => {
                if (isCollapsed && onExpandRequest) {
                    onExpandRequest()
                }
            }}
        >
            <SidebarHeaderBar
                isCollapsed={isCollapsed}
                sidebarViewMode={sidebarViewMode}
                setSidebarViewMode={setSidebarViewMode}
                leftSidebarShortcut={leftSidebarShortcut}
                onToggleSidebar={onToggleSidebar}
            />

            <OrchestratorEntry
                isCollapsed={isCollapsed}
                isSelected={selection.kind === 'orchestrator'}
                isRunning={orchestratorRunning}
                isResetting={orchestratorResetting}
                branch={orchestratorBranch}
                shortcut={orchestratorShortcut}
                onSelect={() => { void handleSelectOrchestrator() }}
                onSwitchModel={orchestratorEntryActions.onSwitchModel}
                onReset={orchestratorEntryActions.onReset}
            />

            <SidebarSearchBar
                isCollapsed={isCollapsed}
                isSearchVisible={isSearchVisible}
                setIsSearchVisible={setIsSearchVisible}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                sessionCount={sessions.length}
                selection={selection}
            />
            <SidebarSessionList
                listRef={sessionListRef}
                isCollapsed={isCollapsed}
                loading={loading}
                sidebarViewMode={sidebarViewMode}
                selection={selection}
                sessions={sessions}
                flattenedSessions={flattenedSessions}
                sectionGroups={sectionGroups}
                collapsedSections={collapsedSections}
                collapsedEpicIds={collapsedEpicIds}
                epicMenuOpenId={epicMenuOpenId}
                setEpicMenuOpenId={setEpicMenuOpenId}
                getCollapsedEpicKey={getCollapsedEpicKey}
                onToggleEpicCollapsed={toggleEpicCollapsed}
                onToggleSectionCollapsed={toggleSectionCollapsed}
                onEditEpic={setEditingEpic}
                onDeleteEpic={setDeleteEpicTarget}
                sessionCardActions={sessionCardActions}
                sessionsWithNotifications={sessionsWithNotifications}
                resettingSelection={resettingSelection}
                isSessionRunning={isSessionRunning}
                isSessionMerging={isSessionMerging}
                getMergeStatus={getMergeStatus}
                isSessionMutating={isSessionMutating}
                onSelectSession={(sessionOrIndex) => { void handleSelectSession(sessionOrIndex) }}
                onSelectBestVersion={handleSelectBestVersion}
                onTriggerConsolidationJudge={handleTriggerConsolidationJudge}
                onConfirmConsolidationWinner={handleConfirmConsolidationWinner}
                onScroll={handleSessionScroll}
                onExpandRequest={onExpandRequest}
            />

            <SidebarModalsTrailer {...buildSidebarModalSlots({
                editingEpic,
                setEditingEpic,
                deleteEpicTarget,
                setDeleteEpicTarget,
                deleteEpicLoading,
                setDeleteEpicLoading,
                updateEpic,
                deleteEpic,
                convertToSpecModal,
                closeConvertToSpecModal,
                optimisticallyConvertSessionToSpec,
                setSelection,
                promoteVersionModal,
                closePromoteVersionModal,
                confirmPromoteVersionModal,
                mergeDialogState,
                activeMergeCommitDraft,
                closeMergeDialog,
                updateActiveMergeCommitDraft,
                confirmMerge,
                handleResolveMergeInAgentSession,
                autoCancelAfterMerge,
                updateAutoCancelAfterMerge,
                prDialogState,
                handleClosePrModal,
                handleConfirmPr,
                autoCancelAfterPr,
                updateAutoCancelAfterPr,
                gitlabMrDialogState,
                handleCloseGitlabMrModal,
                switchOrchestratorModal,
                setSwitchOrchestratorModal,
                switchModelSessionId,
                setSwitchModelSessionId,
                selection,
                terminals,
                clearTerminalTracking,
                clearTerminalStartedTracking,
                switchModel,
                forgeWritebackSessionId,
                setForgeWritebackSessionId,
                sessions,
                forgeIntegration,
            })} />
        </div>
    )
});
