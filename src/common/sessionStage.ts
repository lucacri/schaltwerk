import type { EnrichedSession, SessionInfo } from '../types/session'

export const STAGES = [
    'draft',
    'ready',
    'brainstormed',
    'planned',
    'implemented',
    'pushed',
    'done',
    'cancelled',
] as const

export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
    draft: 'Draft',
    ready: 'Ready',
    brainstormed: 'Brainstormed',
    planned: 'Planned',
    implemented: 'Implemented',
    pushed: 'Pushed',
    done: 'Done',
    cancelled: 'Cancelled',
}

export const NON_TERMINAL_STAGES: readonly Stage[] = [
    'draft',
    'ready',
    'brainstormed',
    'planned',
    'implemented',
    'pushed',
]

export const TERMINAL_STAGES: readonly Stage[] = ['done', 'cancelled']

export interface StageInputs {
    status: SessionInfo['status']
    sessionState: SessionInfo['session_state']
    readyToMerge: boolean
    specStage?: SessionInfo['spec_stage']
    stage?: SessionInfo['stage']
    consolidationRole?: SessionInfo['consolidation_role']
    consolidationRoundPending?: boolean
    mergedAtIsSet?: boolean
}

export function deriveStage(inputs: StageInputs): Stage {
    if (inputs.stage && STAGES.includes(inputs.stage as Stage)) {
        return inputs.stage as Stage
    }

    if (inputs.status === 'archived') {
        return 'cancelled'
    }

    if (inputs.mergedAtIsSet) return 'done'

    if (inputs.consolidationRoundPending || (inputs.consolidationRole ?? null) !== null) {
        return 'implemented'
    }

    const looksLikeSpec = inputs.status === 'spec' || inputs.sessionState === 'spec'
    if (looksLikeSpec) {
        return (inputs.specStage as Stage | undefined) ?? 'draft'
    }

    if (inputs.readyToMerge) return 'implemented'

    return 'implemented'
}

export function stageForSession(session: SessionInfo): Stage {
    return deriveStage({
        status: session.status,
        sessionState: session.session_state as SessionInfo['session_state'],
        readyToMerge: session.ready_to_merge ?? false,
        specStage: session.spec_stage,
        stage: session.stage,
        consolidationRole: session.consolidation_role,
        consolidationRoundPending: (session.consolidation_round_id ?? null) !== null,
        mergedAtIsSet: false,
    })
}

export function stageForEnriched(session: EnrichedSession): Stage {
    return stageForSession(session.info)
}
