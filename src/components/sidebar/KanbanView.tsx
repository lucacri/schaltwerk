import { useMemo, useState, type ReactNode } from 'react'
import type { EnrichedSession } from '../../types/session'
import { NON_TERMINAL_STAGES, STAGE_LABELS, stageForSession, type Stage } from '../../common/sessionStage'
import { SidebarSectionHeader } from './SidebarSectionHeader'

const TERMINAL_COLUMN_KEY = 'archive'
const TERMINAL_COLUMN_LABEL = 'Archive'

export interface KanbanViewProps {
    sessions: EnrichedSession[]
    renderSession: (session: EnrichedSession) => ReactNode
    /** Optional initial collapsed map for tests; defaults to terminal column collapsed. */
    initialCollapsed?: Partial<Record<Stage | typeof TERMINAL_COLUMN_KEY, boolean>>
}

type ColumnKey = Stage | typeof TERMINAL_COLUMN_KEY

export function bucketSessionsByStage(
    sessions: EnrichedSession[],
): Record<ColumnKey, EnrichedSession[]> {
    const buckets: Record<ColumnKey, EnrichedSession[]> = {
        idea: [],
        clarified: [],
        working_on: [],
        judge_review: [],
        ready_to_merge: [],
        merged: [],
        cancelled: [],
        [TERMINAL_COLUMN_KEY]: [],
    }

    for (const session of sessions) {
        const stage = stageForSession(session.info)
        buckets[stage].push(session)
        if (stage === 'merged' || stage === 'cancelled') {
            buckets[TERMINAL_COLUMN_KEY].push(session)
        }
    }

    return buckets
}

export function KanbanView({ sessions, renderSession, initialCollapsed }: KanbanViewProps) {
    const buckets = useMemo(() => bucketSessionsByStage(sessions), [sessions])

    const [collapsed, setCollapsed] = useState<Record<ColumnKey, boolean>>(() => ({
        idea: initialCollapsed?.idea ?? false,
        clarified: initialCollapsed?.clarified ?? false,
        working_on: initialCollapsed?.working_on ?? false,
        judge_review: initialCollapsed?.judge_review ?? false,
        ready_to_merge: initialCollapsed?.ready_to_merge ?? false,
        merged: initialCollapsed?.merged ?? true,
        cancelled: initialCollapsed?.cancelled ?? true,
        [TERMINAL_COLUMN_KEY]: initialCollapsed?.[TERMINAL_COLUMN_KEY] ?? true,
    }))

    const toggle = (key: ColumnKey) =>
        setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

    return (
        <div data-testid="kanban-view">
            {NON_TERMINAL_STAGES.map(stage => {
                const items = buckets[stage]
                return (
                    <section
                        key={stage}
                        data-testid={`kanban-column-${stage}`}
                        className="mt-2 first:mt-0"
                    >
                        <SidebarSectionHeader
                            title={STAGE_LABELS[stage]}
                            count={items.length}
                            collapsed={collapsed[stage]}
                            toggleLabel={`Toggle ${STAGE_LABELS[stage]} column`}
                            onToggle={() => toggle(stage)}
                        />
                        {!collapsed[stage] && (
                            <div className="mt-1 space-y-1" data-testid={`kanban-column-body-${stage}`}>
                                {stage === 'judge_review'
                                    ? renderJudgeReview(items, renderSession)
                                    : items.map(session => (
                                          <div key={session.info.session_id}>
                                              {renderSession(session)}
                                          </div>
                                      ))}
                            </div>
                        )}
                    </section>
                )
            })}

            <section
                data-testid={`kanban-column-${TERMINAL_COLUMN_KEY}`}
                className="mt-2"
            >
                <SidebarSectionHeader
                    title={TERMINAL_COLUMN_LABEL}
                    count={buckets[TERMINAL_COLUMN_KEY].length}
                    collapsed={collapsed[TERMINAL_COLUMN_KEY]}
                    toggleLabel={`Toggle ${TERMINAL_COLUMN_LABEL} column`}
                    onToggle={() => toggle(TERMINAL_COLUMN_KEY)}
                />
                {!collapsed[TERMINAL_COLUMN_KEY] && (
                    <div className="mt-1 space-y-1" data-testid={`kanban-column-body-${TERMINAL_COLUMN_KEY}`}>
                        {buckets[TERMINAL_COLUMN_KEY].map(session => (
                            <div key={session.info.session_id}>
                                {renderSession(session)}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

function renderJudgeReview(
    sessions: EnrichedSession[],
    renderSession: (session: EnrichedSession) => ReactNode,
): ReactNode {
    const byRound = new Map<string, EnrichedSession[]>()
    const unassigned: EnrichedSession[] = []

    for (const session of sessions) {
        const roundId = session.info.consolidation_round_id ?? null
        if (roundId) {
            const existing = byRound.get(roundId) ?? []
            existing.push(session)
            byRound.set(roundId, existing)
        } else {
            unassigned.push(session)
        }
    }

    const nodes: ReactNode[] = []

    for (const [roundId, roundSessions] of byRound.entries()) {
        nodes.push(
            <div
                key={`round-${roundId}`}
                data-testid={`kanban-round-group-${roundId}`}
                className="pl-2 border-l border-border-subtle"
            >
                {roundSessions.map(session => (
                    <div key={session.info.session_id}>{renderSession(session)}</div>
                ))}
            </div>,
        )
    }

    for (const session of unassigned) {
        nodes.push(
            <div key={session.info.session_id}>{renderSession(session)}</div>,
        )
    }

    return nodes
}
