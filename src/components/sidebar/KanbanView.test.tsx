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
            initialCollapsed={{ done: false, cancelled: false, archive: false }}
        />,
    )
}

describe('bucketSessionsByStage', () => {
    it('places sessions into the derived stage column', () => {
        const spec = makeSession({ session_id: 'spec-1', status: 'spec', session_state: 'spec' })
        const ready = makeSession({
            session_id: 'spec-2',
            status: 'spec',
            session_state: 'spec',
            spec_stage: 'ready',
        })
        const implemented = makeSession({ session_id: 'run-1' })
        const pushed = makeSession({ session_id: 'pr-1', stage: 'pushed' })
        const brainstormed = makeSession({ session_id: 'brain-1', stage: 'brainstormed' })

        const buckets = bucketSessionsByStage([spec, ready, implemented, pushed, brainstormed])

        expect(buckets.draft.map(s => s.info.session_id)).toEqual(['spec-1'])
        expect(buckets.ready.map(s => s.info.session_id)).toEqual(['spec-2'])
        expect(buckets.implemented.map(s => s.info.session_id)).toEqual(['run-1'])
        expect(buckets.pushed.map(s => s.info.session_id)).toEqual(['pr-1'])
        expect(buckets.brainstormed.map(s => s.info.session_id)).toEqual(['brain-1'])
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

        expect(screen.getByTestId('kanban-column-draft')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-ready')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-brainstormed')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-planned')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-implemented')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-pushed')).toBeInTheDocument()
        expect(screen.getByTestId('kanban-column-archive')).toBeInTheDocument()
    })

    it('renders sessions into their correct columns based on derived stage', () => {
        const sessions = [
            makeSession({ session_id: 'spec-1', status: 'spec', session_state: 'spec' }),
            makeSession({ session_id: 'run-1' }),
            makeSession({ session_id: 'push-1', stage: 'pushed' }),
        ]

        renderBoard(sessions)

        expect(
            within(screen.getByTestId('kanban-column-body-draft')).getByTestId('session-row-spec-1'),
        ).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-implemented')).getByTestId('session-row-run-1'),
        ).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-pushed')).getByTestId('session-row-push-1'),
        ).toBeInTheDocument()
    })

    it('groups staged round variants under their round inside the stage column', () => {
        const sessions = [
            makeSession({
                session_id: 'cand-1',
                stage: 'implemented',
                consolidation_role: 'candidate',
                consolidation_round_id: 'round-A',
            }),
            makeSession({
                session_id: 'cand-2',
                stage: 'implemented',
                consolidation_role: 'candidate',
                consolidation_round_id: 'round-A',
            }),
            makeSession({
                session_id: 'solo',
                stage: 'implemented',
            }),
        ]

        renderBoard(sessions)

        const roundGroup = screen.getByTestId('kanban-round-group-round-A')
        expect(within(roundGroup).getByTestId('session-row-cand-1')).toBeInTheDocument()
        expect(within(roundGroup).getByTestId('session-row-cand-2')).toBeInTheDocument()
        expect(
            within(screen.getByTestId('kanban-column-body-implemented')).getByTestId('session-row-solo'),
        ).toBeInTheDocument()
    })

    it('collapses a column when its header is clicked', () => {
        const sessions = [makeSession({ session_id: 'run-1' })]
        renderBoard(sessions)

        const column = screen.getByTestId('kanban-column-implemented')
        const toggle = within(column).getByRole('button')

        expect(screen.queryByTestId('kanban-column-body-implemented')).toBeInTheDocument()

        fireEvent.click(toggle)

        expect(screen.queryByTestId('kanban-column-body-implemented')).not.toBeInTheDocument()
    })

    it('collapses done and cancelled by default into the archive column', () => {
        const done = makeSession({ session_id: 'done-1', stage: 'done' })
        const cancelled = makeSession({ session_id: 'cnc-1', status: 'archived' })

        render(
            <KanbanView
                sessions={[done, cancelled]}
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

        const draftColumn = screen.getByTestId('kanban-column-draft')
        const implementedColumn = screen.getByTestId('kanban-column-implemented')

        expect(within(draftColumn).getByTestId('sidebar-section-count')).toHaveTextContent('2')
        expect(within(implementedColumn).getByTestId('sidebar-section-count')).toHaveTextContent('1')
    })
})
