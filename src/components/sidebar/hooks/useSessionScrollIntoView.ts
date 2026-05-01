import { useCallback, useEffect, useLayoutEffect, type MutableRefObject, type RefObject } from 'react'
import type { Selection } from '../../../store/atoms/selection'

interface UseSessionScrollIntoViewParams {
    selection: Selection
    isCollapsed: boolean
    sidebarRef: RefObject<HTMLDivElement | null>
    sessionListRef: RefObject<HTMLDivElement | null>
    sessionScrollTopRef: MutableRefObject<number>
}

interface UseSessionScrollIntoViewResult {
    handleSessionScroll: (event: { currentTarget: { scrollTop: number } }) => void
}

export function useSessionScrollIntoView({
    selection,
    isCollapsed,
    sidebarRef,
    sessionListRef,
    sessionScrollTopRef,
}: UseSessionScrollIntoViewParams): UseSessionScrollIntoViewResult {
    useLayoutEffect(() => {
        if (selection.kind !== 'session') return

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const selectedElement = sidebarRef.current?.querySelector(`[data-session-selected="true"]`)
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest',
                    })
                    if (sessionListRef.current) {
                        sessionScrollTopRef.current = sessionListRef.current.scrollTop
                    }
                }
            })
        })
    }, [selection, sessionListRef, sessionScrollTopRef, sidebarRef])

    const handleSessionScroll = useCallback((event: { currentTarget: { scrollTop: number } }) => {
        sessionScrollTopRef.current = event.currentTarget.scrollTop
    }, [sessionScrollTopRef])

    useEffect(() => {
        const node = sessionListRef.current
        if (node) {
            node.scrollTop = sessionScrollTopRef.current
        }
    }, [isCollapsed, sessionListRef, sessionScrollTopRef])

    return { handleSessionScroll }
}
