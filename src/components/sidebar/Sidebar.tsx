import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { getPasteSubmissionOptions } from '../../common/terminalPaste'
import { invoke } from '@tauri-apps/api/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { EventPayloadMap, GitOperationPayload } from '../../common/events'
import { useSelection } from '../../hooks/useSelection'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { useSessions } from '../../hooks/useSessions'
import { captureSelectionSnapshot, SelectionMemoryEntry } from '../../utils/selectionMemory'
import { computeSelectionCandidate } from '../../utils/selectionPostMerge'
import { FilterMode } from '../../types/sessionFilters'
import { isSpec } from '../../utils/sessionFilters'
import { groupSessionsByVersion, SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import {
    flattenVersionGroups,
    groupVersionGroupsByEpic,
    splitVersionGroupsBySection,
    type SidebarSectionKey,
} from './helpers/versionGroupings'
import { createSelectionMemoryBuckets } from './helpers/selectionMemory'
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
import {
    SwitchOrchestratorModalState,
} from './helpers/modalState'

export { buildConsolidationGroupDetail }
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../types/errors'
import { UiEvent, emitUiEvent, listenUiEvent } from '../../common/uiEvents'
import { AGENT_TYPES, AgentType, type Epic } from '../../types/session'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useRun } from '../../contexts/RunContext'
import { useToast } from '../../common/toast/ToastProvider'
import { useModal } from '../../contexts/ModalContext'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { projectPathAtom } from '../../store/atoms/project'
import { useSessionMergeShortcut } from '../../hooks/useSessionMergeShortcut'
import { openMergeDialogActionAtom } from '../../store/atoms/sessions'
import { useUpdateSessionFromParent } from '../../hooks/useUpdateSessionFromParent'
import { DEFAULT_AGENT } from '../../constants/agents'
import { useEpics } from '../../hooks/useEpics'
import { projectForgeAtom } from '../../store/atoms/forge'
import { useImprovePlanAction } from '../../hooks/useImprovePlanAction'
import { getSessionLifecycleState } from '../../utils/sessionState'
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
    const { pushToast } = useToast()
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

    const [mergeCommitDrafts, setMergeCommitDrafts] = useState<Record<string, string>>({})
    const getCommitDraftForSession = useCallback(
        (sessionId: string) => mergeCommitDrafts[sessionId],
        [mergeCommitDrafts],
    )
    const { handleMergeShortcut, isSessionMerging } = useSessionMergeShortcut({
        getCommitDraftForSession,
    })
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

    const handleMergeSession = useCallback(
        (sessionId: string) => {
            if (isSessionMerging(sessionId)) return
            void openMergeDialog(sessionId)
        },
        [isSessionMerging, openMergeDialog]
    )

    const activeMergeSessionId = mergeDialogState.sessionName
    const activeMergeCommitDraft = activeMergeSessionId ? mergeCommitDrafts[activeMergeSessionId] ?? '' : ''

    const updateActiveMergeCommitDraft = useCallback(
        (value: string) => {
            if (!activeMergeSessionId) {
                return
            }
            setMergeCommitDrafts(prev => {
                if (!value) {
                    if (!(activeMergeSessionId in prev)) {
                        return prev
                    }
                    const { [activeMergeSessionId]: _removed, ...rest } = prev
                    return rest
                }
                if (prev[activeMergeSessionId] === value) {
                    return prev
                }
                return { ...prev, [activeMergeSessionId]: value }
            })
        },
        [activeMergeSessionId]
    )

    const handleResolveMergeInAgentSession = useCallback(async () => {
        const sessionName = mergeDialogState.sessionName
        const preview = mergeDialogState.preview
        if (!sessionName || !preview) {
            return
        }

        const session = allSessions.find(candidate => candidate.info.session_id === sessionName)
        if (!session) {
            return
        }

        const conflictingPaths = preview.conflictingPaths
        const parentBranch = preview.parentBranch || session.info.parent_branch || session.info.base_branch || 'main'
        const agentType = session.info.original_agent_type ?? undefined
        const { useBracketedPaste, needsDelayedSubmit } = getPasteSubmissionOptions(agentType)
        const baseTerminalId = (
            selection.kind === 'session'
            && selection.payload === sessionName
            && terminals.top
        )
            ? terminals.top
            : stableSessionTerminalId(sessionName, 'top')
        const terminalId = getActiveAgentTerminalId(sessionName) ?? baseTerminalId
        const conflictList = conflictingPaths.length > 0
            ? conflictingPaths.map(path => `- ${path}`).join('\n')
            : '- Run `git status` to inspect conflicted files'
        const prompt = [
            `Resolve the rebase conflicts in this session onto ${parentBranch}.`,
            '',
            'Conflicting files:',
            conflictList,
            '',
            'After resolving the conflicts, run:',
            'git rebase --continue',
        ].join('\n')

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
        selection.kind,
        selection.payload,
        setCurrentFocus,
        setFocusForSession,
        setSelection,
        terminals.top,
    ])

    const sidebarRef = useRef<HTMLDivElement>(null)
    const sessionListRef = useRef<HTMLDivElement>(null)
    const sessionScrollTopRef = useRef(0)
    const isProjectSwitching = useRef(false)
    const previousProjectPathRef = useRef<string | null>(null)

    const selectionMemoryRef = useRef<Map<string, Record<FilterMode, SelectionMemoryEntry>>>(new Map())

    const ensureProjectMemory = useCallback(() => {
      const key = projectPath || '__default__';
      if (!selectionMemoryRef.current.has(key)) {
        selectionMemoryRef.current.set(key, createSelectionMemoryBuckets());
      }
      return selectionMemoryRef.current.get(key)!;
    }, [projectPath]);

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

    const versionGroups = useMemo(() => groupSessionsByVersion(sessions), [sessions])
    const sectionGroups = useMemo(() => splitVersionGroupsBySection(versionGroups), [versionGroups])

    const getVisibleGroupsForSection = useCallback((section: SidebarSectionKey, groups: SessionVersionGroupType[]) => {
        const sectionGrouping = groupVersionGroupsByEpic(groups)
        const expandedEpicGroups = sectionGrouping.epicGroups.flatMap((group) => (
            collapsedEpicIds[getCollapsedEpicKey(section, group.epic.id)] ? [] : group.groups
        ))
        return [...expandedEpicGroups, ...sectionGrouping.ungroupedGroups]
    }, [collapsedEpicIds, getCollapsedEpicKey])

    const visibleSpecGroups = useMemo(
        () => getVisibleGroupsForSection('specs', sectionGroups.specs),
        [getVisibleGroupsForSection, sectionGroups.specs],
    )
    const visibleRunningGroups = useMemo(
        () => getVisibleGroupsForSection('running', sectionGroups.running),
        [getVisibleGroupsForSection, sectionGroups.running],
    )

    const flattenedSessions = useMemo(() => {
        const visibleGroups: SessionVersionGroupType[] = []
        if (!collapsedSections.specs) {
            visibleGroups.push(...visibleSpecGroups)
        }
        if (!collapsedSections.running) {
            visibleGroups.push(...visibleRunningGroups)
        }
        return flattenVersionGroups(visibleGroups)
    }, [collapsedSections, visibleRunningGroups, visibleSpecGroups])

    const selectionScopedSessions = useMemo(
        () => [...flattenVersionGroups(visibleSpecGroups), ...flattenVersionGroups(visibleRunningGroups)],
        [visibleSpecGroups, visibleRunningGroups],
    )

    useEffect(() => {
        if (previousProjectPathRef.current !== null && previousProjectPathRef.current !== projectPath) {
            isProjectSwitching.current = true
        }
        previousProjectPathRef.current = projectPath
    }, [projectPath]);

    useEffect(() => {
        let unsubscribe: (() => void) | null = null
        const attach = async () => {
            unsubscribe = await listenUiEvent(UiEvent.ProjectSwitchComplete, () => {
                isProjectSwitching.current = false
            })
        }
        void attach()
        return () => {
            unsubscribe?.()
        }
    }, []);

    useMergeModalListener({
        createSafeUnlistener,
        setMergeCommitDrafts,
        openMergeDialogWithPrefill,
    })

    // Maintain selection memory and choose the next best session when visibility changes.
    useEffect(() => {
        if (isProjectSwitching.current) {
            // Allow refocus even if the project switch completion event is delayed
            isProjectSwitching.current = false
        }

        const allSessionsSnapshot = allSessions.length > 0 ? allSessions : latestSessionsRef.current

        const memory = ensureProjectMemory();
        const entry = memory[filterMode];

        const visibleSessions = selectionScopedSessions
        const visibleIds = new Set(visibleSessions.map(s => s.info.session_id))
        const currentSelectionId = selection.kind === 'session' ? (selection.payload ?? null) : null

        const { previousSessions } = captureSelectionSnapshot(entry, visibleSessions)

        const removalCandidateFromEvent = lastRemovedSessionRef.current
        const mergedCandidate = lastMergedReadySessionRef.current

        const mergedSessionInfo = mergedCandidate
            ? allSessionsSnapshot.find(s => s.info.session_id === mergedCandidate)
            : undefined
        const mergedStillReady = Boolean(mergedSessionInfo?.info.ready_to_merge)

        const shouldAdvanceFromMerged = Boolean(
            mergedCandidate &&
            currentSelectionId === mergedCandidate &&
            !mergedStillReady
        )

        if (mergedCandidate && (!currentSelectionId || currentSelectionId !== mergedCandidate)) {
            lastMergedReadySessionRef.current = null
        }

        const shouldPreserveForReadyRemoval = false

        const currentSessionMovedToReady = false

        const effectiveRemovalCandidate = currentSessionMovedToReady && currentSelectionId
            ? currentSelectionId
            : removalCandidateFromEvent

        if (selection.kind === 'orchestrator') {
            entry.lastSelection = null
            if (!effectiveRemovalCandidate && !shouldAdvanceFromMerged) {
                return
            }
        }

        if (visibleSessions.length === 0) {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
            if (removalCandidateFromEvent) {
                lastRemovedSessionRef.current = null
            }
            if (shouldAdvanceFromMerged) {
                lastMergedReadySessionRef.current = null
            }
            return
        }

        if (selection.kind === 'session' && currentSelectionId && visibleIds.has(currentSelectionId) && !shouldAdvanceFromMerged) {
            entry.lastSelection = currentSelectionId
            if (lastRemovedSessionRef.current) {
                lastRemovedSessionRef.current = null
            }
            return
        }

        const rememberedId = entry.lastSelection
        const candidateId = computeSelectionCandidate({
            currentSelectionId,
            visibleSessions,
            previousSessions,
            rememberedId,
            removalCandidate: effectiveRemovalCandidate,
            mergedCandidate,
            shouldAdvanceFromMerged,
            shouldPreserveForReadyRemoval,
            allSessions: allSessionsSnapshot
        })

        if (candidateId) {
            entry.lastSelection = candidateId
            if (candidateId !== currentSelectionId) {
                const targetSession = visibleSessions.find(s => s.info.session_id === candidateId)
                    ?? allSessionsSnapshot.find(s => s.info.session_id === candidateId)
                if (targetSession) {
                    void setSelection({
                        kind: 'session',
                        payload: candidateId,
                        worktreePath: targetSession.info.worktree_path,
                        sessionState: getSessionLifecycleState(targetSession.info)
                    }, false, false)
                }
            }
        } else {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
        }

        if (removalCandidateFromEvent) {
            lastRemovedSessionRef.current = null
        }
        if (shouldAdvanceFromMerged) {
            lastMergedReadySessionRef.current = null
        }
    }, [allSessions, ensureProjectMemory, filterMode, selectionScopedSessions, selection, setSelection])

    const { orchestratorBranch } = useOrchestratorBranch({
        selection,
        projectPathRef,
        createSafeUnlistener,
    })

    const handleSelectOrchestrator = useCallback(async () => {
        await setSelection({ kind: 'orchestrator' }, false, true) // User clicked - intentional
    }, [setSelection])
    const handleSelectSession = async (sessionOrIndex: string | number) => {
        const session = typeof sessionOrIndex === 'number'
            ? flattenedSessions[sessionOrIndex]
            : flattenedSessions.find(s => s.info.session_id === sessionOrIndex)

        if (session) {
            const s = session.info
            
            // Clear follow-up message notification when user selects the session
            setSessionsWithNotifications(prev => {
                const updated = new Set(prev)
                updated.delete(s.session_id)
                return updated
            })
            
            // Directly set selection to minimize latency in switching
            await setSelection({
                kind: 'session',
                payload: s.session_id,
                worktreePath: s.worktree_path,
                sessionState: getSessionLifecycleState(s)
            }, false, true) // User clicked - intentional
        }
    }

    const handleCancelSelectedSession = (immediate: boolean) => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession) {
                const sessionDisplayName = getSessionDisplayName(selectedSession.info)
                // Check if it's a spec
                if (isSpec(selectedSession.info)) {
                    // For specs, always show confirmation dialog (ignore immediate flag)
                    emitUiEvent(UiEvent.SessionAction, {
                        action: 'delete-spec',
                        sessionId: selectedSession.info.session_id,
                        sessionName: selectedSession.info.session_id,
                        sessionDisplayName,
                        branch: selectedSession.info.branch,
                        hasUncommittedChanges: false,
                    })
                } else {
                    // For regular sessions, handle as before
                    if (immediate) {
                        // immediate cancel without modal
                        emitUiEvent(UiEvent.SessionAction, {
                            action: 'cancel-immediate',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false,
                        })
                    } else {
                        emitUiEvent(UiEvent.SessionAction, {
                            action: 'cancel',
                            sessionId: selectedSession.info.session_id,
                            sessionName: selectedSession.info.session_id,
                            sessionDisplayName,
                            branch: selectedSession.info.branch,
                            hasUncommittedChanges: selectedSession.info.has_uncommitted_changes || false,
                        })
                    }
                }
            }
        }
    }

    const selectPrev = async () => {
        if (sessions.length === 0) return

        if (selection.kind === 'session') {
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            if (currentIndex <= 0) {
                await handleSelectOrchestrator()
                return
            }
            await handleSelectSession(currentIndex - 1)
        }
    }

    const selectNext = async () => {
        if (sessions.length === 0) return

        if (selection.kind === 'orchestrator') {
            await handleSelectSession(0)
            return
        }

        if (selection.kind === 'session') {
            const currentIndex = flattenedSessions.findIndex(s => s.info.session_id === selection.payload)
            const nextIndex = Math.min(currentIndex + 1, flattenedSessions.length - 1)
            if (nextIndex != currentIndex) {
                await handleSelectSession(nextIndex)
            }
        }
    }

    const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreRenameSessionDisplayName, {
                sessionId,
                newDisplayName: newName
            })
        } catch (error) {
            logger.error('Failed to rename session:', error)
            throw error
        }
    }, [])

    const handleLinkPr = useCallback(async (sessionId: string, prNumber: number, prUrl: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreLinkSessionToPr, {
                name: sessionId,
                prNumber,
                prUrl
            })
        } catch (error) {
            logger.error('Failed to link session to PR:', error)
        }
    }, [])

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
                    targetSessionId: null
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
        normalizeAgentType
    ])

    const handleCreatePullRequestShortcut = useCallback(() => {
        if (forge === 'gitlab') {
            if (selection.kind !== 'session' || !selection.payload) return
            handleOpenGitlabMrModal(selection.payload)
            return
        }
        if (!github.canCreatePr) return
        void handlePrShortcut()
    }, [forge, selection, github.canCreatePr, handlePrShortcut, handleOpenGitlabMrModal])

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

    const improvePlanAction = useImprovePlanAction({ logContext: 'Sidebar' })

    const handleRefineSpecShortcut = useCallback(() => {
        if (isAnyModalOpen()) return
        if (selection.kind !== 'session' || !selection.payload) return
        const session = sessions.find(s => s.info.session_id === selection.payload)
        if (!session || !isSpec(session.info)) return
        runRefineSpecFlow(selection.payload)
    }, [isAnyModalOpen, selection, sessions, runRefineSpecFlow])

    useKeyboardShortcuts({
        onSelectOrchestrator: () => { void handleSelectOrchestrator() },
        onSelectSession: (index) => { void handleSelectSession(index) },
        onCancelSelectedSession: handleCancelSelectedSession,
        onRefineSpec: handleRefineSpecShortcut,
        onSpecSession: handleSpecSelectedSession,
        onPromoteSelectedVersion: () => { void handlePromoteSelectedVersion() },
        sessionCount: flattenedSessions.length,
        onSelectPrevSession: () => { void selectPrev() },
        onSelectNextSession: () => { void selectNext() },
        onFocusSidebar: () => {
            setCurrentFocus('sidebar')
            // Focus the first button in the sidebar
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
            // Don't dispatch focus events if any modal is open
            if (isAnyModalOpen()) {
                return
            }
            
            const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : (selection.payload || 'unknown')
            setFocusForSession(sessionKey, 'terminal')
            setCurrentFocus('terminal')
            emitUiEvent(UiEvent.FocusTerminal)
        },
        projectCount: openTabs.length,
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
        isModalOpen: isAnyModalOpen()
    })

    // Selection is now restored by the selection state atoms

    // No longer need to listen for events - context handles everything

    // Keep latest values in refs for use in event handlers without re-attaching listeners
    const latestSessionsRef = useRef(allSessions)
    const lastRemovedSessionRef = useRef<string | null>(null)
    const lastMergedReadySessionRef = useRef<string | null>(null)

    useEffect(() => { latestSessionsRef.current = allSessions }, [allSessions])

    // Scroll selected session into view when selection changes
    useLayoutEffect(() => {
        if (selection.kind !== 'session') return

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const selectedElement = sidebarRef.current?.querySelector(`[data-session-selected="true"]`)
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest'
                    })
                    if (sessionListRef.current) {
                        sessionScrollTopRef.current = sessionListRef.current.scrollTop
                    }
                }
            })
        })
    }, [selection])

    const handleSessionScroll = useCallback((event: { currentTarget: { scrollTop: number } }) => {
        sessionScrollTopRef.current = event.currentTarget.scrollTop
    }, [])

    useEffect(() => {
        const node = sessionListRef.current
        if (node) {
            node.scrollTop = sessionScrollTopRef.current
        }
    }, [isCollapsed])

    // Subscribe to backend push updates and merge into sessions list incrementally
    useEffect(() => {
        let disposed = false
        const unlisteners: UnlistenFn[] = []

        const register = async <E extends SchaltEvent>(
            event: E,
            handler: (payload: EventPayloadMap[E]) => void | Promise<void>
        ) => {
            try {
                const unlisten = await listenEvent(event, async (payload) => {
                    if (!disposed) {
                        await handler(payload)
                    }
                })
                const safeUnlisten = createSafeUnlistener(unlisten)
                if (disposed) {
                    safeUnlisten()
                } else {
                    unlisteners.push(safeUnlisten)
                }
            } catch (e) {
                logger.warn('Failed to attach sidebar event listener', e)
            }
        }

        // Activity and git stats updates are handled by the sessions atoms layer

        void register(SchaltEvent.SessionRemoved, (event) => {
            lastRemovedSessionRef.current = event.session_name
        })

        void register(SchaltEvent.GitOperationCompleted, (event: GitOperationPayload) => {
            if (event?.operation === 'merge') {
                lastMergedReadySessionRef.current = event.session_name
            }
        })

        void register(SchaltEvent.FollowUpMessage, (event) => {
            const { session_name, message, message_type } = event

            setSessionsWithNotifications(prev => new Set([...prev, session_name]))

            const session = latestSessionsRef.current.find(s => s.info.session_id === session_name)
            if (session) {
            void setSelection({
                kind: 'session',
                payload: session_name,
                worktreePath: session.info.worktree_path,
                sessionState: getSessionLifecycleState(session.info)
            }, false, true)
                setFocusForSession(session_name, 'claude')
                setCurrentFocus('claude')
            }

            logger.info(`📬 Follow-up message for ${session_name}: ${message}`)

            if (message_type === 'system') {
                logger.info(`📢 System message for session ${session_name}: ${message}`)
            } else {
                logger.info(`💬 User message for session ${session_name}: ${message}`)
            }
        })

        return () => {
            disposed = true
            unlisteners.forEach(unlisten => {
                try {
                    unlisten()
                } catch (error) {
                    logger.warn('[Sidebar] Failed to remove event listener during cleanup', error)
                }
            })
        }
    }, [setCurrentFocus, setFocusForSession, setSelection, createSafeUnlistener])

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
                onSwitchModel={() => {
                    setSwitchModelSessionId(null)
                    void getOrchestratorAgentType().then((initialAgentType) => {
                        setSwitchOrchestratorModal({
                            open: true,
                            initialAgentType: normalizeAgentType(initialAgentType),
                            targetSessionId: null,
                        })
                    })
                }}
                onReset={() => {
                    void (async () => {
                        if (selection.kind === 'orchestrator') {
                            await resetSession(selection, terminals)
                        }
                    })()
                }}
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

            <SidebarModalsTrailer
                epic={{
                    editing: editingEpic,
                    deleteTarget: deleteEpicTarget,
                    deleteLoading: deleteEpicLoading,
                    onCloseEdit: () => setEditingEpic(null),
                    onSubmitEdit: async ({ name, color }) => {
                        if (!editingEpic) {
                            throw new Error('No epic selected')
                        }
                        await updateEpic(editingEpic.id, name, color)
                    },
                    onCloseDelete: () => {
                        if (deleteEpicLoading) return
                        setDeleteEpicTarget(null)
                    },
                    onConfirmDelete: () => {
                        if (!deleteEpicTarget || deleteEpicLoading) return
                        void (async () => {
                            setDeleteEpicLoading(true)
                            try {
                                await deleteEpic(deleteEpicTarget.id)
                                setDeleteEpicTarget(null)
                            } finally {
                                setDeleteEpicLoading(false)
                            }
                        })()
                    },
                }}
                convertToSpec={{
                    state: convertToSpecModal,
                    onClose: closeConvertToSpecModal,
                    onSuccess: (newSpecName) => {
                        if (convertToSpecModal.sessionName) {
                            optimisticallyConvertSessionToSpec(convertToSpecModal.sessionName)
                        }
                        if (newSpecName) {
                            void setSelection(
                                {
                                    kind: 'session',
                                    payload: newSpecName,
                                    sessionState: 'spec',
                                },
                                true,
                                true,
                            )
                        }
                    },
                }}
                promote={{
                    state: promoteVersionModal,
                    onClose: closePromoteVersionModal,
                    onConfirm: confirmPromoteVersionModal,
                }}
                merge={{
                    state: mergeDialogState,
                    commitDraft: activeMergeCommitDraft,
                    onClose: closeMergeDialog,
                    onCommitMessageChange: updateActiveMergeCommitDraft,
                    onConfirm: (mode, commitMessage) => {
                        if (mergeDialogState.sessionName) {
                            void confirmMerge(mergeDialogState.sessionName, mode, commitMessage)
                        }
                    },
                    onResolveInAgentSession: () => { void handleResolveMergeInAgentSession() },
                    autoCancelEnabled: autoCancelAfterMerge,
                    onToggleAutoCancel: (next) => { void updateAutoCancelAfterMerge(next) },
                }}
                pr={{
                    state: prDialogState,
                    onClose: handleClosePrModal,
                    onConfirm: (options) => { void handleConfirmPr(options) },
                    autoCancelEnabled: autoCancelAfterPr,
                    onToggleAutoCancel: (next) => { void updateAutoCancelAfterPr(next) },
                }}
                gitlabMr={{
                    state: gitlabMrDialogState,
                    onClose: handleCloseGitlabMrModal,
                }}
                switchOrchestrator={{
                    state: switchOrchestratorModal,
                    onClose: () => {
                        setSwitchOrchestratorModal({ open: false })
                        setSwitchModelSessionId(null)
                    },
                    onSwitch: async ({ agentType }) => {
                        const targetSelection = switchModelSessionId
                            ? { kind: 'session' as const, payload: switchModelSessionId }
                            : selection

                        await switchModel(agentType, targetSelection, terminals, clearTerminalTracking, clearTerminalStartedTracking, switchOrchestratorModal.initialAgentType)

                        setSwitchOrchestratorModal({ open: false })
                        setSwitchModelSessionId(null)
                    },
                }}
                forgeWriteback={{
                    sessionId: forgeWritebackSessionId,
                    sessions,
                    forgeIntegration,
                    onClose: () => setForgeWritebackSessionId(null),
                }}
            />
        </div>
    )
});
