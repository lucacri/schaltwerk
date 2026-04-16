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
    it('maps spec status without spec_stage to Idea', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
            }),
        ).toBe('idea')
    })

    it('maps spec stage draft to Idea', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
                specStage: 'draft',
            }),
        ).toBe('idea')
    })

    it('maps spec stage clarified to Clarified', () => {
        expect(
            deriveStage({
                status: 'spec',
                sessionState: 'spec',
                readyToMerge: false,
                specStage: 'clarified',
            }),
        ).toBe('clarified')
    })

    it('maps running session to WorkingOn', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
            }),
        ).toBe('working_on')
    })

    it('maps processing session to WorkingOn', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'processing',
                readyToMerge: false,
            }),
        ).toBe('working_on')
    })

    it('maps ready_to_merge to ReadyToMerge', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: true,
            }),
        ).toBe('ready_to_merge')
    })

    it('maps consolidation candidate to JudgeReview', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRole: 'candidate',
            }),
        ).toBe('judge_review')
    })

    it('maps consolidation judge to JudgeReview', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRole: 'judge',
            }),
        ).toBe('judge_review')
    })

    it('maps pending consolidation round to JudgeReview', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: false,
                consolidationRoundPending: true,
            }),
        ).toBe('judge_review')
    })

    it('judge_review beats ready_to_merge when both conditions hold', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'running',
                readyToMerge: true,
                consolidationRole: 'candidate',
            }),
        ).toBe('judge_review')
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

    it('mergedAtIsSet trumps everything', () => {
        expect(
            deriveStage({
                status: 'archived',
                sessionState: 'running',
                readyToMerge: true,
                consolidationRole: 'judge',
                mergedAtIsSet: true,
            }),
        ).toBe('merged')
    })

    it('spec session_state without spec status still treated as Idea', () => {
        expect(
            deriveStage({
                status: 'active',
                sessionState: 'spec',
                readyToMerge: false,
            }),
        ).toBe('idea')
    })
})

describe('stageForSession', () => {
    it('derives Idea for a freshly created spec', () => {
        const session = makeSessionInfo({
            status: 'spec',
            session_state: 'spec',
        })
        expect(stageForSession(session)).toBe('idea')
    })

    it('derives Clarified for a spec with spec_stage = clarified', () => {
        const session = makeSessionInfo({
            status: 'spec',
            session_state: 'spec',
            spec_stage: 'clarified',
        })
        expect(stageForSession(session)).toBe('clarified')
    })

    it('derives ReadyToMerge when ready_to_merge is true on a running session', () => {
        const session = makeSessionInfo({ ready_to_merge: true })
        expect(stageForSession(session)).toBe('ready_to_merge')
    })

    it('derives JudgeReview when consolidation_round_id is set', () => {
        const session = makeSessionInfo({ consolidation_round_id: 'round-1' })
        expect(stageForSession(session)).toBe('judge_review')
    })

    it('derives WorkingOn for an active running session with no special flags', () => {
        const session = makeSessionInfo()
        expect(stageForSession(session)).toBe('working_on')
    })
})

describe('stage constants', () => {
    it('STAGES contains exactly seven ordered entries', () => {
        expect(STAGES).toEqual([
            'idea',
            'clarified',
            'working_on',
            'judge_review',
            'ready_to_merge',
            'merged',
            'cancelled',
        ])
    })

    it('NON_TERMINAL_STAGES excludes merged and cancelled', () => {
        expect(NON_TERMINAL_STAGES).not.toContain('merged')
        expect(NON_TERMINAL_STAGES).not.toContain('cancelled')
        expect(NON_TERMINAL_STAGES.length).toBe(5)
    })

    it('TERMINAL_STAGES covers only merged and cancelled', () => {
        expect(TERMINAL_STAGES).toEqual(['merged', 'cancelled'])
    })
})
