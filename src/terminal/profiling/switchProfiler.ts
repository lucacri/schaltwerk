import { logger } from '../../utils/logger'

function isSwitchProfilingEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem('TERMINAL_DEBUG') === '1'
  } catch {
    return false
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`
}

export function profileSwitchPhase<T>(
  phase: string,
  run: () => T,
  context?: Record<string, unknown>,
): T {
  if (!isSwitchProfilingEnabled()) return run()
  const start = now()
  const result = run()
  logger.debug(`[SwitchProfile] ${phase}: ${formatMs(now() - start)}`, context)
  return result
}

export async function profileSwitchPhaseAsync<T>(
  phase: string,
  run: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  if (!isSwitchProfilingEnabled()) return run()
  const start = now()
  try {
    const result = await run()
    logger.debug(`[SwitchProfile] ${phase}: ${formatMs(now() - start)}`, context)
    return result
  } catch (e) {
    logger.debug(`[SwitchProfile] ${phase}: ${formatMs(now() - start)} [FAILED]`, context)
    throw e
  }
}

export function startSwitchPhaseProfile(
  phase: string,
  context?: Record<string, unknown>,
): () => void {
  if (!isSwitchProfilingEnabled()) return () => {}
  const start = now()
  return () => {
    logger.debug(`[SwitchProfile] ${phase}: ${formatMs(now() - start)}`, context)
  }
}

export class SwitchProfiler {
  private starts = new Map<string, number>()
  private timings = new Map<string, number>()

  begin(phase: string): void {
    if (!isSwitchProfilingEnabled()) return
    this.starts.set(phase, now())
  }

  end(phase: string): void {
    const start = this.starts.get(phase)
    if (start === undefined) return
    const elapsed = now() - start
    this.timings.set(phase, (this.timings.get(phase) || 0) + elapsed)
    this.starts.delete(phase)
    logger.debug(`[SwitchProfile] ${phase}: ${formatMs(elapsed)}`)
  }

  summary(): string {
    const entries = Array.from(this.timings.entries())
    const total = entries.reduce((sum, [, ms]) => sum + ms, 0)
    const lines = entries.map(([phase, ms]) => `  ${phase}: ${formatMs(ms)}`)
    return `[SwitchProfile] Summary:\n${lines.join('\n')}\n  TOTAL: ${formatMs(total)}`
  }
}
