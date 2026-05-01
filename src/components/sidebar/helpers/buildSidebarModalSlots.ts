import type { Epic, EnrichedSession, AgentType } from '../../../types/session'
import type { ForgeIntegrationContextValue } from '../../../contexts/ForgeIntegrationContext'
import type { Selection } from '../../../store/atoms/selection'
import type { TerminalIds } from '../../../hooks/useSessionManagement'
import type { MergeDialogState } from '../../../store/atoms/sessions'
import type { MergeModeOption } from '../../modals/MergeSessionModal'
import type { PrCreateOptions } from '../../modals/PrSessionModal'
import type {
    ConvertToSpecModalState,
    GitlabMrDialogState,
    PrDialogState,
    PromoteVersionModalState,
    SwitchOrchestratorModalState,
} from './modalState'

interface BuildSidebarModalSlotsParams {
    editingEpic: Epic | null
    setEditingEpic: (epic: Epic | null) => void
    deleteEpicTarget: Epic | null
    setDeleteEpicTarget: (epic: Epic | null) => void
    deleteEpicLoading: boolean
    setDeleteEpicLoading: (loading: boolean) => void
    updateEpic: (id: string, name: string, color: string | null) => Promise<unknown>
    deleteEpic: (id: string) => Promise<unknown>
    convertToSpecModal: ConvertToSpecModalState
    closeConvertToSpecModal: () => void
    optimisticallyConvertSessionToSpec: (sessionName: string) => void
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    promoteVersionModal: PromoteVersionModalState
    closePromoteVersionModal: () => void
    confirmPromoteVersionModal: () => void
    mergeDialogState: MergeDialogState
    activeMergeCommitDraft: string
    closeMergeDialog: () => void
    updateActiveMergeCommitDraft: (value: string) => void
    confirmMerge: (sessionName: string, mode: MergeModeOption, commitMessage?: string) => Promise<unknown>
    handleResolveMergeInAgentSession: () => void | Promise<unknown>
    autoCancelAfterMerge: boolean
    updateAutoCancelAfterMerge: (next: boolean) => void | Promise<unknown>
    prDialogState: PrDialogState
    handleClosePrModal: () => void
    handleConfirmPr: (options: PrCreateOptions) => void | Promise<unknown>
    autoCancelAfterPr: boolean
    updateAutoCancelAfterPr: (next: boolean) => void | Promise<unknown>
    gitlabMrDialogState: GitlabMrDialogState
    handleCloseGitlabMrModal: () => void
    switchOrchestratorModal: SwitchOrchestratorModalState
    setSwitchOrchestratorModal: (next: SwitchOrchestratorModalState) => void
    switchModelSessionId: string | null
    setSwitchModelSessionId: (id: string | null) => void
    selection: Selection
    terminals: TerminalIds
    clearTerminalTracking: (terminalIds: string[]) => Promise<void>
    clearTerminalStartedTracking: (terminalIds: string[]) => void
    switchModel: (
        agentType: AgentType,
        targetSelection: Selection | { kind: 'session'; payload: string },
        terminals: TerminalIds,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void,
        previousAgentType: AgentType | undefined,
    ) => Promise<unknown>
    forgeWritebackSessionId: string | null
    setForgeWritebackSessionId: (id: string | null) => void
    sessions: EnrichedSession[]
    forgeIntegration: ForgeIntegrationContextValue
}

export function buildSidebarModalSlots(p: BuildSidebarModalSlotsParams) {
    return {
        epic: {
            editing: p.editingEpic,
            deleteTarget: p.deleteEpicTarget,
            deleteLoading: p.deleteEpicLoading,
            onCloseEdit: () => p.setEditingEpic(null),
            onSubmitEdit: async ({ name, color }: { name: string; color: string | null }) => {
                if (!p.editingEpic) {
                    throw new Error('No epic selected')
                }
                await p.updateEpic(p.editingEpic.id, name, color)
            },
            onCloseDelete: () => {
                if (p.deleteEpicLoading) return
                p.setDeleteEpicTarget(null)
            },
            onConfirmDelete: () => {
                if (!p.deleteEpicTarget || p.deleteEpicLoading) return
                void (async () => {
                    p.setDeleteEpicLoading(true)
                    try {
                        await p.deleteEpic(p.deleteEpicTarget!.id)
                        p.setDeleteEpicTarget(null)
                    } finally {
                        p.setDeleteEpicLoading(false)
                    }
                })()
            },
        },
        convertToSpec: {
            state: p.convertToSpecModal,
            onClose: p.closeConvertToSpecModal,
            onSuccess: (newSpecName?: string | null) => {
                if (p.convertToSpecModal.sessionName) {
                    p.optimisticallyConvertSessionToSpec(p.convertToSpecModal.sessionName)
                }
                if (newSpecName) {
                    void p.setSelection(
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
        },
        promote: {
            state: p.promoteVersionModal,
            onClose: p.closePromoteVersionModal,
            onConfirm: p.confirmPromoteVersionModal,
        },
        merge: {
            state: p.mergeDialogState,
            commitDraft: p.activeMergeCommitDraft,
            onClose: p.closeMergeDialog,
            onCommitMessageChange: p.updateActiveMergeCommitDraft,
            onConfirm: (mode: MergeModeOption, commitMessage?: string) => {
                if (p.mergeDialogState.sessionName) {
                    void p.confirmMerge(p.mergeDialogState.sessionName, mode, commitMessage)
                }
            },
            onResolveInAgentSession: () => { void p.handleResolveMergeInAgentSession() },
            autoCancelEnabled: p.autoCancelAfterMerge,
            onToggleAutoCancel: (next: boolean) => { void p.updateAutoCancelAfterMerge(next) },
        },
        pr: {
            state: p.prDialogState,
            onClose: p.handleClosePrModal,
            onConfirm: (options: PrCreateOptions) => { void p.handleConfirmPr(options) },
            autoCancelEnabled: p.autoCancelAfterPr,
            onToggleAutoCancel: (next: boolean) => { void p.updateAutoCancelAfterPr(next) },
        },
        gitlabMr: {
            state: p.gitlabMrDialogState,
            onClose: p.handleCloseGitlabMrModal,
        },
        switchOrchestrator: {
            state: p.switchOrchestratorModal,
            onClose: () => {
                p.setSwitchOrchestratorModal({ open: false })
                p.setSwitchModelSessionId(null)
            },
            onSwitch: async ({ agentType }: { agentType: AgentType }) => {
                const targetSelection = p.switchModelSessionId
                    ? { kind: 'session' as const, payload: p.switchModelSessionId }
                    : p.selection

                await p.switchModel(
                    agentType,
                    targetSelection,
                    p.terminals,
                    p.clearTerminalTracking,
                    p.clearTerminalStartedTracking,
                    p.switchOrchestratorModal.initialAgentType,
                )

                p.setSwitchOrchestratorModal({ open: false })
                p.setSwitchModelSessionId(null)
            },
        },
        forgeWriteback: {
            sessionId: p.forgeWritebackSessionId,
            sessions: p.sessions,
            forgeIntegration: p.forgeIntegration,
            onClose: () => p.setForgeWritebackSessionId(null),
        },
    }
}

