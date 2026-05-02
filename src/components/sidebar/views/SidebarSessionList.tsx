import clsx from 'clsx'
import { type RefObject } from 'react'
import { useTranslation } from '../../../common/i18n/useTranslation'
import { CollapsedSidebarRail } from '../CollapsedSidebarRail'
import { KanbanView } from '../KanbanView'
import { KanbanSessionRow } from '../KanbanSessionRow'
import { SessionCardActionsProvider, type SessionCardActions } from '../../../contexts/SessionCardActionsContext'
import { type EnrichedSession, type Epic } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { SessionSelection } from '../../../hooks/useSessionManagement'
import type { MergeStatus } from '../../../store/atoms/sessions'
import type { SidebarViewMode } from '../../../store/atoms/sidebarViewMode'
import { SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import type { SidebarSectionKey } from '../helpers/versionGroupings'
import type { SidebarSectionCollapseState } from '../helpers/sectionCollapse'
import { SidebarVersionGroupRow } from './SidebarVersionGroupRow'
import { SidebarSectionView } from './SidebarSectionView'

interface SidebarSessionListProps {
    listRef: RefObject<HTMLDivElement | null>
    isCollapsed: boolean
    loading: boolean
    sidebarViewMode: SidebarViewMode
    selection: Selection
    sessions: EnrichedSession[]
    flattenedSessions: EnrichedSession[]
    sectionGroups: Record<SidebarSectionKey, SessionVersionGroupType[]>
    collapsedSections: SidebarSectionCollapseState
    collapsedEpicIds: Record<string, boolean>
    epicMenuOpenId: string | null
    setEpicMenuOpenId: (id: string | null) => void
    getCollapsedEpicKey: (section: SidebarSectionKey, epicId: string) => string
    onToggleEpicCollapsed: (section: SidebarSectionKey, epicId: string) => void
    onToggleSectionCollapsed: (section: SidebarSectionKey) => void
    onEditEpic: (epic: Epic) => void
    onDeleteEpic: (epic: Epic) => void
    sessionCardActions: SessionCardActions
    sessionsWithNotifications: Set<string>
    resettingSelection?: SessionSelection | null
    isSessionRunning: (sessionId: string) => boolean
    isSessionMerging: (sessionId: string) => boolean
    getMergeStatus: (sessionId: string) => MergeStatus
    isSessionMutating: (sessionId: string) => boolean
    onSelectSession: (sessionOrIndex: string | number) => void
    onSelectBestVersion: (groupBaseName: string, selectedSessionId: string) => void
    onTriggerConsolidationJudge: (roundId: string, early?: boolean) => void | Promise<void>
    onConfirmConsolidationWinner: (roundId: string, winnerSessionId: string) => void | Promise<void>
    onScroll: (event: { currentTarget: { scrollTop: number } }) => void
    onExpandRequest?: () => void
}

export function SidebarSessionList({
    listRef,
    isCollapsed,
    loading,
    sidebarViewMode,
    selection,
    sessions,
    flattenedSessions,
    sectionGroups,
    collapsedSections,
    collapsedEpicIds,
    epicMenuOpenId,
    setEpicMenuOpenId,
    getCollapsedEpicKey,
    onToggleEpicCollapsed,
    onToggleSectionCollapsed,
    onEditEpic,
    onDeleteEpic,
    sessionCardActions,
    sessionsWithNotifications,
    resettingSelection,
    isSessionRunning,
    isSessionMerging,
    getMergeStatus,
    isSessionMutating,
    onSelectSession,
    onSelectBestVersion,
    onTriggerConsolidationJudge,
    onConfirmConsolidationWinner,
    onScroll,
    onExpandRequest,
}: SidebarSessionListProps) {
    const { t } = useTranslation()

    const renderEmpty = () => (
        <div className="text-center text-text-muted py-4">{t.sidebar.empty}</div>
    )

    const renderCollapsedRail = () => (
        <CollapsedSidebarRail
            sessions={flattenedSessions}
            selection={selection}
            hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
            isSessionRunning={isSessionRunning}
            onSelect={(sessionOrIndex) => { onSelectSession(sessionOrIndex) }}
            onExpandRequest={onExpandRequest}
        />
    )

    const renderKanban = () => (
        <KanbanView
            sessions={sessions}
            renderSession={(session) => (
                <KanbanSessionRow
                    session={session}
                    isSelected={selection.kind === 'session' && selection.payload === session.info.session_id}
                    onSelect={(s) => { onSelectSession(s.info.session_id) }}
                />
            )}
        />
    )

    const renderListBody = () => {
        let globalIndex = 0

        const renderVersionGroup = (group: SessionVersionGroupType) => {
            const groupStartIndex = globalIndex
            globalIndex += group.versions.length

            return (
                <SidebarVersionGroupRow
                    key={group.id}
                    group={group}
                    startIndex={groupStartIndex}
                    selection={selection}
                    hasFollowUpMessage={(sessionId: string) => sessionsWithNotifications.has(sessionId)}
                    resettingSelection={resettingSelection}
                    isSessionRunning={isSessionRunning}
                    isMergeDisabled={isSessionMerging}
                    getMergeStatus={getMergeStatus}
                    isSessionBusy={isSessionMutating}
                    onSelectBestVersion={onSelectBestVersion}
                    onTriggerConsolidationJudge={onTriggerConsolidationJudge}
                    onConfirmConsolidationWinner={onConfirmConsolidationWinner}
                />
            )
        }

        const sectionViewCommon = {
            collapsedEpicIds,
            epicMenuOpenId,
            setEpicMenuOpenId,
            getCollapsedEpicKey,
            onToggleEpicCollapsed,
            onToggleSectionCollapsed,
            onEditEpic,
            onDeleteEpic,
            renderVersionGroup,
        }

        return (
            <SessionCardActionsProvider actions={sessionCardActions}>
                <SidebarSectionView
                    key="sidebar-section-specs"
                    sectionKey="specs"
                    title={t.sidebar.sections.specs}
                    groups={sectionGroups.specs}
                    collapsed={collapsedSections.specs}
                    {...sectionViewCommon}
                />
                <SidebarSectionView
                    key="sidebar-section-running"
                    sectionKey="running"
                    title={t.sidebar.sections.running}
                    groups={sectionGroups.running}
                    collapsed={collapsedSections.running}
                    {...sectionViewCommon}
                />
            </SessionCardActionsProvider>
        )
    }

    const renderBody = () => {
        if (sessions.length === 0 && !loading) {
            return renderEmpty()
        }
        if (isCollapsed) {
            return renderCollapsedRail()
        }
        // Phase 7 close-out: kanban view is disabled during the v2
        // cutover. Force list mode regardless of the persisted
        // preference; the toggle in SidebarHeaderBar is already
        // disabled with a "returns in v2.1" tooltip. Leaving the
        // kanban renderer active would silently break for the task
        // surface (KanbanView only knows how to render sessions).
        if (sidebarViewMode === 'board') {
            return renderListBody()
        }
        return renderListBody()
    }

    return (
        <div
            ref={listRef}
            onScroll={onScroll}
            className={clsx(
                'flex-1 min-h-0 overflow-y-auto pt-1',
                isCollapsed ? 'px-0.5' : 'px-2'
            )}
            data-testid="session-scroll-container"
            data-onboarding="session-list"
        >
            {renderBody()}
        </div>
    )
}
