import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

let capturedPtyDataHandler: ((payload: unknown) => void) | null = null
const mockUnlisten = vi.fn()
vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
    capturedPtyDataHandler = handler
    return mockUnlisten
  }),
  SchaltEvent: {
    PtyData: 'schaltwerk:pty-data',
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { PluginTransport } from './PluginTransport'

describe('PluginTransport', () => {
  let transport: PluginTransport

  beforeEach(() => {
    transport = new PluginTransport()
    vi.clearAllMocks()
    capturedPtyDataHandler = null
  })

  describe('spawn', () => {
    it('invokes PtySpawn and returns the term id', async () => {
      mockInvoke.mockResolvedValueOnce({ term_id: 'term-1' })

      const result = await transport.spawn({
        id: 'my-term',
        cwd: '/tmp',
        rows: 24,
        cols: 80,
      })

      expect(result).toEqual({ termId: 'term-1' })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtySpawn, {
        options: {
          id: 'my-term',
          cwd: '/tmp',
          rows: 24,
          cols: 80,
          env: [],
        },
      })
    })

    it('maps env entries to tuple pairs', async () => {
      mockInvoke.mockResolvedValueOnce({ term_id: 'term-2' })

      await transport.spawn({
        id: 'my-term',
        cwd: '/tmp',
        rows: 24,
        cols: 80,
        env: [{ key: 'FOO', value: 'bar' }],
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtySpawn, {
        options: expect.objectContaining({
          env: [['FOO', 'bar']],
        }),
      })
    })
  })

  describe('write', () => {
    it('invokes PtyWrite with term id and data', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await transport.write('term-1', 'hello')
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtyWrite, {
        term_id: 'term-1',
        utf8: 'hello',
      })
    })
  })

  describe('resize', () => {
    it('invokes PtyResize with dimensions', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await transport.resize('term-1', 30, 120)
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtyResize, {
        term_id: 'term-1',
        rows: 30,
        cols: 120,
      })
    })
  })

  describe('kill', () => {
    it('invokes PtyKill', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await transport.kill('term-1')
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtyKill, {
        term_id: 'term-1',
      })
    })

    it('unlistens existing subscription before killing', async () => {
      mockInvoke.mockResolvedValue({ Snapshot: { term_id: 'term-1', seq: 1, base64: '' } })
      await transport.subscribe('term-1', 0, vi.fn())

      mockInvoke.mockResolvedValueOnce(undefined)
      await transport.kill('term-1')

      expect(mockUnlisten).toHaveBeenCalled()
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtyKill, { term_id: 'term-1' })
    })
  })

  describe('ack', () => {
    it('invokes PtyAck with seq and bytes', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await transport.ack('term-1', 5, 100)
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.PtyAck, {
        term_id: 'term-1',
        seq: 5,
        bytes: 100,
      })
    })
  })

  describe('subscribe', () => {
    it('delivers snapshot data to onData callback', async () => {
      const base64Data = btoa('hello')
      mockInvoke.mockResolvedValueOnce({
        Snapshot: { term_id: 'term-1', seq: 1, base64: base64Data },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)

      expect(onData).toHaveBeenCalledTimes(1)
      expect(onData).toHaveBeenCalledWith({
        seq: 1,
        bytes: new Uint8Array([104, 101, 108, 108, 111]),
      })
    })

    it('does not call onData for empty snapshot', async () => {
      mockInvoke.mockResolvedValueOnce({
        Snapshot: { term_id: 'term-1', seq: 1, base64: '' },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)

      expect(onData).not.toHaveBeenCalled()
    })

    it('handles DeltaReady response without calling onData', async () => {
      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 3 },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)

      expect(onData).not.toHaveBeenCalled()
    })

    it('delivers PtyData events via the listener', async () => {
      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 0 },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)

      const base64Data = btoa('world')
      capturedPtyDataHandler!({
        term_id: 'term-1',
        seq: 1,
        base64: base64Data,
      })

      expect(onData).toHaveBeenCalledWith({
        seq: 1,
        bytes: new Uint8Array([119, 111, 114, 108, 100]),
      })
    })

    it('ignores PtyData events for other terminal ids', async () => {
      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 0 },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)

      capturedPtyDataHandler!({
        term_id: 'term-other',
        seq: 1,
        base64: btoa('data'),
      })

      expect(onData).not.toHaveBeenCalled()
    })

    it('ignores PtyData events with seq not higher than last seen', async () => {
      mockInvoke.mockResolvedValueOnce({
        Snapshot: { term_id: 'term-1', seq: 5, base64: btoa('x') },
      })

      const onData = vi.fn()
      await transport.subscribe('term-1', 0, onData)
      onData.mockClear()

      capturedPtyDataHandler!({
        term_id: 'term-1',
        seq: 3,
        base64: btoa('old'),
      })

      expect(onData).not.toHaveBeenCalled()
    })

    it('returns a cleanup function that unlistens', async () => {
      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 0 },
      })

      const cleanup = await transport.subscribe('term-1', 0, vi.fn())
      await cleanup()

      expect(mockUnlisten).toHaveBeenCalled()
    })

    it('unsubscribes previous listener when subscribing again', async () => {
      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 0 },
      })
      await transport.subscribe('term-1', 0, vi.fn())

      mockInvoke.mockResolvedValueOnce({
        DeltaReady: { term_id: 'term-1', seq: 0 },
      })
      await transport.subscribe('term-1', 0, vi.fn())

      expect(mockUnlisten).toHaveBeenCalledTimes(1)
    })
  })
})
