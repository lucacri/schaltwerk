import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  usageAtom,
  usageLoadingAtom,
  fetchUsageActionAtom,
  registerUsageEventListenerActionAtom,
} from './usage'
import { SchaltEvent } from '../../common/events'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

const handlers: Array<(payload: unknown) => void> = []

vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn((_event: string, handler: (payload: unknown) => void) => {
    handlers.push(handler)
    return Promise.resolve(() => {})
  }),
}))

describe('usage atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    handlers.length = 0
    vi.clearAllMocks()
  })

  it('starts with null usage and not loading', () => {
    expect(store.get(usageAtom)).toBe(null)
    expect(store.get(usageLoadingAtom)).toBe(false)
  })

  it('fetchUsageActionAtom sets usage on success', async () => {
    const snapshot = {
      session_percent: 42,
      session_reset_time: '11:59pm',
      weekly_percent: 80,
      weekly_reset_time: 'Mar 15',
      provider: 'anthropic',
      fetched_at: '2026-03-14T00:00:00Z',
    }
    vi.mocked(invoke).mockResolvedValue(snapshot)

    await store.set(fetchUsageActionAtom)

    expect(store.get(usageAtom)).toEqual(snapshot)
    expect(store.get(usageLoadingAtom)).toBe(false)
  })

  it('fetchUsageActionAtom sets error state on failure', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('network error'))

    await store.set(fetchUsageActionAtom)

    const usage = store.get(usageAtom)
    expect(usage).not.toBe(null)
    expect(usage?.error).toContain('network error')
    expect(usage?.session_percent).toBe(0)
    expect(usage?.weekly_percent).toBe(0)
    expect(store.get(usageLoadingAtom)).toBe(false)
  })

  it('registerUsageEventListenerActionAtom updates atom on event', async () => {
    await store.set(registerUsageEventListenerActionAtom)

    expect(handlers.length).toBe(1)

    const payload = {
      session_percent: 55,
      session_reset_time: null,
      weekly_percent: 90,
      weekly_reset_time: 'Mar 20',
      provider: 'anthropic',
      fetched_at: '2026-03-14T12:00:00Z',
    }
    handlers[0]?.(payload)

    expect(store.get(usageAtom)).toEqual(payload)
  })

  it('listenEvent is called with UsageUpdated event', async () => {
    const { listenEvent } = await import('../../common/eventSystem')
    await store.set(registerUsageEventListenerActionAtom)

    expect(listenEvent).toHaveBeenCalledWith(
      SchaltEvent.UsageUpdated,
      expect.any(Function),
    )
  })
})
