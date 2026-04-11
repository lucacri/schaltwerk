import { atom } from 'jotai'
import type { Getter, Setter } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { AGENT_TYPES, type EnrichedSession, type AgentType, type Epic } from '../../types/session'
import { FilterMode, getDefaultFilterMode, isValidFilterMode } from '../../types/sessionFilters'
import { TauriCommands } from '../../common/tauriCommands'
import { searchSessions as searchSessionsUtil } from '../../utils/sessionFilters'
import { SessionState, type SessionInfo } from '../../types/session'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { projectPathAtom } from './project'
import { setSelectionFilterModeActionAtom, clearTerminalTrackingActionAtom } from './selection'
import { matchesProjectScope, type GitOperationFailedPayload, type GitOperationPayload, type SessionsRefreshedEventPayload } from '../../common/events'
import { hasInflight, singleflight } from '../../utils/singleflight'
import { stableSessionTerminalId, isTopTerminalId } from '../../common/terminalIdentity'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { isTerminalStartingOrStarted, clearTerminalStartState, markTerminalStarted } from '../../common/terminalStartState'
import { startSessionTop, computeProjectOrchestratorId } from '../../common/agentSpawn'
import { releaseSessionTerminals } from '../../terminal/registry/terminalRegistry'
import { logger } from '../../utils/logger'
import { getErrorMessage, isSchaltError } from '../../types/errors'
import { closePreview } from '../../features/preview/previewIframeRegistry'
import { buildPreviewKey, clearPreviewStateActionAtom } from './preview'
import { calculateLogicalSessionCounts, groupSessionsByVersion } from '../../utils/sessionVersions'
import { getSessionLifecycleState, isSpec } from '../../utils/sessionState'

type MergeModeOption = 'squash' | 'reapply'

export type MergeStatus = 'idle' | 'conflict' | 'merged'

interface MergeCommitSummary {
    id: string
    subject: string
    author: string
    timestamp: number
}

interface MergePreviewResponse {
    sessionBranch: string
    parentBranch: string
    squashCommands: string[]
    reapplyCommands: string[]
    defaultCommitMessage: string
    hasConflicts: boolean
    conflictingPaths: string[]
    isUpToDate: boolean
    commitsAheadCount: number
    commits: MergeCommitSummary[]
}

type MergeDialogStatus = 'idle' | 'loading' | 'ready' | 'running'

export interface MergeDialogState {
    isOpen: boolean
    status: MergeDialogStatus
    sessionName: string | null
    preview: MergePreviewResponse | null
    error?: string | null
    prefillMode?: 'squash' | 'reapply'
}

type ShortcutMergeResultBase = {
    autoMarkedReady?: boolean
}

export type ShortcutMergeResult =
    | (ShortcutMergeResultBase & { status: 'started' })
    | (ShortcutMergeResultBase & { status: 'needs-modal'; reason: 'conflict' | 'missing-commit' | 'confirm' })
    | (ShortcutMergeResultBase & { status: 'blocked'; reason: 'no-session' | 'not-ready' | 'in-flight' | 'already-merged' })
    | (ShortcutMergeResultBase & { status: 'error'; message: string })

export type SessionMutationKind = 'merge' | 'remove'

const PENDING_STARTUP_TTL_MS = 10_000
const BACKGROUND_AGENT_START_CONCURRENCY = 2

type BackgroundAgentStartTask = {
    id: string
    run: () => Promise<void>
}

const backgroundAgentStartQueue: BackgroundAgentStartTask[] = []
const backgroundAgentStartQueued = new Set<string>()
let backgroundAgentStartInFlight = 0
let backgroundAgentStartDrainScheduled = false

function scheduleBackgroundAgentStartDrain() {
    if (backgroundAgentStartDrainScheduled) {
        return
    }
    backgroundAgentStartDrainScheduled = true

    const schedule = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (cb: () => void) => void Promise.resolve().then(cb)

    schedule(() => {
        backgroundAgentStartDrainScheduled = false
        drainBackgroundAgentStartQueue()
    })
}

function enqueueBackgroundAgentStart(task: BackgroundAgentStartTask) {
    if (!task.id) return
    if (backgroundAgentStartQueued.has(task.id)) {
        return
    }
    backgroundAgentStartQueued.add(task.id)
    backgroundAgentStartQueue.push(task)
    scheduleBackgroundAgentStartDrain()
}

function drainBackgroundAgentStartQueue() {
    if (backgroundAgentStartInFlight >= BACKGROUND_AGENT_START_CONCURRENCY) {
        return
    }
    while (backgroundAgentStartInFlight < BACKGROUND_AGENT_START_CONCURRENCY && backgroundAgentStartQueue.length > 0) {
        const next = backgroundAgentStartQueue.shift()
        if (!next) {
            continue
        }
        backgroundAgentStartInFlight += 1
        void next
            .run()
            .catch((error) => {
                logger.warn(`[SessionsAtoms] Background agent start failed for ${next.id}:`, error)
            })
            .finally(() => {
                backgroundAgentStartInFlight = Math.max(0, backgroundAgentStartInFlight - 1)
                backgroundAgentStartQueued.delete(next.id)
                scheduleBackgroundAgentStartDrain()
            })
    }
}

interface PendingStartup {
    agentType?: AgentType
    expiresAt: number
    enqueuedAt: number
}

function applySessionMutationState(
    previous: Map<string, Set<SessionMutationKind>>,
    sessionId: string,
    kind: SessionMutationKind,
    active: boolean
): Map<string, Set<SessionMutationKind>> {
    const next = new Map(previous)
    const existing = new Set(next.get(sessionId) ?? [])

    if (active) {
        existing.add(kind)
        next.set(sessionId, existing)
        return next
    }

    existing.delete(kind)
    if (existing.size > 0) {
        next.set(sessionId, existing)
    } else {
        next.delete(sessionId)
    }
    return next
}

function sortSessionsByCreationDate(sessions: EnrichedSession[]): EnrichedSession[] {
    if (sessions.length === 0) return sessions

    const sessionMap = new Map(sessions.map(session => [session.info.session_id, session]))

    const ready = sessions.filter(session => session.info.ready_to_merge)
    const notReady = sessions.filter(session => !session.info.ready_to_merge)

    const compareByCreated = (a: EnrichedSession, b: EnrichedSession) => {
        const aTime = new Date(a.info.created_at || 0).getTime()
        const bTime = new Date(b.info.created_at || 0).getTime()
        const diff = bTime - aTime
        if (diff !== 0) {
            return diff
        }
        return a.info.session_id.localeCompare(b.info.session_id)
    }

    const sortedUnready = [...notReady].sort(compareByCreated)

    const sortedReady = [...ready].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))

    const sorted = [...sortedUnready, ...sortedReady]
    return sorted.map(session => sessionMap.get(session.info.session_id) ?? session)
}

function filterSessions(sessions: EnrichedSession[], filterMode: FilterMode): EnrichedSession[] {
    const runningSessionIds = new Set(
        groupSessionsByVersion(sessions)
            .filter(group => {
                const aggregate = calculateLogicalSessionCounts(
                    group.versions.map(v => v.session),
                )
                return aggregate.runningCount > 0
            })
            .flatMap(group => group.versions.map(version => version.session.info.session_id)),
    )

    switch (filterMode) {
        case FilterMode.Spec:
            return sessions.filter(session => isSpec(session.info))
        case FilterMode.Running:
            return sessions.filter(session => runningSessionIds.has(session.info.session_id))
        default:
            return sessions.filter(session => runningSessionIds.has(session.info.session_id))
    }
}

function defaultMergeDialogState(): MergeDialogState {
    return {
        isOpen: false,
        status: 'idle',
        sessionName: null,
        preview: null,
        error: null,
    }
}

function normalizeMergePreviewForDialog(preview: MergePreviewResponse): MergePreviewResponse {
    if (!preview.hasConflicts && preview.conflictingPaths.length === 0) {
        return preview
    }

    return {
        ...preview,
        hasConflicts: false,
        conflictingPaths: [],
    }
}

function applyMergeConflictToPreview(
    preview: MergePreviewResponse | null,
    conflictingPaths: string[],
): MergePreviewResponse | null {
    if (!preview) {
        return null
    }

    return {
        ...preview,
        hasConflicts: true,
        conflictingPaths,
    }
}

function createPendingStartup(_sessionId: string, agentType?: AgentType, ttlMs: number = PENDING_STARTUP_TTL_MS): PendingStartup {
    const enqueuedAt = Date.now()
    return {
        agentType,
        enqueuedAt,
        expiresAt: enqueuedAt + ttlMs,
    }
}

function buildStateMap(sessions: EnrichedSession[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const session of sessions) {
        map.set(session.info.session_id, getSessionLifecycleState(session.info))
    }
    return map
}

function dedupeSessions(sessions: EnrichedSession[]): EnrichedSession[] {
    const byId = new Map<string, EnrichedSession>()
    for (const session of sessions) {
        const sessionId = session.info.session_id
        const existing = byId.get(sessionId)
        if (!existing) {
            byId.set(sessionId, session)
            continue
        }

        const existingState = getSessionLifecycleState(existing.info)
        if (existingState === SessionState.Spec) {
            continue
        }
        const nextState = getSessionLifecycleState(session.info)
        if (nextState === SessionState.Spec) {
            byId.set(sessionId, session)
            continue
        }
        byId.set(sessionId, session)
    }
    return Array.from(byId.values())
}

