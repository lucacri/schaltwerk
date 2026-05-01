import { useTranslation } from '../../../common/i18n/useTranslation'
import { theme } from '../../../common/theme'
import { type Epic, EnrichedSession, AgentType } from '../../../types/session'
import { ConvertToSpecConfirmation } from '../../modals/ConvertToSpecConfirmation'
import { PromoteVersionConfirmation } from '../../modals/PromoteVersionConfirmation'
import { MergeSessionModal, MergeModeOption } from '../../modals/MergeSessionModal'
import { PrSessionModal, PrCreateOptions } from '../../modals/PrSessionModal'
import { GitlabMrSessionModal } from '../../modals/GitlabMrSessionModal'
import { SwitchOrchestratorModal } from '../../modals/SwitchOrchestratorModal'
import { EpicModal } from '../../modals/EpicModal'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { ForgeWritebackModal } from '../../forge/ForgeWritebackModal'
import { MergeDialogState } from '../../../store/atoms/sessions'
import { ForgeIntegrationContextValue } from '../../../contexts/ForgeIntegrationContext'
import {
    ConvertToSpecModalState,
    GitlabMrDialogState,
    PrDialogState,
    PromoteVersionModalState,
    SwitchOrchestratorModalState,
} from '../helpers/modalState'

interface EpicSlot {
    editing: Epic | null
    deleteTarget: Epic | null
    deleteLoading: boolean
    onCloseEdit: () => void
    onSubmitEdit: (input: { name: string; color: string | null }) => Promise<void>
    onCloseDelete: () => void
    onConfirmDelete: () => void
}

interface ConvertToSpecSlot {
    state: ConvertToSpecModalState
    onClose: () => void
    onSuccess: (newSpecName?: string | null) => void
}

interface PromoteSlot {
    state: PromoteVersionModalState
    onClose: () => void
    onConfirm: () => void
}

interface MergeSlot {
    state: MergeDialogState
    commitDraft: string
    onClose: () => void
    onCommitMessageChange: (value: string) => void
    onConfirm: (mode: MergeModeOption, commitMessage?: string) => void
    onResolveInAgentSession: () => void
    autoCancelEnabled: boolean
    onToggleAutoCancel: (next: boolean) => void
}

interface PrSlot {
    state: PrDialogState
    onClose: () => void
    onConfirm: (options: PrCreateOptions) => void
    autoCancelEnabled: boolean
    onToggleAutoCancel: (next: boolean) => void
}

interface GitlabMrSlot {
    state: GitlabMrDialogState
    onClose: () => void
}

interface SwitchOrchestratorSlot {
    state: SwitchOrchestratorModalState
    onClose: () => void
    onSwitch: (input: { agentType: AgentType }) => void | Promise<void>
}

interface ForgeWritebackSlot {
    sessionId: string | null
    sessions: EnrichedSession[]
    forgeIntegration: ForgeIntegrationContextValue
    onClose: () => void
}

interface SidebarModalsTrailerProps {
    epic: EpicSlot
    convertToSpec: ConvertToSpecSlot
    promote: PromoteSlot
    merge: MergeSlot
    pr: PrSlot
    gitlabMr: GitlabMrSlot
    switchOrchestrator: SwitchOrchestratorSlot
    forgeWriteback: ForgeWritebackSlot
}

export function SidebarModalsTrailer({
    epic,
    convertToSpec,
    promote,
    merge,
    pr,
    gitlabMr,
    switchOrchestrator,
    forgeWriteback,
}: SidebarModalsTrailerProps) {
    const { t } = useTranslation()

    const writebackSession = forgeWriteback.sessionId
        ? forgeWriteback.sessions.find(s => s.info.session_id === forgeWriteback.sessionId)
        : undefined

    return (
        <>
            <EpicModal
                open={Boolean(epic.editing)}
                mode="edit"
                initialName={epic.editing?.name ?? ''}
                initialColor={epic.editing?.color ?? null}
                onClose={epic.onCloseEdit}
                onSubmit={epic.onSubmitEdit}
            />

            <ConfirmModal
                open={Boolean(epic.deleteTarget)}
                title={t.deleteEpicDialog.title.replace('{name}', epic.deleteTarget?.name ?? '')}
                body={
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.body }}>
                        {t.deleteEpicDialog.body} <strong>{t.deleteEpicDialog.ungrouped}</strong>.
                    </div>
                }
                confirmText={t.deleteEpicDialog.confirm}
                cancelText={t.settings.common.cancel}
                variant="danger"
                loading={epic.deleteLoading}
                onCancel={epic.onCloseDelete}
                onConfirm={epic.onConfirmDelete}
            />

            <ConvertToSpecConfirmation
                open={convertToSpec.state.open}
                sessionName={convertToSpec.state.sessionName}
                projectPath={convertToSpec.state.projectPath}
                sessionDisplayName={convertToSpec.state.sessionDisplayName}
                hasUncommittedChanges={convertToSpec.state.hasUncommitted}
                onClose={convertToSpec.onClose}
                onSuccess={convertToSpec.onSuccess}
            />

            <PromoteVersionConfirmation
                open={promote.state.open}
                versionGroup={promote.state.versionGroup}
                selectedSessionId={promote.state.selectedSessionId}
                onClose={promote.onClose}
                onConfirm={promote.onConfirm}
            />

            <MergeSessionModal
                open={merge.state.isOpen}
                sessionName={merge.state.sessionName}
                status={merge.state.status}
                preview={merge.state.preview}
                error={merge.state.error ?? undefined}
                onClose={merge.onClose}
                cachedCommitMessage={merge.commitDraft}
                onCommitMessageChange={merge.onCommitMessageChange}
                onConfirm={merge.onConfirm}
                onResolveInAgentSession={merge.onResolveInAgentSession}
                autoCancelEnabled={merge.autoCancelEnabled}
                onToggleAutoCancel={merge.onToggleAutoCancel}
                prefillMode={merge.state.prefillMode}
            />

            <PrSessionModal
                open={pr.state.isOpen}
                sessionName={pr.state.sessionName}
                status={pr.state.status}
                preview={pr.state.preview}
                prefill={pr.state.prefill}
                error={pr.state.error}
                onClose={pr.onClose}
                onConfirm={pr.onConfirm}
                autoCancelEnabled={pr.autoCancelEnabled}
                onToggleAutoCancel={pr.onToggleAutoCancel}
            />

            <GitlabMrSessionModal
                open={gitlabMr.state.isOpen}
                sessionName={gitlabMr.state.sessionName}
                prefill={gitlabMr.state.prefill}
                onClose={gitlabMr.onClose}
            />

            <SwitchOrchestratorModal
                open={switchOrchestrator.state.open}
                scope={switchOrchestrator.state.targetSessionId ? 'session' : 'orchestrator'}
                onClose={switchOrchestrator.onClose}
                onSwitch={switchOrchestrator.onSwitch}
                initialAgentType={switchOrchestrator.state.initialAgentType}
                targetSessionId={switchOrchestrator.state.targetSessionId}
            />

            {writebackSession && (
                <ForgeWritebackModal
                    sessionId={writebackSession.info.session_id}
                    sessionName={writebackSession.info.session_id}
                    prNumber={writebackSession.info.pr_number}
                    prUrl={writebackSession.info.pr_url}
                    issueNumber={writebackSession.info.issue_number}
                    issueUrl={writebackSession.info.issue_url}
                    forgeSource={forgeWriteback.forgeIntegration.sources[0] ?? null}
                    onClose={forgeWriteback.onClose}
                />
            )}
        </>
    )
}
