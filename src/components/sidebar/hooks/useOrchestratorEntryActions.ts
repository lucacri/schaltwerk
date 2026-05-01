import { useCallback } from 'react'
import type { AgentType } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { TerminalIds, SessionSelection } from '../../../hooks/useSessionManagement'
import type { SwitchOrchestratorModalState } from '../helpers/modalState'

interface UseOrchestratorEntryActionsParams {
    selection: Selection
    terminals: TerminalIds
    setSwitchModelSessionId: (id: string | null) => void
    setSwitchOrchestratorModal: (next: SwitchOrchestratorModalState) => void
    getOrchestratorAgentType: () => Promise<string | AgentType | null>
    normalizeAgentType: (value: string | AgentType | undefined | null) => AgentType
    resetSession: (selection: SessionSelection, terminals: TerminalIds) => Promise<void>
}

interface UseOrchestratorEntryActionsResult {
    onSwitchModel: () => void
    onReset: () => void
}

export function useOrchestratorEntryActions({
    selection,
    terminals,
    setSwitchModelSessionId,
    setSwitchOrchestratorModal,
    getOrchestratorAgentType,
    normalizeAgentType,
    resetSession,
}: UseOrchestratorEntryActionsParams): UseOrchestratorEntryActionsResult {
    const onSwitchModel = useCallback(() => {
        setSwitchModelSessionId(null)
        void getOrchestratorAgentType().then((initialAgentType) => {
            setSwitchOrchestratorModal({
                open: true,
                initialAgentType: normalizeAgentType(initialAgentType),
                targetSessionId: null,
            })
        })
    }, [setSwitchModelSessionId, setSwitchOrchestratorModal, getOrchestratorAgentType, normalizeAgentType])

    const onReset = useCallback(() => {
        void (async () => {
            if (selection.kind === 'orchestrator') {
                await resetSession(selection, terminals)
            }
        })()
    }, [selection, resetSession, terminals])

    return { onSwitchModel, onReset }
}
