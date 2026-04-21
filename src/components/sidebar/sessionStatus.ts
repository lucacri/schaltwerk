import type { SessionInfo } from '../../types/session'
import { SessionState } from '../../types/session'
import { getSessionLifecycleState } from '../../utils/sessionState'

type SidebarSessionStatusSource = Pick<
  SessionInfo,
  'status' | 'session_state' | 'spec_stage' | 'clarification_started' | 'attention_required' | 'attention_kind' | 'ready_to_merge'
>

export type SidebarPrimaryStatus =
  | 'blocked'
  | 'waiting'
  | 'idle'
  | 'not_started'
  | 'ready'
  | 'running'
  | 'ready'
  | null

export interface SidebarSessionStatus {
  sessionState: SessionState.Spec | SessionState.Processing | SessionState.Running
  isSpecClarificationStarted: boolean
  specNotStarted: boolean
  specWaitingForInput: boolean
  isWaitingForInput: boolean
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
  const isDraftClarificationActive =
    isSpecClarificationStarted && info.spec_stage !== 'ready'
  const specNotStarted = sessionState === SessionState.Spec && !isSpecClarificationStarted
  const specWaitingForInput = isSpecClarificationStarted
    && info.attention_required === true
    && info.attention_kind !== 'idle'
  const runningWaitingForInput = sessionState !== SessionState.Spec
    && info.attention_required === true
    && info.attention_kind === 'waiting_for_input'
  const rawWaiting = specWaitingForInput || runningWaitingForInput
  const rawIdle =
    sessionState === SessionState.Spec
      ? info.attention_required === true && !specWaitingForInput
      : info.attention_required === true && !runningWaitingForInput
  const isWaitingForInput = rawWaiting && !isRunning
  const readySpecCanComplete =
    sessionState === SessionState.Spec
    && info.spec_stage === 'ready'
    && !isRunning
    && !isBlocked
  const isIdle = rawIdle && !isRunning && !(readySpecCanComplete && !isWaitingForInput)
  const isReadySpecComplete =
    readySpecCanComplete
    && !isWaitingForInput
  const isActivelyRunning =
    !isReadySpecComplete && !isIdle && !isWaitingForInput && (
      isRunning
      || isDraftClarificationActive
      || (sessionState === SessionState.Running && (info.ready_to_merge !== true || isRunning))
    )

  const primaryStatus: SidebarPrimaryStatus = isBlocked
    ? 'blocked'
    : isWaitingForInput
      ? 'waiting'
      : isIdle
        ? 'idle'
        : isReadySpecComplete
          ? 'ready'
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
    isWaitingForInput,
    isIdle,
    isActivelyRunning,
    primaryStatus,
    shouldShowStatusStrip:
      sessionState !== SessionState.Spec || isSpecClarificationStarted || specNotStarted,
  }
}
