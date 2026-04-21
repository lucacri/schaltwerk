import { memo, useCallback, type CSSProperties } from 'react'
import { clsx } from 'clsx'
import { useAtomValue } from 'jotai'
import { VscIssues, VscGitPullRequest } from 'react-icons/vsc'
import { SessionActions } from '../session/SessionActions'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { UncommittedIndicator } from '../common/UncommittedIndicator'
import { theme, type AgentColor } from '../../common/theme'
import { useMultipleShortcutDisplays } from '../../keyboardShortcuts/useShortcutDisplay'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { SESSION_SWITCH_SHORTCUT_ACTIONS, resolveSwitchSessionShortcut } from './sessionShortcut'
import type { MergeStatus } from '../../store/atoms/sessions'
import { lastAgentResponseMapAtom, agentResponseTickAtom } from '../../store/atoms/lastAgentResponse'
import { useEpics } from '../../hooks/useEpics'
import { useTranslation } from '../../common/i18n/useTranslation'
import type { SessionInfo, SessionMonitorStatus } from '../../types/session'
import { getSessionCardSurfaceClasses } from './SessionCard'
import { getAgentColorKey, MetadataLinkBadge, openMetadataLink, PrStateBadge, sessionText } from './sessionCardStyles'
import { useSessionCardActions } from '../../contexts/SessionCardActionsContext'
import { useSessionActivity } from '../../store/hooks/useSessionActivity'
import { getSidebarSessionStatus } from './sessionStatus'

interface CompactVersionRowProps {
  session: {
    info: SessionInfo
    status?: SessionMonitorStatus
    terminals: string[]
  }
  index: number
  isSelected: boolean
  hasFollowUpMessage: boolean
  showPromoteIcon?: boolean
  tagMinWidth?: string
  willBeDeleted?: boolean
  isPromotionPreview?: boolean
  onPromoteVersion?: () => void
  onPromoteVersionHover?: () => void
  onPromoteVersionHoverEnd?: () => void
  isResetting?: boolean
  isRunning?: boolean
  disableMerge?: boolean
  mergeStatus?: MergeStatus
  isBusy?: boolean
  siblings?: SessionInfo[]
  hideTreeConnector?: boolean
  onHover?: (sessionId: string | null) => void
  isHighlighted?: boolean
  isConsolidationSourceHighlighted?: boolean
  isMuted?: boolean
}

type AccentVars = {
  DEFAULT: string
  light: string
  bg: string
  border: string
}

type CompactRowStyle = CSSProperties & {
  '--session-card-bg'?: string
  '--session-card-hover-bg'?: string
  '--session-card-border'?: string
}

const accentVarsByAgentColor: Record<AgentColor, AccentVars> = {
  blue: {
    DEFAULT: 'var(--color-accent-blue)',
    light: 'var(--color-accent-blue-light)',
    bg: 'var(--color-accent-blue-bg)',
    border: 'var(--color-accent-blue-border)',
  },
  green: {
    DEFAULT: 'var(--color-accent-green)',
    light: 'var(--color-accent-green-light)',
    bg: 'var(--color-accent-green-bg)',
    border: 'var(--color-accent-green-border)',
  },
  orange: {
    DEFAULT: 'var(--color-accent-amber)',
    light: 'var(--color-accent-amber-light)',
    bg: 'var(--color-accent-amber-bg)',
    border: 'var(--color-accent-amber-border)',
  },
  violet: {
    DEFAULT: 'var(--color-accent-violet)',
    light: 'var(--color-accent-violet-light)',
    bg: 'var(--color-accent-violet-bg)',
    border: 'var(--color-accent-violet-border)',
  },
  red: {
    DEFAULT: 'var(--color-accent-red)',
    light: 'var(--color-accent-red-light)',
    bg: 'var(--color-accent-red-bg)',
    border: 'var(--color-accent-red-border)',
  },
  yellow: {
    DEFAULT: 'var(--color-accent-yellow)',
    light: 'var(--color-accent-yellow-light)',
    bg: 'var(--color-accent-yellow-bg)',
    border: 'var(--color-accent-yellow-border)',
  },
}

