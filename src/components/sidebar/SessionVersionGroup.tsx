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
  isMarkReadyDisabled?: boolean
  isSessionBusy?: (sessionId: string) => boolean
  onConsolidate?: (group: SessionVersionGroupType) => void
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
  isMarkReadyDisabled = false,
  isSessionBusy,
  onConsolidate,
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
        isMarkReadyDisabled={isMarkReadyDisabled}
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
  const hasConsolidationVersion = group.versions.some(v => v.session.info.is_consolidation)
  const sourceVersions = group.versions.filter(v => !v.session.info.is_consolidation)

  const hasMultipleVersions = group.versions.length >= 2
  const runningOrReviewedCount = sourceVersions.filter(v => {
    const state = v.session.info.session_state
    return state === 'running' || state === 'reviewed'
  }).length
  const canConsolidate = !hasConsolidationVersion && runningOrReviewedCount >= 2
  const hasRunning = group.versions.some(v => v.session.info.session_state === 'running')
  const maxTagLength = Math.max(
    ...group.versions.map(v => {
      const agent = (v.session.info.original_agent_type || '').toLowerCase()
      const vNum = v.session.info.version_number
      const text = vNum ? `v${vNum} · ${agent}` : agent
      return text.length
    })
  )
  const tagMinWidth = `${maxTagLength + 2}ch`
  const groupDescription = group.versions
    .map(version => (version.session.info.current_task || version.session.info.spec_content || '').trim())
    .find(Boolean) || undefined

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
                className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                style={hasSelectedVersion ? {
                  backgroundColor: 'var(--color-accent-blue-bg)',
                  color: 'var(--color-accent-blue-light)',
                  borderColor: 'var(--color-accent-blue-border)'
                } : {
                  backgroundColor: 'rgba(var(--color-bg-hover-rgb), 0.5)',
                  color: 'var(--color-text-secondary)',
                  borderColor: 'rgba(var(--color-border-subtle-rgb), 0.5)'
                }}
              >
                {group.versions.length}x
              </span>
            
            {/* Base branch indicator */}
            {(() => {
              const firstSession = group.versions[0]?.session?.info
              if (!firstSession) return null

              const baseBranch = firstSession.base_branch
              if (!baseBranch || baseBranch === 'main') return null

              return (
                <>
                  <span className="text-[var(--color-text-muted)] text-xs">|</span>
                  <span className="text-xs text-[var(--color-text-muted)]">← {baseBranch}</span>
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
                title={canConsolidate ? 'Consolidate versions' : 'Needs at least 2 running/reviewed sessions to consolidate'}
                data-testid="consolidate-versions-button"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM3 5v3.5a.5.5 0 0 0 .5.5H8v3h0V9h4.5a.5.5 0 0 0 .5-.5V5h-1v3H8.5V5h-1v3H4V5H3z" />
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
            <div className="relative pl-6">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-[rgba(var(--color-border-strong-rgb),0.5)]" />

              <div className="space-y-2">
                {group.versions.map((version, versionIndex) => {
                  const isSelected = (selection.kind === 'session' && selection.payload === version.session.info.session_id) ||
                    (isInSpecMode === true && isSpec(version.session.info) && currentSpecId === version.session.info.session_id)
                  const willBeDeleted = isPreviewingDeletion && hasSelectedVersion && !isSelected
                  const hoveredSession = group.versions.find(v => v.session.info.session_id === hoveredSessionId)?.session.info
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
                      isMarkReadyDisabled={isMarkReadyDisabled}
                      isBusy={isSessionBusy?.(version.session.info.session_id) ?? false}
                      onHover={setHoveredSessionId}
                      isHighlighted={isHighlighted}
                      isConsolidationSourceHighlighted={Boolean(isConsolidationSourceHighlighted)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
