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
  | 'clarified'
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
  const clarifiedSpecCanComplete =
    sessionState === SessionState.Spec
    && info.spec_stage === 'clarified'
    && !isRunning
    && !isBlocked
  const isIdle = rawIdle && !isRunning && !(clarifiedSpecCanComplete && !isWaitingForInput)
  const isClarifiedSpecComplete =
    clarifiedSpecCanComplete
    && !isWaitingForInput
  const isActivelyRunning =
    !isClarifiedSpecComplete && !isIdle && !isWaitingForInput && (
      isSpecClarificationStarted
      || (sessionState === SessionState.Running && (info.ready_to_merge !== true || isRunning))
    )

  const primaryStatus: SidebarPrimaryStatus = isBlocked
    ? 'blocked'
    : isWaitingForInput
      ? 'waiting'
      : isIdle
        ? 'idle'
        : isClarifiedSpecComplete
          ? 'clarified'
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
