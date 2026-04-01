import { memo, useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { useAtomValue } from 'jotai'
import { VscIssues, VscGitPullRequest } from 'react-icons/vsc'
import { SessionActions } from '../session/SessionActions'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { UncommittedIndicator } from '../common/UncommittedIndicator'
import { getAgentColorScheme } from '../../common/theme'
import type { MergeStatus } from '../../store/atoms/sessions'
import { lastAgentResponseMapAtom, agentResponseTickAtom } from '../../store/atoms/lastAgentResponse'
import { mapSessionUiState } from '../../utils/sessionFilters'
import { useEpics } from '../../hooks/useEpics'
import { useTranslation } from '../../common/i18n/useTranslation'
import type { SessionInfo, SessionMonitorStatus } from '../../types/session'
import { getSessionCardSurfaceClasses } from './SessionCard'
import { getAgentColorKey, MetadataLinkBadge, openMetadataLink, sessionText } from './sessionCardStyles'

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
  willBeDeleted?: boolean
  isPromotionPreview?: boolean
  onSelect: (sessionId: string) => void
  onMarkReady: (sessionId: string) => void
  onUnmarkReady: (sessionId: string) => void
  onCancel: (sessionId: string, hasUncommitted: boolean) => void
  onConvertToSpec?: (sessionId: string) => void
  onRunDraft?: (sessionId: string) => void
  onRefineSpec?: (sessionId: string) => void
  onDeleteSpec?: (sessionId: string) => void
  onPromoteVersion?: () => void
  onPromoteVersionHover?: () => void
  onPromoteVersionHoverEnd?: () => void
  onReset?: (sessionId: string) => void
  onRestartTerminals?: (sessionId: string) => void
  onSwitchModel?: (sessionId: string) => void
  onCreatePullRequest?: (sessionId: string) => void
  onCreateGitlabMr?: (sessionId: string) => void
  isResetting?: boolean
  isRunning?: boolean
  onMerge?: (sessionId: string) => void
  onQuickMerge?: (sessionId: string) => void
  disableMerge?: boolean
  mergeStatus?: MergeStatus
  isMarkReadyDisabled?: boolean
  isBusy?: boolean
  onLinkPr?: (sessionId: string, prNumber: number, prUrl: string) => void
  onHover?: (sessionId: string | null) => void
  isHighlighted?: boolean
  isConsolidationSourceHighlighted?: boolean
}