const SESSION_RELEASE_GRACE_MS = 4_000
const EXPECTED_SESSION_TTL_MS = 15_000

async function releaseRemovedSessions(get: Getter, set: Setter, previous: EnrichedSession[], next: EnrichedSession[]) {
    const now = Date.now()

    for (const session of next) {
        const id = session.info.session_id
        const nextState = getSessionLifecycleState(session.info)
        const previousState = previousSessionStates.get(id) ?? null

        if (previousState === SessionState.Spec && nextState === SessionState.Running) {
            protectedReleaseUntil.set(id, now + SESSION_RELEASE_GRACE_MS)
        }
    }

    if (!previous.length) {
        return
    }

    const nextIds = new Set(next.map(session => session.info.session_id))
    const removed: string[] = []
    for (const session of previous) {
        const sessionId = session.info.session_id
        if (!nextIds.has(sessionId)) {
            removed.push(sessionId)
        }
    }

    if (removed.length === 0) {
        return
    }

    const pending = new Map(get(pendingStartupsAtom))
    let pendingChanged = false
    const terminalsToClear: string[] = []

    for (const sessionId of removed) {
        const protectionUntil = protectedReleaseUntil.get(sessionId) ?? 0

        if (protectionUntil > now) {
            logger.debug('[SessionsAtoms] Skipping terminal release during grace window', {
                sessionId,
                remainingMs: protectionUntil - now,
            })
            continue
        }

        if (pending.delete(sessionId)) {
            pendingChanged = true
        }
        suppressedAutoStart.delete(sessionId)
        releaseSessionTerminals(sessionId)
        terminalsToClear.push(stableSessionTerminalId(sessionId, 'top'))
        terminalsToClear.push(stableSessionTerminalId(sessionId, 'bottom'))
    }

    if (terminalsToClear.length > 0) {
        await set(clearTerminalTrackingActionAtom, terminalsToClear)
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, pending)
    }

    logger.debug(
        `[SessionsAtoms] releaseRemovedSessions removed ${removed.length} session terminals (previous=${previous.length}, next=${next.length}): ${removed.join(', ')}`,
    )
}


function syncMergeStatuses(set: Setter, sessions: EnrichedSession[]) {
    set(mergeStatusesStateAtom, (prev) => {
        const next = new Map(prev)
        const seen = new Set<string>()
        for (const session of sessions) {
            const sessionId = session.info.session_id
            const status = deriveMergeStatusFromSession(session)
            if (status) {
                next.set(sessionId, status)
            } else {
                next.delete(sessionId)
            }
            seen.add(sessionId)
        }

        for (const key of Array.from(next.keys())) {
            if (!seen.has(key)) {
                next.delete(key)
            }
        }

        return next
    })
}

