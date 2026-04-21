import { describe, it, expect } from 'vitest'
import { deriveStage, stageForSession, STAGES, NON_TERMINAL_STAGES, TERMINAL_STAGES } from './sessionStage'
import type { SessionInfo } from '../types/session'

function makeSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        session_id: 'session-id',
        branch: 'lucode/test',
        worktree_path: '/tmp/worktree',
        base_branch: 'main',
        is_current: false,
        session_type: 'worktree',
        status: 'active',
        session_state: 'running',
        ready_to_merge: false,
        ...overrides,
    }
}

describe('deriveStage', () => {
    it('maps spec status without spec_stage to Draft', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
            }),
        ).toBe('draft')
    })

    it('maps spec stage draft to Draft', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
                specStage: 'draft',
            }),
        ).toBe('draft')
    })

    it('maps explicit stage to the authoritative task stage', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
                stage: 'planned',
            }),
        ).toBe('planned')
    })

    it('maps running session to Implemented when no explicit stage exists', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
            }),
        ).toBe('implemented')
    })

    it('maps processing session to Implemented when no explicit stage exists', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'processing',
                readyToMerge: false,
            }),
        ).toBe('implemented')
    })

    it('maps ready_to_merge compatibility sessions to Implemented', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: true,
            }),
        ).toBe('implemented')
    })

    it('maps consolidation candidate compatibility sessions to Implemented', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRole: 'candidate',
            }),
        ).toBe('implemented')
    })

    it('maps consolidation judge compatibility sessions to Implemented', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRole: 'judge',
            }),
        ).toBe('implemented')
    })

    it('maps pending consolidation round compatibility sessions to Implemented', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRoundPending: true,
            }),
        ).toBe('implemented')
    })

    it('explicit stage beats compatibility hints', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: true,
                stage: 'brainstormed',
                consolidationRole: 'candidate',
            }),
        ).toBe('brainstormed')
    })

    it('maps archived status to Cancelled', () => {
        expect(
            deriveStage({
                status: 'archived',
                sessionState: 'running',
                readyToMerge: false,
            }),
        ).toBe('cancelled')
    })

    it('archived status stays cancelled without an explicit stage', () => {
        expect(
            deriveStage({
                status: 'archived',
                sessionState: 'running',
                readyToMerge: true,
                consolidationRole: 'judge',
                mergedAtIsSet: true,
            }),
        ).toBe('cancelled')
    })

    it('spec session_state without spec status still treated as Draft', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'spec',
                readyToMerge: false,
            }),
        ).toBe('draft')
    })
})

describe('stageForSession', () => {
    it('derives Draft for a freshly created spec', () => {
        const session = makeSessionInfo({
            status: 'spec',
            session_state: 'spec',
        })
        expect(stageForSession(session)).toBe('draft')
    })

    it('derives Ready for a spec with spec_stage = ready', () => {
        const session = makeSessionInfo({
            status: 'spec',
            session_state: 'spec',
            spec_stage: 'ready',
        })
        expect(stageForSession(session)).toBe('ready')
    })

    it('uses the authoritative stage field when present', () => {
        const session = makeSessionInfo({ stage: 'planned' })
        expect(stageForSession(session)).toBe('planned')
    })

    it('derives Implemented when ready_to_merge is true on a running compatibility session', () => {
        const session = makeSessionInfo({ ready_to_merge: true })
        expect(stageForSession(session)).toBe('implemented')
    })

    it('derives Implemented when consolidation_round_id is set on a compatibility session', () => {
        const session = makeSessionInfo({ consolidation_round_id: 'round-1' })
        expect(stageForSession(session)).toBe('implemented')
    })

    it('derives Implemented for an active running session with no special flags', () => {
        const session = makeSessionInfo()
        expect(stageForSession(session)).toBe('implemented')
    })
})

describe('stage constants', () => {
    it('STAGES contains the ordered task stages', () => {
        expect(STAGES).toEqual([
            'draft',
            'ready',
            'brainstormed',
            'planned',
            'implemented',
            'pushed',
            'done',
            'cancelled',
        ])
    })

    it('NON_TERMINAL_STAGES excludes done and cancelled', () => {
        expect(NON_TERMINAL_STAGES).not.toContain('done')
        expect(NON_TERMINAL_STAGES).not.toContain('cancelled')
        expect(NON_TERMINAL_STAGES.length).toBe(6)
    })

    it('TERMINAL_STAGES covers only done and cancelled', () => {
        expect(TERMINAL_STAGES).toEqual(['done', 'cancelled'])
    })
})
