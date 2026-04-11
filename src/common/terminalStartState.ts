import { logger } from '../utils/logger'
import { clearInflights } from '../utils/singleflight'

export type TerminalStartState = 'starting' | 'started'

const terminalStates = new Map<string, TerminalStartState>()
const terminalAgentTypes = new Map<string, string>()

export function isTerminalStartingOrStarted(terminalId: string): boolean {
  return terminalStates.has(terminalId)
}

export function getTerminalStartState(terminalId: string): TerminalStartState | null {
  return terminalStates.get(terminalId) ?? null
}

export function getTerminalAgentType(terminalId: string): string | null {
  return terminalAgentTypes.get(terminalId) ?? null
}

export function markTerminalStarting(terminalId: string, agentType?: string | null): void {
  terminalStates.set(terminalId, 'starting')
  if (agentType) {
    terminalAgentTypes.set(terminalId, agentType)
  }
  logger.debug(`[terminalStartState] ${terminalId} -> starting`)
}

export function markTerminalStarted(terminalId: string): void {
  terminalStates.set(terminalId, 'started')
  logger.debug(`[terminalStartState] ${terminalId} -> started`)
}

export function clearTerminalStartState(terminalIds: string[]): void {
  for (const id of terminalIds) {
    terminalStates.delete(id)
    terminalAgentTypes.delete(id)
  }
  clearInflights(terminalIds)
  if (terminalIds.length > 0) {
    logger.debug(`[terminalStartState] cleared: ${terminalIds.join(', ')}`)
  }
}

export function clearTerminalStartStateByPrefix(prefix: string): void {
  const toDelete: string[] = []
  for (const id of terminalStates.keys()) {
    if (id.startsWith(prefix)) {
      toDelete.push(id)
    }
  }
  clearTerminalStartState(toDelete)
}
