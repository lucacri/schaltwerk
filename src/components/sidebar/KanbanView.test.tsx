import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { KanbanView, bucketSessionsByStage } from './KanbanView'
import type { EnrichedSession, SessionInfo } from '../../types/session'

function makeInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        session_id: overrides.session_id ?? 'session-1',
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

function makeSession(overrides: Partial<SessionInfo> = {}): EnrichedSession {
    return {
        info: makeInfo(overrides),
        terminals: [],
    }
}

function renderBoard(sessions: EnrichedSession[]) {
    return render(
        <KanbanView
            sessions={sessions}
            renderSession={session => (
                <div data-testid={`session-row-${session.info.session_id}`}>
                    {session.info.session_id}
                </div>
            )}
            initialCollapsed={{ merged: false, cancelled: false, archive: false }}
        />,
    )
}

describe('bucketSessionsByStage', () => {
    it('places sessions into the derived stage column', () => {
        const spec = makeSession({ session_id: 'spec-1', status: 'spec', session_state: 'spec' })
        const clarified = makeSession({
            session_id: 'spec-2',
            status: 'spec',
            session_state: 'spec',
            spec_stage: 'clarified',
        })
        const running = makeSession({ session_id: 'run-1' })
        const ready = makeSession({ session_id: 'rtm-1', ready_to_merge: true })
        const judge = makeSession({ session_id: 'round-1', consolidation_role: 'candidate' })

        const buckets = bucketSessionsByStage([spec, clarified, running, ready, judge])

        expect(buckets.idea.map(s => s.info.session_id)).toEqual(['spec-1'])
        expect(buckets.clarified.map(s => s.info.session_id)).toEqual(['spec-2'])
        expect(buckets.working_on.map(s => s.info.session_id)).toEqual(['run-1'])
        expect(buckets.ready_to_merge.map(s => s.info.session_id)).toEqual(['rtm-1'])
        expect(buckets.judge_review.map(s => s.info.session_id)).toEqual(['round-1'])
    })

    it('routes archived sessions into the archive bucket too', () => {
        const archived = makeSession({ session_id: 'cnc-1', status: 'archived' })

        const buckets = bucketSessionsByStage([archived])

        expect(buckets.cancelled.map(s => s.info.session_id)).toEqual(['cnc-1'])
        expect(buckets.archive.map(s => s.info.session_id)).toEqual(['cnc-1'])
    })
})

describe('KanbanView', () => {
    it('renders one column per non-terminal stage plus an archive column', () => {
        renderBoard([])

        expect(screen.getByTestId('kanban-column-idea')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-clarified')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-working_on')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-judge_review')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-ready_to_merge')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-archive')).toBeInTheDocument()
    })

    it('renders sessions into their correct columns based on derived stage', () => {
        const sessions = [
            makeSession({ session_id: 'spec-1', status: 'spec', session_state: 'spec' }),
            makeSession({ session_id: 'run-1' }),
            makeSession({ session_id: 'rtm-1', ready_to_merge: true }),
        ]

        renderBoard(sessions)

        expect(
            within(screen.getByTestId('kanban-column-body-idea')).getByTestId('session-row-spec-1'),
        ).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-working_on')).getByTestId('session-row-run-1'),
        ).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-ready_to_merge')).getByTestId('session-row-rtm-1'),
        ).toBeInTheDocument()
    })

    it('groups consolidation candidates under their round within the judge review column', () => {
        const sessions = [
            makeSession({
                session_id: 'cand-1',
                consolidation_role: 'candidate',
                consolidation_round_id: 'round-A',
            }),
            makeSession({
                session_id: 'cand-2',
                consolidation_role: 'candidate',
                consolidation_round_id: 'round-A',
            }),
            makeSession({
                session_id: 'solo',
                consolidation_role: 'judge',
            }),
        ]

        renderBoard(sessions)

        const roundGroup = screen.getByTestId('kanban-round-group-round-A')
        expect(within(roundGroup).getByTestId('session-row-cand-1')).toBeInTheDocument()
        expect(within(roundGroup).getByTestId('session-row-cand-2')).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-judge_review')).getByTestId('session-row-solo'),
        ).toBeInTheDocument()
    })

    it('collapses a column when its header is clicked', () => {
        const sessions = [makeSession({ session_id: 'run-1' })]
        renderBoard(sessions)

        const column = screen.getByTestId('kanban-column-working_on')
        const toggle = within(column).getByRole('button')

        expect(screen.queryByTestId('kanban-column-body-working_on')).toBeInTheDocument()

        fireEvent.click(toggle)

        expect(screen.queryByTestId('kanban-column-body-working_on')).not.toBeInTheDocument()
    })

    it('collapses merged and cancelled by default into the archive column', () => {
        const merged = makeSession({ session_id: 'merged-1' })
        const cancelled = makeSession({ session_id: 'cnc-1', status: 'archived' })

        render(
            <KanbanView
                sessions={[merged, cancelled]}
                renderSession={session => (
                    <div data-testid={`session-row-${session.info.session_id}`}>
                        {session.info.session_id}
                    </div>
                )}
            />,
        )

        expect(screen.queryByTestId('kanban-column-body-archive')).not.toBeInTheDocument()
        const header = within(screen.getByTestId('kanban-column-archive')).getByRole('button')
        fireEvent.click(header)

        expect(screen.getByTestId('kanban-column-body-archive')).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-archive')).getByTestId('session-row-cnc-1'),
        ).toBeInTheDocument()
    })

    it('header counts reflect bucket sizes', () => {
        const sessions = [
            makeSession({ session_id: 'a', status: 'spec', session_state: 'spec' }),
            makeSession({ session_id: 'b', status: 'spec', session_state: 'spec' }),
            makeSession({ session_id: 'c' }),
        ]

        renderBoard(sessions)

        const ideaColumn = screen.getByTestId('kanban-column-idea')
        const runningColumn = screen.getByTestId('kanban-column-working_on')

        expect(within(ideaColumn).getByTestId('sidebar-section-count')).toHaveTextContent('2')
        expect(within(runningColumn).getByTestId('sidebar-section-count')).toHaveTextContent('1')
    })
})