export const CompactVersionRow = memo<CompactVersionRowProps>(({
  session,
  index,
  isSelected,
  hasFollowUpMessage,
  showPromoteIcon = false,
  willBeDeleted = false,
  isPromotionPreview = false,
  onPromoteVersion,
  onPromoteVersionHover,
  onPromoteVersionHoverEnd,
  isResetting = false,
  isRunning = false,
  disableMerge = false,
  mergeStatus = 'idle',
  isBusy = false,
  siblings,
  hideTreeConnector = false,
  onHover,
  isHighlighted = false,
  isConsolidationSourceHighlighted = false,
  isMuted = false,
}) => {
  const shortcuts = useMultipleShortcutDisplays([...SESSION_SWITCH_SHORTCUT_ACTIONS])
  const platform = detectPlatformSafe()
  const modKey = platform === 'mac' ? '⌘' : 'Ctrl'
  const {
    onSelect, onCancel,
    onConvertToSpec, onRunDraft, onRefineSpec, onDeleteSpec, onImprovePlanSpec, improvePlanStartingSessionId,
    onReset, onSwitchModel,
    onCreatePullRequest, onCreateGitlabMr,
    onMerge, onQuickMerge, onLinkPr, onPostToForge,
  } = useSessionCardActions()
  const { t } = useTranslation()
  const { setItemEpic } = useEpics()
  useAtomValue(lastAgentResponseMapAtom)
  useAtomValue(agentResponseTickAtom)

  const s = session.info
  const activity = useSessionActivity(s.session_id)
  const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
  const deletions = s.diff_stats?.deletions || 0
  const filesChanged = s.diff_stats?.files_changed || 0
  const isBlocked = (activity?.is_blocked ?? s.is_blocked) || false
  const isReadyToMerge = s.ready_to_merge || false
  const statusState = getSidebarSessionStatus(s, isBlocked, isRunning)
  const sessionState = statusState.sessionState
  const hasUncommittedChanges = !!s.has_uncommitted_changes
  const dirtyFilesCount =
    s.dirty_files_count
    ?? (hasUncommittedChanges ? Math.max(s.top_uncommitted_paths?.length ?? 0, 1) : 0)
  const showDirtyIndicator = hasUncommittedChanges || dirtyFilesCount > 0
  const commitsAheadCount = s.commits_ahead_count ?? 0
  const agentType = s.original_agent_type as SessionInfo['original_agent_type']
  const agentKey = (agentType || '').toLowerCase()
  const isJudgeSession = s.is_consolidation && s.consolidation_role === 'judge'
  const versionIndexLabel = s.is_consolidation
    ? (isJudgeSession ? 'judge' : 'merge')
    : s.version_number
      ? `v${s.version_number}`
      : `v${index + 1}`
  const agentLabel = sessionState === 'spec' ? t.session.spec : agentKey

  const agentColor = getAgentColorKey(agentKey)
  const colorScheme = accentVarsByAgentColor[agentColor]
  const consolidationSources = s.is_consolidation
    ? s.consolidation_sources?.map((sourceId, index) => {
        const source = siblings?.find(sibling => sibling.session_id === sourceId)
        const sourceAgent = source?.original_agent_type || 'terminal'
        const sourceAgentKey = sourceAgent.toLowerCase()
        return {
          sourceId,
          title: source
            ? `${sourceAgentKey}${source?.version_number ? ` (v${source.version_number})` : ''}`
            : `Session ${sourceId}`,
          colorScheme: accentVarsByAgentColor[getAgentColorKey(sourceAgentKey)],
          zIndex: 10 - index,
        }
      }) ?? []
    : []

  const surface = getSessionCardSurfaceClasses({
    sessionState,
    isSelected: false,
    isReadyToMerge,
    isRunning: statusState.isActivelyRunning,
    isIdle: statusState.isIdle,
    isWaitingForInput: statusState.isWaitingForInput,
    hasFollowUpMessage,
    willBeDeleted,
    isPromotionPreview,
    isHighlighted,
  })
  const rowStyle: CompactRowStyle = {
    ...surface.style,
    '--session-card-border': isSelected ? 'var(--color-accent-blue-border)' : surface.style['--session-card-border'],
    '--session-card-bg': isSelected ? 'var(--color-accent-blue-bg)' : surface.style['--session-card-bg'],
    '--session-card-hover-bg': isSelected ? 'var(--color-accent-blue-bg)' : surface.style['--session-card-hover-bg'],
  }

  const handleEpicChange = useCallback(
    (nextEpicId: string | null) => {
      void setItemEpic(s.session_id, nextEpicId)
    },
    [setItemEpic, s.session_id],
  )

  const handleOpenBadgeUrl = useCallback((url: string) => {
    openMetadataLink(url, s.session_id, 'CompactVersionRow')
  }, [s.session_id])

  const statusIndicator = (() => {
    if (isMuted && (statusState.primaryStatus === 'idle' || statusState.primaryStatus === 'waiting')) {
      return null
    }

    if (statusState.primaryStatus === 'blocked') {
      return (
        <span
          data-testid="compact-row-status-blocked"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-red-bg)',
            color: 'var(--color-accent-red-light)',
            borderColor: 'var(--color-accent-red-border)',
          }}
        >
          {t.session.blocked}
        </span>
      )
    }

    if (statusState.primaryStatus === 'waiting') {
      return (
        <span
          data-testid="compact-row-status-waiting"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-amber-bg)',
            color: 'var(--color-accent-amber-light)',
            borderColor: 'var(--color-accent-amber-border)',
          }}
        >
          {t.session.waitingForInput}
        </span>
      )
    }

    if (statusState.primaryStatus === 'idle') {
      return (
        <span
          data-testid="compact-row-status-idle"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-yellow-bg)',
            color: 'var(--color-accent-yellow-light)',
            borderColor: 'var(--color-accent-yellow-border)',
          }}
        >
          {t.session.idle}
        </span>
      )
    }

    if (statusState.primaryStatus === 'not_started') {
      return (
        <span
          data-testid="compact-row-status-not-started"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-bg-hover)',
            color: 'var(--color-text-muted)',
            borderColor: 'var(--color-border-subtle)',
          }}
        >
          {t.session.notStarted}
        </span>
      )
    }

    if (statusState.primaryStatus === 'ready' && sessionState === 'spec') {
      return (
        <span
          data-testid="compact-row-status-ready"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-green-bg)',
            color: 'var(--color-accent-green-light)',
            borderColor: 'var(--color-accent-green-border)',
          }}
        >
          {t.session.ready}
        </span>
      )
    }

    if (statusState.primaryStatus === 'running') {
      const runningLabel = sessionState === 'spec' ? t.session.clarifying : 'Active'
      return (
        <span
          data-testid="compact-row-status-running"
          className="inline-flex items-center"
          aria-label={runningLabel}
          title={runningLabel}
        >
          {sessionState === 'spec' ? t.session.clarifying : <ProgressIndicator size="sm" />}
        </span>
      )
    }

    if (statusState.primaryStatus === 'ready') {
      return null
    }

    return null
  })()

  const metadataBadges = (
    <>
      {s.issue_number && s.issue_url && (
        <MetadataLinkBadge
          label={`#${s.issue_number}`}
          title={`Open issue #${s.issue_number}`}
          tone="issue"
          url={s.issue_url}
          onOpen={handleOpenBadgeUrl}
        >
          <VscIssues className="w-3 h-3" />
        </MetadataLinkBadge>
      )}
      {s.pr_number && s.pr_url && (
        <MetadataLinkBadge
          label={`PR #${s.pr_number}`}
          title={`Open PR #${s.pr_number}`}
          tone="pr"
          url={s.pr_url}
          onOpen={handleOpenBadgeUrl}
        >
          <VscGitPullRequest className="w-3 h-3" />
        </MetadataLinkBadge>
      )}
      {s.pr_number && <PrStateBadge state={s.pr_state} />}
    </>
  )

  return (
    <div className="relative">
      {!hideTreeConnector && (
        <>
          <div
            data-testid="compact-row-tree-connector-line"
            className={clsx(
              'absolute -left-4 top-1/2 w-4 h-px',
              isConsolidationSourceHighlighted
                ? 'border-t border-dashed border-[rgba(var(--color-border-strong-rgb),0.8)]'
                : 'bg-[rgba(var(--color-border-strong-rgb),0.5)]',
            )}
          />
          <div
            data-testid="compact-row-tree-connector-dot"
            className={clsx(
              'absolute top-1/2 w-2 h-2 rounded-full border',
              isSelected
                ? 'bg-[var(--color-accent-cyan)] border-[var(--color-accent-cyan-border)]'
                : isConsolidationSourceHighlighted
                  ? 'bg-[var(--color-accent-purple)] border-[var(--color-accent-purple-border)]'
                  : 'bg-[var(--color-bg-hover)] border-[var(--color-border-strong)]',
            )}
            style={{ left: '-14px', transform: 'translate(-50%, -50%)' }}
          />
        </>
      )}

      <div
        role="button"
        tabIndex={isBusy ? -1 : 0}
        aria-disabled={isBusy}
        aria-busy={isBusy}
        data-testid="compact-version-row"
        data-session-id={s.session_id}
        data-session-selected={isSelected ? 'true' : 'false'}
        onClick={() => {
          if (isBusy) return
          onSelect(s.session_id)
        }}
        onKeyDown={(event) => {
          if (isBusy) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(s.session_id)
          }
        }}
        onMouseEnter={() => onHover?.(s.session_id)}
        onMouseLeave={() => onHover?.(null)}
        className={clsx(
          'group relative flex w-full min-h-[52px] overflow-hidden text-left rounded-md border transition-all duration-300',
          surface.className,
          isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer',
        )}
        style={rowStyle}
        aria-label={`Select session ${s.display_name ?? s.session_id}`}
      >
        <div
          data-testid="compact-row-accent"
          className={clsx('w-[4px] flex-shrink-0 self-stretch', statusState.isActivelyRunning && 'session-status-pulse')}
          style={{ width: '4px', backgroundColor: colorScheme.DEFAULT }}
        />
        <div
          data-testid="compact-row-version-index"
          className="flex h-auto flex-shrink-0 items-center justify-center"
          style={{
            width: '52px',
            ...sessionText.title,
            color: colorScheme.light,
          }}
        >
          {versionIndexLabel}
        </div>
        <div data-testid="compact-row-body" className="flex min-w-0 flex-1 flex-col gap-[5px] px-2.5 py-[7px]">
          <span
            data-testid="compact-row-agent-chip"
            className="inline-flex h-4 w-fit items-center rounded border px-1.5 py-[2px]"
            style={{
              ...sessionText.badge,
              backgroundColor: sessionState === 'spec' ? 'var(--color-accent-amber-bg)' : colorScheme.bg,
              color: sessionState === 'spec' ? 'var(--color-accent-amber-light)' : colorScheme.light,
              borderColor: sessionState === 'spec' ? 'var(--color-accent-amber-border)' : colorScheme.border,
            }}
            title={agentKey ? `Agent: ${agentKey}` : undefined}
          >
            {agentLabel}
          </span>

          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden" data-testid="compact-row-stats">
            <div data-testid="compact-stat-dirty">
              {showDirtyIndicator ? (
                <UncommittedIndicator
                  className="h-4 flex-shrink-0 px-1.5 py-[2px]"
                  count={dirtyFilesCount}
                  label={`${dirtyFilesCount} dirty`}
                  sessionName={s.display_name ?? s.session_id}
                  samplePaths={s.top_uncommitted_paths}
                  tone="neutral"
                  style={{
                    ...sessionText.badge,
                    color: 'var(--color-accent-amber-light)',
                    backgroundColor: 'var(--color-accent-amber-bg)',
                    borderColor: 'var(--color-accent-amber-border)',
                  }}
                  dotColor="var(--color-accent-amber)"
                />
              ) : (
                <span
                  className="inline-flex h-4 items-center rounded border px-1.5 py-[2px]"
                  style={{
                    ...sessionText.badge,
                    backgroundColor: 'var(--color-bg-hover)',
                    color: 'var(--color-text-tertiary)',
                    borderColor: 'var(--color-border-subtle)',
                  }}
                >
                  clean
                </span>
              )}
            </div>
            <span
              data-testid="compact-row-ahead-chip"
              className="inline-flex h-4 flex-shrink-0 items-center rounded border px-1.5 py-[2px]"
              style={{
                ...sessionText.badge,
                backgroundColor: 'var(--color-bg-hover)',
                color: 'var(--color-text-tertiary)',
                borderColor: 'var(--color-border-subtle)',
              }}
            >
              {commitsAheadCount} ahead
            </span>
            <span
              data-testid="compact-row-diff-chip"
              className="inline-flex h-4 min-w-0 flex-shrink items-center rounded border px-1.5 py-[2px]"
              title={`${filesChanged} files · +${additions} -${deletions}`}
              style={{
                ...sessionText.badge,
                fontFamily: theme.fontFamily.mono,
                backgroundColor: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
                borderColor: 'var(--color-border-subtle)',
              }}
            >
              {filesChanged}f +{additions} -{deletions}
            </span>
            {metadataBadges}
          </div>

          {consolidationSources.length > 0 && (
            <div
              data-testid="compact-row-consolidation-sources"
              className="flex items-center gap-1.5 pl-0.5"
              style={sessionText.meta}
            >
              <span style={{ color: 'var(--color-text-muted)' }}>←</span>
              <div className="flex items-center -space-x-1">
                {consolidationSources.map(source => (
                  <div
                    key={source.sourceId}
                    data-testid="compact-row-consolidation-source-dot"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-bg-primary)]"
                    style={{
                      backgroundColor: source.colorScheme.DEFAULT,
                      zIndex: source.zIndex,
                    }}
                    title={source.title}
                  />
                ))}
              </div>
            </div>
          )}

          {isSelected && (
            <div data-testid="compact-row-actions" className="flex justify-end" onClick={(event) => event.stopPropagation()}>
              <SessionActions
                sessionState={sessionState as 'spec' | 'processing' | 'running'}
                isReadyToMerge={isReadyToMerge}
                sessionId={s.session_id}
                sessionSlug={s.session_id}
                worktreePath={s.worktree_path}
                branch={s.branch}
                defaultBranch={s.parent_branch ?? undefined}
                showPromoteIcon={showPromoteIcon}
                onCreatePullRequest={onCreatePullRequest}
                onCreateGitlabMr={onCreateGitlabMr}
                prNumber={s.pr_number}
                prUrl={s.pr_url}
                onRunSpec={onRunDraft}
                onRefineSpec={onRefineSpec}
                onDeleteSpec={onDeleteSpec}
                onImprovePlanSpec={onImprovePlanSpec}
                canImprovePlanSpec={s.spec_stage === 'ready' && !s.improve_plan_round_id}
                improvePlanActive={Boolean(s.improve_plan_round_id)}
                improvePlanStarting={improvePlanStartingSessionId === s.session_id}
                onCancel={onCancel}
                onConvertToSpec={onConvertToSpec}
                onPromoteVersion={onPromoteVersion}
                onPromoteVersionHover={onPromoteVersionHover}
                onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
                onReset={onReset}
                onSwitchModel={onSwitchModel}
                isResetting={isResetting}
                onMerge={onMerge}
                onQuickMerge={onQuickMerge}
                disableMerge={disableMerge}
                mergeStatus={mergeStatus}
                mergeConflictingPaths={s.merge_conflicting_paths}
                hasUncommittedChanges={s.has_uncommitted_changes}
                onLinkPr={onLinkPr}
                epic={s.epic}
                onEpicChange={handleEpicChange}
                epicDisabled={isBusy}
                issueNumber={s.issue_number}
                issueUrl={s.issue_url}
                onPostToForge={onPostToForge}
              />
            </div>
          )}
        </div>
        <div
          data-testid="compact-row-right-stack"
          className="flex flex-shrink-0 flex-col items-end justify-between py-[7px] pr-2.5"
          style={{ width: '62px' }}
        >
              {statusIndicator}
              {index < 8 && (
                <span
                  data-testid="compact-row-shortcut"
                  className="mt-auto rounded border px-1.5 py-[1px]"
                  title={`Switch to session (${resolveSwitchSessionShortcut(index, shortcuts, modKey)})`}
                  style={{
                    ...sessionText.badge,
                    fontFamily: theme.fontFamily.mono,
                    color: 'var(--color-text-muted)',
                    backgroundColor: 'var(--color-bg-hover)',
                    borderColor: 'var(--color-border-subtle)',
                  }}
                >
                  {resolveSwitchSessionShortcut(index, shortcuts, modKey)}
                </span>
              )}
        </div>
      </div>
    </div>
  )
})
