import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('./PluginTransport', () => {
  class MockPluginTransport {
    spawn = vi.fn()
    write = vi.fn()
    resize = vi.fn()
    kill = vi.fn()
    subscribe = vi.fn()
    ack = vi.fn()
  }
  return { PluginTransport: MockPluginTransport }
})

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('transportFlags', () => {
  beforeEach(async () => {
    vi.resetModules()
    mockInvoke.mockReset()
  })

  describe('shouldUsePluginTransport', () => {
    it('returns true when env variable is set to pty_plugin via process.env', async () => {
      const originalEnv = process.env.SCHALTWERK_TERMINAL_TRANSPORT
      process.env.SCHALTWERK_TERMINAL_TRANSPORT = 'pty_plugin'
      try {
        const { shouldUsePluginTransport } = await import('./transportFlags')
        const result = await shouldUsePluginTransport()
        expect(result).toBe(true)
      } finally {
        if (originalEnv === undefined) {
          delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
        } else {
          process.env.SCHALTWERK_TERMINAL_TRANSPORT = originalEnv
        }
      }
    })

    it('returns false when no Tauri IPC and no env var', async () => {
      delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
      const { shouldUsePluginTransport } = await import('./transportFlags')
      const result = await shouldUsePluginTransport()
      expect(result).toBe(false)
    })

    it('caches the result after first call', async () => {
      delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
      const { shouldUsePluginTransport } = await import('./transportFlags')
      const first = await shouldUsePluginTransport()
      const second = await shouldUsePluginTransport()
      expect(first).toBe(second)
    })
  })

  describe('getPluginTransport', () => {
    it('returns null when plugin transport is not enabled', async () => {
      delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
      const { getPluginTransport } = await import('./transportFlags')
      const result = await getPluginTransport()
      expect(result).toBeNull()
    })

    it('returns a PluginTransport instance when enabled', async () => {
      process.env.SCHALTWERK_TERMINAL_TRANSPORT = 'pty_plugin'
      try {
        const { getPluginTransport } = await import('./transportFlags')
        const result = await getPluginTransport()
        expect(result).not.toBeNull()
      } finally {
        delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
      }
    })

    it('returns the same instance on subsequent calls', async () => {
      process.env.SCHALTWERK_TERMINAL_TRANSPORT = 'pty_plugin'
      try {
        const { getPluginTransport } = await import('./transportFlags')
        const first = await getPluginTransport()
        const second = await getPluginTransport()
        expect(first).toBe(second)
      } finally {
        delete process.env.SCHALTWERK_TERMINAL_TRANSPORT
      }
    })
  })
})
