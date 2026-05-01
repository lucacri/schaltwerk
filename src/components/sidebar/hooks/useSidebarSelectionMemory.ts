import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { listenUiEvent, UiEvent } from '../../../common/uiEvents'
import { captureSelectionSnapshot, SelectionMemoryEntry } from '../../../utils/selectionMemory'
import { computeSelectionCandidate } from '../../../utils/selectionPostMerge'
import { getSessionLifecycleState } from '../../../utils/sessionState'
import { FilterMode } from '../../../types/sessionFilters'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import { createSelectionMemoryBuckets } from '../helpers/selectionMemory'

interface UseSidebarSelectionMemoryParams {
    projectPath: string | null
    selection: Selection
    setSelection: (selection: Selection, hydrate: boolean, focus: boolean) => Promise<void> | void
    allSessions: EnrichedSession[]
    selectionScopedSessions: EnrichedSession[]
    filterMode: FilterMode
    latestSessionsRef: MutableRefObject<EnrichedSession[]>
    lastRemovedSessionRef: MutableRefObject<string | null>
    lastMergedReadySessionRef: MutableRefObject<string | null>
}

export function useSidebarSelectionMemory({
    projectPath,
    selection,
    setSelection,
    allSessions,
    selectionScopedSessions,
    filterMode,
    latestSessionsRef,
    lastRemovedSessionRef,
    lastMergedReadySessionRef,
}: UseSidebarSelectionMemoryParams): void {
    const isProjectSwitching = useRef(false)
    const previousProjectPathRef = useRef<string | null>(null)
    const selectionMemoryRef = useRef<Map<string, Record<FilterMode, SelectionMemoryEntry>>>(new Map())

    const ensureProjectMemory = useCallback(() => {
        const key = projectPath || '__default__'
        if (!selectionMemoryRef.current.has(key)) {
            selectionMemoryRef.current.set(key, createSelectionMemoryBuckets())
        }
        return selectionMemoryRef.current.get(key)!
    }, [projectPath])

    useEffect(() => {
        if (previousProjectPathRef.current !== null && previousProjectPathRef.current !== projectPath) {
            isProjectSwitching.current = true
        }
        previousProjectPathRef.current = projectPath
    }, [projectPath])

    useEffect(() => {
        let unsubscribe: (() => void) | null = null
        const attach = async () => {
            unsubscribe = await listenUiEvent(UiEvent.ProjectSwitchComplete, () => {
                isProjectSwitching.current = false
            })
        }
        void attach()
        return () => {
            unsubscribe?.()
        }
    }, [])

    useEffect(() => {
        if (isProjectSwitching.current) {
            isProjectSwitching.current = false
        }

        const allSessionsSnapshot = allSessions.length > 0 ? allSessions : latestSessionsRef.current

        const memory = ensureProjectMemory()
        const entry = memory[filterMode]

        const visibleSessions = selectionScopedSessions
        const visibleIds = new Set(visibleSessions.map(s => s.info.session_id))
        const currentSelectionId = selection.kind === 'session' ? (selection.payload ?? null) : null

        const { previousSessions } = captureSelectionSnapshot(entry, visibleSessions)

        const removalCandidateFromEvent = lastRemovedSessionRef.current
        const mergedCandidate = lastMergedReadySessionRef.current

        const mergedSessionInfo = mergedCandidate
            ? allSessionsSnapshot.find(s => s.info.session_id === mergedCandidate)
            : undefined
        const mergedStillReady = Boolean(mergedSessionInfo?.info.ready_to_merge)

        const shouldAdvanceFromMerged = Boolean(
            mergedCandidate &&
            currentSelectionId === mergedCandidate &&
            !mergedStillReady
        )

        if (mergedCandidate && (!currentSelectionId || currentSelectionId !== mergedCandidate)) {
            lastMergedReadySessionRef.current = null
        }

        const shouldPreserveForReadyRemoval = false

        const currentSessionMovedToReady = false

        const effectiveRemovalCandidate = currentSessionMovedToReady && currentSelectionId
            ? currentSelectionId
            : removalCandidateFromEvent

        if (selection.kind === 'orchestrator') {
            entry.lastSelection = null
            if (!effectiveRemovalCandidate && !shouldAdvanceFromMerged) {
                return
            }
        }

        if (visibleSessions.length === 0) {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
            if (removalCandidateFromEvent) {
                lastRemovedSessionRef.current = null
            }
            if (shouldAdvanceFromMerged) {
                lastMergedReadySessionRef.current = null
            }
            return
        }

        if (selection.kind === 'session' && currentSelectionId && visibleIds.has(currentSelectionId) && !shouldAdvanceFromMerged) {
            entry.lastSelection = currentSelectionId
            if (lastRemovedSessionRef.current) {
                lastRemovedSessionRef.current = null
            }
            return
        }

        const rememberedId = entry.lastSelection
        const candidateId = computeSelectionCandidate({
            currentSelectionId,
            visibleSessions,
            previousSessions,
            rememberedId,
            removalCandidate: effectiveRemovalCandidate,
            mergedCandidate,
            shouldAdvanceFromMerged,
            shouldPreserveForReadyRemoval,
            allSessions: allSessionsSnapshot,
        })

        if (candidateId) {
            entry.lastSelection = candidateId
            if (candidateId !== currentSelectionId) {
                const targetSession = visibleSessions.find(s => s.info.session_id === candidateId)
                    ?? allSessionsSnapshot.find(s => s.info.session_id === candidateId)
                if (targetSession) {
                    void setSelection({
                        kind: 'session',
                        payload: candidateId,
                        worktreePath: targetSession.info.worktree_path,
                        sessionState: getSessionLifecycleState(targetSession.info),
                    }, false, false)
                }
            }
        } else {
            entry.lastSelection = null
            void setSelection({ kind: 'orchestrator' }, false, false)
        }

        if (removalCandidateFromEvent) {
            lastRemovedSessionRef.current = null
        }
        if (shouldAdvanceFromMerged) {
            lastMergedReadySessionRef.current = null
        }
    }, [allSessions, ensureProjectMemory, filterMode, lastMergedReadySessionRef, lastRemovedSessionRef, latestSessionsRef, selection, selectionScopedSessions, setSelection])
}
