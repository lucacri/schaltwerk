const REFINE_PREFIX = 'Refine spec: '

export function buildSpecRefineReference(sessionId: string, displayName?: string | null): string {
  const name = displayName && displayName.trim().length > 0 ? displayName.trim() : sessionId
  return `${REFINE_PREFIX}${name} (${sessionId})`
}
