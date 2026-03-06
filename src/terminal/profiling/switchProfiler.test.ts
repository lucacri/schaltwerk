import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatSwitchProfileDuration,
  profileSwitchPhase,
  profileSwitchPhaseAsync,
  startSwitchPhaseProfile,
} from './switchProfiler'
import { logger } from '../../utils/logger'

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}))

describe('switchProfiler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem('TERMINAL_DEBUG')
  })

  it('formats durations with one decimal place', () => {
    expect(formatSwitchProfileDuration(12.345)).toBe('12.3ms')
  })

  it('logs sync phase timing when terminal debug is enabled', () => {
    localStorage.setItem('TERMINAL_DEBUG', '1')

    const result = profileSwitchPhase('xterm.refresh', () => 42, { terminalId: 'session-a-top' })

    expect(result).toBe(42)
    expect(logger.debug).toHaveBeenCalledTimes(1)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[SwitchProfile\] xterm\.refresh: \d+\.\dms$/),
      { terminalId: 'session-a-top' },
    )
  })

  it('logs async phase timing when terminal debug is enabled', async () => {
    localStorage.setItem('TERMINAL_DEBUG', '1')

    const result = await profileSwitchPhaseAsync('hydration.fetch', async () => 'ok')

    expect(result).toBe('ok')
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[SwitchProfile\] hydration\.fetch: \d+\.\dms$/),
    )
  })

  it('returns a no-op stopper when debug is disabled', () => {
    const stop = startSwitchPhaseProfile('selection.atom.update')
    stop()
    expect(logger.debug).not.toHaveBeenCalled()
  })
})
