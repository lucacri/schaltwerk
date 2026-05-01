import { useState, useEffect, useLayoutEffect, useRef, useCallback, useEffectEvent, useMemo, memo, type ReactNode } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { getPasteSubmissionOptions } from '../../common/terminalPaste'
import clsx from 'clsx'
import { invoke } from '@tauri-apps/api/core'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from '../../common/i18n/useTranslation'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useFocus } from '../../contexts/FocusContext'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { EventPayloadMap, GitOperationPayload, OpenGitlabMrModalPayload, OpenMergeModalPayload, OpenPrModalPayload, matchesProjectScope } from '../../common/events'
import { useSelection } from '../../hooks/useSelection'
import { clearTerminalStartedTracking } from '../terminal/Terminal'
import { useSessions } from '../../hooks/useSessions'
import { captureSelectionSnapshot, SelectionMemoryEntry } from '../../utils/selectionMemory'
import { computeSelectionCandidate } from '../../utils/selectionPostMerge'
import { ConvertToSpecConfirmation } from '../modals/ConvertToSpecConfirmation'
import { FilterMode } from '../../types/sessionFilters'
import { isSpec } from '../../utils/sessionFilters'
import { theme } from '../../common/theme'
import { groupSessionsByVersion, selectBestVersionAndCleanup, SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import {
    flattenVersionGroups,
    groupVersionGroupsByEpic,
    splitVersionGroupsBySection,
    type SidebarSectionKey,
} from './helpers/versionGroupings'
import { SessionVersionGroup } from './SessionVersionGroup'
import { CollapsedSidebarRail } from './CollapsedSidebarRail'
import { PromoteVersionConfirmation } from '../modals/PromoteVersionConfirmation'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'
import { MergeSessionModal } from '../modals/MergeSessionModal'
import { PrSessionModal, PrPreviewResponse, PrCreateOptions } from '../modals/PrSessionModal'
import { GitlabMrSessionModal } from '../modals/GitlabMrSessionModal'
import { useSessionPrShortcut } from '../../hooks/useSessionPrShortcut'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { VscRefresh, VscCode, VscLayoutSidebarLeft, VscLayoutSidebarLeftOff } from 'react-icons/vsc'
import { IconButton } from '../common/IconButton'
import { ProgressIndicator } from '../common/ProgressIndicator'
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
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'
import { projectPathAtom } from '../../store/atoms/project'
import { useSessionMergeShortcut } from '../../hooks/useSessionMergeShortcut'
import { openMergeDialogActionAtom } from '../../store/atoms/sessions'
import { useUpdateSessionFromParent } from '../../hooks/useUpdateSessionFromParent'
import { DEFAULT_AGENT } from '../../constants/agents'
import { extractPrNumberFromUrl } from '../../utils/githubUrls'
import { EpicModal } from '../modals/EpicModal'
import { ConfirmModal } from '../modals/ConfirmModal'
import { useEpics } from '../../hooks/useEpics'
import { EpicGroupHeader } from './EpicGroupHeader'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { getEpicAccentScheme } from '../../utils/epicColors'
import { projectForgeAtom } from '../../store/atoms/forge'
import { SessionCardActionsProvider, type SessionCardActions } from '../../contexts/SessionCardActionsContext'
import { useImprovePlanAction } from '../../hooks/useImprovePlanAction'
import { getSessionLifecycleState } from '../../utils/sessionState'
import { sidebarViewModeAtom } from '../../store/atoms/sidebarViewMode'
import { KanbanView } from './KanbanView'
import { KanbanSessionRow } from './KanbanSessionRow'
import { ForgeWritebackModal } from '../forge/ForgeWritebackModal'
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

type SidebarSectionCollapseState = Record<SidebarSectionKey, boolean>

export const buildConsolidationGroupDetail = (group: SessionVersionGroupType) => {
    const sourceVersions = group.versions.filter(version => !version.session.info.is_consolidation)
    const firstSession = sourceVersions[0]?.session?.info
    if (!firstSession) {
        return null
    }

    const groupEpicId = sourceVersions.find(version => version.session.info.epic?.id)?.session.info.epic?.id ?? null

    return {
        baseName: group.baseName,
        baseBranch: firstSession.base_branch,
        versionGroupId: firstSession.version_group_id ?? group.id,
        epicId: groupEpicId,
        sessions: sourceVersions.map(version => ({
            id: version.session.info.session_id,
            name: version.session.info.session_id,
            branch: version.session.info.branch,
            worktreePath: version.session.info.worktree_path,
            agentType: version.session.info.original_agent_type ?? undefined,
            diffStats: version.session.info.diff_stats ? {
                files_changed: version.session.info.diff_stats.files_changed,
                additions: version.session.info.diff_stats.additions,
                deletions: version.session.info.diff_stats.deletions,
            } : undefined,
        })),
    }
}

const DEFAULT_SECTION_COLLAPSE_STATE: SidebarSectionCollapseState = {
    specs: false,
    running: false,
}

const createSelectionMemoryBuckets = (): Record<FilterMode, SelectionMemoryEntry> => ({
    [FilterMode.All]: { lastSelection: null, lastSessions: [] },
    [FilterMode.Spec]: { lastSelection: null, lastSessions: [] },
    [FilterMode.Running]: { lastSelection: null, lastSessions: [] },
})

const normalizeSectionCollapseState = (value: unknown): SidebarSectionCollapseState => {
    if (!value || typeof value !== 'object') {
        return DEFAULT_SECTION_COLLAPSE_STATE
    }

    const record = value as Partial<Record<SidebarSectionKey, boolean>>
    return {
        specs: record.specs === true,
        running: record.running === true,
    }
}

export const Sidebar = memo(function Sidebar({ isDiffViewerOpen, openTabs = [], onSwitchToProject, onCycleNextProject, onCyclePrevProject, isCollapsed = false, onExpandRequest, onToggleSidebar }: SidebarProps) {
    const { t } = useTranslation()
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
    const [orchestratorBranch, setOrchestratorBranch] = useState<string>("main")
    const [editingEpic, setEditingEpic] = useState<Epic | null>(null)
    const [deleteEpicTarget, setDeleteEpicTarget] = useState<Epic | null>(null)
    const [deleteEpicLoading, setDeleteEpicLoading] = useState(false)
    const [epicMenuOpenId, setEpicMenuOpenId] = useState<string | null>(null)
    const [collapsedEpicIds, setCollapsedEpicIds] = useState<Record<string, boolean>>({})
    const inlineDiffDefault = useAtomValue(inlineSidebarDefaultPreferenceAtom)
    const projectPathRef = useRef(projectPath)

    useEffect(() => {
        projectPathRef.current = projectPath
    }, [projectPath])
    const fetchOrchestratorBranch = useEffectEvent(async () => {
        try {
            const projectPath = projectPathRef.current
            const branch = await invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName: null, ...(projectPath ? { projectPath } : {}) })
            setOrchestratorBranch(branch || "main")
        } catch (error) {
            logger.warn('Failed to get current branch, defaulting to main:', error)
            setOrchestratorBranch("main")
        }
    })
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState<{ open: boolean; initialAgentType?: AgentType; targetSessionId?: string | null }>({ open: false })
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

    const [prDialogState, setPrDialogState] = useState<{
        isOpen: boolean
        sessionName: string | null
        status: 'idle' | 'loading' | 'ready' | 'running'
        preview: PrPreviewResponse | null
        prefill?: {
            suggestedTitle?: string
            suggestedBody?: string
            suggestedBaseBranch?: string
            suggestedPrBranchName?: string
            suggestedMode?: 'squash' | 'reapply'
        }
        error: string | null
    }>({
        isOpen: false,
        sessionName: null,
        status: 'idle',
        preview: null,
        error: null,
    })

    const [gitlabMrDialogState, setGitlabMrDialogState] = useState<{
        isOpen: boolean
        sessionName: string | null
        prefill?: {
            suggestedTitle?: string
            suggestedBody?: string
            suggestedBaseBranch?: string
            suggestedSourceProject?: string
        }
    }>({
        isOpen: false,
        sessionName: null,
    })

    const handleOpenGitlabMrModal = useCallback((
        sessionName: string,
        prefill?: {
            suggestedTitle?: string
            suggestedBody?: string
            suggestedBaseBranch?: string
            suggestedSourceProject?: string
        }
    ) => {
        setGitlabMrDialogState({
            isOpen: true,
            sessionName,
            prefill,
        })
    }, [])

    const handleCloseGitlabMrModal = useCallback(() => {
        setGitlabMrDialogState({
            isOpen: false,
            sessionName: null,
        })
    }, [])

    const handleMergeSession = useCallback(
        (sessionId: string) => {
            if (isSessionMerging(sessionId)) return
            void openMergeDialog(sessionId)
        },
        [isSessionMerging, openMergeDialog]
    )

    const handleOpenPrModal = useCallback((
        sessionName: string,
        preview: PrPreviewResponse,
        prefill?: {
            suggestedTitle?: string
            suggestedBody?: string
            suggestedBaseBranch?: string
            suggestedPrBranchName?: string
            suggestedMode?: 'squash' | 'reapply'
        }
    ) => {
        setPrDialogState({
            isOpen: true,
            sessionName,
            status: 'ready',
            preview,
            prefill,
            error: null,
        })
    }, [])

    const handleClosePrModal = useCallback(() => {
        setPrDialogState({
            isOpen: false,
            sessionName: null,
            status: 'idle',
            preview: null,
            error: null,
        })
    }, [])

    const handleConfirmPr = useCallback(async (options: PrCreateOptions) => {
        const { sessionName, preview } = prDialogState
        if (!sessionName || !preview) return

        setPrDialogState(prev => ({ ...prev, status: 'running', error: null }))

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
                }
            })

            handleClosePrModal()
            if (result.url) {
                const prUrl = result.url
                const prNumber = extractPrNumberFromUrl(prUrl)
                if (prNumber) {
                    try {
                        await invoke(TauriCommands.SchaltwerkCoreLinkSessionToPr, {
                            name: sessionName,
                            prNumber,
                            prUrl
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
                pushToast({ tone: 'success', title: t.toasts.prCreated, description: t.toasts.prCreatedBranch.replace('{branch}', result.branch) })
            }
        } catch (error) {
            logger.error('Failed to create PR', error)
            const message = error instanceof Error ? error.message : String(error)
            setPrDialogState(prev => ({ ...prev, status: 'ready', error: message }))
        }
    }, [prDialogState, autoCancelAfterPr, handleClosePrModal, pushToast])

    const { handlePrShortcut } = useSessionPrShortcut({
        onOpenModal: handleOpenPrModal,
    })

    const [convertToSpecModal, setConvertToDraftModal] = useState<{ 
        open: boolean; 
        sessionName: string; 
        projectPath?: string | null;
        sessionDisplayName?: string;
        hasUncommitted: boolean 
    }>({
        open: false,
        sessionName: '',
        projectPath: null,
        hasUncommitted: false
    })
    
    const [promoteVersionModal, setPromoteVersionModal] = useState<{
        open: boolean
        versionGroup: SessionVersionGroupType | null
        selectedSessionId: string
    }>({
        open: false,
        versionGroup: null,
        selectedSessionId: ''
    })
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

    const epicCollapseStorageKey = useMemo(
        () => (projectPath ? `schaltwerk:epic-collapse:${projectPath}` : null),
        [projectPath],
    )
    const sectionCollapseStorageKey = useMemo(
        () => (projectPath ? `schaltwerk:sidebar-sections:${projectPath}` : null),
        [projectPath],
    )
    const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(DEFAULT_SECTION_COLLAPSE_STATE)

    useEffect(() => {
        if (!epicCollapseStorageKey) {
            setCollapsedEpicIds({})
            return
        }
        try {
            const raw = localStorage.getItem(epicCollapseStorageKey)
            if (!raw) {
                setCollapsedEpicIds({})
                return
            }
            const parsed = JSON.parse(raw) as Record<string, boolean>
            setCollapsedEpicIds(parsed ?? {})
        } catch (err) {
            logger.warn('[Sidebar] Failed to load epic collapse state, resetting:', err)
            setCollapsedEpicIds({})
        }
    }, [epicCollapseStorageKey])

    useEffect(() => {
        if (!epicCollapseStorageKey) {
            return
        }
        try {
            localStorage.setItem(epicCollapseStorageKey, JSON.stringify(collapsedEpicIds))
        } catch (err) {
            logger.warn('[Sidebar] Failed to persist epic collapse state:', err)
        }
    }, [epicCollapseStorageKey, collapsedEpicIds])

    useEffect(() => {
        if (!sectionCollapseStorageKey) {
            setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
            return
        }
        try {
            const raw = localStorage.getItem(sectionCollapseStorageKey)
            if (!raw) {
                setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
                return
            }
            setCollapsedSections(normalizeSectionCollapseState(JSON.parse(raw)))
        } catch (err) {
            logger.warn('[Sidebar] Failed to load section collapse state, resetting:', err)
            setCollapsedSections(DEFAULT_SECTION_COLLAPSE_STATE)
        }
    }, [sectionCollapseStorageKey])

    useEffect(() => {
        if (!sectionCollapseStorageKey) {
            return
        }
        try {
            localStorage.setItem(sectionCollapseStorageKey, JSON.stringify(collapsedSections))
        } catch (err) {
            logger.warn('[Sidebar] Failed to persist section collapse state:', err)
        }
    }, [sectionCollapseStorageKey, collapsedSections])

    const getCollapsedEpicKey = useCallback((section: SidebarSectionKey, epicId: string) => `${section}:${epicId}`, [])

    const toggleEpicCollapsed = useCallback((section: SidebarSectionKey, epicId: string) => {
        const key = getCollapsedEpicKey(section, epicId)
        setCollapsedEpicIds((prev) => {
            const next = { ...prev }
            if (next[key]) {
                delete next[key]
            } else {
                next[key] = true
            }
            return next
        })
    }, [getCollapsedEpicKey])

    const toggleSectionCollapsed = useCallback((section: SidebarSectionKey) => {
        setCollapsedSections((prev) => ({
            ...prev,
            [section]: !prev[section],
        }))
    }, [])

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

    const createSafeUnlistener = useCallback((fn: UnlistenFn): UnlistenFn => {
        let called = false
        return () => {
            if (called) return
            called = true
            try {
                void Promise.resolve(fn()).catch(error => {
                    logger.warn('Failed to unlisten sidebar event', error)
                })
            } catch (error) {
                logger.warn('Failed to unlisten sidebar event', error)
            }
        }
    }, [])

    useEffect(() => {
        let unlistenOpenPrModal: UnlistenFn | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.OpenPrModal, async (payload: OpenPrModalPayload) => {
                    try {
                        const preview = await invoke<PrPreviewResponse>(TauriCommands.GitHubPreviewPr, {
                            sessionName: payload.sessionName,
                        })
                        handleOpenPrModal(payload.sessionName, preview, {
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
                unlistenOpenPrModal = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for OpenPrModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenOpenPrModal) {
                unlistenOpenPrModal()
            }
        }
    }, [createSafeUnlistener, handleOpenPrModal, pushToast])

    useEffect(() => {
        let unlistenOpenGitlabMrModal: UnlistenFn | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.OpenGitlabMrModal, (payload: OpenGitlabMrModalPayload) => {
                    handleOpenGitlabMrModal(payload.sessionName, {
                        suggestedTitle: payload.suggestedTitle,
                        suggestedBody: payload.suggestedBody,
                        suggestedBaseBranch: payload.suggestedBaseBranch,
                        suggestedSourceProject: payload.suggestedSourceProject,
                    })
                })
                unlistenOpenGitlabMrModal = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for OpenGitlabMrModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenOpenGitlabMrModal) {
                unlistenOpenGitlabMrModal()
            }
        }
    }, [createSafeUnlistener, handleOpenGitlabMrModal])

    useEffect(() => {
        let unlistenOpenMergeModal: UnlistenFn | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.OpenMergeModal, async (payload: OpenMergeModalPayload) => {
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
                unlistenOpenMergeModal = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for OpenMergeModal events:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenOpenMergeModal) {
                unlistenOpenMergeModal()
            }
        }
    }, [createSafeUnlistener, openMergeDialogWithPrefill, pushToast])

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

    useEffect(() => { void fetchOrchestratorBranch() }, [])

    useEffect(() => {
        if (selection.kind !== 'orchestrator') return
        void fetchOrchestratorBranch()
    }, [selection])

    useEffect(() => {
        let unlistenProjectReady: UnlistenFn | null = null
        let unlistenFileChanges: UnlistenFn | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.ProjectReady, () => { void fetchOrchestratorBranch() })
                unlistenProjectReady = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for project ready events:', error)
            }

            try {
                const unlisten = await listenEvent(SchaltEvent.FileChanges, event => {
                    if (!matchesProjectScope(event.project_path, projectPathRef.current)) {
                        return
                    }
                    if (event.session_name === ORCHESTRATOR_SESSION_NAME) {
                        setOrchestratorBranch(event.branch_info.current_branch || 'HEAD')
                    }
                })
                unlistenFileChanges = createSafeUnlistener(unlisten)
            } catch (error) {
                logger.warn('Failed to listen for orchestrator file changes:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenProjectReady) {
                unlistenProjectReady()
            }
            if (unlistenFileChanges) {
                unlistenFileChanges()
            }
        }
    }, [createSafeUnlistener])

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

    const handleSpecSelectedSession = () => {
        if (selection.kind === 'session') {
            const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
            if (selectedSession && !isSpec(selectedSession.info)) {
                setConvertToDraftModal({
                    open: true,
                    sessionName: selectedSession.info.session_id,
                    projectPath: projectPathRef.current,
                    sessionDisplayName: getSessionDisplayName(selectedSession.info),
                    hasUncommitted: selectedSession.info.has_uncommitted_changes || false
                })
            }
        }
    }

    const handleSelectBestVersion = (groupBaseName: string, selectedSessionId: string) => {
        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g => g.baseName === groupBaseName)
        
        if (!targetGroup) {
            logger.error(`Version group ${groupBaseName} not found`)
            return
        }

        // Check if user has opted out of confirmation for this project
        const noConfirmKey = `promote-version-no-confirm-${groupBaseName}`
        const skipConfirmation = localStorage.getItem(noConfirmKey) === 'true'
        
        if (skipConfirmation) {
            // Execute directly without confirmation
            void executeVersionPromotion(targetGroup, selectedSessionId)
        } else {
            // Show confirmation modal
            setPromoteVersionModal({
                open: true,
                versionGroup: targetGroup,
                selectedSessionId
            })
        }
    }

    const executeVersionPromotion = async (targetGroup: SessionVersionGroupType, selectedSessionId: string) => {
        try {
            await selectBestVersionAndCleanup(targetGroup, selectedSessionId, invoke, projectPathRef.current)
        } catch (error) {
            logger.error('Failed to select best version:', error)
            alert(`Failed to select best version: ${error}`)
        }
    }

    const handleTriggerConsolidationJudge = useCallback(async (roundId: string, early = false) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreTriggerConsolidationJudge, {
                roundId,
                early,
            })
            pushToast({
                tone: 'success',
                title: 'Consolidation judge started',
                description: early ? 'Judge launched before all candidates completed.' : 'Judge launched for completed consolidation candidates.',
            })
        } catch (error) {
            logger.error('Failed to trigger consolidation judge:', error)
            pushToast({
                tone: 'error',
                title: 'Failed to start judge',
                description: String(error),
            })
        }
    }, [pushToast])

    const handleConfirmConsolidationWinner = useCallback(async (roundId: string, winnerSessionId: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreConfirmConsolidationWinner, {
                roundId,
                winnerSessionId,
            })
            pushToast({
                tone: 'success',
                title: 'Consolidation winner confirmed',
                description: `Confirmed ${winnerSessionId} for round ${roundId}.`,
            })
        } catch (error) {
            logger.error('Failed to confirm consolidation winner:', error)
            pushToast({
                tone: 'error',
                title: 'Failed to confirm winner',
                description: String(error),
            })
        }
    }, [pushToast])

    const handlePromoteSelectedVersion = () => {
        if (selection.kind !== 'session' || !selection.payload) {
            return // No session selected
        }

        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g => 
            g.isVersionGroup && g.versions.some(v => v.session.info.session_id === selection.payload)
        )
        
        if (!targetGroup) {
            return // Selected session is not within a version group
        }

        handleSelectBestVersion(targetGroup.baseName, selection.payload)
    }

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

    const sessionCardActions: SessionCardActions = {
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
                    hasUncommitted: session.info.has_uncommitted_changes || false
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
    }

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
            <div className={clsx('flex items-center shrink-0 h-9', isCollapsed ? 'justify-center px-0' : 'justify-between px-2 pt-2')}>
                {!isCollapsed && (
                    <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider ml-1">{t.sidebar.header}</span>
                )}
                {!isCollapsed && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            void setSidebarViewMode(sidebarViewMode === 'board' ? 'list' : 'board')
                        }}
                        data-testid="sidebar-view-mode-toggle"
                        className="h-6 px-2 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors text-[11px] uppercase tracking-wider"
                        title={sidebarViewMode === 'board' ? 'Switch to list view' : 'Switch to board view'}
                        aria-label={sidebarViewMode === 'board' ? 'Switch to list view' : 'Switch to board view'}
                        aria-pressed={sidebarViewMode === 'board'}
                    >
                        {sidebarViewMode === 'board' ? 'Board' : 'List'}
                    </button>
                )}
                {onToggleSidebar && (
                    <div className="flex items-center gap-2">
                        {!isCollapsed && leftSidebarShortcut && (
                            <span className="text-[11px] text-text-muted" aria-hidden="true">
                                {leftSidebarShortcut}
                            </span>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onToggleSidebar()
                            }}
                            className={clsx(
                                "h-6 w-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors",
                                !isCollapsed && "ml-auto"
                            )}
                            title={isCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                            aria-label={isCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                        >
                            {isCollapsed ? <VscLayoutSidebarLeftOff /> : <VscLayoutSidebarLeft />}
                        </button>
                    </div>
                )}
            </div>

            <div className={clsx('pt-1', isCollapsed ? 'px-1' : 'px-2')}>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { void handleSelectOrchestrator() }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void handleSelectOrchestrator()
                        }
                    }}
                    className={clsx(
                        'w-full text-left py-2 rounded-md mb-1 group border transition-all duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-bg-secondary',
                        isCollapsed ? 'px-0 justify-center flex' : 'px-3',
                        selection.kind === 'orchestrator'
                            ? 'bg-bg-elevated/60 session-ring session-ring-blue border-transparent'
                            : 'hover:bg-bg-hover/30 border-border-subtle',
                        orchestratorRunning && selection.kind !== 'orchestrator' &&
                            'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20'
                    )}
                    aria-label={`${t.ariaLabels.selectOrchestrator} (⌘1)`}
                    aria-pressed={selection.kind === 'orchestrator'}
                    data-onboarding="orchestrator-entry"
                >
                    <div className={clsx('flex items-center w-full', isCollapsed ? 'flex-col justify-center gap-1' : 'justify-between')}>
                        {!isCollapsed && (
                            <>
                                <div className="font-medium text-text-primary flex items-center gap-2">
                                    {t.sidebar.orchestrator}
                                    {orchestratorRunning && (
                                        <ProgressIndicator size="sm" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-0.5">
                                        <IconButton
                                            icon={<VscCode />}
                                            onClick={() => {
                                                setSwitchModelSessionId(null)
                                                void getOrchestratorAgentType().then((initialAgentType) => {
                                                    setSwitchOrchestratorModal({
                                                        open: true,
                                                        initialAgentType: normalizeAgentType(initialAgentType),
                                                        targetSessionId: null
                                                    })
                                                })
                                            }}
                                            ariaLabel="Switch orchestrator model"
                                            tooltip="Switch model (⌘P)"
                                        />
                                        <IconButton
                                            icon={<VscRefresh />}
                                            onClick={() => {
                                                void (async () => {
                                                    if (selection.kind === 'orchestrator') {
                                                        await resetSession(selection, terminals)
                                                    }
                                                })()
                                            }}
                                            ariaLabel="Reset orchestrator"
                                            tooltip="Reset orchestrator (⌘Y)"
                                            disabled={orchestratorResetting}
                                        />
                                    </div>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-bg-hover/50 text-text-tertiary">
                                        {orchestratorShortcut || '⌘1'}
                                    </span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-accent-blue">{orchestratorBranch}</span>
                                </div>
                            </>
                        )}
                        {isCollapsed && (
                            <>
                                <div className="text-text-tertiary">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                </div>
                                <span className="text-[9px] text-accent-blue font-mono max-w-full truncate">
                                    {(orchestratorBranch === 'main' || orchestratorBranch === 'master') ? 'main' : (orchestratorBranch || 'brch')}
                                </span>
                                {orchestratorRunning && (
                                    <div className="mt-1"><ProgressIndicator size="sm" /></div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {!isCollapsed && (
                <div
                    className="h-8 px-3 border-t border-b text-xs flex items-center bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]"
                    data-onboarding="session-filter-row"
                >
                    <div className="flex items-center gap-2 w-full justify-end">
                        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
                            <button
                                onClick={() => {
                                            setIsSearchVisible(true)
                                            // Trigger OpenCode TUI resize workaround for the active context
                                            if (selection.kind === 'session' && selection.payload) {
                                                emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                            } else {
                                                emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                            }
                                            // Generic resize request for all terminals in the active context
                                            try {
                                                if (selection.kind === 'session' && selection.payload) {
                                                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                                } else {
                                                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                                }
                                            } catch (e) {
                                                logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search open)', e)
                                            }
                                }}
                                className={clsx(
                                    'px-1 py-0.5 rounded flex items-center flex-shrink-0 border border-transparent transition-colors',
                                    isSearchVisible
                                        ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border-default)]'
                                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                                )}
                                title={t.sidebar.search.title}
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Search Line - appears below filters when active */}
            {!isCollapsed && isSearchVisible && (
                <div className="h-8 px-3 border-b bg-[var(--color-bg-secondary)] border-[var(--color-border-subtle)] flex items-center">
                    <div className="flex items-center gap-2 w-full">
                        <svg className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                // Each search keystroke nudges OpenCode to repaint correctly for the active context
                                if (selection.kind === 'session' && selection.payload) {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                } else {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                }
                                try {
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                    } else {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                    }
                                } catch (e) {
                                    logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search type)', e)
                                }
                            }}
                            placeholder={t.sidebar.search.placeholder}
                            className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                            autoFocus
                        />
                        {searchQuery && (
                            <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                                {sessions.length} {sessions.length !== 1 ? t.sidebar.search.results : t.sidebar.search.result}
                            </span>
                        )}
                        <button
                            onClick={() => {
                                setSearchQuery('')
                                setIsSearchVisible(false)
                                // Also trigger a resize when closing search (layout shifts)
                                if (selection.kind === 'session' && selection.payload) {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
                                } else {
                                    emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
                                }
                                try {
                                    if (selection.kind === 'session' && selection.payload) {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
                                    } else {
                                        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                                    }
                                } catch (e) {
                                    logger.warn('[Sidebar] Failed to dispatch generic terminal resize request (search close)', e)
                                }
                            }}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-0.5"
                            title={t.sidebar.search.close}
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
            <div
                ref={sessionListRef}
                onScroll={handleSessionScroll}
                className={clsx(
                    'flex-1 min-h-0 overflow-y-auto pt-1',
                    isCollapsed ? 'px-0.5' : 'px-2'
                )}
                data-testid="session-scroll-container"
                data-onboarding="session-list"
            >
                {sessions.length === 0 && !loading ? (
                    <div className="text-center text-text-muted py-4">{t.sidebar.empty}</div>
                ) : (
                    isCollapsed ? (
                        <CollapsedSidebarRail
                            sessions={flattenedSessions}
                            selection={selection}
                            hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                            isSessionRunning={isSessionRunning}
                            onSelect={(sessionOrIndex) => { void handleSelectSession(sessionOrIndex) }}
                            onExpandRequest={onExpandRequest}
                        />
                    ) : sidebarViewMode === 'board' ? (
                        <KanbanView
                            sessions={sessions}
                            renderSession={(session) => (
                                <KanbanSessionRow
                                    session={session}
                                    isSelected={selection.kind === 'session' && selection.payload === session.info.session_id}
                                    onSelect={(s) => { void handleSelectSession(s.info.session_id) }}
                                />
                            )}
                        />
                    ) : (
                        <SessionCardActionsProvider actions={sessionCardActions}>
                        {(() => {
                            let globalIndex = 0

                            const renderVersionGroup = (group: SessionVersionGroupType) => {
                                const groupStartIndex = globalIndex
                                globalIndex += group.versions.length

                                return (
                                    <SessionVersionGroup
                                        key={group.id}
                                        group={group}
                                        selection={selection}
                                        startIndex={groupStartIndex}

                                        hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                                        onSelectBestVersion={handleSelectBestVersion}
                                        resettingSelection={resettingSelection}
                                        isSessionRunning={isSessionRunning}
                                        isMergeDisabled={isSessionMerging}
                                        getMergeStatus={getMergeStatus}
                                        isSessionBusy={isSessionMutating}
                                        onConsolidate={(group) => {
                                            const detail = buildConsolidationGroupDetail(group)
                                            if (detail) {
                                                emitUiEvent(UiEvent.ConsolidateVersionGroup, detail)
                                            }
                                        }}
                                        onTriggerConsolidationJudge={(roundId, early) => handleTriggerConsolidationJudge(roundId, early)}
                                        onConfirmConsolidationWinner={(roundId, winnerSessionId) => handleConfirmConsolidationWinner(roundId, winnerSessionId)}
                                        onTerminateAll={(group) => {
                                            const runningSessions = group.versions
                                                .filter(v => v.session.info.session_state === 'running')
                                                .map(v => ({
                                                    id: v.session.info.session_id,
                                                    name: v.session.info.session_id,
                                                    displayName: getSessionDisplayName(v.session.info),
                                                    branch: v.session.info.branch,
                                                    hasUncommittedChanges: Boolean(v.session.info.has_uncommitted_changes),
                                                }))

                                            if (runningSessions.length === 0) return

                                            emitUiEvent(UiEvent.TerminateVersionGroup, {
                                                baseName: group.baseName,
                                                sessions: runningSessions,
                                            })
                                        }}
                                    />
                                )
                            }

                            const renderSection = (
                                sectionKey: SidebarSectionKey,
                                title: string,
                                groups: SessionVersionGroupType[],
                                collapsed: boolean,
                            ) => {
                                if (groups.length === 0) {
                                    return null
                                }

                                const grouping = groupVersionGroupsByEpic(groups)
                                const hasEpics = grouping.epicGroups.length > 0
                                const toggleLabel = collapsed
                                    ? (sectionKey === 'specs' ? t.sidebar.sections.expandSpecs : t.sidebar.sections.expandRunning)
                                    : (sectionKey === 'specs' ? t.sidebar.sections.collapseSpecs : t.sidebar.sections.collapseRunning)

                                const sectionElements: ReactNode[] = []

                                if (!collapsed) {
                                    if (!hasEpics) {
                                        sectionElements.push(...groups.map(renderVersionGroup))
                                    } else {
                                        for (const epicGroup of grouping.epicGroups) {
                                            const epic = epicGroup.epic
                                            const sessionCount = epicGroup.groups.reduce((acc, group) => acc + group.versions.length, 0)
                                            const epicCollapsed = Boolean(collapsedEpicIds[getCollapsedEpicKey(sectionKey, epic.id)])
                                            const countLabel = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`
                                            const epicScheme = getEpicAccentScheme(epic.color)

                                            sectionElements.push(
                                                <div key={`epic-group-${sectionKey}-${epic.id}`} className="mt-2 mb-2">
                                                    <EpicGroupHeader
                                                        epic={epic}
                                                        collapsed={epicCollapsed}
                                                        countLabel={countLabel}
                                                        menuOpen={epicMenuOpenId === epic.id}
                                                        onMenuOpenChange={(open) => setEpicMenuOpenId(open ? epic.id : null)}
                                                        onToggleCollapsed={() => toggleEpicCollapsed(sectionKey, epic.id)}
                                                        onEdit={() => setEditingEpic(epic)}
                                                        onDelete={() => setDeleteEpicTarget(epic)}
                                                    />
                                                    {!epicCollapsed && (
                                                        <div
                                                            className="ml-1 pl-2 pb-1"
                                                            style={{
                                                                borderLeft: `2px solid ${epicScheme?.DEFAULT ?? 'var(--color-border-subtle)'}`,
                                                                marginLeft: '6px',
                                                            }}
                                                        >
                                                            {epicGroup.groups.map(group => renderVersionGroup(group))}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        }

                                        if (grouping.ungroupedGroups.length > 0) {
                                            sectionElements.push(
                                                <div
                                                    key={`ungrouped-header-${sectionKey}`}
                                                    data-testid="epic-ungrouped-header"
                                                    className="mt-4 mb-2 px-2 flex items-center gap-2"
                                                    style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                                                >
                                                    <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border-subtle)' }} />
                                                    <span>{t.sidebar.ungrouped}</span>
                                                    <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border-subtle)' }} />
                                                </div>
                                            )

                                            for (const group of grouping.ungroupedGroups) {
                                                sectionElements.push(renderVersionGroup(group))
                                            }
                                        }
                                    }
                                }

                                return (
                                    <div
                                        key={`sidebar-section-${sectionKey}`}
                                        data-testid={`sidebar-section-${sectionKey}`}
                                        className="mt-2 first:mt-0"
                                    >
                                        <SidebarSectionHeader
                                            title={title}
                                            count={groups.length}
                                            collapsed={collapsed}
                                            toggleLabel={toggleLabel}
                                            onToggle={() => toggleSectionCollapsed(sectionKey)}
                                        />
                                        {!collapsed && (
                                            <div className="mt-1">
                                                {sectionElements}
                                            </div>
                                        )}
                                    </div>
                                )
                            }

                            return [
                                renderSection('specs', t.sidebar.sections.specs, sectionGroups.specs, collapsedSections.specs),
                                renderSection('running', t.sidebar.sections.running, sectionGroups.running, collapsedSections.running),
                            ]
                        })()}
                        </SessionCardActionsProvider>
                    )
                )}
            </div>

            <EpicModal
                open={Boolean(editingEpic)}
                mode="edit"
                initialName={editingEpic?.name ?? ''}
                initialColor={editingEpic?.color ?? null}
                onClose={() => setEditingEpic(null)}
                onSubmit={async ({ name, color }) => {
                    if (!editingEpic) {
                        throw new Error('No epic selected')
                    }
                    await updateEpic(editingEpic.id, name, color)
                }}
            />

            <ConfirmModal
                open={Boolean(deleteEpicTarget)}
                title={t.deleteEpicDialog.title.replace('{name}', deleteEpicTarget?.name ?? '')}
                body={
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.body }}>
                        {t.deleteEpicDialog.body} <strong>{t.deleteEpicDialog.ungrouped}</strong>.
                    </div>
                }
                confirmText={t.deleteEpicDialog.confirm}
                cancelText={t.settings.common.cancel}
                variant="danger"
                loading={deleteEpicLoading}
                onCancel={() => {
                    if (deleteEpicLoading) {
                        return
                    }
                    setDeleteEpicTarget(null)
                }}
                onConfirm={() => {
                    if (!deleteEpicTarget || deleteEpicLoading) {
                        return
                    }
                    void (async () => {
                        setDeleteEpicLoading(true)
                        try {
                            await deleteEpic(deleteEpicTarget.id)
                            setDeleteEpicTarget(null)
                        } finally {
                            setDeleteEpicLoading(false)
                        }
                    })()
                }}
            />
            
            <ConvertToSpecConfirmation
                open={convertToSpecModal.open}
                sessionName={convertToSpecModal.sessionName}
                projectPath={convertToSpecModal.projectPath}
                sessionDisplayName={convertToSpecModal.sessionDisplayName}
                hasUncommittedChanges={convertToSpecModal.hasUncommitted}
                onClose={() => setConvertToDraftModal({ open: false, sessionName: '', projectPath: null, hasUncommitted: false })}
                onSuccess={(newSpecName) => {
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
                }}
            />
            <PromoteVersionConfirmation
                open={promoteVersionModal.open}
                versionGroup={promoteVersionModal.versionGroup}
                selectedSessionId={promoteVersionModal.selectedSessionId}
                onClose={() => setPromoteVersionModal({ open: false, versionGroup: null, selectedSessionId: '' })}
                onConfirm={() => {
                    const { versionGroup, selectedSessionId } = promoteVersionModal
                    setPromoteVersionModal({ open: false, versionGroup: null, selectedSessionId: '' })
                    if (versionGroup) {
                        void executeVersionPromotion(versionGroup, selectedSessionId)
                    }
                }}
            />
            <MergeSessionModal
                open={mergeDialogState.isOpen}
                sessionName={mergeDialogState.sessionName}
                status={mergeDialogState.status}
                preview={mergeDialogState.preview}
                error={mergeDialogState.error ?? undefined}
                onClose={closeMergeDialog}
                cachedCommitMessage={activeMergeCommitDraft}
                onCommitMessageChange={updateActiveMergeCommitDraft}
                onConfirm={(mode, commitMessage) => {
                    if (mergeDialogState.sessionName) {
                        void confirmMerge(mergeDialogState.sessionName, mode, commitMessage)
                    }
                }}
                onResolveInAgentSession={() => { void handleResolveMergeInAgentSession() }}
                autoCancelEnabled={autoCancelAfterMerge}
                onToggleAutoCancel={(next) => { void updateAutoCancelAfterMerge(next) }}
                prefillMode={mergeDialogState.prefillMode}
            />
            <PrSessionModal
                open={prDialogState.isOpen}
                sessionName={prDialogState.sessionName}
                status={prDialogState.status}
                preview={prDialogState.preview}
                prefill={prDialogState.prefill}
                error={prDialogState.error}
                onClose={handleClosePrModal}
                onConfirm={(options) => { void handleConfirmPr(options) }}
                autoCancelEnabled={autoCancelAfterPr}
                onToggleAutoCancel={(next) => { void updateAutoCancelAfterPr(next) }}
            />
            <GitlabMrSessionModal
                open={gitlabMrDialogState.isOpen}
                sessionName={gitlabMrDialogState.sessionName}
                prefill={gitlabMrDialogState.prefill}
                onClose={handleCloseGitlabMrModal}
            />
            <SwitchOrchestratorModal
                open={switchOrchestratorModal.open}
                scope={switchOrchestratorModal.targetSessionId ? 'session' : 'orchestrator'}
                onClose={() => {
                    setSwitchOrchestratorModal({ open: false })
                    setSwitchModelSessionId(null)
                }}
                onSwitch={async ({ agentType }) => {
                    const targetSelection = switchModelSessionId
                        ? { kind: 'session' as const, payload: switchModelSessionId }
                        : selection

                    await switchModel(agentType, targetSelection, terminals, clearTerminalTracking, clearTerminalStartedTracking, switchOrchestratorModal.initialAgentType)

                    setSwitchOrchestratorModal({ open: false })
                    setSwitchModelSessionId(null)
                }}
                initialAgentType={switchOrchestratorModal.initialAgentType}
                targetSessionId={switchOrchestratorModal.targetSessionId}
            />
            {forgeWritebackSessionId && (() => {
                const writebackSession = sessions.find(s => s.info.session_id === forgeWritebackSessionId)
                if (!writebackSession) return null
                return (
                    <ForgeWritebackModal
                        sessionId={writebackSession.info.session_id}
                        sessionName={writebackSession.info.session_id}
                        prNumber={writebackSession.info.pr_number}
                        prUrl={writebackSession.info.pr_url}
                        issueNumber={writebackSession.info.issue_number}
                        issueUrl={writebackSession.info.issue_url}
                        forgeSource={forgeIntegration.sources[0] ?? null}
                        onClose={() => setForgeWritebackSessionId(null)}
                    />
                )
            })()}
        </div>
    )
});
