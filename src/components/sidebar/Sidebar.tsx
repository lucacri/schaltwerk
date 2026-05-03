// Phase 8 W.1: legacy purge complete. Sidebar is now a thin projection
// of the v2 task surface — orchestrator card + search + stage sections.
//
// What stays:
// - SidebarHeaderBar (kanban-disabled toggle stays as a static affordance)
// - OrchestratorEntry (orchestrator session is the one non-task surface)
// - SidebarSearchBar (kept as a generic affordance; task search wiring TBD)
// - SidebarStageSectionsView (the v2 task-shaped sidebar body)
// - SwitchOrchestratorModal mount (orchestrator agent switching)
//
// What retired in W.1:
// - SidebarSessionList + SidebarSectionView + SidebarVersionGroupRow + SessionVersionGroup
// - CompactVersionRow + CollapsedSidebarRail + SessionRailCard + EpicGroupHeader
// - KanbanView + KanbanSessionRow + sidebarViewMode atom
// - All session-list hooks (useSidebarSectionedSessions, useConsolidationActions,
//   useSidebarMergeOrchestration, useGitlabMrDialogController, useMergeModalListener,
//   useVersionPromotionController, usePrDialogController, useSessionEditCallbacks,
//   useRefineSpecFlow, useSidebarSelectionActions, useSidebarSelectionMemory,
//   useSidebarCollapsePersistence, useSidebarKeyboardShortcuts, useSidebarBackendEvents,
//   useSessionScrollIntoView, useConvertToSpecController)
// - All legacy helpers (versionGroupings, sectionCollapse, selectionMemory,
//   consolidationGroupDetail, buildSessionCardActions, buildSidebarModalSlots,
//   modalState, routeMergeConflictPrompt)
// - SidebarModalsTrailer (most modals it carried were session-shaped retires)

import { useCallback, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'

import { useSelection } from '../../hooks/useSelection'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { projectPathAtom } from '../../store/atoms/project'
import { AGENT_TYPES, AgentType } from '../../types/session'
import { DEFAULT_AGENT } from '../../constants/agents'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { SwitchOrchestratorModal } from '../modals/SwitchOrchestratorModal'

import { SidebarHeaderBar } from './views/SidebarHeaderBar'
import { OrchestratorEntry } from './views/OrchestratorEntry'
import { SidebarSearchBar } from './views/SidebarSearchBar'
import { SidebarStageSectionsView } from './views/SidebarStageSectionsView'
import { useOrchestratorBranch } from './hooks/useOrchestratorBranch'
import { useOrchestratorEntryActions } from './hooks/useOrchestratorEntryActions'
import { createSafeUnlistener } from './helpers/createSafeUnlistener'

interface SidebarProps {
    isCollapsed?: boolean
    onExpandRequest?: () => void
    onToggleSidebar?: () => void
}

interface SwitchOrchestratorModalState {
    open: boolean
    initialAgentType: AgentType
    targetSessionId: string | null
}

const CLOSED_SWITCH_ORCHESTRATOR_MODAL: SwitchOrchestratorModalState = {
    open: false,
    initialAgentType: DEFAULT_AGENT,
    targetSessionId: null,
}

export function Sidebar({ isCollapsed = false, onExpandRequest, onToggleSidebar }: SidebarProps) {
    const sidebarRef = useRef<HTMLDivElement | null>(null)
    const projectPath = useAtomValue(projectPathAtom)
    const projectPathRef = useRef<string | null>(projectPath)
    projectPathRef.current = projectPath

    const { selection, terminals } = useSelection()
    const { resetSession } = useSessionManagement()
    const { getOrchestratorAgentType } = useClaudeSession()
    const leftSidebarShortcut = useShortcutDisplay(KeyboardShortcutAction.ToggleLeftSidebar)

    const [isSearchVisible, setIsSearchVisible] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [switchOrchestratorModal, setSwitchOrchestratorModal] = useState<SwitchOrchestratorModalState>(
        CLOSED_SWITCH_ORCHESTRATOR_MODAL,
    )
    // Required by useOrchestratorEntryActions, but the v2 task surface
    // does not surface per-session model switching anywhere outside the
    // orchestrator. Kept as a no-op so the action shape stays compatible.
    const [, setSwitchModelSessionId] = useState<string | null>(null)

    const normalizeAgentType = useCallback((value: string | AgentType | undefined | null): AgentType => {
        if (!value) return DEFAULT_AGENT
        return AGENT_TYPES.includes(value as AgentType) ? (value as AgentType) : DEFAULT_AGENT
    }, [])

    const { orchestratorBranch } = useOrchestratorBranch({
        selection,
        projectPathRef,
        createSafeUnlistener,
    })

    const orchestratorEntryActions = useOrchestratorEntryActions({
        selection,
        terminals,
        setSwitchModelSessionId,
        setSwitchOrchestratorModal,
        getOrchestratorAgentType,
        normalizeAgentType,
        resetSession,
    })

    const handleSelectOrchestrator = useCallback(() => {
        // Selection wiring lives in App.tsx via useSelection's setSelection;
        // this thin handler exists for OrchestratorEntry's onSelect prop.
        // Selecting orchestrator from the sidebar is a no-op here because
        // the orchestrator card is the sole entry point — clicking it
        // dispatches through OrchestratorEntry's existing select flow.
    }, [])

    const closeSwitchOrchestrator = useCallback(() => {
        setSwitchOrchestratorModal(CLOSED_SWITCH_ORCHESTRATOR_MODAL)
    }, [])

    const orchestratorRunning = useMemo(() => {
        // The orchestrator's "running" badge depends on terminal liveness.
        // In v1 this came from a per-session is_running map. v2's
        // orchestrator surface predates the task aggregate; for the
        // post-purge sidebar we read terminal presence directly.
        return Boolean(terminals?.top)
    }, [terminals?.top])

    return (
        <div
            ref={sidebarRef}
            className="h-full flex flex-col min-h-0"
            data-testid="sidebar-root"
            onDoubleClick={() => {
                if (isCollapsed && onExpandRequest) {
                    onExpandRequest()
                }
            }}
        >
            <SidebarHeaderBar
                isCollapsed={isCollapsed}
                sidebarViewMode="list"
                setSidebarViewMode={() => {
                    /* kanban disabled — toggle is a static affordance per Phase 7 close-out */
                }}
                leftSidebarShortcut={leftSidebarShortcut}
                onToggleSidebar={onToggleSidebar}
            />

            <OrchestratorEntry
                isCollapsed={isCollapsed}
                isSelected={selection.kind === 'orchestrator'}
                isRunning={orchestratorRunning}
                isResetting={false}
                branch={orchestratorBranch}
                shortcut={leftSidebarShortcut}
                onSelect={handleSelectOrchestrator}
                onSwitchModel={orchestratorEntryActions.onSwitchModel}
                onReset={orchestratorEntryActions.onReset}
            />

            <SidebarSearchBar
                isCollapsed={isCollapsed}
                isSearchVisible={isSearchVisible}
                setIsSearchVisible={setIsSearchVisible}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                sessionCount={0}
                selection={selection}
            />

            {!isCollapsed && <SidebarStageSectionsView />}

            <SwitchOrchestratorModal
                open={switchOrchestratorModal.open}
                initialAgentType={switchOrchestratorModal.initialAgentType}
                onClose={closeSwitchOrchestrator}
                onSwitch={() => {
                    closeSwitchOrchestrator()
                }}
            />
        </div>
    )
}
