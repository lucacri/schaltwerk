import { memo, useState } from 'react'
import { clsx } from 'clsx'
import { SessionCard } from './SessionCard'
import { CompactVersionRow } from './CompactVersionRow'
import { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { isSpec } from '../../utils/sessionFilters'
import { SessionSelection } from '../../hooks/useSessionManagement'
import type { MergeStatus } from '../../store/atoms/sessions'
import { sessionText } from './sessionCardStyles'

interface SessionVersionGroupProps {
  group: SessionVersionGroupType
  selection: {
    kind: string
    payload?: string
  }
  startIndex: number

  hasFollowUpMessage: (sessionId: string) => boolean
  onSelectBestVersion?: (groupBaseName: string, selectedSessionId: string) => void
  resettingSelection?: SessionSelection | null
  isInSpecMode?: boolean
  currentSpecId?: string | null
  isSessionRunning?: (sessionId: string) => boolean
  isMergeDisabled?: (sessionId: string) => boolean
  getMergeStatus?: (sessionId: string) => MergeStatus
  isSessionBusy?: (sessionId: string) => boolean
  onConsolidate?: (group: SessionVersionGroupType) => void
  onTriggerConsolidationJudge?: (roundId: string, early?: boolean) => void
  onConfirmConsolidationWinner?: (roundId: string, winnerSessionId: string) => void
  onTerminateAll?: (group: SessionVersionGroupType) => void
}

export const SessionVersionGroup = memo<SessionVersionGroupProps>(({
  group,
  selection,
  startIndex,

  hasFollowUpMessage,
  onSelectBestVersion,
  resettingSelection,
  isInSpecMode,
  currentSpecId,
  isSessionRunning,
  isMergeDisabled,
  getMergeStatus,
  isSessionBusy,
  onConsolidate,
  onTriggerConsolidationJudge,
  onConfirmConsolidationWinner,
  onTerminateAll
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isPreviewingDeletion, setIsPreviewingDeletion] = useState(false)
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)

   // If it's not a version group, render the single session normally
   if (!group.isVersionGroup) {
     const session = group.versions[0]
     // Check if this session is selected either as a normal session or as a spec in spec mode
      const isSelected = (selection.kind === 'session' && selection.payload === session.session.info.session_id) ||
                          (isInSpecMode === true && isSpec(session.session.info) && currentSpecId === session.session.info.session_id)

    const isResettingForSession = resettingSelection?.kind === 'session'
      && resettingSelection.payload === session.session.info.session_id

    return (
      <SessionCard
        session={session.session}
        index={startIndex}
        isSelected={isSelected}

        hasFollowUpMessage={hasFollowUpMessage(session.session.info.session_id)}
        isWithinVersionGroup={false}
        showPromoteIcon={false}
        isResetting={isResettingForSession}
        isRunning={isSessionRunning?.(session.session.info.session_id) || false}
        disableMerge={isMergeDisabled?.(session.session.info.session_id) || false}
        mergeStatus={getMergeStatus?.(session.session.info.session_id) ?? 'idle'}
        isBusy={isSessionBusy?.(session.session.info.session_id) ?? false}
        siblings={group.versions.map(v => v.session.info)}
        onHover={setHoveredSessionId}
        isHighlighted={hoveredSessionId === session.session.info.session_id}
      />
    )
  }

  // Check if any version in the group is selected
  const selectedVersionInGroup = group.versions.find(
    v => selection.kind === 'session' && selection.payload === v.session.info.session_id
  )
  const hasSelectedVersion = !!selectedVersionInGroup
  const consolidationSessions = group.versions.filter(v => v.session.info.is_consolidation)
  const consolidationCandidates = consolidationSessions.filter(v => v.session.info.consolidation_role !== 'judge')
  const judgeSessions = consolidationSessions.filter(v => v.session.info.consolidation_role === 'judge')
  const hasConsolidationVersion = consolidationCandidates.length > 0
  const sourceVersions = group.versions.filter(v => !v.session.info.is_consolidation)
  const siblingInfos = group.versions.map(v => v.session.info)
  const hoveredSession = group.versions.find(v => v.session.info.session_id === hoveredSessionId)?.session.info
  const latestJudge = [...judgeSessions]
    .sort((a, b) => {
      const aTs = a.session.info.last_modified_ts
        ?? (Date.parse(a.session.info.last_modified ?? a.session.info.created_at ?? '') || 0)
      const bTs = b.session.info.last_modified_ts
        ?? (Date.parse(b.session.info.last_modified ?? b.session.info.created_at ?? '') || 0)
      return bTs - aTs
    })
    .find(v => v.session.info.consolidation_recommended_session_id)
  const activeRoundId = consolidationCandidates[0]?.session.info.consolidation_round_id
  const selectedCandidate = selectedVersionInGroup?.session.info.is_consolidation
    && selectedVersionInGroup.session.info.consolidation_role !== 'judge'
      ? selectedVersionInGroup.session.info
      : null
  const confirmWinnerSessionId = latestJudge
    ? (selectedCandidate?.session_id ?? latestJudge.session.info.consolidation_recommended_session_id ?? null)
    : null

  const hasMultipleVersions = group.versions.length >= 2
  const activeVersionCount = sourceVersions.filter(v => {
    const state = v.session.info.session_state
    return state === 'running'
  }).length
  const canConsolidate = !hasConsolidationVersion && activeVersionCount >= 2
  const hasRunning = group.versions.some(v => v.session.info.session_state === 'running')
  const maxTagLength = Math.max(
    ...group.versions.map(v => {
      const agent = (v.session.info.original_agent_type || '').toLowerCase()
      const vNum = v.session.info.version_number
      const text = v.session.info.is_consolidation
        ? `merge · ${agent}`
        : vNum
          ? `v${vNum} · ${agent}`
          : agent
      return text.length
    })
  )
  const tagMinWidth = `${maxTagLength + 2}ch`
  const groupDescription = group.versions
    .map(version => (version.session.info.current_task || version.session.info.spec_content || '').trim())
    .find(Boolean) || undefined
  const renderVersionRow = (
    version: SessionVersionGroupType['versions'][number],
    versionIndex: number,
    hideTreeConnector = false,
  ) => {
    const isSelected = (selection.kind === 'session' && selection.payload === version.session.info.session_id) ||
      (isInSpecMode === true && isSpec(version.session.info) && currentSpecId === version.session.info.session_id)
    const willBeDeleted = isPreviewingDeletion && hasSelectedVersion && !isSelected
    const isConsolidationSourceHighlighted = hoveredSession?.is_consolidation
      ? hoveredSession.consolidation_sources?.includes(version.session.info.session_id)
      : false
    const isHighlighted = (version.session.info.is_consolidation && version.session.info.consolidation_sources?.includes(hoveredSessionId || ''))
      || hoveredSessionId === version.session.info.session_id

    return (
      <CompactVersionRow
        key={version.session.info.session_id}
        session={version.session}
        index={startIndex + versionIndex}
        isSelected={isSelected}
        tagMinWidth={tagMinWidth}
        hasFollowUpMessage={hasFollowUpMessage(version.session.info.session_id)}
        showPromoteIcon={isSelected}
        willBeDeleted={willBeDeleted}
        isPromotionPreview={isPreviewingDeletion && isSelected}
        onPromoteVersion={() => {
          if (onSelectBestVersion) {
            onSelectBestVersion(group.baseName, version.session.info.session_id)
          }
        }}
        onPromoteVersionHover={() => setIsPreviewingDeletion(true)}
        onPromoteVersionHoverEnd={() => setIsPreviewingDeletion(false)}
        isResetting={resettingSelection?.kind === 'session'
          && resettingSelection.payload === version.session.info.session_id}
        isRunning={isSessionRunning?.(version.session.info.session_id) || false}
        disableMerge={isMergeDisabled?.(version.session.info.session_id) || false}
        mergeStatus={getMergeStatus?.(version.session.info.session_id) ?? 'idle'}
        isBusy={isSessionBusy?.(version.session.info.session_id) ?? false}
        siblings={siblingInfos}
        hideTreeConnector={hideTreeConnector}
        onHover={setHoveredSessionId}
        isHighlighted={isHighlighted}
        isConsolidationSourceHighlighted={Boolean(isConsolidationSourceHighlighted)}
      />
    )
  }

  return (
    <div className="mb-2 relative">
      {/* Version group container with subtle background */}
      <div className={clsx(
        'rounded-lg border transition-all duration-200'
      )}
      style={hasSelectedVersion ? {
        borderColor: 'var(--color-accent-blue-border)',
        backgroundColor: 'var(--color-accent-blue-bg)'
      } : {
        borderColor: 'rgba(var(--color-border-subtle-rgb), 0.5)',
        backgroundColor: 'rgba(var(--color-bg-tertiary-rgb), 0.2)'
      }}>
        {/* Group header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-t-md border-b transition-all duration-200'
          )}
          style={hasSelectedVersion ? {
            borderBottomColor: 'var(--color-accent-blue-border)',
            backgroundColor: 'var(--color-accent-blue-bg)'
          } : {
            borderBottomColor: 'rgba(var(--color-border-subtle-rgb), 0.3)',
            backgroundColor: 'rgba(var(--color-bg-elevated-rgb), 0.3)'
          }}
          onMouseEnter={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-hover-rgb), 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-elevated-rgb), 0.3)';
            }
          }}
          title={`${group.baseName} (${group.versions.length} versions) - Click to expand/collapse`}
        >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <svg
                className={clsx('w-3 h-3 flex-shrink-0 transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="truncate" style={sessionText.title}>{group.baseName}</span>
              <span
                className="px-2 py-0.5 rounded-full flex-shrink-0"
                style={hasSelectedVersion ? {
                  ...sessionText.badge,
                  backgroundColor: 'var(--color-accent-blue-bg)',
                  color: 'var(--color-accent-blue-light)',
                  borderColor: 'var(--color-accent-blue-border)'
                } : {
                  ...sessionText.badge,
                  backgroundColor: 'rgba(var(--color-bg-hover-rgb), 0.5)',
                  color: 'var(--color-text-secondary)',
                  borderColor: 'rgba(var(--color-border-subtle-rgb), 0.5)'
                }}
              >
                {group.versions.length}x
              </span>

            {(() => {
              const firstSession = group.versions[0]?.session?.info
              if (!firstSession) return null

              const baseBranch = firstSession.base_branch
              if (!baseBranch || baseBranch === 'main') return null

              return (
                <>
                  <span style={{ ...sessionText.meta, color: 'var(--color-text-muted)' }}>|</span>
                  <span style={{ ...sessionText.meta, color: 'var(--color-text-muted)' }}>← {baseBranch}</span>
                </>
              )
            })()}
            </div>
            {groupDescription && (
              <div
                className="truncate mt-0.5 pl-5"
                style={sessionText.meta}
                title={groupDescription}
              >
                {groupDescription}
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-1 justify-end overflow-hidden flex-nowrap flex-shrink-0"
            data-testid="version-group-status"
          >
            {hasMultipleVersions && onConsolidate && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canConsolidate) return
                  onConsolidate(group)
                }}
                disabled={!canConsolidate}
                className="p-1 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => {
                  if (!canConsolidate) return
                  e.currentTarget.style.color = 'var(--color-accent-purple-light)'
                }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                title={canConsolidate ? 'Consolidate versions' : 'Needs at least 2 running sessions to consolidate'}
                data-testid="consolidate-versions-button"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM3 5v3.5a.5.5 0 0 0 .5.5H8v3h0V9h4.5a.5.5 0 0 0 .5-.5V5h-1v3H8.5V5h-1v3H4V5H3z" />
                </svg>
              </button>
            )}
            {activeRoundId && onTriggerConsolidationJudge && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTriggerConsolidationJudge(activeRoundId, consolidationCandidates.some(candidate => !candidate.session.info.consolidation_report))
                }}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-purple-light)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                title={latestJudge ? 'Re-run consolidation judge' : 'Run consolidation judge'}
                data-testid="trigger-consolidation-judge-button"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1.5a3.5 3.5 0 0 0-3.328 2.422l-.11.328H3.25a2.75 2.75 0 0 0 0 5.5h1.5v-1.5h-1.5a1.25 1.25 0 1 1 0-2.5h2.408l.17-.504A2 2 0 1 1 9.5 6h-1l2.25 2.25L13 6h-1a4 4 0 0 0-4-4.5ZM5 10h6v1.5H5zm0 3h6v1.5H5z" />
                </svg>
              </button>
            )}
            {activeRoundId && confirmWinnerSessionId && onConfirmConsolidationWinner && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onConfirmConsolidationWinner(activeRoundId, confirmWinnerSessionId)
                }}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-green-light)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                title={selectedCandidate ? 'Confirm selected consolidation winner' : 'Confirm judge recommendation'}
                data-testid="confirm-consolidation-winner-button"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 3.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 8.28a.75.75 0 1 1 1.06-1.06L6 9.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
              </button>
            )}
            {hasRunning && onTerminateAll && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTerminateAll(group)
                }}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-red-light)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                title="Terminate all running sessions"
                data-testid="terminate-group-button"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 13.5v-11z" />
                </svg>
              </button>
            )}
          </div>
        </div>
        </button>

        {isExpanded && (
          <div className="p-2 pt-2">
            {sourceVersions.length > 0 && (
              <div className="relative pl-6" data-testid="version-group-source-tree">
                <div className="absolute left-2 top-2 bottom-2 w-px bg-[rgba(var(--color-border-strong-rgb),0.5)]" />

                <div className="space-y-2">
                  {sourceVersions.map((version, versionIndex) => renderVersionRow(version, versionIndex))}
                </div>
              </div>
            )}

            {latestJudge?.session.info.consolidation_recommended_session_id && (
              <div className={clsx(sourceVersions.length > 0 && 'mt-3')}>
                <div
                  className="rounded-md px-3 py-2"
                  style={{
                    ...sessionText.meta,
                    border: '1px solid var(--color-accent-purple-border)',
                    backgroundColor: 'rgb(var(--color-accent-purple-rgb) / 0.08)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Judge recommends{' '}
                  <span style={{ color: 'var(--color-text-primary)' }}>
                    {latestJudge.session.info.consolidation_recommended_session_id}
                  </span>
                </div>
              </div>
            )}

            {consolidationCandidates.length > 0 && (
              <div className={clsx(sourceVersions.length > 0 && 'mt-3')}>
                {sourceVersions.length > 0 && (
                  <div
                    data-testid="version-group-consolidation-divider"
                    className="mx-1 mb-3 border-t"
                    style={{ borderTopColor: 'rgb(var(--color-accent-purple-rgb) / 0.3)' }}
                  />
                )}
                <div
                  data-testid="version-group-consolidation"
                  className="rounded-md pl-3"
                  style={{
                    borderLeft: '3px solid var(--color-accent-purple)',
                    backgroundColor: 'rgb(var(--color-accent-purple-rgb) / 0.05)',
                  }}
                >
                  <div className="space-y-2 py-1">
                    {consolidationCandidates.map((candidate, index) => renderVersionRow(candidate, sourceVersions.length + index, true))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
