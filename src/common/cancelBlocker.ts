import type { CancelBlocker } from './events'

type Envelope = { type?: unknown; data?: { blocker?: unknown } }

function coerceEnvelope(err: unknown): Envelope | null {
  if (err && typeof err === 'object' && !Array.isArray(err) && 'type' in (err as object)) {
    return err as Envelope
  }
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err)
      return parsed && typeof parsed === 'object' ? (parsed as Envelope) : null
    } catch {
      return null
    }
  }
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message)
      return parsed && typeof parsed === 'object' ? (parsed as Envelope) : null
    } catch {
      return null
    }
  }
  return null
}

function isCancelBlocker(value: unknown): value is CancelBlocker {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const data = record.data
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  switch (record.type) {
    case 'UncommittedChanges':
      return Array.isArray(d.files) && (d.files as unknown[]).every(f => typeof f === 'string')
    case 'OrphanedWorktree':
      return typeof d.expected_path === 'string'
    case 'WorktreeLocked':
      return typeof d.reason === 'string'
    case 'GitError':
      return typeof d.operation === 'string' && typeof d.message === 'string'
    default:
      return false
  }
}

export function parseCancelBlocker(err: unknown): CancelBlocker | null {
  const envelope = coerceEnvelope(err)
  if (!envelope || envelope.type !== 'CancelBlocked') return null
  return isCancelBlocker(envelope.data?.blocker) ? (envelope.data?.blocker as CancelBlocker) : null
}
