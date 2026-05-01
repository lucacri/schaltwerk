import clsx from 'clsx'
import { useCallback } from 'react'
import { useTranslation } from '../../../common/i18n/useTranslation'
import { emitUiEvent, UiEvent } from '../../../common/uiEvents'
import { logger } from '../../../utils/logger'
import type { Selection } from '../../../store/atoms/selection'

interface SidebarSearchBarProps {
    isCollapsed: boolean
    isSearchVisible: boolean
    setIsSearchVisible: (visible: boolean) => void
    searchQuery: string
    setSearchQuery: (value: string) => void
    sessionCount: number
    selection: Selection
}

export function SidebarSearchBar({
    isCollapsed,
    isSearchVisible,
    setIsSearchVisible,
    searchQuery,
    setSearchQuery,
    sessionCount,
    selection,
}: SidebarSearchBarProps) {
    const { t } = useTranslation()

    const dispatchResizeNudge = useCallback((origin: 'open' | 'type' | 'close') => {
        if (selection.kind === 'session' && selection.payload) {
            emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'session', sessionId: selection.payload })
        } else {
            emitUiEvent(UiEvent.OpencodeSearchResize, { kind: 'orchestrator' })
        }
        try {
            if (selection.kind === 'session' && selection.payload) {
                emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: selection.payload })
            } else {
                emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
            }
        } catch (e) {
            logger.warn(`[Sidebar] Failed to dispatch generic terminal resize request (search ${origin})`, e)
        }
    }, [selection])

    if (isCollapsed) {
        return null
    }

    return (
        <>
            <div
                className="h-8 px-3 border-t border-b text-xs flex items-center bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]"
                data-onboarding="session-filter-row"
            >
                <div className="flex items-center gap-2 w-full justify-end">
                    <div className="flex items-center gap-1 flex-nowrap overflow-x-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
                        <button
                            onClick={() => {
                                setIsSearchVisible(true)
                                dispatchResizeNudge('open')
                            }}
                            className={clsx(
                                'px-1 py-0.5 rounded flex items-center flex-shrink-0 border border-transparent transition-colors',
                                isSearchVisible
                                    ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border-default)]'
                                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                            )}
                            title={t.sidebar.search.title}
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {isSearchVisible && (
                <div className="h-8 px-3 border-b bg-[var(--color-bg-secondary)] border-[var(--color-border-subtle)] flex items-center">
                    <div className="flex items-center gap-2 w-full">
                        <svg className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                dispatchResizeNudge('type')
                            }}
                            placeholder={t.sidebar.search.placeholder}
                            className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                            autoFocus
                        />
                        {searchQuery && (
                            <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                                {sessionCount} {sessionCount !== 1 ? t.sidebar.search.results : t.sidebar.search.result}
                            </span>
                        )}
                        <button
                            onClick={() => {
                                setSearchQuery('')
                                setIsSearchVisible(false)
                                dispatchResizeNudge('close')
                            }}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] p-0.5"
                            title={t.sidebar.search.close}
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
