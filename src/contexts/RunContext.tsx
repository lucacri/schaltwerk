import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { useSessions } from '../hooks/useSessions'
import { SessionState, type EnrichedSession } from '../types/session'
import { getSessionLifecycleState } from '../utils/sessionState'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { specOrchestratorTerminalId, stableSessionTerminalId } from '../common/terminalIdentity'
import { logger } from '../utils/logger'
import { clarifierResumedSpecsAtom } from '../store/atoms/clarifierResume'

interface RunContextType {
    runningSessions: Set<string>
    addRunningSession: (sessionId: string) => void
    removeRunningSession: (sessionId: string) => void
    isSessionRunning: (sessionId: string) => boolean
}

const RunContext = createContext<RunContextType | undefined>(undefined)

function isSessionActivelyRunning(
    session: EnrichedSession,
    resumedSpecs: ReadonlySet<string>,
): boolean {
    const lifecycleState = getSessionLifecycleState(session.info)

    if (lifecycleState === SessionState.Spec) {
        if (session.info.clarification_started !== true) return false
        if (session.info.attention_required !== true) return true
        return resumedSpecs.has(session.info.session_id)
    }

    return lifecycleState === SessionState.Running && session.info.attention_required !== true
}

export function RunProvider({ children }: { children: ReactNode }) {
    const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set())
    const { allSessions } = useSessions()
    const resumedSpecs = useAtomValue(clarifierResumedSpecsAtom)
    const allSessionsRef = useRef(allSessions)
    allSessionsRef.current = allSessions

    const addRunningSession = useCallback((sessionId: string) => {
        setRunningSessions(prev => new Set(prev).add(sessionId))
    }, [])

    const removeRunningSession = useCallback((sessionId: string) => {
        setRunningSessions(prev => {
            const next = new Set(prev)
            next.delete(sessionId)
            return next
        })
    }, [])

    const isSessionRunning = (sessionId: string) => {
        return runningSessions.has(sessionId)
    }

    useEffect(() => {
        setRunningSessions(prev => {
            if (!allSessions || allSessions.length === 0) {
                if (prev.size === 0) return prev
                const next = new Set<string>()
                // Preserve orchestrator flag if active
                if (prev.has('orchestrator')) next.add('orchestrator')
                return next.size === prev.size ? prev : next
            }

            const allowed = new Set<string>(
                allSessions
                    .filter(session => isSessionActivelyRunning(session, resumedSpecs))
                    .map(session => session.info.session_id)
            )

            let changed = false
            const next = new Set<string>()
            prev.forEach(id => {
                if (id === 'orchestrator' || allowed.has(id)) {
                    next.add(id)
                } else {
                    changed = true
                }
            })
            allowed.forEach(id => {
                if (resumedSpecs.has(id) && !next.has(id)) {
                    next.add(id)
                    changed = true
                }
            })

            return changed || next.size !== prev.size ? next : prev
        })
    }, [allSessions, resumedSpecs])

    useEffect(() => {
        let stopAgentStarted: (() => void) | null = null
        let stopTerminalClosed: (() => void) | null = null
        let disposed = false

        const setupListeners = async () => {
            try {
                stopAgentStarted = await listenEvent(SchaltEvent.TerminalAgentStarted, payload => {
                    if (disposed || !payload?.session_name) {
                        return
                    }
                    addRunningSession(payload.session_name)
                })

                stopTerminalClosed = await listenEvent(SchaltEvent.TerminalClosed, payload => {
                    if (disposed || !payload?.terminal_id) {
                        return
                    }

                    const closedSession = allSessionsRef.current.find(session => {
                        const sessionId = session.info.session_id
                        return payload.terminal_id === stableSessionTerminalId(sessionId, 'top')
                            || payload.terminal_id === specOrchestratorTerminalId(sessionId)
                    })

                    if (closedSession) {
                        removeRunningSession(closedSession.info.session_id)
                    }
                })
            } catch (error) {
                logger.warn('[RunContext] Failed to attach run-state listeners', error)
            }
        }

        void setupListeners()

        return () => {
            disposed = true
            try {
                stopAgentStarted?.()
            } catch (error) {
                logger.warn('[RunContext] Failed to remove TerminalAgentStarted listener', error)
            }
            try {
                stopTerminalClosed?.()
            } catch (error) {
                logger.warn('[RunContext] Failed to remove TerminalClosed listener', error)
            }
        }
    }, [addRunningSession, removeRunningSession])

    return (
        <RunContext.Provider value={{ 
            runningSessions, 
            addRunningSession, 
            removeRunningSession, 
            isSessionRunning 
        }}>
            {children}
        </RunContext.Provider>
    )
}

export function useRun() {
    const context = useContext(RunContext)
    if (!context) {
        throw new Error('useRun must be used within a RunProvider')
    }
    return context
}
