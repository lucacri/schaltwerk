import { useState, useEffect, useRef, useCallback, useMemo, useEffectEvent } from 'react'
import { SchaltEvent, listenEvent } from './common/eventSystem'
import type { CancelBlocker } from './common/events'
import { useMultipleShortcutDisplays } from './keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from './keyboardShortcuts/config'
import { Sidebar } from './components/sidebar/Sidebar'
import { TerminalGrid } from './components/terminal/TerminalGrid'
import { RightPanelTabs } from './components/right-panel/RightPanelTabs'
import ErrorBoundary from './components/ErrorBoundary'
import SessionErrorBoundary from './components/SessionErrorBoundary'
import { UnifiedDiffModal, type HistoryDiffContext } from './components/diff/UnifiedDiffModal'
import { PierreDiffProvider } from './components/diff/PierreDiffProvider'
import type { HistoryItem, CommitFileChange } from './components/git-graph/types'
import Split from 'react-split'
import { CancelConfirmation } from './components/modals/CancelConfirmation'
import { CloseConfirmation } from './components/modals/CloseConfirmation'
import { DeleteSpecConfirmation } from './components/modals/DeleteSpecConfirmation'
import { SettingsModal } from './components/modals/SettingsModal'
import { ViewProcessesModal } from './components/diagnostics/ViewProcessesModal'
import { SetupScriptApprovalModal } from './components/modals/SetupScriptApprovalModal'
import { ProjectSelectorModal } from './components/modals/ProjectSelectorModal'
import {
  TerminateVersionGroupConfirmation,
  type TerminateVersionGroupSession,
} from './components/modals/TerminateVersionGroupConfirmation'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSelection } from './hooks/useSelection'
import { usePreviewPanelEvents } from './hooks/usePreviewPanelEvents'
import { useSetupScriptApproval } from './hooks/useSetupScriptApproval'
import { useAtom, useSetAtom, useAtomValue, useStore } from 'jotai'
import {
  increaseFontSizesActionAtom,
  decreaseFontSizesActionAtom,
  resetFontSizesActionAtom,
  initializeFontSizesActionAtom,
} from './store/atoms/fontSize'
import { initializeThemeActionAtom } from './store/atoms/theme'
import { initializeLanguageActionAtom } from './store/atoms/language'
import { initializeInlineDiffPreferenceActionAtom } from './store/atoms/diffPreferences'
import {
  initializeSelectionEventsActionAtom,
  setProjectPathActionAtom,
} from './store/atoms/selection'
import { refreshForgeAtom } from './store/atoms/forge'
import {
  projectPathAtom,
  projectTabsAtom,
  projectSwitchStatusAtom,
  openProjectActionAtom,
  selectProjectActionAtom,
  closeProjectActionAtom,
  deactivateProjectActionAtom,
} from './store/atoms/project'
import {
  initializeSessionsEventsActionAtom,
  initializeSessionsSettingsActionAtom,
  refreshSessionsActionAtom,
  crossProjectCountsAtom,
  activeSessionsHydratedFromCacheAtom,
} from './store/atoms/sessions'
import {
  leftPanelCollapsedAtom,
  leftPanelSizesAtom,
  leftPanelLastExpandedSizesAtom,
  rightPanelCollapsedAtom,
  rightPanelSizesAtom,
  rightPanelLastExpandedSizeAtom,
} from './store/atoms/layout'
import { useSessions } from './hooks/useSessions'
import { HomeScreen } from './components/home/HomeScreen'
import { TopBar } from './components/TopBar'
import { PermissionPrompt } from './components/PermissionPrompt'
import { OnboardingModal } from './components/onboarding/OnboardingModal'
import { useOnboarding } from './hooks/useOnboarding'
// useRightPanelPersistence removed
import { useAttentionNotifications } from './hooks/useAttentionNotifications'
import { useAgentBinarySnapshot } from './hooks/useAgentBinarySnapshot'
import { useDiffPreloader } from './hooks/useDiffPreloader'
import { useLastAgentResponseTracker } from './hooks/useLastAgentResponseTracker'
import { theme } from './common/theme'
import { useGithubIntegrationContext } from './contexts/GithubIntegrationContext'
import { resolveOpenPathForOpenButton } from './utils/resolveOpenPath'
import { TauriCommands } from './common/tauriCommands'
import { validatePanelPercentage } from './utils/panel'
import { calculateLogicalSessionCounts } from './utils/sessionVersions'
import {
  UiEvent,
  listenUiEvent,
  emitUiEvent,
  SessionActionDetail,
  AgentLifecycleDetail,
  type PermissionErrorDetail,
} from './common/uiEvents'
import { clearTerminalStartState } from './common/terminalStartState'
import { logger } from './utils/logger'
import { installSmartDashGuards } from './utils/normalizeCliText'
import { useKeyboardShortcutsConfig } from './contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from './keyboardShortcuts/helpers'
import { selectAllTerminal } from './terminal/registry/terminalRegistry'
import { useTaskRefreshListener } from './hooks/useTaskRefreshListener'
import { NewTaskModal } from './components/modals/NewTaskModal'
import { AGENT_START_TIMEOUT_MESSAGE } from './common/agentSpawn'
import { beginSplitDrag, endSplitDrag } from './utils/splitDragCoordinator'
import { useOptionalToast } from './common/toast/ToastProvider'
import { ForgeConnectionIssuePayload, NewerBuildAvailablePayload } from './common/events'
import { RawSpec, SessionState } from './types/session'
import { specOrchestratorTerminalId } from './common/terminalIdentity'
import {
  refreshKeepAwakeStateActionAtom,
  registerKeepAwakeEventListenerActionAtom,
} from './store/atoms/powerSettings'
import { registerDevErrorListeners } from './dev/registerDevErrorListeners'
import { AgentCliMissingModal } from './components/agentBinary/AgentCliMissingModal'
import type { SettingsCategory } from './types/settings'
import { SPLIT_GUTTER_SIZE } from './common/splitLayout'
import { isNotificationPermissionGranted } from './utils/notificationPermission'
import { sanitizeSplitSizes, areSizesEqual } from './utils/splitStorage'
import { getErrorMessage } from './types/errors'

const COLLAPSED_LEFT_PANEL_PX = 50
import { finalizeSplitCommit, selectSplitRenderSizes } from './utils/splitDragState'

interface OpenTabsState {
  tabs: string[]
  active: string | null
}



import { FocusSync } from './components/FocusSync'
import { parseCancelBlocker } from './common/cancelBlocker'

