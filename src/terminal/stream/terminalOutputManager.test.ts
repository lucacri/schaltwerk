import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../common/eventSystem', () => ({
  listenTerminalOutput: vi.fn()
}))

vi.mock('../transport/backend', () => ({
  subscribeTerminalBackend: vi.fn(),
  ackTerminalBackend: vi.fn(),
  isPluginTerminal: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { terminalOutputManager } from './terminalOutputManager'
import { TauriCommands } from '../../common/tauriCommands'
import { listenTerminalOutput } from '../../common/eventSystem'
import { subscribeTerminalBackend, ackTerminalBackend, isPluginTerminal } from '../transport/backend'
import { invoke } from '@tauri-apps/api/core'

type VitestMock = ReturnType<typeof vi.fn>

const listenMock = listenTerminalOutput as unknown as VitestMock
const subscribeMock = subscribeTerminalBackend as unknown as VitestMock
const ackMock = ackTerminalBackend as unknown as VitestMock
const isPluginMock = isPluginTerminal as unknown as VitestMock
const invokeMock = invoke as unknown as VitestMock

describe('terminalOutputManager', () => {
  const TERMINAL_ID = 'terminal-stream-test'

  beforeEach(() => {
    vi.clearAllMocks()
    isPluginMock.mockReturnValue(false)
    ackMock.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await terminalOutputManager.dispose(TERMINAL_ID)
  })

  it('hydrates and listens for standard terminal output', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 42, startSeq: 0, data: 'snapshot-data' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: null
    })
    expect(listener).toHaveBeenCalledWith('snapshot-data', { source: 'hydration' })
    expect(listenMock).toHaveBeenCalledWith(TERMINAL_ID, expect.any(Function))

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('live-chunk')
    expect(listener).toHaveBeenCalledWith('live-chunk', { source: 'live' })

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(unlisten).toHaveBeenCalled()
  })

  it('marks hydrated chunks as hydration source', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 15, startSeq: 0, data: 'existing buffer' })

    const calls: Array<{ chunk: string; source?: string }> = []
    terminalOutputManager.addListener(TERMINAL_ID, (chunk, meta) => {
      calls.push({ chunk, source: meta?.source })
    })
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(calls[0]).toEqual({ chunk: 'existing buffer', source: 'hydration' })
  })

  it('marks subscribed chunks as live source', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const calls: Array<{ chunk: string; source?: string }> = []
    terminalOutputManager.addListener(TERMINAL_ID, (chunk, meta) => {
      calls.push({ chunk, source: meta?.source })
    })
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('fresh output')

    expect(calls.at(-1)).toEqual({ chunk: 'fresh output', source: 'live' })
  })

  it('dispatches large hydration snapshots in bounded chunks', async () => {
    vi.useFakeTimers()
    try {
      const unlisten = vi.fn()
      listenMock.mockResolvedValueOnce(unlisten)
      const hydrationPayload = 'a'.repeat(170_000)
      invokeMock.mockResolvedValueOnce({ seq: 170_000, startSeq: 0, data: hydrationPayload })

      const chunks: string[] = []
      terminalOutputManager.addListener(TERMINAL_ID, chunk => {
        chunks.push(chunk)
      })

      const startPromise = terminalOutputManager.ensureStarted(TERMINAL_ID)
      await vi.runAllTimersAsync()
      await startPromise

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every(chunk => chunk.length <= 64 * 1024)).toBe(true)
      expect(chunks.join('')).toBe(hydrationPayload)
    } finally {
      vi.useRealTimers()
    }
  })

  it('streams plugin terminal output and acknowledges bytes', async () => {
    isPluginMock.mockReturnValue(true)
    const unsubscribe = vi.fn()
    subscribeMock.mockResolvedValueOnce(unsubscribe)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = subscribeMock.mock.calls[0][2] as (message: { seq: number; bytes: Uint8Array }) => void
    const bytes = new TextEncoder().encode('plugin-data')
    callback({ seq: 7, bytes })

    expect(listener).toHaveBeenCalledWith('plugin-data', { source: 'live' })
    expect(ackMock).toHaveBeenCalledWith(TERMINAL_ID, 7, bytes.length)

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('restores stream after dispose and restart', async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()
    listenMock
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)
    invokeMock.mockResolvedValue({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(firstUnlisten).toHaveBeenCalled()

    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)
    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(secondUnlisten).toHaveBeenCalled()
  })

  it('hydrates only new output after restart using last seen seq', async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()

    listenMock
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)

    invokeMock
      .mockResolvedValueOnce({ seq: 5, startSeq: 0, data: 'first-snapshot' })
      .mockResolvedValueOnce({ seq: 9, startSeq: 0, data: 'after-restart' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const firstCallback = listenMock.mock.calls[0][1] as (chunk: string) => void
    firstCallback('live') // advances seq by 4 bytes

    await terminalOutputManager.dispose(TERMINAL_ID)

    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: 9,
    })

    expect(listener).toHaveBeenCalledWith('first-snapshot', { source: 'hydration' })
    expect(listener).toHaveBeenCalledWith('live', { source: 'live' })
    expect(listener).toHaveBeenCalledWith('after-restart', { source: 'hydration' })
  })

  it('dispatches chunks to multiple listeners', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 1, startSeq: 0, data: '' })

    const listenerA = vi.fn()
    const listenerB = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listenerA)
    terminalOutputManager.addListener(TERMINAL_ID, listenerB)

    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('hello world')

    expect(listenerA).toHaveBeenCalledWith('hello world', { source: 'live' })
    expect(listenerB).toHaveBeenCalledWith('hello world', { source: 'live' })
  })

  it('forces text presentation for record button symbol', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    const emojiVariant = '\u23fa\uFE0F'
    const plainVariant = '\u23fa'
    callback(`recording ${emojiVariant} plain ${plainVariant}`)

    const expectedTextVariant = '\u23fa\uFE0E'
    expect(listener).toHaveBeenCalledWith(`recording ${expectedTextVariant} plain ${expectedTextVariant}`, { source: 'live' })
  })

  it('forces text presentation for pause symbol', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    const emojiVariant = '\u23f8\uFE0F'
    const plainVariant = '\u23f8'
    callback(`status ${emojiVariant} plain ${plainVariant}`)

    const expectedTextVariant = '\u23f8\uFE0E'
    expect(listener).toHaveBeenCalledWith(`status ${expectedTextVariant} plain ${expectedTextVariant}`, { source: 'live' })
  })

  it('ignores non-string chunks from standard stream', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: unknown) => void
    callback(123 as unknown as string)
    callback(null as unknown as string)

    expect(listener).not.toHaveBeenCalled()
  })

  it('handles hydration failure gracefully', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockRejectedValueOnce(new Error('boom'))

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(listenMock).toHaveBeenCalledWith(TERMINAL_ID, expect.any(Function))
  })

  it('does not start stream twice while a start is in progress', async () => {
    const unlisten = vi.fn()
    let resolver: () => void = () => {}
    const listenPromise = new Promise<() => void>(resolve => {
      resolver = () => resolve(unlisten)
    })
    listenMock.mockReturnValue(listenPromise)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)

    const first = terminalOutputManager.ensureStarted(TERMINAL_ID)
    const second = terminalOutputManager.ensureStarted(TERMINAL_ID)

    resolver()
    await Promise.all([first, second])

    expect(listenMock).toHaveBeenCalledTimes(1)
  })

  it('rehydrates catch-up bytes from last seq and dispatches them', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 12, startSeq: 0, data: 'initial' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('live') // advances seqCursor by 4 bytes → 16

    invokeMock.mockResolvedValueOnce({ seq: 20, startSeq: 16, data: 'catchup' })

    await terminalOutputManager.rehydrate(TERMINAL_ID)

    expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: 16,
    })
    expect(listener).toHaveBeenCalledWith('catchup', { source: 'hydration' })
  })

  it('rehydrate is a no-op before the stream has started', async () => {
    await terminalOutputManager.rehydrate(TERMINAL_ID)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('rehydrate awaits an in-flight start before fetching', async () => {
    const unlisten = vi.fn()
    let resolver: () => void = () => {}
    const listenPromise = new Promise<() => void>(resolve => {
      resolver = () => resolve(unlisten)
    })
    listenMock.mockReturnValue(listenPromise)
    invokeMock.mockResolvedValueOnce({ seq: 5, startSeq: 0, data: 'first' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)

    const startPromise = terminalOutputManager.ensureStarted(TERMINAL_ID)
    const rehydratePromise = terminalOutputManager.rehydrate(TERMINAL_ID)

    invokeMock.mockResolvedValueOnce({ seq: 7, startSeq: 5, data: 'delta' })
    resolver()

    await startPromise
    await rehydratePromise

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: 5,
    })
    expect(listener).toHaveBeenCalledWith('delta', { source: 'hydration' })
  })

  it('removes listener and stops dispatching chunks', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listenerA = vi.fn()
    const listenerB = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listenerA)
    terminalOutputManager.addListener(TERMINAL_ID, listenerB)

    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    terminalOutputManager.removeListener(TERMINAL_ID, listenerA)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('chunk')

    expect(listenerA).not.toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalledWith('chunk', { source: 'live' })
  })

  it('rehydrates from the caller-provided baseline instead of the live seqCursor', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 20, startSeq: 0, data: 'initial' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(terminalOutputManager.getSeqCursor(TERMINAL_ID)).toBe(20)

    invokeMock.mockResolvedValueOnce({ seq: 32, startSeq: 12, data: 'delta-from-12' })
    await terminalOutputManager.rehydrate(TERMINAL_ID, 12)

    expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: 12,
    })
    expect(listener).toHaveBeenCalledWith('delta-from-12', { source: 'hydration' })
    expect(terminalOutputManager.getSeqCursor(TERMINAL_ID)).toBe(32)
  })

  it('rehydrate without fromSeq still falls back to the live seqCursor', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 9, startSeq: 0, data: 'initial' })

    terminalOutputManager.addListener(TERMINAL_ID, vi.fn())
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    invokeMock.mockResolvedValueOnce({ seq: 14, startSeq: 9, data: 'delta' })
    await terminalOutputManager.rehydrate(TERMINAL_ID)

    expect(invokeMock).toHaveBeenNthCalledWith(2, TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: 9,
    })
  })

  it('getSeqCursor returns null before hydration starts', () => {
    expect(terminalOutputManager.getSeqCursor('never-started-terminal')).toBeNull()
  })
})
