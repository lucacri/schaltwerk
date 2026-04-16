export type AgentStoppedReason = 'stopped' | 'terminated'
export const AGENT_STOPPED_STATE_CHANGED = 'schaltwerk:agent-stopped-state-changed'

export type AgentStoppedStateChangedDetail = {
  terminalId: string
  stopped: boolean
  reason: AgentStoppedReason
}

function stoppedKey(terminalId: string): string {
  return `schaltwerk:agent-stopped:${terminalId}`
}

function reasonKey(terminalId: string): string {
  return `schaltwerk:agent-stopped-reason:${terminalId}`
}

export function readAgentStoppedState(terminalId: string): {
  stopped: boolean
  reason: AgentStoppedReason
} {
  const stopped = sessionStorage.getItem(stoppedKey(terminalId)) === 'true'
  const reason = sessionStorage.getItem(reasonKey(terminalId))
  return {
    stopped,
    reason: reason === 'terminated' ? 'terminated' : 'stopped',
  }
}

export function markAgentStopped(terminalId: string, reason: AgentStoppedReason): void {
  sessionStorage.setItem(stoppedKey(terminalId), 'true')
  sessionStorage.setItem(reasonKey(terminalId), reason)
  emitAgentStoppedStateChanged({ terminalId, stopped: true, reason })
}

export function clearAgentStopped(terminalId: string): void {
  sessionStorage.removeItem(stoppedKey(terminalId))
  sessionStorage.removeItem(reasonKey(terminalId))
  emitAgentStoppedStateChanged({ terminalId, stopped: false, reason: 'stopped' })
}

function emitAgentStoppedStateChanged(detail: AgentStoppedStateChangedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AGENT_STOPPED_STATE_CHANGED, { detail }))
}
