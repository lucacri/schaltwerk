import { SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import { AgentType } from '../../../types/session'
import { PrPreviewResponse } from '../../modals/PrSessionModal'

export interface PrDialogPrefill {
    suggestedTitle?: string
    suggestedBody?: string
    suggestedBaseBranch?: string
    suggestedPrBranchName?: string
    suggestedMode?: 'squash' | 'reapply'
}

export interface PrDialogState {
    isOpen: boolean
    sessionName: string | null
    status: 'idle' | 'loading' | 'ready' | 'running'
    preview: PrPreviewResponse | null
    prefill?: PrDialogPrefill
    error: string | null
}

export interface GitlabMrDialogPrefill {
    suggestedTitle?: string
    suggestedBody?: string
    suggestedBaseBranch?: string
    suggestedSourceProject?: string
}

export interface GitlabMrDialogState {
    isOpen: boolean
    sessionName: string | null
    prefill?: GitlabMrDialogPrefill
}

export interface ConvertToSpecModalState {
    open: boolean
    sessionName: string
    projectPath?: string | null
    sessionDisplayName?: string
    hasUncommitted: boolean
}

export interface PromoteVersionModalState {
    open: boolean
    versionGroup: SessionVersionGroupType | null
    selectedSessionId: string
}

export interface SwitchOrchestratorModalState {
    open: boolean
    initialAgentType?: AgentType
    targetSessionId?: string | null
}
