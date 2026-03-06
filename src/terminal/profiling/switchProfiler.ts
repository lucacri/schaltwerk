import { logger } from '../../utils/logger'

const SWITCH_PROFILE_PREFIX = '[SwitchProfile]'

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

export function isSwitchProfilingEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    return window.localStorage.getItem('TERMINAL_DEBUG') === '1'
  } catch {
    return false
  }
}

export function formatSwitchProfileDuration(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`
}

function emitSwitchProfile(
  phase: string,
  durationMs: number,
  context?: Record<string, unknown>,
): void {
  const message = `${SWITCH_PROFILE_PREFIX} ${phase}: ${formatSwitchProfileDuration(durationMs)}`
  if (context) {
    logger.debug(message, context)
    return
  }
  logger.debug(message)
}

export function profileSwitchPhase<T>(
  phase: string,
  run: () => T,
  context?: Record<string, unknown>,
): T {
  if (!isSwitchProfilingEnabled()) {
    return run()
  }

  const startedAt = now()
  try {
    return run()
  } finally {
    emitSwitchProfile(phase, now() - startedAt, context)
  }
}

export async function profileSwitchPhaseAsync<T>(
  phase: string,
  run: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  if (!isSwitchProfilingEnabled()) {
    return run()
  }

  const startedAt = now()
  try {
    return await run()
  } finally {
    emitSwitchProfile(phase, now() - startedAt, context)
  }
}

export function startSwitchPhaseProfile(
  phase: string,
  context?: Record<string, unknown>,
): () => void {
  if (!isSwitchProfilingEnabled()) {
    return () => undefined
  }

  const startedAt = now()
  return () => {
    emitSwitchProfile(phase, now() - startedAt, context)
  }
}
