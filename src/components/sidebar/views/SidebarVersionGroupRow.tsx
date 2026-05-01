import { SessionVersionGroup } from '../SessionVersionGroup'
import { SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import { emitUiEvent, UiEvent } from '../../../common/uiEvents'
import { getSessionDisplayName } from '../../../utils/sessionDisplayName'
import { buildConsolidationGroupDetail } from '../helpers/consolidationGroupDetail'
import type { Selection } from '../../../store/atoms/selection'
import type { MergeStatus } from '../../../store/atoms/sessions'
import type { SessionSelection } from '../../../hooks/useSessionManagement'

interface SidebarVersionGroupRowProps {
    group: SessionVersionGroupType
    startIndex: number
    selection: Selection
    hasFollowUpMessage: (sessionId: string) => boolean
    resettingSelection?: SessionSelection | null
    isSessionRunning?: (sessionId: string) => boolean
    isMergeDisabled?: (sessionId: string) => boolean
    getMergeStatus?: (sessionId: string) => MergeStatus
    isSessionBusy?: (sessionId: string) => boolean
    onSelectBestVersion: (groupBaseName: string, selectedSessionId: string) => void
    onTriggerConsolidationJudge: (roundId: string, early?: boolean) => void | Promise<void>
    onConfirmConsolidationWinner: (roundId: string, winnerSessionId: string) => void | Promise<void>
}

export function SidebarVersionGroupRow({
    group,
    startIndex,
    selection,
    hasFollowUpMessage,
    resettingSelection,
    isSessionRunning,
    isMergeDisabled,
    getMergeStatus,
    isSessionBusy,
    onSelectBestVersion,
    onTriggerConsolidationJudge,
    onConfirmConsolidationWinner,
}: SidebarVersionGroupRowProps) {
    return (
        <SessionVersionGroup
            key={group.id}
            group={group}
            selection={selection}
            startIndex={startIndex}
            hasFollowUpMessage={hasFollowUpMessage}
            onSelectBestVersion={onSelectBestVersion}
            resettingSelection={resettingSelection}
            isSessionRunning={isSessionRunning}
            isMergeDisabled={isMergeDisabled}
            getMergeStatus={getMergeStatus}
            isSessionBusy={isSessionBusy}
            onConsolidate={(g) => {
                const detail = buildConsolidationGroupDetail(g)
                if (detail) {
                    emitUiEvent(UiEvent.ConsolidateVersionGroup, detail)
                }
            }}
            onTriggerConsolidationJudge={onTriggerConsolidationJudge}
            onConfirmConsolidationWinner={onConfirmConsolidationWinner}
            onTerminateAll={(g) => {
                const runningSessions = g.versions
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
                    baseName: g.baseName,
                    sessions: runningSessions,
                })
            }}
        />
    )
}