function autoStartRunningSessions(
    get: Getter,
    set: Setter,
    sessions: EnrichedSession[],
    options: { reason?: string; previousStates?: Map<string, string> },
) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return
    }

    const projectPath = get(projectPathAtom)
    if (!projectPath) {
        logger.debug('[AGENT_LAUNCH_TRACE] autoStartRunningSessions skipped: no project path')
        return
    }

    const pending = new Map(get(pendingStartupsAtom))
    const previousStates = options.previousStates ?? previousSessionStates
    const reason = options.reason ?? 'sessions-refresh'
    let pendingChanged = false
    const now = Date.now()
    for (const [sessionId, entry] of pending) {
        if (entry.expiresAt <= now) {
            pending.delete(sessionId)
            pendingChanged = true
            logger.warn(`[AGENT_LAUNCH_TRACE] pending startup expired for ${sessionId} (ttl=${PENDING_STARTUP_TTL_MS}ms)`)
        }
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, new Map(pending))
    }

    for (const session of sessions) {
        const sessionId = session?.info?.session_id
        if (!sessionId) {
            continue
        }

        const rawState = session.info.session_state
        const uiState = getSessionLifecycleState(session.info)
        const isEligible = uiState === SessionState.Running && rawState === SessionState.Running
        const topId = stableSessionTerminalId(sessionId, 'top')
        const pendingEntry = pending.get(sessionId)

        if (session.info.status === 'missing' || session.info.status === 'archived') {
            logger.debug(
                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}: status=${session.info.status} (${reason})`
            )
            continue
        }

        const scheduleStart = (opts?: { agentTypeOverride?: AgentType; pendingEntry?: PendingStartup }) => {
            const agentTypeOverride = opts?.agentTypeOverride
            const taskId = topId
            enqueueBackgroundAgentStart({
                id: taskId,
                run: async () => {
                    try {
                        const activeProjectPath = get(projectPathAtom)
                        if (!activeProjectPath || activeProjectPath !== projectPath) {
                            logger.debug(
                                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; project changed (${reason})`,
                            )
                            return
                        }

                        const latestSession = get(allSessionsAtom).find(s => s.info.session_id === sessionId)
                        if (!latestSession) {
                            logger.debug(
                                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; session missing in store (${reason})`,
                            )
                            return
                        }

                        if (latestSession.info.status === 'missing' || latestSession.info.status === 'archived') {
                            logger.debug(
                                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}: status=${latestSession.info.status} (${reason})`,
                            )
                            return
                        }

                        const latestUiState = getSessionLifecycleState(latestSession.info)
                        const latestRawState = latestSession.info.session_state
                        const latestEligible =
                            latestUiState === SessionState.Running && latestRawState === SessionState.Running
                        if (!latestEligible) {
                            logger.debug(
                                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; latest state=${latestRawState} (${reason})`,
                            )
                            return
                        }

                        const projectOrchestratorId = computeProjectOrchestratorId(projectPath ?? null)
                        const agentType = agentTypeOverride ?? latestSession.info.original_agent_type ?? session.info.original_agent_type ?? undefined
                        await startSessionTop({ sessionName: sessionId, topId, projectOrchestratorId, agentType })
                        logger.info(`[SessionsAtoms] Started agent for ${sessionId} (${reason}).`)
                        suppressedAutoStart.add(sessionId)
                    } catch (error) {
                        const message = getErrorMessage(error)
                        if (message.includes('Working directory not found:')) {
                            logger.info(`[SessionsAtoms] Auto-start skipped for ${sessionId} because worktree is missing.`)
                            suppressedAutoStart.add(sessionId)
                            set(allSessionsAtom, (prev) => prev.map(session => {
                                if (session.info.session_id !== sessionId) {
                                    return session
                                }
                                if (session.info.status === 'missing') {
                                    return session
                                }
                                return {
                                    ...session,
                                    info: {
                                        ...session.info,
                                        status: 'missing',
                                    },
                                }
                            }))
                            return
                        }
                        if (message.includes('Permission required for folder:')) {
                            emitUiEvent(UiEvent.PermissionError, { error: message })
                        } else {
                            logger.warn(`[SessionsAtoms] Auto-start failed for ${sessionId} (${reason}):`, error)
                        }
                    }
                },
            })
        }

        if (pendingEntry && !isEligible) {
            if (uiState === SessionState.Spec) {
                pending.delete(sessionId)
                suppressedAutoStart.add(sessionId)
                pendingChanged = true
            }
            continue
        }

        if (pendingEntry && isEligible) {
            if (isTerminalStartingOrStarted(topId) || hasInflight(topId)) {
                logger.info(`[AGENT_LAUNCH_TRACE] pending startup skipping ${sessionId}; background mark or inflight present`)
                pending.delete(sessionId)
                suppressedAutoStart.add(sessionId)
                pendingChanged = true
                continue
            }

            pending.delete(sessionId)
            suppressedAutoStart.delete(sessionId)
            pendingChanged = true

            const pendingElapsed = Date.now() - pendingEntry.enqueuedAt
            logger.info(`[AGENT_LAUNCH_TRACE] pending startup starting ${sessionId} (queued=${pendingElapsed}ms, reason=${reason})`)
            const fallbackAgent = session.info.original_agent_type ?? undefined
            scheduleStart({ agentTypeOverride: pendingEntry.agentType ?? fallbackAgent })
            continue
        }

        if (!isEligible) {
            suppressedAutoStart.delete(sessionId)
            continue
        }

        if (suppressedAutoStart.has(sessionId)) {
            logger.debug(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}: suppressed`)
            continue
        }

        const previousState = previousStates.get(sessionId)

        if (isTerminalStartingOrStarted(topId) || hasInflight(topId)) {
            logger.info(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; background mark or inflight present (${reason})`)
            continue
        }

        if (backgroundAgentStartQueued.has(topId)) {
            logger.debug(
                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; background start already queued (${reason})`
            )
            continue
        }

        if (previousState === undefined) {
            logger.info(
                `[AGENT_LAUNCH_TRACE] autoStartRunningSessions - will auto-start ${sessionId} (hydration reason: ${reason})`
            )
        } else {
            logger.info(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - will auto-start ${sessionId} (reason: ${reason})`)
        }

        scheduleStart()
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, new Map(pending))
    }
}

function attachMergeSnapshot(
    session: EnrichedSession,
    previousSessions: Map<string, EnrichedSession>,
): EnrichedSession {
    const previous = previousSessions.get(session.info.session_id)
    const cached = mergePreviewCache.get(session.info.session_id) ?? null

    const mergeHasConflicts = session.info.merge_has_conflicts
        ?? previous?.info.merge_has_conflicts
        ?? (cached ? cached.hasConflicts : undefined)
    const mergeIsUpToDate = session.info.merge_is_up_to_date
        ?? previous?.info.merge_is_up_to_date
        ?? (cached ? cached.isUpToDate : undefined)
    const mergeConflictingPaths = session.info.merge_conflicting_paths
        ?? previous?.info.merge_conflicting_paths
        ?? (cached && cached.conflictingPaths.length ? cached.conflictingPaths : undefined)

    if (
        mergeHasConflicts === session.info.merge_has_conflicts &&
        mergeIsUpToDate === session.info.merge_is_up_to_date &&
        mergeConflictingPaths === session.info.merge_conflicting_paths
    ) {
        return session
    }

    return {
        ...session,
        info: {
            ...session.info,
            merge_has_conflicts: mergeHasConflicts,
            merge_is_up_to_date: mergeIsUpToDate,
            merge_conflicting_paths: mergeConflictingPaths,
        },
    }
}


async function applySessionsSnapshot(
    get: Getter,
    set: Setter,
    sessions: EnrichedSession[],
    snapshotProjectPath: string | null,
    options: { reason?: string; previousStates?: Map<string, string> } = {},
) {
    const activeProjectPath = get(projectPathAtom)

    // If this snapshot belongs to a different project than the current active one,
    // cache it for that project and skip applying it to the active UI state to avoid
    // cross-project contamination during rapid switches.
    if (snapshotProjectPath && activeProjectPath && snapshotProjectPath !== activeProjectPath) {
        cacheProjectSnapshot(snapshotProjectPath, sessions)
        return
    }

    const projectPath = snapshotProjectPath ?? activeProjectPath
    const previousMap = new Map(previousSessionsSnapshot.map(session => [session.info.session_id, session]))
    const withSnapshots = sessions.map(session => {
        const merged = attachMergeSnapshot(session, previousMap)
        if (merged.attention_required != null && merged.info.attention_required == null) {
            return { ...merged, info: { ...merged.info, attention_required: merged.attention_required } }
        }
        return merged
    })
    const deduped = dedupeSessions(withSnapshots)

    // Re-inject expected sessions that are temporarily missing (e.g. immediately after we create/promote one
    // but before backend refresh catches up). This keeps the UI stable without showing a flicker.
    const currentIds = new Set(deduped.map(session => session.info.session_id))
    const now = Date.now()
    const preserved: EnrichedSession[] = []
    const expired: string[] = []
    const projectKey: ProjectKey = projectPath ?? null
    const expectedForProject = getExpectedSessionsForProject(projectKey)

    if (expectedForProject) {
        for (const [expectedId, expected] of expectedForProject) {
            const { expiresAt, session: expectedSession } = expected
            if (now > expiresAt) {
                expired.push(expectedId)
                continue
            }
            if (!currentIds.has(expectedId)) {
                if (expectedSession) {
                    preserved.push(expectedSession)
                } else {
                    const prev = previousSessionsSnapshot.find(s => s.info.session_id === expectedId)
                    if (prev) {
                        preserved.push(prev)
                    }
                }
            } else {
                expectedForProject.delete(expectedId)
            }
        }
    }

    if (preserved.length > 0) {
        deduped.push(...preserved)
    }
    if (expectedForProject) {
        for (const id of expired) {
            expectedForProject.delete(id)
        }
        if (expectedForProject.size === 0) {
            expectedSessionsByProject.delete(projectKey)
        }
    }

    if (projectPath) {
        await releaseRemovedSessions(get, set, previousSessionsSnapshot, deduped)
    }
    let resolved = deduped
    set(allSessionsAtom, (current) => {
        const liveAttention = new Map<string, boolean>()
        for (const s of current) {
            if (s.info.attention_required != null) {
                liveAttention.set(s.info.session_id, s.info.attention_required)
            }
        }
        if (liveAttention.size === 0) {
            return deduped
        }
        resolved = deduped.map(session => {
            const live = liveAttention.get(session.info.session_id)
            if (live != null && session.info.attention_required == null) {
                return {
                    ...session,
                    info: { ...session.info, attention_required: live },
                }
            }
            return session
        })
        return resolved
    })
    previousSessionsSnapshot = resolved
    set(activeSessionsHydratedFromCacheStateAtom, options.reason === 'cache-hydrate')

    syncMergeStatuses(set, resolved)
    autoStartRunningSessions(get, set, resolved, {
        reason: options.reason,
        previousStates: options.previousStates ?? previousSessionStates,
    })

    const stateMap = buildStateMap(resolved)
    previousSessionStates = stateMap
    activeSessionsProjectPath = projectPath ?? null

    if (projectPath) {
        projectSessionsSnapshotCache.set(projectPath, resolved)
        projectSessionStatesCache.set(projectPath, new Map(stateMap))
        updateSessionProjectIndex(projectPath, resolved)
        if (options.reason !== 'cache-hydrate') {
            for (const session of resolved) {
                updateCrossProjectAttention(projectPath, session.info.session_id, session.info.attention_required === true)
            }
        }
        setCrossProjectCounts(set, projectPath, recomputeCrossProjectCounts(projectPath))
    }
}

function cacheProjectSnapshot(projectPath: string, sessions: EnrichedSession[]) {
    const previous = projectSessionsSnapshotCache.get(projectPath) ?? []
    const previousMap = new Map(previous.map(session => [session.info.session_id, session]))
    const withSnapshots = sessions.map(session => attachMergeSnapshot(session, previousMap))
    const deduped = dedupeSessions(withSnapshots)
    projectSessionsSnapshotCache.set(projectPath, deduped)
    projectSessionStatesCache.set(projectPath, buildStateMap(deduped))
    updateSessionProjectIndex(projectPath, deduped)
}

function updateSessionProjectIndex(projectPath: string, sessions: EnrichedSession[]) {
    for (const session of sessions) {
        sessionProjectIndex.set(session.info.session_id, projectPath)
    }
}

function updateCrossProjectAttention(projectPath: string, sessionId: string, needsAttention: boolean) {
    let projectMap = crossProjectAttention.get(projectPath)
    if (!projectMap) {
        projectMap = new Map()
        crossProjectAttention.set(projectPath, projectMap)
    }
    projectMap.set(sessionId, needsAttention)
}

function setCrossProjectCounts(
    set: Setter,
    projectPath: string,
    counts: { attention: number; running: number },
) {
    set(crossProjectCountsAtom, (prev) => {
        const existing = prev[projectPath]
        if (existing?.attention === counts.attention && existing?.running === counts.running) {
            return prev
        }
        return { ...prev, [projectPath]: counts }
    })
}

function cacheCrossProjectSnapshot(set: Setter, projectPath: string, sessions: EnrichedSession[]) {
    cacheProjectSnapshot(projectPath, sessions)
    for (const session of sessions) {
        updateCrossProjectAttention(projectPath, session.info.session_id, session.info.attention_required === true)
    }
    setCrossProjectCounts(set, projectPath, recomputeCrossProjectCounts(projectPath))
}

function recomputeCrossProjectCounts(projectPath: string): { attention: number; running: number } {
    const sessions = projectSessionsSnapshotCache.get(projectPath) ?? []
    const attentionMap = crossProjectAttention.get(projectPath) ?? new Map()
    const logicalCounts = calculateLogicalSessionCounts(
        sessions,
        session => attentionMap.get(session.info.session_id) === true,
    )

    return {
        attention: logicalCounts.idleCount,
        running: logicalCounts.runningCount,
    }
}

function stripAttentionState(sessions: EnrichedSession[]): EnrichedSession[] {
    return sessions.map(session =>
        session.info.attention_required != null
            ? { ...session, info: { ...session.info, attention_required: undefined } }
            : session,
    )
}

function parseSessionsRefreshedPayload(payload: unknown): { projectPath: string | null; sessions: EnrichedSession[] } {
    if (payload && typeof payload === 'object' && payload !== null && 'sessions' in payload) {
        const scoped = payload as Partial<SessionsRefreshedEventPayload>
        const projectPath = typeof scoped.projectPath === 'string' ? scoped.projectPath : null
        const sessions = Array.isArray(scoped.sessions) ? scoped.sessions : []
        return { projectPath, sessions }
    }
    if (Array.isArray(payload)) {
        return { projectPath: null, sessions: payload as EnrichedSession[] }
    }
    return { projectPath: null, sessions: [] }
}

function syncSnapshotsFromAtom(get: Getter, set?: Setter) {
    const current = get(allSessionsAtom)
    previousSessionsSnapshot = current
    const stateMap = buildStateMap(current)
    previousSessionStates = stateMap

    const projectPath = get(projectPathAtom)
    if (projectPath) {
        const stripped = stripAttentionState(current)
        projectSessionsSnapshotCache.set(projectPath, stripped)
        projectSessionStatesCache.set(projectPath, new Map(stateMap))
        updateSessionProjectIndex(projectPath, current)
        if (set) {
            setCrossProjectCounts(set, projectPath, recomputeCrossProjectCounts(projectPath))
        }
    }
}

async function loadSessionsSnapshot(projectPath: string | null): Promise<EnrichedSession[]> {
    if (!projectPath) {
        return []
    }

    const cacheKey = `list_enriched_sessions:${projectPath}`
    const enrichedSessions = await singleflight(cacheKey, () =>
        invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions)
    )
    return Array.isArray(enrichedSessions) ? enrichedSessions : []
}

function deriveMergeStatusFromSession(session: EnrichedSession): MergeStatus | undefined {
    const { info } = session

    if (!info.ready_to_merge) {
        return undefined
    }

    if (info.merge_has_conflicts === true || info.has_conflicts === true) {
        return 'conflict'
    }

    if (info.merge_is_up_to_date === true) {
        return 'merged'
    }

    if (Array.isArray(info.merge_conflicting_paths) && info.merge_conflicting_paths.length > 0) {
        return 'conflict'
    }

    const diff = info.diff_stats
    if (!diff) {
        return undefined
    }

    const filesChanged = diff.files_changed ?? 0
    const additions = (diff.additions ?? diff.insertions) ?? 0
    const deletions = diff.deletions ?? 0
    const insertions = diff.insertions ?? diff.additions ?? 0

    if (filesChanged === 0 && additions === 0 && deletions === 0 && insertions === 0) {
        return 'merged'
    }

    return undefined
}

export const allSessionsAtom = atom<EnrichedSession[]>([])

export interface SessionActivityData {
    last_modified: string
    last_modified_ts: number
    current_task?: string | null
    todo_percentage?: number | null
    is_blocked?: boolean | null
}
export const sessionActivityMapAtom = atom<Map<string, SessionActivityData>>(new Map())

export const crossProjectCountsAtom = atom<Record<string, { attention: number; running: number }>>({})
const filterModeStateAtom = atom<FilterMode>(getDefaultFilterMode())
const searchQueryStateAtom = atom<string>('')
const isSearchVisibleStateAtom = atom<boolean>(false)
const lastRefreshStateAtom = atom<number>(0)
const mergeDialogStateAtom = atom<MergeDialogState>(defaultMergeDialogState())
const mergeStatusesStateAtom = atom<Map<string, MergeStatus>>(new Map())
const mergeInFlightStateAtom = atom<Map<string, boolean>>(new Map())
const sessionMutationsStateAtom = atom<Map<string, Set<SessionMutationKind>>>(new Map())
export const pendingStartupsAtom = atom<Map<string, PendingStartup>>(new Map())
const loadingStateAtom = atom<boolean>(false)
const settingsLoadedAtom = atom<boolean>(false)
const autoCancelAfterMergeStateAtom = atom<boolean>(true)
const autoCancelAfterPrStateAtom = atom<boolean>(false)
const currentSelectionStateAtom = atom<string | null>(null)

let lastPersistedFilterMode: FilterMode | null = null

type PushToast = (toast: { tone: 'success' | 'error'; title: string; description?: string }) => void

let pushToastHandler: PushToast | null = null
let previousSessionsSnapshot: EnrichedSession[] = []
let previousSessionStates = new Map<string, string>()
const projectSessionsSnapshotCache = new Map<string, EnrichedSession[]>()
const projectSessionStatesCache = new Map<string, Map<string, string>>()
const suppressedAutoStart = new Set<string>()
const mergeErrorCache = new Map<string, string>()
const mergePreviewCache = new Map<string, MergePreviewResponse>()
const protectedReleaseUntil = new Map<string, number>()
type ExpectedSession = { expiresAt: number; session?: EnrichedSession }
type ProjectKey = string | null
const expectedSessionsByProject = new Map<ProjectKey, Map<string, ExpectedSession>>()
const sessionProjectIndex = new Map<string, string>()
const crossProjectAttention = new Map<string, Map<string, boolean>>()
const activeSessionsHydratedFromCacheStateAtom = atom(false)
let activeSessionsProjectPath: string | null = null

function getExpectedSessionsForProject(projectPath: ProjectKey, create = false): Map<string, ExpectedSession> | undefined {
    let bucket = expectedSessionsByProject.get(projectPath)
    if (!bucket && create) {
        bucket = new Map<string, ExpectedSession>()
        expectedSessionsByProject.set(projectPath, bucket)
    }
    return bucket
}
let sessionsRefreshedReloadPending = false
const sessionsEventHandlersForTests = new Map<SchaltEvent, (payload: unknown) => void>()

type SessionActivityPayload = { session_name: string; last_activity_ts: number; current_task?: string | null; todo_percentage?: number | null; is_blocked?: boolean | null }
export const ACTIVITY_FLUSH_INTERVAL = 1000
const activityBuffer = new Map<string, SessionActivityPayload>()
let activityFlushTimer: ReturnType<typeof setTimeout> | null = null

export function __getSessionsEventHandlerForTest(event: SchaltEvent): ((payload: unknown) => void) | undefined {
    return sessionsEventHandlersForTests.get(event)
}

export const autoCancelAfterMergeAtom = atom((get) => get(autoCancelAfterMergeStateAtom))
export const autoCancelAfterPrAtom = atom((get) => get(autoCancelAfterPrStateAtom))
export const sessionsLoadingAtom = atom((get) => get(loadingStateAtom))
export const activeSessionsHydratedFromCacheAtom = atom((get) => get(activeSessionsHydratedFromCacheStateAtom))
export const hydrateProjectSessionsForSwitchActionAtom = atom(
    null,
    (get, set, projectPath: string | null) => {
        const activeProject = activeSessionsProjectPath
        const activeSessions = get(allSessionsAtom)

        if (activeProject && activeProject !== projectPath) {
            cacheCrossProjectSnapshot(set, activeProject, activeSessions)
        }

        if (!projectPath) {
            set(allSessionsAtom, [])
            set(activeSessionsHydratedFromCacheStateAtom, false)
            previousSessionsSnapshot = []
            previousSessionStates = new Map()
            activeSessionsProjectPath = null
            syncMergeStatuses(set, [])
            return
        }

        const cachedSnapshot = projectSessionsSnapshotCache.get(projectPath) ?? []
        const strippedSnapshot = stripAttentionState(cachedSnapshot)
        const stateMap = projectSessionStatesCache.get(projectPath) ?? buildStateMap(strippedSnapshot)

        set(allSessionsAtom, strippedSnapshot)
        set(activeSessionsHydratedFromCacheStateAtom, strippedSnapshot.length > 0)
        previousSessionsSnapshot = [...strippedSnapshot]
        previousSessionStates = new Map(stateMap)
        activeSessionsProjectPath = projectPath
        syncMergeStatuses(set, strippedSnapshot)
    },
)

export const expectSessionActionAtom = atom(
    null,
    (_get, _set, sessionOrId: string | EnrichedSession) => {
        if (!sessionOrId) return

        const projectPath = _get(projectPathAtom) ?? null
        const bucket = getExpectedSessionsForProject(projectPath, true)
        if (!bucket) return

        const { id, payload } =
            typeof sessionOrId === 'string'
                ? { id: sessionOrId, payload: undefined }
                : { id: sessionOrId.info.session_id, payload: sessionOrId }

        logger.debug(`[SessionsAtoms] Expecting session ${id}`)
        bucket.set(id, { expiresAt: Date.now() + EXPECTED_SESSION_TTL_MS, session: payload })
    },
)

export function setSessionsToastHandlers(handlers: { pushToast?: PushToast | null }) {
    pushToastHandler = handlers.pushToast ?? null
}

export const filterModeAtom = atom(
    (get) => get(filterModeStateAtom),
    (_get, set, mode: FilterMode) => {
        if (!isValidFilterMode(mode)) {
            return
        }
        set(filterModeStateAtom, mode)
        set(setSelectionFilterModeActionAtom, mode)
        void set(persistSessionsSettingsAtom)
    },
)

export const searchQueryAtom = atom(
    (get) => get(searchQueryStateAtom),
    (_get, set, query: string) => {
        set(searchQueryStateAtom, query)
    },
)

export const isSearchVisibleAtom = atom(
    (get) => get(isSearchVisibleStateAtom),
    (_get, set, value: boolean) => {
        set(isSearchVisibleStateAtom, value)
    },
)

const searchedSessionsAtom = atom((get) => {
    const sessions = get(allSessionsAtom)
    const query = get(searchQueryStateAtom)
    return searchSessionsUtil(sessions, query)
})

export const filteredSessionsAtom = atom((get) => {
    const sessions = get(searchedSessionsAtom)
    const filterMode = get(filterModeStateAtom)
    return filterSessions(sessions, filterMode)
})

export const sortedSessionsAtom = atom((get) => {
    const sessions = get(filteredSessionsAtom)
    return sortSessionsByCreationDate(sessions)
})

export const sessionsAtom = atom((get) => get(sortedSessionsAtom))

export const lastRefreshAtom = atom((get) => get(lastRefreshStateAtom))

export const mergeDialogAtom = atom((get) => get(mergeDialogStateAtom))

export const mergeStatusSelectorAtom = atom((get) => {
    const statuses = get(mergeStatusesStateAtom)
    return (sessionId: string): MergeStatus | undefined => statuses.get(sessionId)
})

export const mergeInFlightSelectorAtom = atom((get) => {
    const statuses = get(mergeInFlightStateAtom)
    return (sessionId: string): boolean => statuses.get(sessionId) ?? false
})

export const sessionMutationSelectorAtom = atom((get) => {
    const mutations = get(sessionMutationsStateAtom)
    return (sessionId: string, kind: SessionMutationKind): boolean => {
        const entry = mutations.get(sessionId)
        return entry?.has(kind) ?? false
    }
})

export const beginSessionMutationActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; kind: SessionMutationKind }) => {
        set(sessionMutationsStateAtom, (prev) => applySessionMutationState(prev, input.sessionId, input.kind, true))
    },
)

export const endSessionMutationActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; kind: SessionMutationKind }) => {
        set(sessionMutationsStateAtom, (prev) => applySessionMutationState(prev, input.sessionId, input.kind, false))
    },
)

export const enqueuePendingStartupActionAtom = atom(
    null,
    (get, set, input: { sessionId: string; agentType?: AgentType; ttlMs?: number }) => {
        suppressedAutoStart.delete(input.sessionId)
        set(pendingStartupsAtom, (prev) => {
            const next = new Map(prev)
            next.set(input.sessionId, createPendingStartup(input.sessionId, input.agentType, input.ttlMs))
            return next
        })

        const existingSessions = get(allSessionsAtom)
        const existing = existingSessions.find(session => session.info.session_id === input.sessionId)
        if (!existing) {
            return
        }

        if (existing.info.session_state !== SessionState.Running) {
            return
        }

        const previousStatesOverride = new Map(previousSessionStates)
        previousStatesOverride.delete(input.sessionId)

        autoStartRunningSessions(get, set, [existing], {
            reason: 'pending-startup-enqueue',
            previousStates: previousStatesOverride,
        })
    },
)

export const clearPendingStartupActionAtom = atom(
    null,
    (_get, set, sessionId: string) => {
        set(pendingStartupsAtom, (prev) => {
            if (!prev.has(sessionId)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    },
)

export const cleanupExpiredPendingStartupsActionAtom = atom(
    null,
    (_get, set) => {
        const now = Date.now()
        set(pendingStartupsAtom, (prev) => {
            let changed = false
            const next = new Map(prev)
            for (const [sessionId, pending] of next) {
                if (now >= pending.expiresAt) {
                    next.delete(sessionId)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    },
)

export const refreshSessionsActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)
        const activeSessions = get(allSessionsAtom)

        const started = performance.now()
        logger.debug(`[SessionsAtoms] refreshSessionsActionAtom start (project=${projectPath ?? 'none'})`)

        if (activeSessionsProjectPath && activeSessionsProjectPath !== projectPath) {
            cacheCrossProjectSnapshot(set, activeSessionsProjectPath, activeSessions)
        }

        let cachedSnapshot: EnrichedSession[] | null = null
        let cachedStates: Map<string, string> | null = null
        if (projectPath) {
            cachedSnapshot = projectSessionsSnapshotCache.get(projectPath) ?? null
            previousSessionsSnapshot = cachedSnapshot ? [...cachedSnapshot] : []
            cachedStates = projectSessionStatesCache.get(projectPath) ?? null
            previousSessionStates = cachedStates ? new Map(cachedStates) : new Map()
        }

        if (!projectPath) {
            await releaseRemovedSessions(get, set, previousSessionsSnapshot, [])
            set(allSessionsAtom, [])
            set(activeSessionsHydratedFromCacheStateAtom, false)
            set(mergeStatusesStateAtom, new Map())
            set(mergeInFlightStateAtom, new Map())
            set(pendingStartupsAtom, new Map())
            suppressedAutoStart.clear()
            previousSessionsSnapshot = []
            previousSessionStates = new Map()
            activeSessionsProjectPath = null
            set(lastRefreshStateAtom, Date.now())
            return
        }

        try {
            if (cachedSnapshot && cachedSnapshot.length > 0) {
                const stripped = stripAttentionState(cachedSnapshot)
                await applySessionsSnapshot(get, set, stripped, projectPath, {
                    reason: 'cache-hydrate',
                    previousStates: cachedStates ? new Map(cachedStates) : new Map(previousSessionStates),
                })
            }
            const loadStart = performance.now()
            const sessions = await loadSessionsSnapshot(projectPath)
            logger.debug(
                `[SessionsAtoms] loadSessionsSnapshot success in ${(performance.now() - loadStart).toFixed(1)}ms (count=${sessions.length})`,
            )
            await applySessionsSnapshot(get, set, sessions, projectPath, { reason: 'refresh' })
        } catch (error) {
            logger.error('[SessionsAtoms] Failed to load sessions (keeping stale state):', error)
            // Keep previous snapshot to avoid tearing down terminals on transient errors
        } finally {
            set(lastRefreshStateAtom, Date.now())
            const elapsed = performance.now() - started
            logger.debug(`[SessionsAtoms] refreshSessionsActionAtom end in ${elapsed.toFixed(1)}ms`)
        }
    },
)

export const cleanupProjectSessionsCacheActionAtom = atom(
    null,
    async (get, set, projectPath: string | null) => {
        if (!projectPath) {
            return
        }
        const snapshot = projectSessionsSnapshotCache.get(projectPath)
        projectSessionsSnapshotCache.delete(projectPath)
        projectSessionStatesCache.delete(projectPath)
        expectedSessionsByProject.delete(projectPath)
        crossProjectAttention.delete(projectPath)
        for (const [sessionId, path] of sessionProjectIndex.entries()) {
            if (path === projectPath) {
                sessionProjectIndex.delete(sessionId)
            }
        }
        set(crossProjectCountsAtom, (prev) => {
            if (!(projectPath in prev)) return prev
            const { [projectPath]: _, ...rest } = prev
            return rest
        })
        if (!snapshot || snapshot.length === 0) {
            return
        }
        await releaseRemovedSessions(get, set, snapshot, [])
    },
)

const persistSessionsSettingsAtom = atom(
    null,
    async (get) => {
        const loaded = get(settingsLoadedAtom)
        const projectPath = get(projectPathAtom)
        if (!loaded || !projectPath) {
            return
        }

        const filterMode = get(filterModeStateAtom)

        if (lastPersistedFilterMode === filterMode) {
            return
        }

        try {
            await invoke(TauriCommands.SetProjectSessionsSettings, {
                settings: {
                    filter_mode: filterMode,
                },
            })
            lastPersistedFilterMode = filterMode
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to save sessions settings:', error)
            lastPersistedFilterMode = null
        }
    },
)

let sessionsEventsCleanup: (() => void) | null = null
let reloadSessionsPromise: Promise<void> | null = null
let reloadSessionsReplay = false

export const reloadSessionsActionAtom = atom(
    null,
    async (_get, set) => {
        if (reloadSessionsPromise) {
            reloadSessionsReplay = true
            return reloadSessionsPromise
        }

        reloadSessionsPromise = (async () => {
            set(loadingStateAtom, true)
            try {
                let shouldRepeat = false
                do {
                    await set(refreshSessionsActionAtom)
                    shouldRepeat = reloadSessionsReplay
                    reloadSessionsReplay = false
                } while (shouldRepeat)
            } finally {
                set(loadingStateAtom, false)
                reloadSessionsPromise = null
            }
        })()

        return reloadSessionsPromise
    },
)

export const initializeSessionsSettingsActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)
        if (!projectPath) {
            set(settingsLoadedAtom, false)
            return
        }

        try {
            const settings = await invoke<{ filter_mode?: string } | null>(TauriCommands.GetProjectSessionsSettings)
            const filter = settings && isValidFilterMode(settings.filter_mode) ? (settings.filter_mode as FilterMode) : getDefaultFilterMode()
            set(filterModeStateAtom, filter)
            set(setSelectionFilterModeActionAtom, filter)
            lastPersistedFilterMode = filter
        } catch {
            lastPersistedFilterMode = null
        } finally {
            set(settingsLoadedAtom, true)
        }

        try {
            const prefs = await invoke<{ auto_cancel_after_merge?: boolean; auto_cancel_after_pr?: boolean } | null>(TauriCommands.GetProjectMergePreferences)
            if (prefs && typeof prefs.auto_cancel_after_merge === 'boolean') {
                set(autoCancelAfterMergeStateAtom, prefs.auto_cancel_after_merge)
            } else {
                set(autoCancelAfterMergeStateAtom, true)
            }
            if (prefs && typeof prefs.auto_cancel_after_pr === 'boolean') {
                set(autoCancelAfterPrStateAtom, prefs.auto_cancel_after_pr)
            } else {
                set(autoCancelAfterPrStateAtom, false)
            }
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to load project merge preferences', error)
            set(autoCancelAfterMergeStateAtom, true)
            set(autoCancelAfterPrStateAtom, false)
        }
    },
)

export const updateAutoCancelAfterMergeActionAtom = atom(
    null,
    async (get, set, input: { value: boolean; persist?: boolean }) => {
        const previous = get(autoCancelAfterMergeStateAtom)
        set(autoCancelAfterMergeStateAtom, input.value)

        if (input.persist === false) {
            return
        }

        try {
            await invoke(TauriCommands.SetProjectMergePreferences, {
                preferences: {
                    auto_cancel_after_merge: input.value,
                    auto_cancel_after_pr: get(autoCancelAfterPrStateAtom),
                },
            })
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to persist project merge preferences', error)
            set(autoCancelAfterMergeStateAtom, previous)
        }
    },
)

export const updateAutoCancelAfterPrActionAtom = atom(
    null,
    async (get, set, input: { value: boolean; persist?: boolean }) => {
        const previous = get(autoCancelAfterPrStateAtom)
        set(autoCancelAfterPrStateAtom, input.value)

        if (input.persist === false) {
            return
        }

        try {
            await invoke(TauriCommands.SetProjectMergePreferences, {
                preferences: {
                    auto_cancel_after_merge: get(autoCancelAfterMergeStateAtom),
                    auto_cancel_after_pr: input.value,
                },
            })
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to persist project PR preferences', error)
            set(autoCancelAfterPrStateAtom, previous)
        }
    },
)

export const initializeSessionsEventsActionAtom = atom(
    null,
    async (get, set) => {
        if (sessionsEventsCleanup) {
            return
        }

        const unlisteners: Array<() => void> = []

        const register = async <E extends SchaltEvent>(event: E, handler: (payload: unknown) => void) => {
            const unlisten = await listenEvent(event, (payload) => {
                try {
                    handler(payload)
                } catch (error) {
                    logger.error(`[SessionsAtoms] Failed to handle ${event}:`, error)
                }
            })
            unlisteners.push(unlisten)
            sessionsEventHandlersForTests.set(event, handler)
        }

        await register(SchaltEvent.SessionsRefreshed, (payload) => {
            const normalized = parseSessionsRefreshedPayload(payload)
            const activeProject = get(projectPathAtom)

            if (normalized.projectPath && normalized.projectPath !== activeProject) {
                cacheCrossProjectSnapshot(set, normalized.projectPath, normalized.sessions)
                return
            }

            if (normalized.sessions.length === 0) {
                if (sessionsRefreshedReloadPending) {
                    logger.debug('[SessionsAtoms] Skipping duplicate reload for empty SessionsRefreshed payload')
                    return
                }
                sessionsRefreshedReloadPending = true
                void (async () => {
                    try {
                        await set(reloadSessionsActionAtom)
                    } catch (error) {
                        logger.warn('[SessionsAtoms] Failed to reload after empty SessionsRefreshed payload:', error)
                    } finally {
                        sessionsRefreshedReloadPending = false
                    }
                })()
                return
            }

            void (async () => {
                const previousStatesSnapshot = new Map(previousSessionStates)
                await applySessionsSnapshot(get, set, normalized.sessions, normalized.projectPath, {
                    reason: 'sessions-refreshed',
                    previousStates: previousStatesSnapshot,
                })
            })()
        })

        await register(SchaltEvent.TerminalAgentStarted, (payload) => {
            const event = payload as { terminal_id?: string | null }
            if (!event?.terminal_id) {
                return
            }
            markTerminalStarted(event.terminal_id)
        })

        const hasSessionInActiveProject = (sessionId: string | undefined | null): boolean => {
            if (!sessionId) return false
            const currentSessions = get(allSessionsAtom)
            return currentSessions.some(session => session.info.session_id === sessionId)
        }

        await register(SchaltEvent.GitOperationStarted, (payload) => {
            const event = payload as GitOperationPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            if (!hasSessionInActiveProject(sessionName)) {
                return
            }

            mergeErrorCache.delete(sessionName)
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, true)
                return next
            })

            set(mergeStatusesStateAtom, (prev) => {
                if (!prev.has(sessionName)) {
                    return prev
                }
                const next = new Map(prev)
                next.delete(sessionName)
                return next
            })

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'running',
                    error: null,
                }
            })
        })

        await register(SchaltEvent.GitOperationCompleted, (payload) => {
            const event = payload as GitOperationPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            if (!hasSessionInActiveProject(sessionName)) {
                return
            }

            mergeErrorCache.delete(sessionName)
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, false)
                return next
            })

            const status = event.status ?? 'success'

            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                if (status === 'success') {
                    next.set(sessionName, 'merged')
                } else if (status === 'conflict') {
                    next.set(sessionName, 'conflict')
                }
                return next
            })

            if (status === 'success' && pushToastHandler) {
                const shortCommit = event.commit ? event.commit.slice(0, 7) : undefined
                const description = shortCommit
                    ? `Fast-forwarded ${event.parent_branch} to ${shortCommit}`
                    : `Fast-forwarded ${event.parent_branch}`
                pushToastHandler({
                    tone: 'success',
                    title: `Merged ${sessionName}`,
                    description,
                })
            }

            const autoCancel = get(autoCancelAfterMergeStateAtom)
            if (autoCancel && event.operation === 'merge' && (event.status === 'success' || event.status === undefined)) {
                void (async () => {
                    try {
                        await invoke(TauriCommands.SchaltwerkCoreCancelSession, { name: sessionName })
                    } catch (error) {
                        logger.error(`Failed to auto-cancel session after merge: ${sessionName}`, error)
                        if (pushToastHandler) {
                            pushToastHandler({
                                tone: 'error',
                                title: `Failed to cancel ${sessionName}`,
                                description: getErrorMessage(error),
                            })
                        }
                    }
                })()
            }

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return defaultMergeDialogState()
            })
        })

        await register(SchaltEvent.GitOperationFailed, (payload) => {
            const event = payload as GitOperationFailedPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            if (!hasSessionInActiveProject(sessionName)) {
                return
            }

            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, false)
                return next
            })

            if (event.status === 'conflict') {
                set(mergeStatusesStateAtom, (prev) => {
                    const next = new Map(prev)
                    next.set(sessionName, 'conflict')
                    return next
                })
            }

            const message = event.error ?? 'Merge failed'
            const previousError = mergeErrorCache.get(sessionName)
            if (pushToastHandler && previousError !== message) {
                pushToastHandler({
                    tone: 'error',
                    title: `Merge failed for ${sessionName}`,
                    description: message,
                })
            }
            mergeErrorCache.set(sessionName, message)

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'ready',
                    error: message,
                }
            })
        })

        await register(SchaltEvent.SessionActivity, (payload) => {
            const event = payload as SessionActivityPayload
            if (!hasSessionInActiveProject(event?.session_name)) {
                return
            }
            activityBuffer.set(event.session_name, event)
            if (activityFlushTimer === null) {
                activityFlushTimer = setTimeout(() => {
                    const updates = new Map(activityBuffer)
                    activityBuffer.clear()
                    activityFlushTimer = null
                    if (updates.size === 0) return

                    set(sessionActivityMapAtom, (prev) => {
                        const next = new Map(prev)
                        for (const [id, update] of updates) {
                            next.set(id, {
                                last_modified: new Date((update.last_activity_ts ?? 0) * 1000).toISOString(),
                                last_modified_ts: (update.last_activity_ts ?? 0) * 1000,
                                current_task: update.current_task ?? prev.get(id)?.current_task ?? null,
                                todo_percentage: update.todo_percentage ?? prev.get(id)?.todo_percentage ?? null,
                                is_blocked: update.is_blocked ?? prev.get(id)?.is_blocked ?? null,
                            })
                        }
                        return next
                    })
                }, ACTIVITY_FLUSH_INTERVAL)
            }
        })

        await register(SchaltEvent.TerminalAttention, (payload) => {
            const event = payload as { session_id: string; terminal_id: string; needs_attention?: boolean }
            if (!isTopTerminalId(event.terminal_id)) {
                logger.debug('[SessionsAtoms] Ignoring attention event from non-top terminal', event)
                return
            }

            const needsAttention = event.needs_attention ?? false

            if (hasSessionInActiveProject(event.session_id)) {
                const activeProject = get(projectPathAtom)
                if (activeProject) {
                    updateCrossProjectAttention(activeProject, event.session_id, needsAttention)
                }
                set(allSessionsAtom, (prev) => {
                    const targetIndex = prev.findIndex(session => session.info.session_id === event.session_id)
                    if (targetIndex === -1) {
                        return prev
                    }
                    const target = prev[targetIndex]
                    const nextAttention = needsAttention ? true : undefined
                    if (target.info.attention_required === nextAttention) {
                        return prev
                    }
                    const updated = [...prev]
                    updated[targetIndex] = {
                        ...target,
                        info: {
                            ...target.info,
                            attention_required: nextAttention,
                        },
                    }
                    return updated
                })
                syncSnapshotsFromAtom(get, set)
                if (activeProject) {
                    setCrossProjectCounts(set, activeProject, recomputeCrossProjectCounts(activeProject))
                }
                return
            }

            const ownerProject = sessionProjectIndex.get(event.session_id)
            if (!ownerProject) return

            updateCrossProjectAttention(ownerProject, event.session_id, needsAttention)
            setCrossProjectCounts(set, ownerProject, recomputeCrossProjectCounts(ownerProject))
        })

        await register(SchaltEvent.SessionGitStats, (payload) => {
            const event = payload as {
                session_name: string
                project_path?: string
                files_changed?: number
                lines_added?: number
                lines_removed?: number
                has_uncommitted?: boolean
                dirty_files_count?: number
                commits_ahead_count?: number
                has_conflicts?: boolean
                top_uncommitted_paths?: string[] | null
                merge_has_conflicts?: boolean
                merge_is_up_to_date?: boolean
                merge_conflicting_paths?: string[] | null
            }

            const activeProject = get(projectPathAtom)
            if (!matchesProjectScope(event.project_path, activeProject)) {
                return
            }

            if (!hasSessionInActiveProject(event.session_name)) {
                return
            }

            set(allSessionsAtom, (prev) => prev.map(session => {
                if (session.info.session_id !== event.session_name) {
                    return session
                }
                const diffStats = {
                    files_changed: event.files_changed ?? 0,
                    additions: event.lines_added ?? 0,
                    deletions: event.lines_removed ?? 0,
                    insertions: event.lines_added ?? 0,
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        diff_stats: diffStats,
                        has_uncommitted_changes: event.has_uncommitted ?? session.info.has_uncommitted_changes,
                        dirty_files_count: event.dirty_files_count ?? session.info.dirty_files_count,
                        commits_ahead_count: event.commits_ahead_count ?? session.info.commits_ahead_count,
                        has_conflicts: event.has_conflicts ?? session.info.has_conflicts,
                        top_uncommitted_paths: event.top_uncommitted_paths && event.top_uncommitted_paths.length > 0
                            ? event.top_uncommitted_paths
                            : session.info.top_uncommitted_paths,
                        merge_has_conflicts: event.merge_has_conflicts ?? session.info.merge_has_conflicts,
                        merge_is_up_to_date: typeof event.merge_is_up_to_date === 'boolean'
                            ? event.merge_is_up_to_date
                            : session.info.merge_is_up_to_date,
                        merge_conflicting_paths: event.merge_conflicting_paths && event.merge_conflicting_paths.length > 0
                            ? event.merge_conflicting_paths
                            : session.info.merge_conflicting_paths,
                    },
                }
            }))
            syncSnapshotsFromAtom(get, set)

            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                const conflictFlag = event.merge_has_conflicts
                if (conflictFlag === true || (conflictFlag === undefined && event.has_conflicts)) {
                    next.set(event.session_name, 'conflict')
                } else if (conflictFlag === false || (!event.has_conflicts && conflictFlag === undefined)) {
                    if (next.get(event.session_name) === 'conflict') {
                        next.delete(event.session_name)
                    }
                }

                const upToDateFlag = event.merge_is_up_to_date
                if (upToDateFlag === true) {
                    next.set(event.session_name, 'merged')
                } else if (upToDateFlag === false) {
                    if (next.get(event.session_name) === 'merged') {
                        next.delete(event.session_name)
                    }
                } else if (conflictFlag === undefined) {
                    const noDiff = (event.files_changed ?? 0) === 0
                        && (event.has_uncommitted ?? false) === false
                        && (event.has_conflicts ?? false) === false
                    if (noDiff) {
                        next.set(event.session_name, 'merged')
                    } else if (next.get(event.session_name) === 'merged') {
                        next.delete(event.session_name)
                    }
                }

                return next
            })
        })

        await register(SchaltEvent.SessionAdded, (payload) => {
            const event = payload as {
                session_name: string
                branch?: string
                worktree_path?: string
                parent_branch?: string
                created_at?: string
                last_modified?: string
                epic?: Epic
                agent_type?: string
                is_consolidation?: boolean
                consolidation_sources?: string[]
                consolidation_round_id?: string | null
                consolidation_role?: 'candidate' | 'judge' | null
                consolidation_report?: string | null
                consolidation_base_session_id?: string | null
                consolidation_recommended_session_id?: string | null
                consolidation_confirmation_mode?: 'confirm' | 'auto-promote' | null
            }

            const previousStatesSnapshot = new Map(previousSessionStates)
            const pendingStartup = get(pendingStartupsAtom).get(event.session_name) ?? null
            const agentTypeFromEvent: AgentType | undefined =
                typeof event.agent_type === 'string' && AGENT_TYPES.includes(event.agent_type as AgentType)
                    ? (event.agent_type as AgentType)
                    : undefined

            set(allSessionsAtom, (prev) => {
                if (prev.some(session => session.info.session_id === event.session_name)) {
                    return prev
                }
                const nowIso = new Date().toISOString()
                const createdAtIso = event.created_at ?? nowIso
                const lastModifiedIso = event.last_modified ?? createdAtIso
                const info: SessionInfo = {
                    session_id: event.session_name,
                    branch: event.branch ?? '',
                    worktree_path: event.worktree_path ?? '',
                    base_branch: event.parent_branch ?? '',
                    parent_branch: event.parent_branch ?? null,
                    epic: event.epic,
                    status: 'active' as const,
                    created_at: createdAtIso,
                    last_modified: lastModifiedIso,
                    has_uncommitted_changes: false,
                    has_conflicts: false,
                    is_current: false,
                    session_type: 'worktree',
                    container_status: undefined,
                    session_state: SessionState.Running,
                    current_task: undefined,
                    todo_percentage: undefined,
                    is_blocked: undefined,
                    original_agent_type: agentTypeFromEvent ?? pendingStartup?.agentType,
                    is_consolidation: event.is_consolidation ?? false,
                    consolidation_sources: event.consolidation_sources ?? undefined,
                    consolidation_round_id: event.consolidation_round_id ?? undefined,
                    consolidation_role: event.consolidation_role ?? undefined,
                    consolidation_report: event.consolidation_report ?? undefined,
                    consolidation_base_session_id: event.consolidation_base_session_id ?? undefined,
                    consolidation_recommended_session_id: event.consolidation_recommended_session_id ?? undefined,
                    consolidation_confirmation_mode: event.consolidation_confirmation_mode ?? undefined,
                    diff_stats: undefined,
                    ready_to_merge: false,
                }
                const terminals = [
                    stableSessionTerminalId(event.session_name, 'top'),
                    stableSessionTerminalId(event.session_name, 'bottom'),
                ]
                const enriched: EnrichedSession = { info, terminals }
                return [enriched, ...prev]
            })

            syncSnapshotsFromAtom(get, set)

            const addedSession = get(allSessionsAtom).find(session => session.info.session_id === event.session_name)
            if (addedSession) {
                autoStartRunningSessions(get, set, [addedSession], {
                    reason: 'session-added',
                    previousStates: previousStatesSnapshot,
                })
                syncSnapshotsFromAtom(get, set)
            }
        })

        await register(SchaltEvent.SessionCancelling, (payload) => {
            const event = payload as { session_name: string }
            set(allSessionsAtom, (prev) => prev.map(session => {
                if (session.info.session_id !== event.session_name) {
                    return session
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        status: 'spec' as const,
                    },
                }
            }))
            syncSnapshotsFromAtom(get, set)
        })

        await register(SchaltEvent.SessionRemoved, (payload) => {
            const event = payload as { session_name: string }
            let removed = false
            set(allSessionsAtom, (prev) => {
                if (!prev.some(session => session.info.session_id === event.session_name)) {
                    removed = false
                    return prev
                }
                removed = true
                return prev.filter(session => session.info.session_id !== event.session_name)
            })

            if (removed) {
                releaseSessionTerminals(event.session_name)
                suppressedAutoStart.delete(event.session_name)
                const topId = stableSessionTerminalId(event.session_name, 'top')
                const bottomId = stableSessionTerminalId(event.session_name, 'bottom')
                clearTerminalStartState([topId, bottomId])
                const projectPath = get(projectPathAtom)
                if (projectPath) {
                    const previewKey = buildPreviewKey(projectPath, 'session', event.session_name)
                    closePreview(previewKey)
                    set(clearPreviewStateActionAtom, previewKey)
                }
                const pending = new Map(get(pendingStartupsAtom))
                if (pending.delete(event.session_name)) {
                    set(pendingStartupsAtom, pending)
                }
                set(mergeStatusesStateAtom, (prev) => {
                    if (!prev.has(event.session_name)) {
                        return prev
                    }
                    const next = new Map(prev)
                    next.delete(event.session_name)
                    return next
                })
                set(sessionMutationsStateAtom, (prev) => {
                    if (!prev.has(event.session_name)) {
                        return prev
                    }
                    const next = new Map(prev)
                    next.delete(event.session_name)
                    return next
                })
                set(sessionActivityMapAtom, (prev) => {
                    if (!prev.has(event.session_name)) {
                        return prev
                    }
                    const next = new Map(prev)
                    next.delete(event.session_name)
                    return next
                })
            }

            previousSessionStates.delete(event.session_name)
            syncSnapshotsFromAtom(get, set)
        })

        sessionsEventsCleanup = () => {
            for (const unlisten of unlisteners.splice(0)) {
                try {
                    unlisten()
                } catch (error) {
                    logger.debug('[SessionsAtoms] Failed to remove session event listener during cleanup', { error })
                }
            }
            if (activityFlushTimer !== null) {
                clearTimeout(activityFlushTimer)
                activityFlushTimer = null
            }
            activityBuffer.clear()
            sessionsEventsCleanup = null
            sessionsRefreshedReloadPending = false
            sessionsEventHandlersForTests.clear()
        }
    },
)

export function __resetSessionsTestingState() {
    if (sessionsEventsCleanup) {
        try {
            sessionsEventsCleanup()
        } catch (error) {
            logger.debug('[SessionsAtoms] Failed to run sessionsEventsCleanup during reset', { error })
        }
    }
    sessionsEventsCleanup = null
    reloadSessionsPromise = null
    reloadSessionsReplay = false
    pushToastHandler = null
    sessionsRefreshedReloadPending = false
    if (activityFlushTimer !== null) {
        clearTimeout(activityFlushTimer)
        activityFlushTimer = null
    }
    activityBuffer.clear()
    previousSessionsSnapshot = []
    previousSessionStates = new Map()
    projectSessionsSnapshotCache.clear()
    projectSessionStatesCache.clear()
    suppressedAutoStart.clear()
    mergeErrorCache.clear()
    mergePreviewCache.clear()
    protectedReleaseUntil.clear()
    sessionsEventHandlersForTests.clear()
    expectedSessionsByProject.clear()
    backgroundAgentStartQueue.splice(0)
    backgroundAgentStartQueued.clear()
    backgroundAgentStartInFlight = 0
    backgroundAgentStartDrainScheduled = false
    sessionProjectIndex.clear()
    crossProjectAttention.clear()
    activeSessionsProjectPath = null
}

export const openMergeDialogActionAtom = atom(
    null,
    async (_get, set, input: string | { sessionId: string; prefillMode?: 'squash' | 'reapply' }) => {
        const sessionId = typeof input === 'string' ? input : input.sessionId
        const prefillMode = typeof input === 'string' ? undefined : input.prefillMode

        set(mergeDialogStateAtom, {
            isOpen: true,
            status: 'loading',
            sessionName: sessionId,
            preview: null,
            error: null,
            prefillMode,
        })

        try {
            const preview = normalizeMergePreviewForDialog(
                await invoke<MergePreviewResponse>(TauriCommands.SchaltwerkCoreGetMergePreviewWithWorktree, { name: sessionId })
            )
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview,
                error: null,
                prefillMode,
            })

            mergePreviewCache.set(sessionId, preview)
        } catch (error) {
            logger.error(`Failed to prepare merge for session ${sessionId}`, error)
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'idle',
                sessionName: sessionId,
                preview: null,
                error: error instanceof Error ? error.message : 'Unknown error',
                prefillMode,
            })
        }
    },
)

export const closeMergeDialogActionAtom = atom(
    null,
    (_get, set) => {
        set(mergeDialogStateAtom, defaultMergeDialogState())
    },
)

export const confirmMergeActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; mode: MergeModeOption; commitMessage?: string }) => {
        const current = get(mergeInFlightStateAtom)
        if (current.get(input.sessionId)) {
            return
        }

        set(mergeInFlightStateAtom, (prev) => {
            const next = new Map(prev)
            next.set(input.sessionId, true)
            return next
        })

        try {
            await invoke(TauriCommands.SchaltwerkCoreMergeSessionToMain, {
                name: input.sessionId,
                mode: input.mode,
                commitMessage: input.commitMessage ?? null,
            })

            set(mergeDialogStateAtom, defaultMergeDialogState())
        } catch (error) {
            if (isSchaltError(error) && error.type === 'MergeConflict') {
                const conflictingPaths = [...error.data.files]
                set(mergeStatusesStateAtom, (prev) => {
                    const next = new Map(prev)
                    next.set(input.sessionId, 'conflict')
                    return next
                })
                set(mergeDialogStateAtom, (prev) => {
                    const nextPreview = applyMergeConflictToPreview(prev.preview, conflictingPaths)
                    if (nextPreview) {
                        mergePreviewCache.set(input.sessionId, nextPreview)
                    }
                    return {
                        ...prev,
                        status: 'ready',
                        error: null,
                        preview: nextPreview,
                    }
                })
                return
            }

            const message = getErrorMessage(error)
            logger.error(`Confirm merge failed for ${input.sessionId}`, error)
            set(mergeDialogStateAtom, (prev) => ({
                ...prev,
                status: 'ready',
                error: message,
            }))
        } finally {
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(input.sessionId, false)
                return next
            })
        }
    },
)

export const shortcutMergeActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; commitMessage?: string | null }): Promise<ShortcutMergeResult> => {
        const sessionId = input.sessionId
        if (!sessionId) {
            return { status: 'blocked', reason: 'no-session' }
        }

        const findSession = () => get(allSessionsAtom).find(candidate => candidate.info.session_id === sessionId) ?? null

        let session = findSession()
        if (!session) {
            return { status: 'blocked', reason: 'no-session' }
        }

        if (session.info.session_state === 'spec') {
            return { status: 'blocked', reason: 'not-ready' }
        }

        if (get(mergeInFlightStateAtom).get(sessionId)) {
            return { status: 'blocked', reason: 'in-flight' }
        }

        let preview: MergePreviewResponse
        try {
            preview = normalizeMergePreviewForDialog(
                await invoke<MergePreviewResponse>(TauriCommands.SchaltwerkCoreGetMergePreviewWithWorktree, { name: sessionId })
            )
            mergePreviewCache.set(sessionId, preview)
        } catch (error) {
            return { status: 'error', message: getErrorMessage(error) }
        }

        const openMergeDialogWithPreview = () => {
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview,
                error: null,
            })
        }

        if (preview.isUpToDate) {
            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionId, 'merged')
                return next
            })
            return { status: 'blocked', reason: 'already-merged' }
        }

        const commitFromInput = typeof input.commitMessage === 'string' ? input.commitMessage.trim() : ''
        const commitMessage = (commitFromInput || preview.defaultCommitMessage || '').trim()

        if (!commitMessage) {
            openMergeDialogWithPreview()
            return { status: 'needs-modal', reason: 'missing-commit' }
        }

        openMergeDialogWithPreview()
        return { status: 'needs-modal', reason: 'confirm' }
    },
)

export const setCurrentSelectionActionAtom = atom(
    null,
    (_get, set, sessionId: string | null) => {
        set(currentSelectionStateAtom, sessionId)
    },
)

export const updateSessionStatusActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; status: 'spec' | 'active' | 'dirty' }) => {
        const projectPath = get(projectPathAtom)
        if (!projectPath) {
            return
        }

        const sessions = get(allSessionsAtom)
        const session = sessions.find(s => s.info.session_id === input.sessionId)
        if (!session) {
            return
        }

        const currentSelection = get(currentSelectionStateAtom)

        try {
            if (input.status === 'spec') {
                const createdSpecName = await invoke<string>(TauriCommands.SchaltwerkCoreConvertSessionToDraft, { name: input.sessionId })
                const specSessionName = createdSpecName ?? input.sessionId
                const optimisticSpec: EnrichedSession = {
                    ...session,
                    info: {
                        ...session.info,
                        session_id: specSessionName,
                        display_name: specSessionName,
                        session_state: SessionState.Spec,
                        status: 'spec',
                        ready_to_merge: false,
                        has_uncommitted_changes: false,
                    },
                }
                set(expectSessionActionAtom, optimisticSpec)
                // Replace old session entry optimistically with spec so UI stays stable until refresh
                set(allSessionsAtom, prev => [
                    optimisticSpec,
                    ...prev.filter(s => s.info.session_id !== input.sessionId),
                ])
                // Move selection to the new spec name if user had the old session selected
                if (currentSelection === input.sessionId) {
                    set(currentSelectionStateAtom, createdSpecName ?? null)
                }
            }
        } finally {
            await set(refreshSessionsActionAtom)
        }
    },
)

export const createDraftActionAtom = atom(
    null,
    async (_get, set, input: { name: string; content: string }) => {
        await invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, {
            name: input.name,
            specContent: input.content,
        })
        await set(refreshSessionsActionAtom)
    },
)

export const updateSessionSpecContentActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; content: string }) => {
        set(allSessionsAtom, (prev) => {
            let changed = false
            const next = prev.map(session => {
                const matches =
                    session.info.session_id === input.sessionId ||
                    session.info.branch === input.sessionId ||
                    session.info.display_name === input.sessionId

                if (!matches) {
                    return session
                }

                const existing = session.info.spec_content ?? session.info.current_task ?? ''
                if (existing === input.content) {
                    return session
                }

                changed = true
                return {
                    ...session,
                    info: {
                        ...session.info,
                        spec_content: input.content,
                    },
                }
            })

            return changed ? next : prev
        })
    },
)

export const optimisticallyConvertSessionToSpecActionAtom = atom(
    null,
    (_get, set, sessionId: string) => {
        set(allSessionsAtom, (prev) => {
            let mutated = false
            const next = prev.map(session => {
                if (session.info.session_id !== sessionId) {
                    return session
                }
                mutated = true
                return {
                    ...session,
                    info: {
                        ...session.info,
                        session_state: SessionState.Spec,
                        status: 'spec' as const,
                        ready_to_merge: false,
                        has_uncommitted_changes: false,
                        has_conflicts: false,
                        diff_stats: undefined,
                        merge_has_conflicts: undefined,
                        merge_conflicting_paths: undefined,
                        merge_is_up_to_date: undefined,
                    },
                }
            })
            return mutated ? next : prev
        })

        set(mergeStatusesStateAtom, (prev) => {
            if (!prev.has(sessionId)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    },
)
