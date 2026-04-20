import { memo } from 'react'
import { clsx } from 'clsx'
import { SessionInfo, SessionMonitorStatus, SessionState } from '../../types/session'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { getSessionCardSurfaceClasses } from './SessionCard'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { useMultipleShortcutDisplays } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { useTranslation } from '../../common/i18n'
import { getSidebarSessionStatus } from './sessionStatus'

interface SessionRailCardProps {
  session: {
    info: SessionInfo
    status?: SessionMonitorStatus
    terminals: string[]
  }
  index: number
  isSelected: boolean
  hasFollowUpMessage: boolean
  isRunning: boolean
  onSelect: (sessionId: string) => void
}

export const SessionRailCard = memo<SessionRailCardProps>(function SessionRailCard({
  session,
  index,
  isSelected,
  hasFollowUpMessage,
  isRunning,
  onSelect,
}) {
  const { t } = useTranslation()
  const info = session.info
  const sessionName = getSessionDisplayName(info)
  const sessionState = info.session_state
  const statusState = getSidebarSessionStatus(info, Boolean(info.is_blocked), isRunning)
  const lifecycleState = statusState.sessionState
  const isWaitingForInput = statusState.isWaitingForInput
  const isIdle = statusState.isIdle
  const isRunningState = isRunning || statusState.isActivelyRunning
  const isClarifyingState = isRunningState && sessionState === SessionState.Spec
  const accessibleState = isClarifyingState
    ? t.session.clarifying
    : isRunningState
      ? 'running'
    : isWaitingForInput
      ? 'waiting for input'
      : isIdle
        ? 'idle'
        : statusState.primaryStatus === 'clarified'
          ? 'clarified'
          : lifecycleState
  const shortcuts = useMultipleShortcutDisplays([
    KeyboardShortcutAction.SwitchToSession1,
    KeyboardShortcutAction.SwitchToSession2,
    KeyboardShortcutAction.SwitchToSession3,
    KeyboardShortcutAction.SwitchToSession4,
    KeyboardShortcutAction.SwitchToSession5,
    KeyboardShortcutAction.SwitchToSession6,
    KeyboardShortcutAction.SwitchToSession7,
    KeyboardShortcutAction.SwitchToSession8,
  ])
  const platform = detectPlatformSafe()
  const modKey = platform === 'mac' ? '⌘' : 'Ctrl'
  const sessionActions = [
    KeyboardShortcutAction.SwitchToSession1,
    KeyboardShortcutAction.SwitchToSession2,
    KeyboardShortcutAction.SwitchToSession3,
    KeyboardShortcutAction.SwitchToSession4,
    KeyboardShortcutAction.SwitchToSession5,
    KeyboardShortcutAction.SwitchToSession6,
    KeyboardShortcutAction.SwitchToSession7,
    KeyboardShortcutAction.SwitchToSession8,
  ]
  const getShortcutLabel = (idx: number) => {
    if (idx >= sessionActions.length) return null
    const action = sessionActions[idx]
    return shortcuts[action] || `${modKey}${idx + 2}`
  }
  const shortcutLabel = getShortcutLabel(index)

  const additions = info.diff_stats?.insertions || info.diff_stats?.additions || 0
  const deletions = info.diff_stats?.deletions || 0

  const surface = getSessionCardSurfaceClasses({
    sessionState,
    isSelected,
    isReadyToMerge: false,
    isRunning,
    isIdle,
    isWaitingForInput,
    hasFollowUpMessage,
  })

  return (
    <div
      role="button"
      tabIndex={0}
      data-session-id={info.session_id}
      data-session-selected={isSelected ? 'true' : 'false'}
      title={`${shortcutLabel ? `[${shortcutLabel}] ` : ''}${sessionName} • ${accessibleState} • +${additions} -${deletions}`}
      aria-label={`${sessionName} (${accessibleState})`}
      className={clsx(
        'group relative w-full rounded-md mb-1 border transition-all duration-200',
        'flex flex-col items-center gap-1.5 px-1.5 py-1.5',
        surface.className,
        'cursor-pointer'
      )}
      style={surface.style}
      onClick={() => onSelect(info.session_id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(info.session_id)
        }
      }}
    >
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Shortcut badge */}
        <div className="flex items-center justify-center w-full">
          {shortcutLabel && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{
                color: 'var(--color-text-secondary)',
                backgroundColor: 'rgba(var(--color-bg-hover-rgb), 0.6)',
              }}
            >
              {shortcutLabel}
            </span>
          )}
        </div>

        {/* State icon row */}
        <div className="flex items-center justify-center w-full">
          {isRunningState && <ProgressIndicator className="scale-75" size="sm" />}
          {!isRunningState && isWaitingForInput && (
          <span
            style={{
              fontSize: theme.fontSize.label,
              lineHeight: theme.lineHeight.compact,
              fontFamily: theme.fontFamily.sans,
              fontWeight: 600,
              color: 'var(--color-accent-amber-light)'
            }}
            title={t.session.waitingForInput}
          >
            ✋ {t.session.waitingForInput}
          </span>
          )}
          {!isRunningState && isIdle && (
          <span
            style={{
              fontSize: theme.fontSize.label,
              lineHeight: theme.lineHeight.compact,
              fontFamily: theme.fontFamily.sans,
              fontWeight: 600,
              color: 'var(--color-accent-yellow-light)'
            }}
            title={t.sidebar.states.idle}
          >
            ⏸ {t.sidebar.states.idle}
          </span>
          )}
          {!isRunningState && !isIdle && statusState.primaryStatus === 'clarified' && (
            <span
              className="block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--color-accent-green)' }}
              title={t.session.clarified}
            />
          )}
          {!isRunningState && !isIdle && statusState.primaryStatus !== 'clarified' && lifecycleState === SessionState.Spec && (
            <span
              className="block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--color-accent-yellow)' }}
              title={t.sidebar.states.spec}
            />
          )}
          {!isRunningState && !isIdle && lifecycleState === SessionState.Running && (
            <span
              className="block w-1 h-1 rounded-full opacity-40"
              style={{ backgroundColor: 'var(--color-text-tertiary)' }}
              title={t.sidebar.states.idle}
            />
          )}
        </div>

        {/* Diff summary */}
        <div
          className="flex flex-col items-center justify-center gap-0.8 w-full"
          style={{ ...typography.caption, fontSize: theme.fontSize.label, color: 'var(--color-text-secondary)' }}
        >
          <span style={{ color: 'var(--color-accent-green-light)' }}>+{additions}</span>
          <span style={{ color: 'var(--color-accent-red-light)' }}>-{deletions}</span>
        </div>

        <div
          className="mt-1 w-full text-center truncate"
          style={{
            fontSize: theme.fontSize.caption,
            lineHeight: '1.2',
            color: 'var(--color-text-tertiary)',
            fontFamily: theme.fontFamily.sans,
          }}
          title={sessionName}
        >
          {sessionName}
        </div>
      </div>
    </div>
  )
})
