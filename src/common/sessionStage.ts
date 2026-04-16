import type { EnrichedSession, SessionInfo } from '../types/session'

export const STAGES = [
    'idea',
    'clarified',
    'working_on',
    'judge_review',
    'ready_to_merge',
    'merged',
    'cancelled',
] as const

export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
    idea: 'Idea',
    clarified: 'Clarified',
    working_on: 'Working on',
    judge_review: 'Judge review',
    ready_to_merge: 'Ready to merge',
    merged: 'Merged',
    cancelled: 'Cancelled',
}

export const NON_TERMINAL_STAGES: readonly Stage[] = [
    'idea',
    'clarified',
    'working_on',
    'judge_review',
    'ready_to_merge',
]

export const TERMINAL_STAGES: readonly Stage[] = ['merged', 'cancelled']

export interface StageInputs {
    status: SessionInfo['status']
    sessionState: SessionInfo['session_state']
    readyToMerge: boolean
    specStage?: SessionInfo['spec_stage']
    consolidationRole?: SessionInfo['consolidation_role']
    consolidationRoundPending?: boolean
    mergedAtIsSet?: boolean
}

export function deriveStage(inputs: StageInputs): Stage {
    if (inputs.mergedAtIsSet) return 'merged'

    if (inputs.status === 'archived') {
        return 'cancelled'
    }

    if (inputs.consolidationRoundPending || (inputs.consolidationRole ?? null) !== null) {
        return 'judge_review'
    }

    const looksLikeSpec = inputs.status === 'spec' || inputs.sessionState === 'spec'
    if (looksLikeSpec) {
        return inputs.specStage === 'clarified' ? 'clarified' : 'idea'
    }

    if (inputs.readyToMerge) return 'ready_to_merge'

    return 'working_on'
}

export function stageForSession(session: SessionInfo): Stage {
    return deriveStage({
        status: session.status,
        sessionState: session.session_state as SessionInfo['session_state'],
        readyToMerge: session.ready_to_merge ?? false,
        specStage: session.spec_stage,
        consolidationRole: session.consolidation_role,
        consolidationRoundPending: (session.consolidation_round_id ?? null) !== null,
        mergedAtIsSet: false,
    })
}

export function stageForEnriched(session: EnrichedSession): Stage {
    return stageForSession(session.info)
}
