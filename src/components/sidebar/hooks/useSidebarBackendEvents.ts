import { useEffect, type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../../common/eventSystem'
import { EventPayloadMap, GitOperationPayload } from '../../../common/events'
import { logger } from '../../../utils/logger'
import { getSessionLifecycleState } from '../../../utils/sessionState'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'

type FocusArea = 'claude' | 'terminal' | 'diff' | 'sidebar'

interface UseSidebarBackendEventsParams {
    createSafeUnlistener: (fn: UnlistenFn) => UnlistenFn
    latestSessionsRef: MutableRefObject<EnrichedSession[]>
    lastRemovedSessionRef: MutableRefObject<string | null>
    lastMergedReadySessionRef: MutableRefObject<string | null>
    setSessionsWithNotifications: Dispatch<SetStateAction<Set<string>>>
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    setFocusForSession: (sessionKey: string, focus: FocusArea) => void
    setCurrentFocus: (focus: FocusArea | null) => void
}

export function useSidebarBackendEvents({
    createSafeUnlistener,
    latestSessionsRef,
    lastRemovedSessionRef,
    lastMergedReadySessionRef,
    setSessionsWithNotifications,
    setSelection,
    setFocusForSession,
    setCurrentFocus,
}: UseSidebarBackendEventsParams): void {
    useEffect(() => {
        let disposed = false
        const unlisteners: UnlistenFn[] = []

        const register = async <E extends SchaltEvent>(
            event: E,
            handler: (payload: EventPayloadMap[E]) => void | Promise<void>,
        ) => {
            try {
                const unlisten = await listenEvent(event, async (payload) => {
                    if (!disposed) {
                        await handler(payload)
                    }
                })
                const safeUnlisten = createSafeUnlistener(unlisten)
                if (disposed) {
                    safeUnlisten()
                } else {
                    unlisteners.push(safeUnlisten)
                }
            } catch (e) {
                logger.warn('Failed to attach sidebar event listener', e)
            }
        }

        void register(SchaltEvent.SessionRemoved, (event) => {
            lastRemovedSessionRef.current = event.session_name
        })

        void register(SchaltEvent.GitOperationCompleted, (event: GitOperationPayload) => {
            if (event?.operation === 'merge') {
                lastMergedReadySessionRef.current = event.session_name
            }
        })

        void register(SchaltEvent.FollowUpMessage, (event) => {
            const { session_name, message, message_type } = event

            setSessionsWithNotifications(prev => new Set([...prev, session_name]))

            const session = latestSessionsRef.current.find(s => s.info.session_id === session_name)
            if (session) {
                void setSelection({
                    kind: 'session',
                    payload: session_name,
                    worktreePath: session.info.worktree_path,
                    sessionState: getSessionLifecycleState(session.info),
                }, false, true)
                setFocusForSession(session_name, 'claude')
                setCurrentFocus('claude')
            }

            logger.info(`📬 Follow-up message for ${session_name}: ${message}`)

            if (message_type === 'system') {
                logger.info(`📢 System message for session ${session_name}: ${message}`)
            } else {
                logger.info(`💬 User message for session ${session_name}: ${message}`)
            }
        })

        return () => {
            disposed = true
            unlisteners.forEach(unlisten => {
                try {
                    unlisten()
                } catch (error) {
                    logger.warn('[Sidebar] Failed to remove event listener during cleanup', error)
                }
            })
        }
    }, [
        createSafeUnlistener,
        latestSessionsRef,
        lastMergedReadySessionRef,
        lastRemovedSessionRef,
        setCurrentFocus,
        setFocusForSession,
        setSelection,
        setSessionsWithNotifications,
    ])
}
