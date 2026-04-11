import { memo, useCallback } from 'react'
import { clsx } from 'clsx'
import { useAtomValue } from 'jotai'
import { VscIssues, VscGitPullRequest } from 'react-icons/vsc'
import { SessionActions } from '../session/SessionActions'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { UncommittedIndicator } from '../common/UncommittedIndicator'
import { getAgentColorScheme } from '../../common/theme'
import type { MergeStatus } from '../../store/atoms/sessions'
import { lastAgentResponseMapAtom, agentResponseTickAtom } from '../../store/atoms/lastAgentResponse'
import { useEpics } from '../../hooks/useEpics'
import { useTranslation } from '../../common/i18n/useTranslation'
import type { SessionInfo, SessionMonitorStatus } from '../../types/session'
import { getSessionCardSurfaceClasses } from './SessionCard'
import { getAgentColorKey, MetadataLinkBadge, openMetadataLink, sessionText } from './sessionCardStyles'
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
}

export const CompactVersionRow = memo<CompactVersionRowProps>(({
  session,
  isSelected,
  hasFollowUpMessage,
  showPromoteIcon = false,
  tagMinWidth,
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
}) => {
  const {
    onSelect, onCancel,
    onConvertToSpec, onRunDraft, onRefineSpec, onDeleteSpec,
    onReset, onSwitchModel,
    onCreatePullRequest, onCreateGitlabMr,
    onMerge, onQuickMerge, onLinkPr,
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
  const versionLabel = s.is_consolidation
    ? `merge · ${agentKey}`
    : s.version_number
      ? `v${s.version_number} · ${agentKey}`
      : agentKey

  const agentColor = getAgentColorKey(agentKey)
  const colorScheme = getAgentColorScheme(agentColor)
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
          colorScheme: getAgentColorScheme(getAgentColorKey(sourceAgentKey)),
          zIndex: 10 - index,
        }
      }) ?? []
    : []

  const surface = getSessionCardSurfaceClasses({
    sessionState,
    isSelected,
    isReadyToMerge,
    isRunning: statusState.isActivelyRunning,
    isIdle: statusState.isIdle,
    isWaitingForInput: statusState.isWaitingForInput,
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

    if (statusState.primaryStatus === 'running') {
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

    if (statusState.primaryStatus === 'ready') {
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
          'group relative w-full text-left pl-3.5 pr-2.5 py-1.5 rounded-md border transition-all duration-300',
          surface.className,
          isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer',
        )}
        style={surface.style}
        aria-label={`Select session ${s.display_name ?? s.session_id}`}
      >
        {statusState.shouldShowStatusStrip && (() => {
          const stripColor = statusState.primaryStatus === 'blocked'
            ? 'var(--color-accent-red)'
            : statusState.isIdle
            ? 'var(--color-accent-yellow)'
            : statusState.isActivelyRunning
              ? 'var(--color-accent-blue)'
              : statusState.primaryStatus === 'not_started'
                ? 'var(--color-border-subtle)'
              : isReadyToMerge
                ? 'var(--color-accent-green)'
                : 'var(--color-border-subtle)'
          return (
            <div
              className={clsx('absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md', statusState.isActivelyRunning && 'session-status-pulse')}
              style={{ backgroundColor: stripColor }}
            />
          )
        })()}
        <div className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden" style={sessionText.meta}>
            {sessionState === 'spec' ? (
              <>
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
                {statusIndicator}
              </>
            ) : (
              <>
                {agentType && (
                  <span
                    className="inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-[1px] rounded border"
                    style={{
                      ...sessionText.badge,
                      minWidth: tagMinWidth,
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
                    {versionLabel}
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
                    className="flex items-center justify-center w-4 h-4 rounded-full border border-[var(--color-bg-primary)]"
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
                readinessChecks={s.ready_to_merge_checks}
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
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
