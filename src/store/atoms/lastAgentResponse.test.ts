import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  lastAgentResponseMapAtom,
  updateLastAgentResponseActionAtom,
  cleanupStaleSessionsActionAtom,
  agentResponseTickAtom,
  formatAgentResponseTime,
} from './lastAgentResponse'

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('lastAgentResponse atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  describe('lastAgentResponseMapAtom', () => {
    it('starts as an empty map', () => {
      const map = store.get(lastAgentResponseMapAtom)
      expect(map).toBeInstanceOf(Map)
      expect(map.size).toBe(0)
    })

    it('is read-only (no set method exposed)', () => {
      expect(() => {
        // @ts-expect-error - verifying read-only behavior
        store.set(lastAgentResponseMapAtom, new Map())
      }).toThrow()
    })
  })

  describe('updateLastAgentResponseActionAtom', () => {
    it('sets a timestamp for a session name', () => {
      const before = Date.now()
      store.set(updateLastAgentResponseActionAtom, 'my-session')
      const after = Date.now()

      const map = store.get(lastAgentResponseMapAtom)
      expect(map.has('my-session')).toBe(true)
      const ts = map.get('my-session')!
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })

    it('throttles updates within 5 seconds', () => {
      vi.useFakeTimers()
      const baseTime = new Date('2025-08-09T12:00:00Z')
      vi.setSystemTime(baseTime)

      store.set(updateLastAgentResponseActionAtom, 'session-a')
      const first = store.get(lastAgentResponseMapAtom).get('session-a')!

      vi.advanceTimersByTime(1000)
      store.set(updateLastAgentResponseActionAtom, 'session-a')
      const second = store.get(lastAgentResponseMapAtom).get('session-a')!
      expect(second).toBe(first)

      vi.advanceTimersByTime(5000)
      store.set(updateLastAgentResponseActionAtom, 'session-a')
      const third = store.get(lastAgentResponseMapAtom).get('session-a')!
      expect(third).toBeGreaterThan(first)

      vi.useRealTimers()
    })

    it('tracks multiple sessions independently', () => {
      store.set(updateLastAgentResponseActionAtom, 'session-a')
      store.set(updateLastAgentResponseActionAtom, 'session-b')

      const map = store.get(lastAgentResponseMapAtom)
      expect(map.size).toBe(2)
      expect(map.has('session-a')).toBe(true)
      expect(map.has('session-b')).toBe(true)
    })
  })

  describe('cleanupStaleSessionsActionAtom', () => {
    it('removes entries for sessions not in the active set', () => {
      store.set(updateLastAgentResponseActionAtom, 'session-a')
      store.set(updateLastAgentResponseActionAtom, 'session-b')
      store.set(updateLastAgentResponseActionAtom, 'session-c')

      store.set(cleanupStaleSessionsActionAtom, new Set(['session-a']))

      const map = store.get(lastAgentResponseMapAtom)
      expect(map.size).toBe(1)
      expect(map.has('session-a')).toBe(true)
    })

    it('does not mutate if all sessions are active', () => {
      store.set(updateLastAgentResponseActionAtom, 'session-a')
      const mapBefore = store.get(lastAgentResponseMapAtom)

      store.set(cleanupStaleSessionsActionAtom, new Set(['session-a']))
      const mapAfter = store.get(lastAgentResponseMapAtom)

      expect(mapAfter).toBe(mapBefore)
    })
  })

  describe('agentResponseTickAtom', () => {
    it('starts at 0', () => {
      expect(store.get(agentResponseTickAtom)).toBe(0)
    })

    it('can be set to a new value', () => {
      store.set(agentResponseTickAtom, 1)
      expect(store.get(agentResponseTickAtom)).toBe(1)
    })
  })

  describe('formatAgentResponseTime', () => {
    it('returns undefined when session is not in the map', () => {
      const map = new Map<string, number>()
      expect(formatAgentResponseTime(map, 'missing')).toBeUndefined()
    })

    it('returns "now" for a very recent timestamp', () => {
      const map = new Map<string, number>([['s1', Date.now()]])
      expect(formatAgentResponseTime(map, 's1')).toBe('now')
    })

    it('returns a relative time string for older timestamps', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      const map = new Map<string, number>([['s1', fiveMinutesAgo]])
      expect(formatAgentResponseTime(map, 's1')).toBe('5m')
    })

    it('returns hour-based format for timestamps over an hour old', () => {
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
      const map = new Map<string, number>([['s1', threeHoursAgo]])
      expect(formatAgentResponseTime(map, 's1')).toBe('3h')
    })

    it('returns day-based format for timestamps over a day old', () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      const map = new Map<string, number>([['s1', twoDaysAgo]])
      expect(formatAgentResponseTime(map, 's1')).toBe('2d')
    })
  })
})