function AppContent() {
  // Phase 7 Wave A.3: subscribe to TasksRefreshed and dispatch payloads
  // into tasksAtom. The listener mounts at the App shell so it survives
  // project switches (the backend-side TasksRefreshedPayload carries the
  // project_path, but the atom holds the active project's task list and
  // is replaced wholesale on every emission).
  useTaskRefreshListener()

  const { selection, clearTerminalTracking } = useSelection()
  const selectionIsSpec = selection.kind === 'session' && selection.sessionState === 'spec'
  const projectPath = useAtomValue(projectPathAtom)
  const projectTabs = useAtomValue(projectTabsAtom)
  const projectSwitchStatus = useAtomValue(projectSwitchStatusAtom)
  const openProject = useSetAtom(openProjectActionAtom)
  const selectProject = useSetAtom(selectProjectActionAtom)
  const closeProject = useSetAtom(closeProjectActionAtom)
  const deactivateProject = useSetAtom(deactivateProjectActionAtom)
  const increaseFontSizes = useSetAtom(increaseFontSizesActionAtom)
  const decreaseFontSizes = useSetAtom(decreaseFontSizesActionAtom)
  const resetFontSizes = useSetAtom(resetFontSizesActionAtom)
  const initializeFontSizes = useSetAtom(initializeFontSizesActionAtom)
  const initializeTheme = useSetAtom(initializeThemeActionAtom)
  const initializeLanguage = useSetAtom(initializeLanguageActionAtom)
  const initializeInlineDiffPreference = useSetAtom(initializeInlineDiffPreferenceActionAtom)
  const initializeSelectionEvents = useSetAtom(initializeSelectionEventsActionAtom)
  const setSelectionProjectPath = useSetAtom(setProjectPathActionAtom)
  const initializeSessionsEvents = useSetAtom(initializeSessionsEventsActionAtom)
  const initializeSessionsSettings = useSetAtom(initializeSessionsSettingsActionAtom)
  const refreshSessions = useSetAtom(refreshSessionsActionAtom)
  const refreshKeepAwakeState = useSetAtom(refreshKeepAwakeStateActionAtom)
  const registerKeepAwakeListener = useSetAtom(registerKeepAwakeEventListenerActionAtom)
  const refreshForge = useSetAtom(refreshForgeAtom)
  const { isOnboardingOpen, completeOnboarding, closeOnboarding, openOnboarding } = useOnboarding()
  const github = useGithubIntegrationContext()
  const toast = useOptionalToast()
  const { beginSessionMutation, endSessionMutation, allSessions } = useSessions()
  const agentLifecycleStateRef = useRef(new Map<string, { state: 'spawned' | 'ready'; timestamp: number }>())
  const [devErrorToastsEnabled, setDevErrorToastsEnabled] = useState(false)
  const [attentionCounts, setAttentionCounts] = useState<Record<string, number>>({})
  const [runningCounts, setRunningCounts] = useState<Record<string, number>>({})
  const crossProjectCounts = useAtomValue(crossProjectCountsAtom)
  const activeSessionsHydratedFromCache = useAtomValue(activeSessionsHydratedFromCacheAtom)
  const [showCliMissingModal, setShowCliMissingModal] = useState(false)
  const [cliModalEverShown, setCliModalEverShown] = useState(false)
  const store = useStore()
  usePreviewPanelEvents()
  useDiffPreloader()
  useLastAgentResponseTracker()
  const {
    loading: agentDetectLoading,
    allMissing: agentAllMissing,
    statusByAgent: agentStatusByName,
    refresh: refreshAgentDetection,
  } = useAgentBinarySnapshot()

  useEffect(() => {
    void initializeTheme()
    void initializeLanguage()
    void initializeFontSizes()
    void initializeInlineDiffPreference()
  }, [initializeTheme, initializeLanguage, initializeFontSizes, initializeInlineDiffPreference])

  useEffect(() => {
    void isNotificationPermissionGranted()
  }, [])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const tabs = store.get(projectTabsAtom)
      const activePath = store.get(projectPathAtom)
      invoke(TauriCommands.SaveOpenTabsState, {
        tabs: tabs.map(t => t.projectPath),
        active: activePath,
      }).catch(error => {
        logger.warn('[App] Failed to save open tabs state on close', { error })
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [store])

  useEffect(() => {
    if (agentDetectLoading) return
    if (agentAllMissing) {
      setShowCliMissingModal(true)
      setCliModalEverShown(true)
    }
  }, [agentAllMissing, agentDetectLoading])

  useEffect(() => {
    void initializeSelectionEvents()
  }, [initializeSelectionEvents])

  useEffect(() => {
    void initializeSessionsEvents()
  }, [initializeSessionsEvents])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void (async () => {
      await refreshKeepAwakeState()
      try {
        unlisten = await registerKeepAwakeListener()
      } catch (error) {
        logger.debug('Failed to register keep-awake state listener', error)
      }
    })()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [refreshKeepAwakeState, registerKeepAwakeListener])

  useEffect(() => {
    void initializeSessionsSettings()
  }, [initializeSessionsSettings, projectPath])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions, projectPath])

  useEffect(() => {
    void setSelectionProjectPath(projectPath ?? null)
  }, [projectPath, setSelectionProjectPath])

  useEffect(() => {
    if (projectPath) {
      void refreshForge()
    }
  }, [projectPath, refreshForge])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const shouldBlock = (event: DragEvent) => {
      const transfer = event.dataTransfer
      if (!transfer) {
        return false
      }

      const types = Array.from(transfer.types ?? [])
      if (types.includes('Files')) {
        return true
      }

      const items = Array.from(transfer.items ?? [])
      return items.some(item => item.kind === 'file' && item.type?.startsWith('image/'))
    }

    const blockDragAndDrop = (event: DragEvent) => {
      if (!shouldBlock(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (event.type === 'dragover' && event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
    }

    window.addEventListener('dragover', blockDragAndDrop)
    window.addEventListener('drop', blockDragAndDrop)

    return () => {
      window.removeEventListener('dragover', blockDragAndDrop)
      window.removeEventListener('drop', blockDragAndDrop)
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      setDevErrorToastsEnabled(false)
      return
    }

    let cancelled = false

    const loadPreference = async () => {
      try {
        const result = await invoke<boolean | null | undefined>(TauriCommands.GetDevErrorToastsEnabled)
        if (!cancelled) {
          if (typeof result === 'boolean') {
            setDevErrorToastsEnabled(result)
          } else {
            setDevErrorToastsEnabled(true)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setDevErrorToastsEnabled(true)
          logger.info('[App] Dev error toast preference unavailable; defaulting to enabled', error)
        }
      }
    }

    void loadPreference()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const cleanup = listenUiEvent(UiEvent.DevErrorToastPreferenceChanged, detail => {
      setDevErrorToastsEnabled(Boolean(detail?.enabled ?? true))
    })

    return cleanup
  }, [])

  useEffect(() => {
    if (!toast || !import.meta.env.DEV || !devErrorToastsEnabled) {
      return
    }

    let active = true
    let cleanup: (() => void) | undefined

    registerDevErrorListeners({
      isDev: import.meta.env.DEV,
      pushToast: toast.pushToast,
      listenBackendError: (handler) => listenEvent(SchaltEvent.DevBackendError, handler),
    }).then((dispose) => {
      if (!active) {
        dispose()
        return
      }
      cleanup = dispose
    }).catch((error) => {
      logger.warn('[App] Failed to register dev error listeners', error)
    })

    return () => {
      active = false
      cleanup?.()
    }
  }, [toast, devErrorToastsEnabled])

  useEffect(() => {
    if (!toast) return
    const spawnCleanup = listenUiEvent(UiEvent.SpawnError, (detail: { error?: string, terminalId?: string }) => {
      const description = detail?.error?.trim() || 'Agent failed to start.'
      const terminalId = detail?.terminalId
      if (terminalId) {
        const lifecycleState = agentLifecycleStateRef.current.get(terminalId)
        const isTimeout = description.includes(AGENT_START_TIMEOUT_MESSAGE)
        if (lifecycleState?.state === 'spawned' && isTimeout) {
          logger.info(`[App] Suppressing timeout toast for ${terminalId}; lifecycle indicates spawn succeeded`)
          agentLifecycleStateRef.current.delete(terminalId)
          return
        }
      }
      toast.pushToast({ tone: 'error', title: 'Failed to start agent', description })
      if (agentAllMissing && !cliModalEverShown) {
        setShowCliMissingModal(true)
        setCliModalEverShown(true)
      }
    })
    const noProjectCleanup = listenUiEvent(UiEvent.NoProjectError, (detail: { error?: string }) => {
      const description = detail?.error?.trim() || 'Open a project before starting an agent.'
      toast.pushToast({ tone: 'error', title: 'Project required', description })
    })
    const notGitCleanup = listenUiEvent(UiEvent.NotGitError, (detail: { error?: string }) => {
      const description = detail?.error?.trim() || 'Initialize a Git repository to start agents.'
      toast.pushToast({ tone: 'error', title: 'Git repository required', description })
    })
    let orchestratorCleanup: (() => void) | undefined
    void (async () => {
      try {
        orchestratorCleanup = await listenEvent(SchaltEvent.OrchestratorLaunchFailed, payload => {
          clearTerminalStartState([payload.terminal_id])
          toast.pushToast({
            tone: 'error',
            title: 'Orchestrator failed to start',
            description: payload.error || 'Launch error. Please retry.',
            durationMs: 6000,
          })
        })
      } catch (error) {
        logger.warn('[App] Failed to listen for orchestrator launch failures', error)
      }
    })()
    return () => {
      spawnCleanup()
      noProjectCleanup()
      notGitCleanup()
      orchestratorCleanup?.()
    }
  }, [toast, agentAllMissing, cliModalEverShown])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.AgentLifecycle, (detail: AgentLifecycleDetail) => {
      if (!detail?.terminalId) return
      const timestamp = detail.occurredAtMs ?? Date.now()
      if (detail.state === 'ready' || detail.state === 'failed') {
        agentLifecycleStateRef.current.delete(detail.terminalId)
        return
      }
      agentLifecycleStateRef.current.set(detail.terminalId, { state: detail.state, timestamp })
    })
    return cleanup
  }, [])

  const onProjectChange = useEffectEvent(() => {
    github.refreshStatus().catch(error => {
      logger.warn('[App] Failed to refresh GitHub status after project change', error)
    })
  })

  useEffect(() => {
    if (!projectPath) return
    onProjectChange()
  }, [projectPath])

  useEffect(() => {
    if (!toast) return

    let disposed = false
    let unlisten: (() => void) | null = null
    let notified = false

    const subscribe = async () => {
      try {
        const stop = await listenEvent(
          SchaltEvent.NewerBuildAvailable,
          (payload: NewerBuildAvailablePayload) => {
            if (notified) return
            notified = true
            logger.info('[VersionCheck] Newer build detected', payload)
            toast.pushToast({
              tone: 'info',
              title: 'Newer build available',
              description: `v${payload.installedVersion} is installed. Restart to use it.`,
              durationMs: 0,
              action: {
                label: 'Restart',
                onClick: () => { void invoke(TauriCommands.RestartApp) },
              },
            })
          }
        )
        if (disposed) { stop() } else { unlisten = stop }
      } catch (error) {
        logger.error('[VersionCheck] Failed to attach listener', error)
      }
    }

    void subscribe()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [toast])

  // Phase 8 W.2: NewSession + NewSpec collapsed onto NewTask. The
  // shortcut display + state are single-axis now.
  const shortcuts = useMultipleShortcutDisplays([KeyboardShortcutAction.NewTask])
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsCategory | undefined>(undefined)
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelBlocker, setCancelBlocker] = useState<CancelBlocker | null>(null)
  const [deleteSpecModalOpen, setDeleteSpecModalOpen] = useState(false)
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentSession, setCurrentSession] = useState<{ id: string; name: string; displayName: string; branch: string; hasUncommittedChanges: boolean } | null>(null)
  const [diffViewerState, setDiffViewerState] = useState<{ mode: 'session' | 'history'; filePath: string | null; historyContext?: HistoryDiffContext } | null>(null)
  const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false)
  const [showHome, setShowHome] = useState(true)
  const [cliValidationError, setCliValidationError] = useState<string | null>(null)
  const [pendingActivePath, setPendingActivePath] = useState<string | null>(null)
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)
  const [permissionDeniedPath, setPermissionDeniedPath] = useState<string | null>(null)
  const [permissionContext, setPermissionContext] = useState<'project' | 'session' | 'unknown'>('unknown')
  const [terminateGroupModalState, setTerminateGroupModalState] = useState<{
    open: boolean
    baseName: string
    sessions: TerminateVersionGroupSession[]
  }>({
    open: false,
    baseName: '',
    sessions: [],
  })
  const [isTerminatingGroup, setIsTerminatingGroup] = useState(false)
  const [isConvertingGroup, setIsConvertingGroup] = useState(false)
  // openAsDraft / setOpenAsSpec retired in Phase 8 W.2 (NewSpec gone).
  const [triggerOpenInApp, setTriggerOpenInApp] = useState<number>(0)
  const {
    proposal: setupScriptProposal,
    approve: approveSetupScript,
    reject: rejectSetupScript,
    isApplying: isApplyingSetupScript,
  } = useSetupScriptApproval()
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useAtom(leftPanelCollapsedAtom)
  const [rawLeftPanelSizes, setLeftPanelSizes] = useAtom(leftPanelSizesAtom)
  const [rawLeftPanelLastExpandedSizes, setLeftPanelLastExpandedSizes] = useAtom(leftPanelLastExpandedSizesAtom)
  const [leftDragSizes, setLeftDragSizes] = useState<number[] | null>(null)
  const leftPanelSizes = useMemo(
    () => sanitizeSplitSizes(rawLeftPanelSizes, [20, 80]),
    [rawLeftPanelSizes]
  )
  const leftPanelLastExpandedSizes = useMemo(
    () => sanitizeSplitSizes(rawLeftPanelLastExpandedSizes, [20, 80]),
    [rawLeftPanelLastExpandedSizes]
  )
  const leftRenderSizes = useMemo(
    () => selectSplitRenderSizes(leftDragSizes, leftPanelSizes as [number, number], [20, 80]),
    [leftDragSizes, leftPanelSizes]
  )
  const autoCollapsedLeftForInlineRef = useRef(false)
  const inlineReviewActiveRef = useRef(false)
  const prevCollapsedBeforeInlineRef = useRef<boolean | null>(null)
  const userTouchedLeftDuringInlineRef = useRef(false)
  const skipMarkUserChangeRef = useRef(false)
  const rightSizesBeforeLeftCollapseRef = useRef<number[] | null>(null)
  const prevLeftCollapsedRef = useRef<boolean | null>(null)
  const inlineReformatEnabledRef = useRef<boolean | null>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const isMac = platform === 'mac'
  // Phase 8 W.2: single NewTask shortcut display (Mod+N AND Mod+Shift+N
  // both bind to it). Button title shows the canonical Mod+N variant.
  const newTaskShortcut = shortcuts[KeyboardShortcutAction.NewTask] || (isMac ? '⌘N' : 'Ctrl + N')
  const pendingActivePathRef = useRef<string | null>(null)
  const openProjectPaths = useMemo(() => projectTabs.map(tab => tab.projectPath), [projectTabs])
  const clearPendingPath = useCallback((path?: string | null) => {
    if (path && pendingActivePathRef.current && pendingActivePathRef.current !== path) {
      return
    }
    pendingActivePathRef.current = null
    setPendingActivePath(null)
  }, [])

  const handleSelectAllRequested = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    const active = document.activeElement
    if (!(active instanceof Element)) {
      return
    }

    const terminalContainer = active.closest('[data-terminal-id]')
    const terminalId = terminalContainer?.getAttribute('data-terminal-id')
    if (terminalId) {
      selectAllTerminal(terminalId)
      return
    }

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.select()
      return
    }

    if (active instanceof HTMLElement && active.isContentEditable) {
      const selection = window.getSelection()
      if (!selection) {
        return
      }

      const range = document.createRange()
      range.selectNodeContents(active)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }, [selectAllTerminal])

  useEffect(() => {
    const unlistenPromise = listenEvent(SchaltEvent.SelectAllRequested, () => {
      handleSelectAllRequested()
    })

    return () => {
      void unlistenPromise
        .then(unlisten => {
          unlisten()
        })
        .catch(error => {
          logger.warn('[App] Failed to detach select all requested listener', error)
        })
    }
  }, [handleSelectAllRequested])

  useEffect(() => {
    if (projectPath && pendingActivePathRef.current === projectPath) {
      clearPendingPath(projectPath)
    }
  }, [projectPath, clearPendingPath])

  useEffect(() => {
    const unlistenPromise = listenEvent(SchaltEvent.ProjectReady, readyPath => {
      if (typeof readyPath !== 'string') {
        return
      }
      if (!pendingActivePathRef.current) {
        return
      }
      if (pendingActivePathRef.current === readyPath) {
        clearPendingPath(readyPath)
      }
    })

    return () => {
      void unlistenPromise
        .then(unlisten => {
          unlisten()
        })
        .catch(error => {
          logger.warn('[App] Failed to detach project ready listener', error)
        })
    }
  }, [clearPendingPath])

  useEffect(() => {
    if (!toast) {
      return
    }

    const unlistenPromise = listenEvent(
      SchaltEvent.ForgeConnectionIssue,
      (payload: ForgeConnectionIssuePayload) => {
        const { hostname, verdict } = payload
        if (verdict === 'TRANSIENT') {
          toast.pushToast({
            tone: 'info',
            title: `Connection to ${hostname} recovered`,
            description: `Connections to ${hostname} appear healthy again.`,
            durationMs: 8000,
          })
          return
        }

        const isAppWide = verdict === 'APP_WIDE' || verdict === 'TAURI_PROCESS'
        const description = isAppWide
          ? `Lucode's connection to ${hostname} is failing. Restarting the app will fix this.`
          : `Terminal connections to ${hostname} are failing. Try restarting the affected session terminals.`

        toast.pushToast({
          tone: 'warning',
          title: `Connection issue with ${hostname}`,
          description,
          durationMs: 15000,
          action:
            !isAppWide && payload.sessionName
              ? {
                  label: 'Restart Terminals',
                  onClick: () => {
                    void invoke(TauriCommands.RestartSessionTerminals, {
                      sessionName: payload.sessionName,
                    })
                      .then(() => {
                        emitUiEvent(UiEvent.TerminalReset, {
                          kind: 'session',
                          sessionId: payload.sessionName!,
                        })
                      })
                      .catch(error => {
                        logger.warn('[App] Failed to restart session terminals', error)
                      })
                  },
                }
              : undefined,
        })
      }
    )

    return () => {
      void unlistenPromise
        .then(unlisten => {
          unlisten()
        })
        .catch(error => {
          logger.warn('[App] Failed to detach forge connection issue listener', error)
        })
    }
  }, [toast])

  useEffect(() => {
    const prev = prevLeftCollapsedRef.current
    const changed = prev !== null && prev !== isLeftPanelCollapsed

    // React strict/dev may re-run effects without state change; ignore duplicates
    if (!changed && prev !== null) {
      prevLeftCollapsedRef.current = isLeftPanelCollapsed
      skipMarkUserChangeRef.current = false
      return
    }

    if (changed && inlineReviewActiveRef.current && !skipMarkUserChangeRef.current) {
      userTouchedLeftDuringInlineRef.current = true
    }

    skipMarkUserChangeRef.current = false
    prevLeftCollapsedRef.current = isLeftPanelCollapsed
  }, [isLeftPanelCollapsed])

  const handleAttentionSummaryChange = useCallback(
    ({ perProjectCounts }: { perProjectCounts: Record<string, number>; totalCount: number }) => {
      setAttentionCounts(prev => {
        const next: Record<string, number> = {}
        for (const tab of projectTabs) {
          next[tab.projectPath] = perProjectCounts[tab.projectPath] ?? 0
        }
        for (const [key, value] of Object.entries(perProjectCounts)) {
          if (!(key in next)) {
            next[key] = value
          }
        }

        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length === nextKeys.length) {
          let different = false
          for (const key of nextKeys) {
            if (prev[key] !== next[key]) {
              different = true
              break
            }
          }
          if (!different) {
            return prev
          }
        }

        return next
      })
    },
    [projectTabs]
  )

  useAttentionNotifications({
    sessions: allSessions,
    projectPath,
    openProjectPaths,
    onProjectAttentionChange: useCallback((count: number) => {
      if (!projectPath) {
        return
      }
      setAttentionCounts(prev => {
        if (prev[projectPath] === count) return prev
        return { ...prev, [projectPath]: count }
      })
    }, [projectPath]),
    onAttentionSummaryChange: handleAttentionSummaryChange,
  })

  useEffect(() => {
    if (!projectPath) return
    const cachedCounts = crossProjectCounts[projectPath]
    const liveCounts = calculateLogicalSessionCounts(
      allSessions,
      session => session.info.attention_required === true && session.info.attention_kind !== 'waiting_for_input',
    )
    const counts = activeSessionsHydratedFromCache && cachedCounts != null
      ? cachedCounts
      : {
          attention: liveCounts.idleCount,
          running: liveCounts.runningCount,
        }

    setAttentionCounts(prev => {
      if (prev[projectPath] === counts.attention) return prev
      return { ...prev, [projectPath]: counts.attention }
    })

    setRunningCounts(prev => {
      if (prev[projectPath] === counts.running) return prev
      return { ...prev, [projectPath]: counts.running }
    })
  }, [activeSessionsHydratedFromCache, allSessions, crossProjectCounts, projectPath])

  const shouldBlockSessionModal = useCallback(
    (reason: string) => {
      if (showHome || !projectPath) {
        logger.info('[App] Ignoring modal request because Home is active or no project selected:', reason)
        return true
      }
      return false
    },
    [projectPath, showHome]
  )

  const leftSplitDraggingRef = useRef(false)

  const finalizeLeftSplitDrag = useCallback((nextSizes?: number[]) => {
    if (!leftSplitDraggingRef.current) {
      return
    }

    leftSplitDraggingRef.current = false
    endSplitDrag('app-left-panel')

    const commit = finalizeSplitCommit({
      dragSizes: leftDragSizes,
      nextSizes,
      defaults: [20, 80],
      collapsed: isLeftPanelCollapsed,
    })

    setLeftDragSizes(null)

    if (!commit) {
      return
    }

    if (!areSizesEqual(commit as [number, number], leftPanelLastExpandedSizes as [number, number])) {
      void setLeftPanelLastExpandedSizes(commit)
    }
    if (!areSizesEqual(commit as [number, number], leftPanelSizes as [number, number])) {
      void setLeftPanelSizes(commit)
    }
  }, [isLeftPanelCollapsed, leftDragSizes, leftPanelLastExpandedSizes, leftPanelSizes, setLeftPanelLastExpandedSizes, setLeftPanelSizes])

  const handleLeftSplitDragStart = useCallback(() => {
    if (isLeftPanelCollapsed) {
      return
    }
    beginSplitDrag('app-left-panel', { orientation: 'col' })
    leftSplitDraggingRef.current = true
    setLeftDragSizes(null)
  }, [isLeftPanelCollapsed])

  const handleLeftSplitDrag = useCallback((nextSizes: number[]) => {
    setLeftDragSizes(nextSizes)
  }, [])

  const handleLeftSplitDragEnd = useCallback((nextSizes: number[]) => {
    finalizeLeftSplitDrag(nextSizes)
  }, [finalizeLeftSplitDrag])

  useEffect(() => {
    const handlePointerEnd = () => finalizeLeftSplitDrag()
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handlePointerEnd)
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', handlePointerEnd)
    }
  }, [finalizeLeftSplitDrag])

  const toggleLeftPanelCollapsed = useCallback(() => {
    setLeftDragSizes(null)
    void setIsLeftPanelCollapsed(prev => {
      if (prev) {
        void setLeftPanelSizes(leftPanelLastExpandedSizes as [number, number])
        return false
      }
      void setLeftPanelLastExpandedSizes(leftPanelSizes)
      return true
    })
  }, [leftPanelLastExpandedSizes, leftPanelSizes, setIsLeftPanelCollapsed, setLeftPanelLastExpandedSizes, setLeftPanelSizes, setLeftDragSizes])

  const handleInlineReviewModeChange = useCallback((isInlineReviewing: boolean, opts?: { reformatSidebar: boolean, hasFiles?: boolean }) => {
    setLeftDragSizes(null)

    const reformatEnabled = opts?.reformatSidebar ?? true
    const hasFiles = opts?.hasFiles ?? true
    const wasInline = inlineReviewActiveRef.current
    const previousReformat = inlineReformatEnabledRef.current

    inlineReviewActiveRef.current = isInlineReviewing
    inlineReformatEnabledRef.current = reformatEnabled

    if (isInlineReviewing) {
      // Transition into inline review
      if (!wasInline) {
        prevCollapsedBeforeInlineRef.current = isLeftPanelCollapsed
        userTouchedLeftDuringInlineRef.current = false

        if (reformatEnabled && hasFiles && !isLeftPanelCollapsed) {
          autoCollapsedLeftForInlineRef.current = true
          void setLeftPanelLastExpandedSizes(leftPanelSizes)
          skipMarkUserChangeRef.current = true
          void setIsLeftPanelCollapsed(true)
        } else {
          autoCollapsedLeftForInlineRef.current = false
        }
        return
      }

      // Already inline: only layout preference may have changed
      if (previousReformat !== reformatEnabled) {
        if (reformatEnabled) {
          if (hasFiles && !isLeftPanelCollapsed) {
            autoCollapsedLeftForInlineRef.current = true
            void setLeftPanelLastExpandedSizes(leftPanelSizes)
            skipMarkUserChangeRef.current = true
            void setIsLeftPanelCollapsed(true)
          }
        } else {
          // Reformat turned off while inline: undo auto collapse if we triggered it
          if (autoCollapsedLeftForInlineRef.current && prevCollapsedBeforeInlineRef.current !== null) {
            skipMarkUserChangeRef.current = true
            const targetCollapsed = prevCollapsedBeforeInlineRef.current
            void setIsLeftPanelCollapsed(targetCollapsed)
            if (!targetCollapsed) {
              void setLeftPanelSizes(leftPanelLastExpandedSizes as [number, number])
            }
            autoCollapsedLeftForInlineRef.current = false
          }
        }
      }
      return
    }

    // Exiting inline review
    if (!wasInline) {
      return
    }

    const canRestore = !userTouchedLeftDuringInlineRef.current && prevCollapsedBeforeInlineRef.current !== null
    if (autoCollapsedLeftForInlineRef.current && canRestore) {
      skipMarkUserChangeRef.current = true
      const targetCollapsed = prevCollapsedBeforeInlineRef.current as boolean
      void setIsLeftPanelCollapsed(targetCollapsed)
      if (!targetCollapsed) {
        void setLeftPanelSizes(leftPanelLastExpandedSizes as [number, number])
      }
    }

    autoCollapsedLeftForInlineRef.current = false
    prevCollapsedBeforeInlineRef.current = null
    userTouchedLeftDuringInlineRef.current = false
    inlineReformatEnabledRef.current = null
  }, [isLeftPanelCollapsed, leftPanelLastExpandedSizes, leftPanelSizes, setIsLeftPanelCollapsed, setLeftDragSizes, setLeftPanelLastExpandedSizes, setLeftPanelSizes, inlineReformatEnabledRef])

  const handleOpenProject = useCallback(async (path: string) => {
    try {
      const opened = await openProject({ path })
      if (opened) {
        setShowHome(false)
        try {
          const isEmpty = await invoke<boolean>(TauriCommands.RepositoryIsEmpty)
          if (isEmpty) {
            setShowHome(true)
            emitUiEvent(UiEvent.OpenNewProjectDialog)
          }
        } catch (repoError) {
          logger.warn('Failed to check if repository is empty:', repoError)
        }
      }
    } catch (error) {
      logger.error('Failed to open project:', error)
      alert(`Failed to open project: ${error}`)
    }
  }, [openProject])

  const tabsRestoredRef = useRef(false)
  const openProjectInFlightRef = useRef(new Map<string, Promise<void>>())
  const openProjectOnce = useCallback(async (path: string, source: string) => {
    const trimmed = path.trim()
    if (!trimmed) {
      return
    }

    const normalized = trimmed === '/' ? trimmed : trimmed.replace(/[/\\]+$/, '')
    const existing = openProjectInFlightRef.current.get(normalized)
    if (existing) {
      logger.debug(`[App] Ignoring duplicate openProject (${source})`, { path: normalized })
      await existing
      return
    }

    logger.debug(`[App] Opening project (${source})`, { path: normalized })
    const promise = handleOpenProject(normalized)
    openProjectInFlightRef.current.set(normalized, promise)
    void promise.finally(() => {
      if (openProjectInFlightRef.current.get(normalized) === promise) {
        openProjectInFlightRef.current.delete(normalized)
      }
    })

    await promise
  }, [handleOpenProject])

  const tryRestoreOpenTabs = useCallback(async (): Promise<boolean> => {
    if (tabsRestoredRef.current) {
      return true
    }
    try {
      const restoreEnabled = await invoke<boolean>(TauriCommands.GetRestoreOpenProjects)
      if (!restoreEnabled) {
        return false
      }
      const state = await invoke<OpenTabsState | null>(TauriCommands.GetOpenTabsState)
      if (!state || state.tabs.length === 0) {
        return false
      }
      logger.info('[App] Restoring open tabs:', state.tabs.length)
      const restoredPaths = new Set<string>()
      for (const tabPath of state.tabs) {
        try {
          const exists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: tabPath })
          const isGit = exists && await invoke<boolean>(TauriCommands.IsGitRepository, { path: tabPath })
          if (isGit) {
            await openProjectOnce(tabPath, 'restore-tabs')
            restoredPaths.add(tabPath)
          } else {
            logger.info('[App] Skipping invalid tab during restore:', tabPath)
          }
        } catch (error) {
          logger.warn('[App] Failed to validate tab during restore:', tabPath, error)
        }
      }
      if (restoredPaths.size === 0) {
        return false
      }
      tabsRestoredRef.current = true
      const activePath = (state.active && restoredPaths.has(state.active))
        ? state.active
        : restoredPaths.values().next().value
      if (activePath) {
        try {
          await selectProject({ path: activePath })
        } catch (error) {
          logger.warn('[App] Failed to restore active project', { path: activePath, error })
        }
      }
      return true
    } catch (error) {
      logger.warn('[App] Failed to restore open tabs:', error)
      return false
    }
  }, [openProjectOnce, selectProject])

  // Right panel global state (using atoms for persistence)
  const [rightSizes, setRightSizes] = useAtom(rightPanelSizesAtom)
  const [rightDragSizes, setRightDragSizes] = useState<number[] | null>(null)
  const safeRightSizes = useMemo(
    () => sanitizeSplitSizes(rightSizes, [70, 30]),
    [rightSizes]
  )
  const rightRenderSizes = useMemo(
    () => selectSplitRenderSizes(rightDragSizes, safeRightSizes as [number, number], [70, 30]),
    [rightDragSizes, safeRightSizes]
  )
  useEffect(() => {
    if (!areSizesEqual(safeRightSizes as [number, number], rightSizes as [number, number])) {
      void setRightSizes(safeRightSizes as [number, number])
    }
  }, [safeRightSizes, rightSizes, setRightSizes])
  const [isRightCollapsed, setIsRightCollapsed] = useAtom(rightPanelCollapsedAtom)
  const [lastExpandedRightPercent, setLastExpandedRightPercent] = useAtom(rightPanelLastExpandedSizeAtom)

  const toggleRightPanelCollapsed = useCallback(() => {
    setRightDragSizes(null)
    void setIsRightCollapsed(prev => {
        const willCollapse = !prev
        if (willCollapse) {
            void setRightSizes([100, 0])
        } else {
            const expanded = validatePanelPercentage(
              typeof lastExpandedRightPercent === 'number' ? lastExpandedRightPercent.toString() : null,
              30
            )
            void setRightSizes([100 - expanded, expanded])
        }
        return willCollapse
    })
  }, [setIsRightCollapsed, lastExpandedRightPercent, setRightSizes, setRightDragSizes])

  // Right panel drag state for performance optimization
  const [isDraggingRightSplit, setIsDraggingRightSplit] = useState(false)
  const rightSplitDraggingRef = useRef(false)

  // Keep left sizes sanitized and persisted if storage contained invalid data
  useEffect(() => {
    const sanitizedSizes = sanitizeSplitSizes(rawLeftPanelSizes, [20, 80])
    if (!areSizesEqual(sanitizedSizes, rawLeftPanelSizes as [number, number])) {
      void setLeftPanelSizes(sanitizedSizes)
    }
  }, [rawLeftPanelSizes, setLeftPanelSizes])

  useEffect(() => {
    const sanitizedLastExpanded = sanitizeSplitSizes(rawLeftPanelLastExpandedSizes, [20, 80])
    if (!areSizesEqual(sanitizedLastExpanded, rawLeftPanelLastExpandedSizes as [number, number])) {
      void setLeftPanelLastExpandedSizes(sanitizedLastExpanded)
    }
  }, [rawLeftPanelLastExpandedSizes, setLeftPanelLastExpandedSizes])

  // Memoized drag handlers for performance (following TerminalGrid pattern)
  const handleRightSplitDragStart = useCallback(() => {
    beginSplitDrag('app-right-panel', { orientation: 'col' })
    rightSplitDraggingRef.current = true
    setIsDraggingRightSplit(true)
    setRightDragSizes(null)
  }, [])

  const finalizeRightSplitDrag = useCallback((options?: { sizes?: number[] }) => {
    if (!rightSplitDraggingRef.current) return
    rightSplitDraggingRef.current = false
    
    setIsDraggingRightSplit(false)

    const commit = finalizeSplitCommit({
      dragSizes: rightDragSizes,
      nextSizes: options?.sizes,
      defaults: [70, 30],
      collapsed: false,
    })

    setRightDragSizes(null)

    if (commit) {
      if (!areSizesEqual(commit as [number, number], rightSizes as [number, number])) {
        void setRightSizes((): [number, number] => [commit[0], commit[1]])
      }
      if (commit[1] > 0 && commit[1] !== lastExpandedRightPercent) {
          void setLastExpandedRightPercent(commit[1])
      }
    }
    // Ensure we mark the panel expanded without overwriting the freshly committed sizes
    void setIsRightCollapsed(false)

    endSplitDrag('app-right-panel')
    window.dispatchEvent(new Event('right-panel-split-drag-end'))

    // Dispatch OpenCode resize event when right panel drag ends
    try {
      if (selection.kind === 'session' && selection.payload) {
        emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'session', sessionId: selection.payload })
      } else {
        emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'orchestrator' })
      }
    } catch (e) {
      logger.warn('[App] Failed to dispatch OpenCode resize event on right panel drag end', e)
    }

    try {
      if (selection.kind === 'session' && selection.payload) {
        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
      } else {
        emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
      }
    } catch (e) {
      logger.warn('[App] Failed to dispatch generic terminal resize request on right panel drag end', e)
    }
  }, [
    selection,
    setRightSizes,
    setLastExpandedRightPercent,
    setIsRightCollapsed,
    rightDragSizes,
    rightSizes,
    lastExpandedRightPercent,
  ])

  const handleRightSplitDragEnd = useCallback((nextSizes: number[]) => {
    finalizeRightSplitDrag({ sizes: nextSizes })
  }, [finalizeRightSplitDrag])
  const handleRightSplitDrag = useCallback((nextSizes: number[]) => {
    setRightDragSizes(nextSizes)
  }, [])

  useEffect(() => {
    const handlePointerEnd = () => finalizeRightSplitDrag()
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handlePointerEnd)
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', handlePointerEnd)
    }
  }, [finalizeRightSplitDrag])

  useEffect(() => {
    return () => {
      if (rightSplitDraggingRef.current) {
        rightSplitDraggingRef.current = false
        endSplitDrag('app-right-panel')
      }
    }
  }, [])
  
  // Start with home screen, user must explicitly choose a project
  // Remove automatic project detection to ensure home screen is shown first

  const cancelSessionImmediate = useCallback(async (sessionName: string) => {
    beginSessionMutation(sessionName, 'remove')
    try {
      await invoke(TauriCommands.SchaltwerkCoreCancelSession, {
        name: sessionName,
        ...(projectPath ? { projectPath } : {}),
      })
    } catch (error) {
      logger.error(`[App] Failed to cancel session ${sessionName}:`, error)
      throw error
    } finally {
      endSessionMutation(sessionName, 'remove')
    }
  }, [beginSessionMutation, endSessionMutation, projectPath])

  const forceCancelSessionImmediate = useCallback(async (sessionName: string) => {
    beginSessionMutation(sessionName, 'remove')
    try {
      await invoke(TauriCommands.SchaltwerkCoreForceCancelSession, {
        name: sessionName,
        ...(projectPath ? { projectPath } : {}),
      })
    } catch (error) {
      logger.error(`[App] Failed to force cancel session ${sessionName}:`, error)
      throw error
    } finally {
      endSessionMutation(sessionName, 'remove')
    }
  }, [beginSessionMutation, endSessionMutation, projectPath])

  const handleCancelSession = useCallback(async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await cancelSessionImmediate(currentSession.name)
      setCancelModalOpen(false)
      setCancelBlocker(null)
    } catch (error) {
      logger.error(`[App] Failed to cancel session ${currentSession.name}:`, error)
      setCancelBlocker(parseCancelBlocker(error) ?? {
        type: 'GitError',
        data: {
          operation: 'cancel_session',
          message: getErrorMessage(error),
        },
      })
      setCancelModalOpen(true)
    } finally {
      setIsCancelling(false)
    }
  }, [cancelSessionImmediate, currentSession])

  const handleForceCancelSession = useCallback(async () => {
    if (!currentSession) return

    try {
      setIsCancelling(true)
      await forceCancelSessionImmediate(currentSession.name)
      setCancelBlocker(null)
      setCancelModalOpen(false)
    } catch (error) {
      logger.error(`[App] Failed to force remove session ${currentSession.name}:`, error)
      setCancelBlocker({
        type: 'GitError',
        data: {
          operation: 'force_cancel_session',
          message: getErrorMessage(error),
        },
      })
      setCancelModalOpen(true)
    } finally {
      setIsCancelling(false)
    }
  }, [currentSession, forceCancelSessionImmediate])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenEvent(SchaltEvent.SessionCancelBlocked, (payload) => {
      if (disposed) return

      const blockedSession = allSessions.find(session => session.info.session_id === payload.session_name)
      setCurrentSession({
        id: payload.session_name,
        name: payload.session_name,
        displayName: blockedSession?.info.display_name || payload.session_name,
        branch: blockedSession?.info.branch || '',
        hasUncommittedChanges: blockedSession?.info.has_uncommitted_changes || false,
      })
      setCancelBlocker(payload.blocker)
      setCancelModalOpen(true)
      setIsCancelling(false)
    }).then(listener => {
      if (disposed) {
        listener()
      } else {
        unlisten = listener
      }
    }).catch(error => {
      logger.warn('[App] Failed to register cancel-blocked listener:', error)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [allSessions])

  const handleTerminateVersionGroup = useCallback(async () => {
    if (!terminateGroupModalState.open || terminateGroupModalState.sessions.length === 0) return

    setIsTerminatingGroup(true)
    const failedSessions: string[] = []

    for (const session of terminateGroupModalState.sessions) {
      try {
        await cancelSessionImmediate(session.name)
      } catch {
        failedSessions.push(session.displayName || session.name)
      }
    }

    setIsTerminatingGroup(false)

    if (failedSessions.length > 0) {
      alert(`Failed to terminate: ${failedSessions.join(', ')}`)
      return
    }

    setTerminateGroupModalState({ open: false, baseName: '', sessions: [] })
  }, [cancelSessionImmediate, terminateGroupModalState])

  const handleConvertVersionGroupToSpec = useCallback(async () => {
    if (!terminateGroupModalState.open || terminateGroupModalState.sessions.length === 0) return
    if (isConvertingGroup || isTerminatingGroup) return

    setIsConvertingGroup(true)
    try {
      await invoke<string>(TauriCommands.SchaltwerkCoreConvertVersionGroupToSpec, {
        baseName: terminateGroupModalState.baseName,
        sessionNames: terminateGroupModalState.sessions.map(s => s.name),
        ...(projectPath ? { projectPath } : {}),
      })
      setTerminateGroupModalState({ open: false, baseName: '', sessions: [] })
    } catch (error) {
      logger.error('[App] Failed to convert version group to spec:', error)
      alert(`Failed to convert version group to spec: ${error}`)
    } finally {
      setIsConvertingGroup(false)
    }
  }, [isConvertingGroup, isTerminatingGroup, projectPath, terminateGroupModalState])

  // Handle CLI directory argument
  useEffect(() => {
    // Handle opening a Git repository
    const unlistenDirectoryPromise = listenEvent(SchaltEvent.OpenDirectory, async (directoryPath) => {
      logger.info('Received open-directory event:', directoryPath)
      await openProjectOnce(directoryPath, 'open-directory-event')
    })

    const unlistenHomePromise = listenEvent(SchaltEvent.OpenHome, async (directoryPath) => {
      logger.info('Received open-home event:', directoryPath)
      if (tabsRestoredRef.current) {
        logger.debug('[App] Tabs already restored, ignoring OpenHome event')
        return
      }
      const restored = await tryRestoreOpenTabs()
      if (!restored) {
        setShowHome(true)
      }
    })

    // Handle CLI project validation errors
    const unlistenValidationErrorPromise = listenEvent(SchaltEvent.ProjectValidationError, async (payload) => {
      logger.warn('CLI project validation error:', payload.error)
      setCliValidationError(payload.error)
    })

    // Deterministically pull active project on mount to avoid event race.
    // The OpenHome event fires from a spawned backend task and can arrive
    // before this listener is registered, so we also attempt tab restoration
    // directly when no CLI project was provided.
    void (async () => {
      try {
        const active = await invoke<string | null>(TauriCommands.GetActiveProjectPath)
        if (active) {
          logger.info('Detected active project on startup:', active)
          await openProjectOnce(active, 'active-project-detection')
        } else {
          const restored = await tryRestoreOpenTabs()
          if (!restored) {
            setShowHome(true)
          }
        }
      } catch (_e) {
        logger.warn('Failed to fetch active project on startup:', _e)
      }
    })()

    return () => {
      void unlistenDirectoryPromise.then(unlisten => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove directory event listener', error)
        }
      })
      void unlistenHomePromise.then(unlisten => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove home event listener', error)
        }
      })
      void unlistenValidationErrorPromise.then(unlisten => {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[App] Failed to remove validation error event listener', error)
        }
      })
    }
  }, [openProjectOnce, tryRestoreOpenTabs])

  // Install smart dash/quote normalization for all text inputs (except terminals)
  useEffect(() => {
    installSmartDashGuards(document)
    logger.debug('[App] Smart dash normalization installed')
  }, [])

  useEffect(() => {
    const handlePermissionError = (detail: PermissionErrorDetail) => {
      const errorMessage = detail?.error ?? ''
      const match = errorMessage.match(/Permission required for folder: ([^.]+)/)
      const matchedPath = match && match[1] ? match[1].trim() : null
      const providedPath = detail?.path ?? matchedPath ?? null

      if (providedPath) {
        setPermissionDeniedPath(providedPath)
      } else {
        setPermissionDeniedPath(null)
      }

      const source = detail?.source
      const origin: 'project' | 'session' | 'unknown' =
        source === 'project'
          ? 'project'
          : source === 'session' || source === 'terminal' || source === undefined
            ? 'session'
            : 'unknown'

      setPermissionContext(origin)
      setShowPermissionPrompt(true)
    }

    const cleanup = listenUiEvent(UiEvent.PermissionError, handlePermissionError)

    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.SessionAction, (detail: SessionActionDetail) => {
      const { action, sessionId, sessionName, sessionDisplayName, branch, hasUncommittedChanges = false } = detail

      setCurrentSession({
        id: sessionId,
        name: sessionName,
        displayName: sessionDisplayName || sessionName,
        branch: branch || '',
        hasUncommittedChanges
      })

      if (action === 'cancel') {
        setCancelBlocker(null)
        setCancelModalOpen(true)
      } else if (action === 'cancel-immediate') {
        setCancelBlocker(null)
        setCancelModalOpen(false)
        void handleCancelSession()
      } else if (action === 'delete-spec') {
        setDeleteSpecModalOpen(true)
      }
    })

    return cleanup
  }, [handleCancelSession])

  const runningSessionCount = useMemo(
    () => allSessions.filter(s => s.info.session_state === SessionState.Running).length,
    [allSessions]
  )

  const handleCloseRequested = useCallback(() => {
    if (runningSessionCount > 0) {
      setCloseModalOpen(true)
    } else {
      getCurrentWindow().destroy().catch(err => logger.error('[App] Failed to close window', err))
    }
  }, [runningSessionCount])

  const handleCloseConfirmed = useCallback(() => {
    setCloseModalOpen(false)
    getCurrentWindow().destroy().catch(err => logger.error('[App] Failed to close window', err))
  }, [])

  useEffect(() => {
    const uiCleanup = listenUiEvent(UiEvent.CloseRequested, handleCloseRequested)

    let tauriCleanup: (() => void) | undefined
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      handleCloseRequested()
    }).then(unlisten => { tauriCleanup = unlisten })
      .catch(err => logger.error('[App] Failed to register close listener', err))

    return () => {
      uiCleanup()
      tauriCleanup?.()
    }
  }, [handleCloseRequested])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'

      // Phase 8 W.2: NewSession + NewSpec shortcuts collapsed onto a
      // single NewTask binding. Both Mod+N and Mod+Shift+N route here.
      if (!newTaskOpen && !cancelModalOpen && !isInputFocused && isShortcutForAction(e, KeyboardShortcutAction.NewTask, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        if (shouldBlockSessionModal('new task shortcut')) {
          return
        }
        logger.info('[App] New task shortcut triggered')
        previousFocusRef.current = document.activeElement
        setNewTaskOpen(true)
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.IncreaseFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        increaseFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.DecreaseFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        decreaseFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.ResetFontSize, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        resetFontSizes()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.OpenInApp, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        handleOpenInApp()
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.ToggleLeftSidebar, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        toggleLeftPanelCollapsed()
        return
      }
    }

    // Phase 8 W.2: GlobalNewSessionShortcut event retired; the terminal
    // emits NewTaskRequest now (handled by the listener below).

    const handleOpenDiffView = () => {
      setDiffViewerState({ mode: 'session', filePath: null })
      setIsDiffViewerOpen(true)
    }

    const handleOpenInApp = () => {
      setTriggerOpenInApp(prev => prev + 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    const cleanupOpenDiffView = listenUiEvent(UiEvent.OpenDiffView, () => handleOpenDiffView())
    const cleanupOpenDiffFile = listenUiEvent(UiEvent.OpenDiffFile, detail => {
      const filePath = detail?.filePath || null
      setDiffViewerState({ mode: 'session', filePath })
      setIsDiffViewerOpen(true)
    })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      cleanupOpenDiffView()
      cleanupOpenDiffFile()
    }
  }, [newTaskOpen, cancelModalOpen, increaseFontSizes, decreaseFontSizes, resetFontSizes, keyboardShortcutConfig, platform, shouldBlockSessionModal, toggleLeftPanelCollapsed])

  // Phase 8 W.2: NewSpecRequest retired. The legacy spec-create event is
  // gone; NewTaskRequest covers both former cases via the listener
  // below.

  // Phase 8 W.1/W.2: ConsolidateVersionGroup + TerminateVersionGroup
  // listeners retired. The emitters (SessionVersionGroup) were deleted in
  // W.1; consolidation as a top-level concept retires with the legacy
  // session list. v2 multi-candidate consolidation lives inside
  // TaskRunSlots (per-task, per-run).



  // Phase 8 W.2: NewSessionRequest renamed to NewTaskRequest. Listener
  // now opens the NewTaskModal (the v2 creation surface).
  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.NewTaskRequest, () => {
      if (shouldBlockSessionModal('new task request event')) {
        return
      }
      logger.info('[App] schaltwerk:new-task event received')
      previousFocusRef.current = document.activeElement
      setNewTaskOpen(true)
    })
    return cleanup
  }, [shouldBlockSessionModal])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenSettings, detail => {
      setSettingsInitialTab(detail?.tab)
      setSettingsOpen(true)
    })
    return cleanup
  }, [])

  // Phase 8 W.2: StartAgentFromSpec retired. v2 has no spec-with-agent
  // distinction — drafts ARE tasks. The "start agent from existing spec"
  // surface emitted from session card actions is gone with W.1.


  const cleanupSpecOrchestratorByName = useCallback(async (specName: string) => {
    let stableId =
      selection.kind === 'session'
      && selection.sessionState === 'spec'
      && selection.payload === specName
        ? selection.stableId ?? null
        : null

    if (!stableId) {
      try {
        const projectScope = projectPath ? { projectPath } : {}
        const spec = await invoke<RawSpec>(TauriCommands.SchaltwerkCoreGetSpec, { name: specName, ...projectScope })
        stableId = spec?.id ?? null
      } catch (error) {
        logger.warn('[App] Failed to load spec before orchestrator cleanup:', { specName, error })
      }
    }

    if (!stableId) {
      return
    }

    await clearTerminalTracking([specOrchestratorTerminalId(stableId)])
  }, [clearTerminalTracking, selection])

  const handleDeleteSpec = async () => {
    if (!currentSession) return

    const sessionName = currentSession.name
    beginSessionMutation(sessionName, 'remove')
    try {
      setIsCancelling(true)
      await cleanupSpecOrchestratorByName(sessionName)
      await invoke(TauriCommands.SchaltwerkCoreArchiveSpecSession, { name: sessionName })
      setDeleteSpecModalOpen(false)
      // No manual selection here; SessionRemoved + SessionsRefreshed will drive next focus
    } catch (error) {
      logger.error('Failed to delete spec:', error)
      alert(`Failed to delete spec: ${error}`)
    } finally {
      endSessionMutation(sessionName, 'remove')
      setIsCancelling(false)
    }
  }

  const handleOpenHistoryDiff = useCallback((payload: { repoPath: string; commit: HistoryItem; files: CommitFileChange[]; initialFilePath?: string | null }) => {
    const { repoPath, commit, files, initialFilePath } = payload
    const committedAt = Number.isFinite(commit.timestamp)
      ? new Date(commit.timestamp).toLocaleString()
      : undefined

    const historyContext: HistoryDiffContext = {
      repoPath,
      commitHash: commit.fullHash ?? commit.id,
      subject: commit.subject,
      author: commit.author,
      committedAt,
      files,
    }

    setDiffViewerState({ mode: 'history', filePath: initialFilePath ?? null, historyContext })
    setIsDiffViewerOpen(true)
  }, [])

  const handleCloseDiffViewer = () => {
    setIsDiffViewerOpen(false)
    setDiffViewerState(null)
  }

  // Phase 8 W.2: contextual create paths (forge issue/PR right-click →
  // create) collapsed onto a single task-create flow. The legacy
  // session/spec branches are gone; both kinds rebind to NewTaskModal.
  // Deeper prefill (passing the issue body into NewTaskModal as the
  // request_body) is W.5 §5.5 wiring; for now the contextual click just
  // opens NewTaskModal and the user types their own request.
  const handleContextualTaskCreate = useEffectEvent(() => {
    if (shouldBlockSessionModal('contextual action create task')) {
      return
    }
    previousFocusRef.current = document.activeElement
    setNewTaskOpen(true)
  })

  useEffect(() => {
    const sessionCleanup = listenUiEvent(UiEvent.ContextualActionCreateSession, handleContextualTaskCreate)
    const specCleanup = listenUiEvent(UiEvent.ContextualActionCreateSpec, handleContextualTaskCreate)
    const specClarifyCleanup = listenUiEvent(UiEvent.ContextualActionCreateSpecClarify, handleContextualTaskCreate)
    return () => {
      sessionCleanup()
      specCleanup()
      specClarifyCleanup()
    }
  }, [handleContextualTaskCreate])

  const handleGoHome = useCallback(() => {
    setShowHome(true)
    clearPendingPath()
    void deactivateProject()
  }, [deactivateProject, clearPendingPath])

  const handleSelectTab = useCallback(async (path: string): Promise<boolean> => {
    if (!path) {
      return false
    }

    const hasCompetingSwitch = Boolean(
      projectSwitchStatus?.inFlight &&
      projectSwitchStatus.target &&
      projectSwitchStatus.target !== path
    )

    if (path === projectPath && !hasCompetingSwitch) {
      clearPendingPath(path)
      setShowHome(false)
      return true
    }

    if (pendingActivePathRef.current === path) {
      setShowHome(false)
      return true
    }

    pendingActivePathRef.current = path
    setPendingActivePath(path)
    setShowHome(false)

    try {
      const switched = await selectProject({ path })
      if (!switched && projectPath !== path) {
        clearPendingPath(path)
      }
      return switched
    } catch (error) {
      logger.error('Failed to switch project:', error)
      clearPendingPath(path)
      return false
    }
  }, [selectProject, projectPath, clearPendingPath, projectSwitchStatus])

  const handleCloseTab = useCallback(async (path: string) => {
    try {
      const result = await closeProject({ path })
      if (!result.closed) {
        logger.warn('Aborting tab close because backend rejected the request')
        return
      }

      setAttentionCounts(prev => {
        if (!(path in prev)) {
          return prev
        }
        const { [path]: _removed, ...rest } = prev
        return rest
      })

      setRunningCounts(prev => {
        if (!(path in prev)) {
          return prev
        }
        const { [path]: _removed, ...rest } = prev
        return rest
      })

      setShowHome(result.nextActivePath === null)
    } catch (error) {
      logger.warn('Failed to cleanup closed project:', error)
    }
  }, [closeProject])

  const switchProject = useCallback(async (direction: 'prev' | 'next') => {
    if (projectTabs.length <= 1) return
    if (!projectPath) return

    const currentIndex = projectTabs.findIndex(tab => tab.projectPath === projectPath)
    if (currentIndex === -1) return

    let newIndex: number
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % projectTabs.length
    } else {
      newIndex = (currentIndex - 1 + projectTabs.length) % projectTabs.length
    }

    const targetTab = projectTabs[newIndex]
    if (targetTab?.projectPath) {
      await handleSelectTab(targetTab.projectPath)
    }
  }, [projectTabs, projectPath, handleSelectTab])

  const switchToProject = useCallback(async (index: number) => {
    const tab = projectTabs[index]
    if (tab?.projectPath) {
      await handleSelectTab(tab.projectPath)
    }
  }, [projectTabs, handleSelectTab])

  const handleSwitchToProject = useCallback((index: number) => {
    void switchToProject(index)
  }, [switchToProject])

  const handleCycleNextProject = useCallback(() => {
    void switchProject('next')
  }, [switchProject])

  const handleCyclePrevProject = useCallback(() => {
    void switchProject('prev')
  }, [switchProject])

  const tabsWithAttention = useMemo(() => projectTabs.map(tab => {
    const cross = crossProjectCounts[tab.projectPath]
    if (tab.projectPath === projectPath) {
      return {
        ...tab,
        attentionCount: attentionCounts[tab.projectPath] ?? 0,
        runningCount: runningCounts[tab.projectPath] ?? 0,
      }
    }
    return {
      ...tab,
      attentionCount: cross?.attention ?? attentionCounts[tab.projectPath] ?? 0,
      runningCount: cross?.running ?? runningCounts[tab.projectPath] ?? 0,
    }
  }), [projectTabs, projectPath, attentionCounts, runningCounts, crossProjectCounts])

  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  )
  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const collapsedLeftPanelSizes = useMemo(() => {
    const safeWidth = Math.max(windowWidth, COLLAPSED_LEFT_PANEL_PX + 400)
    const pct = Math.min(40, (COLLAPSED_LEFT_PANEL_PX / safeWidth) * 100)
    return [pct, 100 - pct]
  }, [windowWidth])

  useEffect(() => {
    // When the left sidebar collapses, share the newly freed space evenly between terminal and right panel.
    // When it re-expands, restore the previous user-defined split.
    if (isLeftPanelCollapsed) {
      if (rightSizesBeforeLeftCollapseRef.current === null) {
        rightSizesBeforeLeftCollapseRef.current = safeRightSizes as number[]
        const expandedMainPct = leftPanelSizes[1]
        const collapsedMainPct = collapsedLeftPanelSizes[1]
        const deltaTotalPct = collapsedMainPct - expandedMainPct
        if (deltaTotalPct > 0) {
          const terminalTotal = (safeRightSizes[0] / 100) * expandedMainPct
        const terminalTotalNew = terminalTotal + deltaTotalPct * 0.4
        const collapsedMainSafe = collapsedMainPct || 1
        const terminalPctNew = Math.min(100, Math.max(0, (terminalTotalNew / collapsedMainSafe) * 100))
        const rightPctNew = 100 - terminalPctNew
        void setRightSizes([terminalPctNew, rightPctNew])
      }
      }
    } else if (rightSizesBeforeLeftCollapseRef.current) {
      void setRightSizes(rightSizesBeforeLeftCollapseRef.current as [number, number])
      rightSizesBeforeLeftCollapseRef.current = null
    }
  }, [isLeftPanelCollapsed, collapsedLeftPanelSizes, leftPanelSizes, safeRightSizes, setRightSizes])

  const activeTabPath = showHome ? null : (pendingActivePath ?? projectPath)

  // Update unified work area ring color when selection changes
  useEffect(() => {
    const el = document.getElementById('work-ring')
    if (!el) return
    // Remove the ring entirely - no visual indicator needed
    el.style.boxShadow = 'none'
  }, [selection])

  if (showHome && projectTabs.length === 0) {
    return (
      <>
        <TopBar
          tabs={[]}
          activeTabPath={null}
          onGoHome={() => {}}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onOpenSettings={() => {
            setSettingsInitialTab(undefined)
            setSettingsOpen(true)
          }}
        />
        <div className="pt-[32px] h-full">
          <HomeScreen
            onOpenProject={(path) => { void openProjectOnce(path, 'home-screen') }}
            initialError={cliValidationError}
            onClearInitialError={() => setCliValidationError(null)}
          />
        </div>
        <SetupScriptApprovalModal
          open={Boolean(setupScriptProposal)}
          script={setupScriptProposal?.setupScript ?? ''}
          isApplying={isApplyingSetupScript}
          onConfirm={() => { void approveSetupScript() }}
          onCancel={rejectSetupScript}
        />
        <SettingsModal
          open={settingsOpen}
          initialTab={settingsInitialTab}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsInitialTab(undefined)
          }}
        />
        <ViewProcessesModal />
      </>
    )
  }

  return (
    <ErrorBoundary name="App">
      <FocusSync />
      {/* Show TopBar always */}
      <TopBar
        tabs={tabsWithAttention}
        activeTabPath={activeTabPath}
        onGoHome={handleGoHome}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenSettings={() => {
          setSettingsInitialTab(undefined)
          setSettingsOpen(true)
        }}
        onOpenProjectSelector={() => setProjectSelectorOpen(true)}
        resolveOpenPath={async () => resolveOpenPathForOpenButton({
          selection,
          activeTabPath,
          projectPath,
          invoke
        })}
        isRightPanelCollapsed={isRightCollapsed}
        onToggleRightPanel={toggleRightPanelCollapsed}
        triggerOpenCounter={triggerOpenInApp}
      />

      {/* Show home screen if requested, or no active tab */}
      {showHome && (
        <div className="pt-[32px] h-full">
          <ErrorBoundary name="HomeScreen">
            <HomeScreen
              onOpenProject={(path) => { void openProjectOnce(path, 'home-screen') }}
              initialError={cliValidationError}
              onClearInitialError={() => setCliValidationError(null)}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Show project content when a tab is active */}
      {!showHome && activeTabPath && (
        <>
          <div className="pt-[32px] h-full flex flex-col w-full">
            <div className="flex-1 min-h-0">
              <Split
                className="h-full w-full flex"
                sizes={isLeftPanelCollapsed ? collapsedLeftPanelSizes : leftRenderSizes}
                minSize={[isLeftPanelCollapsed ? COLLAPSED_LEFT_PANEL_PX : 240, 400]}
                gutterSize={isLeftPanelCollapsed ? 0 : SPLIT_GUTTER_SIZE}
                onDragStart={handleLeftSplitDragStart}
                onDrag={handleLeftSplitDrag}
                onDragEnd={handleLeftSplitDragEnd}
              >
                <div
                  className="h-full border-r overflow-y-auto shrink-0"
                  style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    borderRightColor: 'var(--color-border-default)',
                    minWidth: isLeftPanelCollapsed ? `${COLLAPSED_LEFT_PANEL_PX}px` : undefined,
                    maxWidth: isLeftPanelCollapsed ? `${COLLAPSED_LEFT_PANEL_PX}px` : undefined,
                  }}
                  data-testid="sidebar"
                >
                  <div className="h-full flex flex-col min-h-0">
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <SessionErrorBoundary>
                        <Sidebar 
                          isDiffViewerOpen={isDiffViewerOpen}
                          openTabs={projectTabs}
                          onSwitchToProject={handleSwitchToProject}
                          onCycleNextProject={handleCycleNextProject}
                          onCyclePrevProject={handleCyclePrevProject}
                          isCollapsed={isLeftPanelCollapsed}
                          onExpandRequest={toggleLeftPanelCollapsed}
                          onToggleSidebar={toggleLeftPanelCollapsed}
                        />
                      </SessionErrorBoundary>
                    </div>
                    {!isLeftPanelCollapsed && (
                    <div
                      className="p-2 border-t"
                      style={{ borderTopColor: 'var(--color-border-default)' }}
                    >
                      <div
                        className="flex items-center justify-between px-1 pb-2 text-[11px]"
                        style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                        aria-hidden="true"
                      >
                        <span className="flex items-center gap-2">
                          <span>Cycle sidebar items</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>⌥⇧` · ⌥`</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span>Cycle filters</span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>⌘← · ⌘→</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <button
                          onClick={() => {
                            previousFocusRef.current = document.activeElement
                            setNewTaskOpen(true)
                          }}
                          className="w-full text-sm px-3 py-2 rounded group transition-colors flex items-center justify-between border"
                          style={{
                            backgroundColor: 'rgba(var(--color-bg-elevated-rgb), 0.6)',
                            color: 'var(--color-text-primary)',
                            borderColor: 'var(--color-border-subtle)'
                          }}
                          data-testid="home-new-task-button"
                          data-onboarding="new-task-button"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-hover-rgb), 0.6)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-elevated-rgb), 0.6)'
                          }}
                          title={`+ New Task (${newTaskShortcut})`}
                        >
                          <span>+ New Task</span>
                          <span
                            className="text-xs px-2 py-0.5 rounded transition-opacity group-hover:opacity-100"
                            style={{
                              backgroundColor: 'var(--color-bg-secondary)',
                              color: 'var(--color-text-secondary)'
                            }}
                          >
                            {newTaskShortcut}
                          </span>
                        </button>
                      </div>
                    </div>
                    )}
                  </div>
                </div>

                <div className="relative h-full">
                  {/* Unified session ring around center + right (Claude, Terminal, Diff) */}
                  <div id="work-ring" className="absolute inset-2 rounded-xl pointer-events-none" />
                  {isRightCollapsed || selectionIsSpec ? (
                    // When collapsed, render only the terminal grid at full width
                    <main className="h-full w-full" style={{ backgroundColor: 'var(--color-bg-primary)' }} data-testid="terminal-grid">
                      <ErrorBoundary name="TerminalGrid">
                        <TerminalGrid />
                      </ErrorBoundary>
                    </main>
                  ) : (
                    // When expanded, render the split view
                      <Split 
                      className="h-full w-full flex" 
                      sizes={rightRenderSizes} 
                      minSize={[400, 280]} 
                      gutterSize={SPLIT_GUTTER_SIZE}
                      onDragStart={handleRightSplitDragStart}
                      onDrag={handleRightSplitDrag}
                      onDragEnd={handleRightSplitDragEnd}
                    >
                      <main className="h-full" style={{ backgroundColor: 'var(--color-bg-primary)' }} data-testid="terminal-grid">
                        <ErrorBoundary name="TerminalGrid">
                          <TerminalGrid />
                        </ErrorBoundary>
                      </main>
                      <section className={`overflow-hidden`}>
                        <ErrorBoundary name="RightPanel">
                          <RightPanelTabs 
                            onOpenHistoryDiff={handleOpenHistoryDiff}
                            isDragging={isDraggingRightSplit}
                            onInlineReviewModeChange={handleInlineReviewModeChange}
                          />
                        </ErrorBoundary>
                      </section>
                    </Split>
                  )}
                </div>
              </Split>
            </div>
          </div>

           {/* Phase 7 Wave D.1: + New Task primary creation surface.
               Phase 8 W.2: NewSessionModal mount retired entirely. */}
           <NewTaskModal
             isOpen={newTaskOpen}
             onClose={() => setNewTaskOpen(false)}
             projectPath={projectPath}
           />

          {currentSession && (
            <>
              <CancelConfirmation
                open={cancelModalOpen}
                displayName={currentSession.displayName}
                branch={currentSession.branch}
                hasUncommittedChanges={currentSession.hasUncommittedChanges}
                cancelBlocker={cancelBlocker}
                onConfirm={() => { void handleCancelSession() }}
                onForceRemove={() => { void handleForceCancelSession() }}
                onCancel={() => {
                  setCancelBlocker(null)
                  setCancelModalOpen(false)
                }}
                loading={isCancelling}
              />
               <DeleteSpecConfirmation
                 open={deleteSpecModalOpen}
                 displayName={currentSession.displayName}
                 onConfirm={() => { void handleDeleteSpec() }}
                 onCancel={() => setDeleteSpecModalOpen(false)}
                 loading={isCancelling}
               />
            </>
          )}

          <CloseConfirmation
            open={closeModalOpen}
            runningCount={runningSessionCount}
            onConfirm={handleCloseConfirmed}
            onCancel={() => setCloseModalOpen(false)}
          />

          <TerminateVersionGroupConfirmation
            open={terminateGroupModalState.open}
            baseName={terminateGroupModalState.baseName}
            sessions={terminateGroupModalState.sessions}
            onConfirm={() => { void handleTerminateVersionGroup() }}
            onConvertToSpec={() => { void handleConvertVersionGroupToSpec() }}
            onCancel={() => {
              if (isTerminatingGroup || isConvertingGroup) return
              setTerminateGroupModalState({ open: false, baseName: '', sessions: [] })
            }}
            loading={isTerminatingGroup}
            converting={isConvertingGroup}
          />

          {/* Diff Viewer Modal with Review - render only when open */}
          {isDiffViewerOpen && diffViewerState && (
            <UnifiedDiffModal
              filePath={diffViewerState.filePath}
              isOpen={true}
              onClose={handleCloseDiffViewer}
              mode={diffViewerState.mode}
              historyContext={diffViewerState.mode === 'history' ? diffViewerState.historyContext : undefined}
            />
          )}
          
          <AgentCliMissingModal
            open={showCliMissingModal}
            loading={agentDetectLoading}
            statusByAgent={agentStatusByName}
            onRefresh={() => { void refreshAgentDetection() }}
            onOpenSettings={() => emitUiEvent(UiEvent.OpenSettings, { tab: 'environment' })}
            onClose={() => setShowCliMissingModal(false)}
          />

          <SetupScriptApprovalModal
            open={Boolean(setupScriptProposal)}
            script={setupScriptProposal?.setupScript ?? ''}
            isApplying={isApplyingSetupScript}
            onConfirm={() => { void approveSetupScript() }}
            onCancel={rejectSetupScript}
          />

          {/* Settings Modal */}
          <SettingsModal
            open={settingsOpen}
            initialTab={settingsInitialTab}
            onClose={() => {
              setSettingsOpen(false)
              setSettingsInitialTab(undefined)
            }}
            onOpenTutorial={openOnboarding}
          />

          <ViewProcessesModal />

          {/* Project Selector Modal */}
          <ProjectSelectorModal
            open={projectSelectorOpen}
            onClose={() => setProjectSelectorOpen(false)}
            onOpenProject={(path) => { void openProjectOnce(path, 'project-selector-modal') }}
            openProjectPaths={projectTabs.map(tab => tab.projectPath)}
          />

          <OnboardingModal
            open={isOnboardingOpen}
            onClose={closeOnboarding}
            onComplete={() => { void completeOnboarding() }}
          />

          {/* Permission Prompt - shows only when needed */}
          {showPermissionPrompt && (
            <PermissionPrompt
              showOnlyIfNeeded={true}
              folderPath={permissionDeniedPath || undefined}
              onPermissionGranted={() => {
                const targetPath = permissionDeniedPath
                const origin = permissionContext
                logger.info(`Folder permission granted for: ${targetPath ?? 'unknown path'}`)
                setShowPermissionPrompt(false)
                setPermissionDeniedPath(null)
                setPermissionContext('unknown')
                if (origin === 'project' && targetPath) {
                  void openProjectOnce(targetPath, 'permission-prompt')
                }
              }}
              onRetryAgent={permissionContext === 'session'
                ? () => {
                    emitUiEvent(UiEvent.RetryAgentStart)
                    setShowPermissionPrompt(false)
                    setPermissionDeniedPath(null)
                    setPermissionContext('unknown')
                  }
                : undefined}
            />
          )}
        </>
      )}
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <PierreDiffProvider>
      <AppContent />
    </PierreDiffProvider>
  )
}
