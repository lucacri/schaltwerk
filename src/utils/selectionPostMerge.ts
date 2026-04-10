import type { EnrichedSession } from '../types/session'

export interface SelectionCandidateInput {
    currentSelectionId: string | null
    visibleSessions: EnrichedSession[]
    previousSessions: EnrichedSession[]
    rememberedId: string | null
    removalCandidate: string | null
    mergedCandidate: string | null
    shouldAdvanceFromMerged: boolean
    shouldPreserveForReadyRemoval: boolean
    allSessions: EnrichedSession[]
}

function getSessionIds(sessions: EnrichedSession[]): string[] {
    return sessions.map(session => session.info.session_id)
}

function pickNextReadyAfterMerge(
    mergedCandidate: string,
    previousSessions: EnrichedSession[],
    allSessions: EnrichedSession[]
): string | null {
    const previousReady = previousSessions.filter(s => s.info.ready_to_merge)
    const readyIds = previousReady.map(s => s.info.session_id)

    const mergedIndex = readyIds.indexOf(mergedCandidate)
    if (mergedIndex !== -1) {
        const nextId = readyIds[mergedIndex + 1]
        if (nextId) {
            return nextId
        }
    }

    const currentReadyIds = allSessions
        .filter(s => s.info.ready_to_merge && s.info.session_id !== mergedCandidate)
        .map(s => s.info.session_id)
        .sort((a, b) => a.localeCompare(b))

    return currentReadyIds[0] ?? null
}

export function computeSelectionCandidate(input: SelectionCandidateInput): string | null {
    const {
        currentSelectionId,
        visibleSessions,
        previousSessions,
        rememberedId,
        removalCandidate,
        mergedCandidate,
        shouldAdvanceFromMerged,
    shouldPreserveForReadyRemoval,
    allSessions,
  } = input

  // If we know a session was removed, try to pick the next visible session at the
  // same position in the previous ordered list (fallback to previous one, then first).
  // This keeps keyboard focus stable when deleting specs in the filtered list.
  if (removalCandidate) {
    const previousIds = getSessionIds(previousSessions)
    const removedIndex = previousIds.indexOf(removalCandidate)
    const orderedVisible = getSessionIds(visibleSessions).filter(id => id !== mergedCandidate)

    if (removedIndex !== -1 && orderedVisible.length > 0) {
      const next = orderedVisible[removedIndex] ?? orderedVisible[removedIndex - 1] ?? orderedVisible[0] ?? null
      if (next) {
        return next
      }
    }
  }

  if (shouldAdvanceFromMerged && mergedCandidate) {
    const nextReady = pickNextReadyAfterMerge(mergedCandidate, previousSessions, allSessions)
    if (nextReady) {
      return nextReady
    }
    }

    if (shouldPreserveForReadyRemoval) {
        if (currentSelectionId && visibleSessions.find(s => s.info.session_id === currentSelectionId)) {
            return currentSelectionId
        }
        return null
    }

    const baselineId = currentSelectionId ?? rememberedId ?? removalCandidate ?? mergedCandidate ?? null

    const visibleIds = new Set(getSessionIds(visibleSessions))

    if (rememberedId && rememberedId !== mergedCandidate && visibleIds.has(rememberedId)) {
        return rememberedId
    }

    if (baselineId && previousSessions.length > 0) {
        const previousIndex = previousSessions.findIndex(s => s.info.session_id === baselineId)
        if (previousIndex !== -1) {
            const ordered = getSessionIds(visibleSessions).filter(id => id !== mergedCandidate)
            if (ordered.length > 0) {
                const boundedIndex = Math.min(previousIndex, ordered.length - 1)
                if (boundedIndex >= 0) {
                    return ordered[boundedIndex] ?? null
                }
            }
        }

        const nextFromPrevious = previousSessions
            .map(s => s.info.session_id)
            .find(id => id !== mergedCandidate && visibleIds.has(id))
        if (nextFromPrevious) {
            return nextFromPrevious
        }
    }

    const firstAvailable = visibleSessions.find(s => s.info.session_id !== mergedCandidate)
    return firstAvailable?.info.session_id ?? null
}
