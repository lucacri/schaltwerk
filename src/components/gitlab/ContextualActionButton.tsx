import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useContextualActions } from '../../hooks/useContextualActions'
import { renderTemplate } from '../../common/templateRenderer'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import type { ContextualAction } from '../../types/contextualAction'
import { logger } from '../../utils/logger'

interface ContextualActionButtonProps {
    context: 'mr' | 'issue'
    variables: Record<string, string>
}

export function ContextualActionButton({ context, variables }: ContextualActionButtonProps) {
    const { actions } = useContextualActions()
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    const matchingActions = useMemo(() => {
        return actions.filter(a =>
            a.context === context || a.context === 'both'
        )
    }, [actions, context])

    useEffect(() => {
        if (!open) return
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleAction = useCallback((action: ContextualAction) => {
        setOpen(false)
        const prompt = renderTemplate(action.promptTemplate, variables)
        logger.info(`[ContextualAction] Triggering "${action.name}" in ${action.mode} mode`)

        if (action.mode === 'spec') {
            emitUiEvent(UiEvent.ContextualActionCreateSpec, {
                prompt,
                name: action.name,
            })
        } else {
            emitUiEvent(UiEvent.ContextualActionCreateSession, {
                prompt,
                actionName: action.name,
                agentType: action.agentType,
                variantId: action.variantId,
                presetId: action.presetId,
            })
        }
    }, [variables])

    if (matchingActions.length === 0) return null

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm hover:opacity-80"
                style={{
                    backgroundColor: 'var(--color-bg-elevated)',
                    borderColor: 'var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                }}
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Actions
                <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
            </button>
            {open && (
                <div
                    className="absolute right-0 mt-1 py-1 rounded-lg border shadow-lg z-50 min-w-[200px]"
                    style={{
                        backgroundColor: 'var(--color-bg-elevated)',
                        borderColor: 'var(--color-border-subtle)',
                    }}
                >
                    {matchingActions.map(action => (
                        <button
                            key={action.id}
                            onClick={() => handleAction(action)}
                            className="w-full text-left px-4 py-2 text-sm hover:opacity-80 flex items-center gap-2"
                            style={{ color: 'var(--color-text-primary)' }}
                        >
                            <span className="flex-1">{action.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                                {action.mode}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