export const CompactVersionRow = memo<CompactVersionRowProps>(({
  session,
  isSelected,
  hasFollowUpMessage,
  showPromoteIcon = false,
  willBeDeleted = false,
  isPromotionPreview = false,
  onSelect,
  onMarkReady,
  onUnmarkReady,
  onCancel,
  onConvertToSpec,
  onRunDraft,
  onRefineSpec,
  onDeleteSpec,
  onPromoteVersion,
  onPromoteVersionHover,
  onPromoteVersionHoverEnd,
  onReset,
  onRestartTerminals,
  onSwitchModel,
  onCreatePullRequest,
  onCreateGitlabMr,
  isResetting = false,
  isRunning = false,
  onMerge,
  onQuickMerge,
  disableMerge = false,
  mergeStatus = 'idle',
  isMarkReadyDisabled = false,
  isBusy = false,
  onLinkPr,
  onHover,
  isHighlighted = false,
  isConsolidationSourceHighlighted = false,
}) => {
  const { t } = useTranslation()
  const { setItemEpic } = useEpics()
  useAtomValue(lastAgentResponseMapAtom)
  useAtomValue(agentResponseTickAtom)

  const s = session.info
  const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
  const deletions = s.diff_stats?.deletions || 0
  const filesChanged = s.diff_stats?.files_changed || 0
  const isBlocked = s.is_blocked || false
  const isReadyToMerge = s.ready_to_merge || false
  const sessionState = mapSessionUiState(s)
  const isReviewedState = sessionState === 'reviewed'
  const hasUncommittedChanges = !!s.has_uncommitted_changes
  const dirtyFilesCount =
    s.dirty_files_count
    ?? (hasUncommittedChanges ? Math.max(s.top_uncommitted_paths?.length ?? 0, 1) : 0)
  const showDirtyIndicator = hasUncommittedChanges || dirtyFilesCount > 0
  const commitsAheadCount = s.commits_ahead_count ?? 0
  const canCollapse = sessionState !== 'spec'
  const [isExpanded, setIsExpanded] = useState<boolean>(isSelected || !canCollapse)
  const showExpandedActions = !canCollapse || isExpanded
  const agentType = s.original_agent_type as SessionInfo['original_agent_type']
  const agentKey = (agentType || '').toLowerCase()

  useEffect(() => {
    if (!canCollapse) {
      setIsExpanded(true)
      return
    }
    if (isSelected) {
      setIsExpanded(true)
    }
  }, [canCollapse, isSelected])

  const agentColor = getAgentColorKey(agentKey)
  const colorScheme = getAgentColorScheme(agentColor)

  const surface = getSessionCardSurfaceClasses({
    sessionState,
    isSelected,
    isReviewedState,
    isRunning: Boolean(isRunning),
    isIdle: !!s.attention_required,
    hasFollowUpMessage,
    willBeDeleted,
    isPromotionPreview,
    isHighlighted,
  })

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
    if (isBlocked) {
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

    if (isReviewedState) {
      return (
        <span
          data-testid="compact-row-status-reviewed"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-green-bg)',
            color: 'var(--color-accent-green-light)',
            borderColor: 'var(--color-accent-green-border)',
          }}
        >
          {t.session.reviewed}
        </span>
      )
    }

    if (s.attention_required) {
      return (
        <span
          data-testid="compact-row-status-idle"
          className="inline-flex items-center px-1.5 py-[1px] rounded border"
          style={{
            ...sessionText.badge,
            backgroundColor: 'var(--color-accent-amber-bg)',
            color: 'var(--color-accent-amber-light)',
            borderColor: 'var(--color-accent-amber-border)',
          }}
        >
          {t.session.idle}
        </span>
      )
    }

    if (sessionState === 'running' && !isReadyToMerge) {
      return (
        <span
          data-testid="compact-row-status-running"
          className="inline-flex items-center"
          aria-label="Active"
          title="Active"
        >
          <ProgressIndicator size="sm" />
        </span>
      )
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
    </>
  )

  return (
    <div className="relative">
      <div
        className={clsx(
          'absolute -left-4 top-1/2 w-4 h-px',
          isConsolidationSourceHighlighted
            ? 'border-t border-dashed border-[rgba(var(--color-border-strong-rgb),0.8)]'
            : 'bg-[rgba(var(--color-border-strong-rgb),0.5)]',
        )}
      />
      <div
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
          if (canCollapse) {
            setIsExpanded((previous) => !previous)
          }
          onSelect(s.session_id)
        }}
        onKeyDown={(event) => {
          if (isBusy) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (canCollapse) {
              setIsExpanded((previous) => !previous)
            }
            onSelect(s.session_id)
          }
        }}
        onMouseEnter={() => onHover?.(s.session_id)}
        onMouseLeave={() => onHover?.(null)}
        className={clsx(
          'group relative w-full text-left pl-3.5 pr-2.5 py-1.5 rounded-md border transition-all duration-300',
          surface.className,
          isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer',
        )}
        style={surface.style}
        aria-label={`Select session ${s.display_name ?? s.session_id}`}
      >
        {sessionState !== 'spec' && (() => {
          const isIdle = !!s.attention_required
          const isActivelyRunning = !isIdle && sessionState === 'running' && !isReadyToMerge
          const stripColor = isIdle
            ? 'var(--color-accent-yellow)'
            : isActivelyRunning
              ? 'var(--color-accent-blue)'
              : isReviewedState
                ? 'var(--color-accent-green)'
                : 'var(--color-border-subtle)'
          return (
            <div
              className={clsx('absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md', isActivelyRunning && 'session-status-pulse')}
              style={{ backgroundColor: stripColor }}
            />
          )
        })()}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden" style={sessionText.meta}>
            {sessionState === 'spec' ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
                style={{
                  ...sessionText.badge,
                  backgroundColor: 'var(--color-accent-amber-bg)',
                  color: 'var(--color-accent-amber-light)',
                  borderColor: 'var(--color-accent-amber-border)',
                }}
              >
                {t.session.spec}
              </span>
            ) : (
              <>
                {agentType && (
                  <span
                    className="inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-[1px] rounded border"
                    style={{
                      ...sessionText.badge,
                      backgroundColor: colorScheme.bg,
                      color: colorScheme.light,
                      borderColor: colorScheme.border,
                    }}
                    title={`Agent: ${agentKey}`}
                  >
                    <span
                      className="w-1 h-1 rounded-full"
                      style={{ backgroundColor: colorScheme.DEFAULT }}
                    />
                    {s.version_number ? `v${s.version_number} · ${agentKey}` : agentKey}
                  </span>
                )}
                {showDirtyIndicator ? (
                  <div data-testid="compact-stat-dirty">
                    <UncommittedIndicator
                      className="flex-shrink-0"
                      count={dirtyFilesCount}
                      sessionName={s.display_name ?? s.session_id}
                      samplePaths={s.top_uncommitted_paths}
                    />
                  </div>
                ) : null}
                <span
                  className="inline-flex items-center gap-1"
                  style={sessionText.meta}
                  title={`${commitsAheadCount} ahead · ${filesChanged} files · +${additions} -${deletions}`}
                >
                  <span>{commitsAheadCount} ahead</span>
                  <span>{filesChanged} files</span>
                  <span style={{ color: 'var(--color-accent-green-light)' }}>+{additions}</span>
                  <span style={{ color: 'var(--color-accent-red-light)' }}>-{deletions}</span>
                </span>
                {statusIndicator}
              </>
            )}
            {metadataBadges}
          </div>

          {showExpandedActions && (
            <div className="flex-shrink-0" onClick={(event) => event.stopPropagation()}>
              <SessionActions
                sessionState={sessionState as 'spec' | 'running' | 'reviewed'}
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
                onMarkReviewed={onMarkReady}
                onUnmarkReviewed={onUnmarkReady}
                onCancel={onCancel}
                onConvertToSpec={onConvertToSpec}
                onPromoteVersion={onPromoteVersion}
                onPromoteVersionHover={onPromoteVersionHover}
                onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
                onReset={onReset}
                onRestartTerminals={onRestartTerminals}
                onSwitchModel={onSwitchModel}
                isResetting={isResetting}
                onMerge={onMerge}
                onQuickMerge={onQuickMerge}
                disableMerge={disableMerge}
                mergeStatus={mergeStatus}
                mergeConflictingPaths={s.merge_conflicting_paths}
                isMarkReadyDisabled={isMarkReadyDisabled}
                hasUncommittedChanges={s.has_uncommitted_changes}
                onLinkPr={onLinkPr}
                epic={s.epic}
                onEpicChange={handleEpicChange}
                epicDisabled={isBusy}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
