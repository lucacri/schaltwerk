import { memo, type ReactNode, useState } from 'react'
import { clsx } from 'clsx'
import { SessionCard } from './SessionCard'
import { CompactVersionRow } from './CompactVersionRow'
import { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { isSpec } from '../../utils/sessionFilters'
import { SessionSelection } from '../../hooks/useSessionManagement'
import type { MergeStatus } from '../../store/atoms/sessions'
import { sessionText } from './sessionCardStyles'
import { getSidebarSessionStatus } from './sessionStatus'
import { useTranslation } from '../../common/i18n/useTranslation'

type HeaderStatusTone = 'neutral' | 'blue' | 'green' | 'yellow' | 'amber' | 'red'

const headerStatusToneStyles: Record<HeaderStatusTone, { backgroundColor: string; color: string; borderColor: string; dotColor: string }> = {
  neutral: {
    backgroundColor: 'var(--color-bg-hover)',
    color: 'var(--color-text-muted)',
    borderColor: 'var(--color-border-subtle)',
    dotColor: 'var(--color-text-muted)',
  },
  blue: {
    backgroundColor: 'var(--color-accent-blue-bg)',
    color: 'var(--color-accent-blue-light)',
    borderColor: 'var(--color-accent-blue-border)',
    dotColor: 'var(--color-accent-blue)',
  },
  green: {
    backgroundColor: 'var(--color-accent-green-bg)',
    color: 'var(--color-accent-green-light)',
    borderColor: 'var(--color-accent-green-border)',
    dotColor: 'var(--color-accent-green)',
  },
  yellow: {
    backgroundColor: 'var(--color-accent-yellow-bg)',
    color: 'var(--color-accent-yellow-light)',
    borderColor: 'var(--color-accent-yellow-border)',
    dotColor: 'var(--color-accent-yellow)',
  },
  amber: {
    backgroundColor: 'var(--color-accent-amber-bg)',
    color: 'var(--color-accent-amber-light)',
    borderColor: 'var(--color-accent-amber-border)',
    dotColor: 'var(--color-accent-amber)',
  },
  red: {
    backgroundColor: 'var(--color-accent-red-bg)',
    color: 'var(--color-accent-red-light)',
    borderColor: 'var(--color-accent-red-border)',
    dotColor: 'var(--color-accent-red)',
  },
}

function getJudgeRecommendationLabel(
  recommendedSessionId: string | null | undefined,
  versions: SessionVersionGroupType['versions'],
): string | null {
  if (!recommendedSessionId) return null

  const recommended = versions.find(version => version.session.info.session_id === recommendedSessionId)?.session.info
  if (!recommended) return recommendedSessionId

  const agent = (recommended.original_agent_type || 'session').toLowerCase()
  return recommended.version_number ? `${agent} v${recommended.version_number}` : agent
}

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
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isPreviewingDeletion, setIsPreviewingDeletion] = useState(false)
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)

  const isVersionSelected = (sessionId: string, sessionInfo: SessionVersionGroupType['versions'][number]['session']['info']) => (
    (selection.kind === 'session' && selection.payload === sessionId)
      || (isInSpecMode === true && isSpec(sessionInfo) && currentSpecId === sessionId)
  )

  if (!group.isVersionGroup) {
    const session = group.versions[0]
    const isSelected = isVersionSelected(session.session.info.session_id, session.session.info)

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
    version => isVersionSelected(version.session.info.session_id, version.session.info)
  )
  const hasSelectedVersion = !!selectedVersionInGroup
  const consolidationSessions = group.versions.filter(v => v.session.info.is_consolidation)
  const consolidationCandidates = consolidationSessions.filter(v => v.session.info.consolidation_role !== 'judge')
  const judgeSessions = consolidationSessions.filter(v => v.session.info.consolidation_role === 'judge')
  const hasConsolidationVersion = consolidationCandidates.length > 0
  const sourceVersions = group.versions.filter(v => !v.session.info.is_consolidation)
  const selectedSourceVersion = selectedVersionInGroup?.session.info.is_consolidation ? null : selectedVersionInGroup
  const primaryVersion = selectedSourceVersion ?? sourceVersions[0] ?? group.versions[0]
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
    ?? latestJudge?.session.info.consolidation_round_id
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
  const sourceVersionCount = Math.max(sourceVersions.length, 1)
  const primaryVersionIndex = primaryVersion
    ? Math.max(sourceVersions.findIndex(version => version.session.info.session_id === primaryVersion.session.info.session_id), 0)
    : 0
  const recommendationLabel = getJudgeRecommendationLabel(
    latestJudge?.session.info.consolidation_recommended_session_id,
    group.versions,
  )
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
  const primaryStatus = primaryVersion
    ? getSidebarSessionStatus(
        primaryVersion.session.info,
        Boolean(primaryVersion.session.info.is_blocked),
        isSessionRunning?.(primaryVersion.session.info.session_id) || false,
      )
    : null
  const headerStatus = (() => {
    if (!primaryVersion || !primaryStatus) {
      return {
        label: t.session.notStarted,
        tone: 'neutral' as HeaderStatusTone,
      }
    }

    if (primaryStatus.sessionState === 'spec') {
      if (primaryStatus.primaryStatus === 'waiting') {
        return {
          label: t.session.waitingForInput,
          tone: 'amber' as HeaderStatusTone,
        }
      }

      if (primaryVersion.session.info.spec_stage === 'clarified') {
        return {
          label: 'Clarified',
          tone: 'green' as HeaderStatusTone,
        }
      }

      return {
        label: 'Draft',
        tone: 'amber' as HeaderStatusTone,
      }
    }

    switch (primaryStatus.primaryStatus) {
      case 'blocked':
        return { label: t.session.blocked, tone: 'red' as HeaderStatusTone }
      case 'waiting':
        return { label: t.session.waitingForInput, tone: 'amber' as HeaderStatusTone }
      case 'idle':
        return { label: t.session.idle, tone: 'yellow' as HeaderStatusTone }
      case 'ready':
        return { label: t.session.ready, tone: 'green' as HeaderStatusTone }
      case 'running':
        return { label: t.session.running, tone: 'blue' as HeaderStatusTone }
      default:
        return { label: t.session.notStarted, tone: 'neutral' as HeaderStatusTone }
    }
  })()

  const renderHeaderAction = (
    testId: string,
    title: string,
    icon: ReactNode,
    onClick: () => void,
    options?: { disabled?: boolean; tone?: HeaderStatusTone },
  ) => {
    const tone = options?.tone ?? 'neutral'
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={options?.disabled}
        title={title}
        data-testid={testId}
        className="inline-flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: 'var(--color-bg-hover)',
          color: headerStatusToneStyles[tone].color,
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        {icon}
      </button>
    )
  }

  const renderVersionRow = (
    version: SessionVersionGroupType['versions'][number],
    versionIndex: number,
    hideTreeConnector = true,
  ) => {
    const isSelected = isVersionSelected(version.session.info.session_id, version.session.info)
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
      <div
        className="rounded-lg border transition-colors"
        style={hasSelectedVersion ? {
          borderColor: 'var(--color-accent-blue-border)',
          backgroundColor: 'rgb(var(--color-accent-blue-rgb) / 0.08)',
        } : {
          borderColor: 'var(--color-border-default)',
          backgroundColor: 'rgb(var(--color-bg-elevated-rgb) / 0.55)',
        }}
      >
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full text-left"
            title={`${group.baseName} (${sourceVersionCount} versions) - Click to expand/collapse`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    className={clsx('h-3 w-3 flex-shrink-0 text-text-muted transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate" style={sessionText.title}>{group.baseName}</span>
                  <span
                    data-testid="version-group-count"
                    className="inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5"
                    style={{
                      ...sessionText.badge,
                      backgroundColor: 'var(--color-bg-hover)',
                      color: 'var(--color-text-secondary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  >
                    {primaryVersionIndex + 1} / {sourceVersionCount}
                  </span>
                </div>
              </div>

              <span
                data-testid="version-group-header-status"
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5"
                style={{
                  ...sessionText.badge,
                  ...headerStatusToneStyles[headerStatus.tone],
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: headerStatusToneStyles[headerStatus.tone].dotColor }}
                />
                {headerStatus.label}
              </span>
            </div>
          </button>

          {(groupDescription || hasMultipleVersions || activeRoundId || hasRunning) && (
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {groupDescription && (
                  <div
                    data-testid="version-group-description"
                    className="truncate"
                    style={sessionText.meta}
                    title={groupDescription}
                  >
                    {groupDescription}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 justify-end flex-wrap">
                {hasMultipleVersions && onConsolidate && renderHeaderAction(
                  'consolidate-versions-button',
                  canConsolidate ? 'Consolidate versions' : 'Needs at least 2 running sessions to consolidate',
                  (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M5 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM3 5v3.5a.5.5 0 0 0 .5.5H8v3h0V9h4.5a.5.5 0 0 0 .5-.5V5h-1v3H8.5V5h-1v3H4V5H3z" />
                    </svg>
                  ),
                  () => {
                    if (!canConsolidate) return
                    onConsolidate(group)
                  },
                  { disabled: !canConsolidate, tone: 'amber' },
                )}
                {activeRoundId && onTriggerConsolidationJudge && renderHeaderAction(
                  'trigger-consolidation-judge-button',
                  latestJudge ? 'Re-run consolidation judge' : 'Run consolidation judge',
                  (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 1.5a3.5 3.5 0 0 0-3.328 2.422l-.11.328H3.25a2.75 2.75 0 0 0 0 5.5h1.5v-1.5h-1.5a1.25 1.25 0 1 1 0-2.5h2.408l.17-.504A2 2 0 1 1 9.5 6h-1l2.25 2.25L13 6h-1a4 4 0 0 0-4-4.5ZM5 10h6v1.5H5zm0 3h6v1.5H5z" />
                    </svg>
                  ),
                  () => onTriggerConsolidationJudge(activeRoundId, consolidationCandidates.some(candidate => !candidate.session.info.consolidation_report)),
                  { tone: 'amber' },
                )}
                {activeRoundId && confirmWinnerSessionId && onConfirmConsolidationWinner && renderHeaderAction(
                  'confirm-consolidation-winner-button',
                  selectedCandidate ? 'Confirm selected consolidation winner' : 'Confirm judge recommendation',
                  (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M13.78 3.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 8.28a.75.75 0 1 1 1.06-1.06L6 9.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                    </svg>
                  ),
                  () => onConfirmConsolidationWinner(activeRoundId, confirmWinnerSessionId),
                  { tone: 'green' },
                )}
                {hasRunning && onTerminateAll && renderHeaderAction(
                  'terminate-group-button',
                  'Terminate all running sessions',
                  (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 13.5v-11z" />
                    </svg>
                  ),
                  () => onTerminateAll(group),
                  { tone: 'red' },
                )}
              </div>
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="border-t px-3 pb-3 pt-2" style={{ borderTopColor: 'rgb(var(--color-border-subtle-rgb) / 0.7)' }}>
            {sourceVersions.length > 0 && (
              <div data-testid="version-group-source-list" className="space-y-1.5">
                <div className="space-y-1.5">
                  {sourceVersions.map((version, versionIndex) => renderVersionRow(version, versionIndex))}
                </div>
              </div>
            )}

            {(consolidationCandidates.length > 0 || recommendationLabel) && (
              <div className={clsx(sourceVersions.length > 0 && 'mt-3')}>
                {sourceVersions.length > 0 && (
                  <div
                    data-testid="version-group-consolidation-divider"
                    className="mx-1 mb-3 border-t"
                    style={{ borderTopColor: 'rgb(var(--color-accent-purple-rgb) / 0.3)' }}
                  />
                )}
                <div
                  data-testid="version-group-consolidation-lane"
                  className="rounded-md border px-3 py-2"
                  style={{
                    borderColor: 'rgb(var(--color-accent-purple-rgb) / 0.3)',
                    backgroundColor: 'rgb(var(--color-accent-purple-rgb) / 0.06)',
                  }}
                >
                  <div
                    className="mb-2"
                    style={{
                      ...sessionText.badge,
                      color: 'var(--color-accent-violet-light)',
                    }}
                  >
                    CONSOLIDATION
                  </div>
                  {recommendationLabel && (
                    <div
                      data-testid="version-group-judge-recommendation"
                      className="mb-2 rounded-md border px-3 py-2"
                      style={{
                        ...sessionText.meta,
                        borderColor: 'rgb(var(--color-accent-purple-rgb) / 0.35)',
                        backgroundColor: 'rgb(var(--color-accent-purple-rgb) / 0.08)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      Judge recommends{' '}
                      <span style={{ color: 'var(--color-text-primary)' }}>
                        {recommendationLabel}
                      </span>
                    </div>
                  )}
                  <div className="space-y-1.5">
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
