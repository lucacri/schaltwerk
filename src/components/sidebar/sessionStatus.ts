import type { SessionInfo } from '../../types/session'
import { SessionState } from '../../types/session'
import { getSessionLifecycleState } from '../../utils/sessionState'

type SidebarSessionStatusSource = Pick<
  SessionInfo,
  'status' | 'session_state' | 'clarification_started' | 'attention_required' | 'ready_to_merge'
>

export type SidebarPrimaryStatus =
  | 'blocked'
  | 'waiting'
  | 'idle'
  | 'not_started'
  | 'running'
  | 'ready'
  | null

export interface SidebarSessionStatus {
  sessionState: SessionState.Spec | SessionState.Processing | SessionState.Running
  isSpecClarificationStarted: boolean
  specNotStarted: boolean
  specWaitingForInput: boolean
  isIdle: boolean
  isActivelyRunning: boolean
  primaryStatus: SidebarPrimaryStatus
  shouldShowStatusStrip: boolean
}

export function getSidebarSessionStatus(
  info: SidebarSessionStatusSource,
  isBlocked: boolean,
  isRunning: boolean,
): SidebarSessionStatus {
  const sessionState = getSessionLifecycleState(info)
  const isSpecClarificationStarted =
    sessionState === SessionState.Spec && info.clarification_started === true
  const specNotStarted = sessionState === SessionState.Spec && !isSpecClarificationStarted
  const specWaitingForInput = isSpecClarificationStarted && info.attention_required === true
  const isIdle =
    sessionState === SessionState.Spec
      ? specWaitingForInput
      : info.attention_required === true
  const isActivelyRunning =
    !isIdle && (
      isSpecClarificationStarted
      || (sessionState === SessionState.Running && (info.ready_to_merge !== true || isRunning))
    )

  const primaryStatus: SidebarPrimaryStatus = isBlocked
    ? 'blocked'
    : specWaitingForInput
      ? 'waiting'
      : isIdle
        ? 'idle'
        : specNotStarted
          ? 'not_started'
          : isActivelyRunning
            ? 'running'
            : info.ready_to_merge === true
              ? 'ready'
              : null

  return {
    sessionState,
    isSpecClarificationStarted,
    specNotStarted,
    specWaitingForInput,
    isIdle,
    isActivelyRunning,
    primaryStatus,
    shouldShowStatusStrip:
      sessionState !== SessionState.Spec || isSpecClarificationStarted || specNotStarted,
  }
}
