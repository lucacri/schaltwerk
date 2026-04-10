import type { SessionInfo } from '../types/session'
import { SessionState } from '../types/session'

type SessionStateSource = Pick<SessionInfo, 'session_state' | 'status'>

export function getSessionLifecycleState(
    info: SessionStateSource,
): SessionState.Spec | SessionState.Processing | SessionState.Running {
    if (info.session_state === SessionState.Spec || info.status === 'spec') {
        return SessionState.Spec
    }

    if (info.session_state === SessionState.Processing) {
        return SessionState.Processing
    }

    return SessionState.Running
}

export function isSpec(info: SessionStateSource): boolean {
    return getSessionLifecycleState(info) === SessionState.Spec
}

export function isRunning(info: SessionStateSource): boolean {
    return getSessionLifecycleState(info) === SessionState.Running
}

