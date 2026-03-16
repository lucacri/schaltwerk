import { atom } from 'jotai'
import { formatLastActivity } from '../../utils/time'

const THROTTLE_MS = 5_000

const baseMapAtom = atom<Map<string, number>>(new Map())

export const lastAgentResponseMapAtom = atom<Map<string, number>>(
  (get) => get(baseMapAtom)
)

export const updateLastAgentResponseActionAtom = atom(
  null,
  (get, set, sessionName: string) => {
    const prev = get(baseMapAtom)
    const lastTs = prev.get(sessionName)
    const now = Date.now()
    if (lastTs !== undefined && now - lastTs < THROTTLE_MS) return
    const next = new Map(prev)
    next.set(sessionName, now)
    set(baseMapAtom, next)
  }
)

export const cleanupStaleSessionsActionAtom = atom(
  null,
  (get, set, activeSessionIds: ReadonlySet<string>) => {
    const map = get(baseMapAtom)
    let changed = false
    const next = new Map(map)
    for (const key of next.keys()) {
      if (!activeSessionIds.has(key)) {
        next.delete(key)
        changed = true
      }
    }
    if (changed) set(baseMapAtom, next)
  }
)

export const agentResponseTickAtom = atom(0)

export function formatAgentResponseTime(
  map: Map<string, number>,
  sessionName: string
): string | undefined {
  const timestamp = map.get(sessionName)
  if (timestamp === undefined) {
    return undefined
  }
  return formatLastActivity(new Date(timestamp).toISOString())
}
