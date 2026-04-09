import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { allSessionsAtom } from '../store/atoms/sessions'
import { updateLastAgentResponseActionAtom, agentResponseTickAtom, cleanupStaleSessionsActionAtom } from '../store/atoms/lastAgentResponse'
import { sessionTerminalGroup, specOrchestratorTerminalId } from '../common/terminalIdentity'
import { terminalOutputManager } from '../terminal/stream/terminalOutputManager'

const TICK_INTERVAL_MS = 30_000

export function useLastAgentResponseTracker(): void {
  const sessions = useAtomValue(allSessionsAtom)
  const updateTimestamp = useSetAtom(updateLastAgentResponseActionAtom)
  const cleanupStaleSessions = useSetAtom(cleanupStaleSessionsActionAtom)
  const setTick = useSetAtom(agentResponseTickAtom)

  useEffect(() => {
    const listeners: Array<{ topId: string; callback: (chunk: string) => void }> = []
    const activeSessionIds = new Set<string>()

    for (const session of sessions) {
      const sessionName = session.info.session_id
      activeSessionIds.add(sessionName)
      const topId = session.info.session_state === 'spec'
        ? specOrchestratorTerminalId(session.info.stable_id ?? sessionName)
        : sessionTerminalGroup(sessionName).top
      const callback = (): void => {
        updateTimestamp(sessionName)
      }
      terminalOutputManager.addListener(topId, callback)
      listeners.push({ topId, callback })
    }

    cleanupStaleSessions(activeSessionIds)

    return () => {
      for (const { topId, callback } of listeners) {
        terminalOutputManager.removeListener(topId, callback)
      }
    }
  }, [sessions, updateTimestamp, cleanupStaleSessions])

  useEffect(() => {
    const id = setInterval(() => {
      setTick((prev) => prev + 1)
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [setTick])
}
