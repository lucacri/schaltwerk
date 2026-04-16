import { memo } from 'react'
import clsx from 'clsx'
import type { EnrichedSession } from '../../types/session'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { theme } from '../../common/theme'
import { STAGE_LABELS, stageForSession } from '../../common/sessionStage'

export interface KanbanSessionRowProps {
    session: EnrichedSession
    isSelected: boolean
    onSelect: (session: EnrichedSession) => void
}

export const KanbanSessionRow = memo(function KanbanSessionRow({
    session,
    isSelected,
    onSelect,
}: KanbanSessionRowProps) {
    const stage = stageForSession(session.info)
    const display = getSessionDisplayName(session.info)

    return (
        <button
            type="button"
            onClick={() => onSelect(session)}
            data-testid={`kanban-session-row-${session.info.session_id}`}
            aria-pressed={isSelected}
            className={clsx(
                'w-full text-left px-3 py-2 rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70',
                isSelected
                    ? 'bg-bg-elevated/60 border-transparent session-ring session-ring-blue'
                    : 'border-border-subtle hover:bg-bg-hover/30',
            )}
        >
            <div
                className="font-medium text-text-primary"
                style={{ fontSize: theme.fontSize.body, lineHeight: theme.lineHeight.compact }}
            >
                {display}
            </div>
            <div
                className="text-text-muted mt-0.5"
                style={{ fontSize: theme.fontSize.caption, lineHeight: theme.lineHeight.compact }}
            >
                {STAGE_LABELS[stage]} · {session.info.branch}
            </div>
        </button>
    )
})
