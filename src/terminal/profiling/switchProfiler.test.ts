import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
  },
}))

import { logger } from '../../utils/logger'
import {
  profileSwitchPhase,
  profileSwitchPhaseAsync,
  startSwitchPhaseProfile,
  SwitchProfiler,
} from './switchProfiler'

const loggerDebug = logger.debug as ReturnType<typeof vi.fn>

function setProfilingEnabled(enabled: boolean) {
  if (enabled) {
    localStorage.setItem('TERMINAL_DEBUG', '1')
  } else {
    localStorage.removeItem('TERMINAL_DEBUG')
  }
}

describe('switchProfiler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('isSwitchProfilingEnabled', () => {
    it('returns false when localStorage has no flag', () => {
      const result = profileSwitchPhase('test', () => 42)
      expect(result).toBe(42)
      expect(loggerDebug).not.toHaveBeenCalled()
    })

    it('returns true when TERMINAL_DEBUG=1', () => {
      setProfilingEnabled(true)
      profileSwitchPhase('test', () => 42)
      expect(loggerDebug).toHaveBeenCalledOnce()
    })

    it('returns false when localStorage throws', () => {
      const originalGetItem = Storage.prototype.getItem
      Storage.prototype.getItem = () => {
        throw new Error('sandboxed')
      }
      try {
        const result = profileSwitchPhase('test', () => 99)
        expect(result).toBe(99)
        expect(loggerDebug).not.toHaveBeenCalled()
      } finally {
        Storage.prototype.getItem = originalGetItem
      }
    })
  })

  describe('profileSwitchPhase', () => {
    it('runs operation and returns result when disabled', () => {
      const result = profileSwitchPhase('phase', () => 'hello')
      expect(result).toBe('hello')
      expect(loggerDebug).not.toHaveBeenCalled()
    })

    it('runs operation, returns result, and logs when enabled', () => {
      setProfilingEnabled(true)
      const result = profileSwitchPhase('phase.test', () => 'value')
      expect(result).toBe('value')
      expect(loggerDebug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SwitchProfile\] phase\.test: \d+\.\d+ms$/),
        undefined,
      )
    })

    it('passes context to logger', () => {
      setProfilingEnabled(true)
      const ctx = { terminalId: 'abc', chars: 100 }
      profileSwitchPhase('write', () => null, ctx)
      expect(loggerDebug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SwitchProfile\] write:/),
        ctx,
      )
    })
  })

  describe('profileSwitchPhaseAsync', () => {
    it('awaits and logs async operations', async () => {
      setProfilingEnabled(true)
      const result = await profileSwitchPhaseAsync(
        'async.op',
        async () => {
          return 'async-result'
        },
      )
      expect(result).toBe('async-result')
      expect(loggerDebug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SwitchProfile\] async\.op: \d+\.\d+ms$/),
        undefined,
      )
    })

    it('still logs timing if the operation throws', async () => {
      setProfilingEnabled(true)
      await expect(
        profileSwitchPhaseAsync('failing', async () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(loggerDebug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SwitchProfile\] failing: \d+\.\d+ms \[FAILED\]$/),
        undefined,
      )
    })
  })

  describe('startSwitchPhaseProfile', () => {
    it('returns no-op when disabled', () => {
      const stop = startSwitchPhaseProfile('phase')
      stop()
      expect(loggerDebug).not.toHaveBeenCalled()
    })

    it('logs elapsed time when stop() is called', () => {
      setProfilingEnabled(true)
      const stop = startSwitchPhaseProfile('manual.phase', { id: 'x' })
      stop()
      expect(loggerDebug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[SwitchProfile\] manual\.phase: \d+\.\d+ms$/),
        { id: 'x' },
      )
    })
  })

  describe('SwitchProfiler', () => {
    it('aggregates all phases with totals in summary', () => {
      setProfilingEnabled(true)
      const profiler = new SwitchProfiler()
      profiler.begin('acquire')
      profiler.end('acquire')
      profiler.begin('attach')
      profiler.end('attach')

      const summary = profiler.summary()
      expect(summary).toContain('[SwitchProfile] Summary:')
      expect(summary).toContain('acquire:')
      expect(summary).toContain('attach:')
      expect(summary).toContain('TOTAL:')
      expect(summary).toMatch(/TOTAL: \d+\.\d+ms$/)
    })

    it('end() without begin() is safe (no-op)', () => {
      setProfilingEnabled(true)
      const profiler = new SwitchProfiler()
      expect(() => profiler.end('nonexistent')).not.toThrow()
    })
  })

  describe('formatMs', () => {
    it('formats to 1 decimal place', () => {
      setProfilingEnabled(true)
      profileSwitchPhase('fmt', () => null)
      const call = loggerDebug.mock.calls[0][0] as string
      const match = call.match(/(\d+\.\d)ms/)
      expect(match).toBeTruthy()
      expect(match![1].split('.')[1]).toHaveLength(1)
    })
  })
})
