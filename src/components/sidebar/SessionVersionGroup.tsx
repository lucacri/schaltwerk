import { memo, type ReactNode, useState } from 'react'
import { clsx } from 'clsx'
import { VscCheck, VscChevronRight, VscDebugStop, VscGitMerge, VscRefresh } from 'react-icons/vsc'
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

  const baseSessionId = recommended.consolidation_base_session_id
  const baseSession = baseSessionId
    ? versions.find(version => version.session.info.session_id === baseSessionId)?.session.info
    : null

  if (baseSession) {
    const agent = (baseSession.original_agent_type || 'session').toLowerCase()
    return baseSession.version_number ? `${agent} v${baseSession.version_number}` : agent
  }

  if (recommended.is_consolidation) {
    return (recommended.original_agent_type || 'session').toLowerCase()
  }

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
  const sortedJudgeSessions = [...judgeSessions]
    .sort((a, b) => {
      const aTs = a.session.info.last_modified_ts
        ?? (Date.parse(a.session.info.last_modified ?? a.session.info.created_at ?? '') || 0)
      const bTs = b.session.info.last_modified_ts
        ?? (Date.parse(b.session.info.last_modified ?? b.session.info.created_at ?? '') || 0)
      return bTs - aTs
    })
  const activeJudge = sortedJudgeSessions[0]
  const latestJudge = sortedJudgeSessions
    .find(v => v.session.info.consolidation_recommended_session_id)
  const focusJudge = latestJudge ?? activeJudge
  const activeRoundId = focusJudge?.session.info.consolidation_round_id
    ?? consolidationCandidates[0]?.session.info.consolidation_round_id
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
  const recommendedWinnerSessionId = latestJudge?.session.info.consolidation_recommended_session_id ?? null
  const judgeCandidateSessionIds = new Set(focusJudge?.session.info.consolidation_sources ?? [])
  const isConsolidationFocusActive = Boolean(focusJudge)
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
        return { label: t.session.running, tone: 'blue' as HeaderStatusTone }
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
    const isConsolidationCandidate = version.session.info.consolidation_role !== 'judge'
      && (
        version.session.info.is_consolidation
        || judgeCandidateSessionIds.has(version.session.info.session_id)
        || version.session.info.session_id === recommendedWinnerSessionId
      )
    const isDimmedForConsolidation = isConsolidationFocusActive && !isConsolidationCandidate

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
        isDimmedForConsolidation={isDimmedForConsolidation}
      />
    )
  }
  const visibleVersionRows = [
    ...consolidationCandidates,
    ...sourceVersions,
  ]
  const sourceListRows = recommendationLabel ? sourceVersions : visibleVersionRows
  const consolidationLaneRows = recommendationLabel ? consolidationCandidates : []

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
            data-testid="version-group-toggle"
            className="w-full text-left"
            title={`${group.baseName} (${sourceVersionCount} versions) - Click to expand/collapse`}
          >
            <div className="flex items-center justify-between gap-3 py-[3px]">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <VscChevronRight
                  data-testid="version-group-chevron"
                  data-expanded={isExpanded ? 'true' : 'false'}
                  className="h-3 w-3 flex-shrink-0 transition-transform duration-200"
                  style={{
                    color: 'var(--color-text-muted)',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                  aria-hidden="true"
                />
                <span className="truncate" style={sessionText.title}>{group.baseName}</span>
                <span
                  data-testid="version-group-count"
                  className="inline-flex flex-shrink-0 items-center rounded-full border px-1.5 py-px"
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
                  <VscGitMerge className="h-3.5 w-3.5" aria-hidden="true" />,
                  () => {
                    if (!canConsolidate) return
                    onConsolidate(group)
                  },
                  { disabled: !canConsolidate, tone: 'amber' },
                )}
                {activeRoundId && onTriggerConsolidationJudge && renderHeaderAction(
                  'trigger-consolidation-judge-button',
                  latestJudge ? 'Re-run consolidation judge' : 'Run consolidation judge',
                  <VscRefresh className="h-3.5 w-3.5" aria-hidden="true" />,
                  () => onTriggerConsolidationJudge(activeRoundId, consolidationCandidates.some(candidate => !candidate.session.info.consolidation_report)),
                  { tone: 'amber' },
                )}
                {activeRoundId && confirmWinnerSessionId && onConfirmConsolidationWinner && renderHeaderAction(
                  'confirm-consolidation-winner-button',
                  selectedCandidate ? 'Confirm selected consolidation winner' : 'Confirm judge recommendation',
                  <VscCheck className="h-3.5 w-3.5" aria-hidden="true" />,
                  () => onConfirmConsolidationWinner(activeRoundId, confirmWinnerSessionId),
                  { tone: 'green' },
                )}
                {hasRunning && onTerminateAll && renderHeaderAction(
                  'terminate-group-button',
                  'Terminate all running sessions',
                  <VscDebugStop className="h-3.5 w-3.5" aria-hidden="true" />,
                  () => onTerminateAll(group),
                  { tone: 'red' },
                )}
              </div>
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="border-t px-3 pb-3 pt-2" style={{ borderTopColor: 'rgb(var(--color-border-subtle-rgb) / 0.7)' }}>
            {sourceListRows.length > 0 && (
              <div data-testid="version-group-source-list" className="space-y-1.5">
                <div className="space-y-1.5">
                  {sourceListRows.map((version, versionIndex) => renderVersionRow(version, versionIndex))}
                </div>
              </div>
            )}

            {recommendationLabel && (
              <div className={clsx(sourceListRows.length > 0 && 'mt-3')}>
                <div
                  data-testid="version-group-consolidation-lane"
                  className="rounded-md border px-2.5 py-2"
                  style={{
                    borderColor: 'var(--color-accent-violet-border)',
                    backgroundColor: 'var(--color-accent-violet-bg)',
                  }}
                >
                  <div
                    className="mb-2"
                    style={{
                      ...sessionText.badge,
                      color: 'var(--color-accent-violet)',
                    }}
                  >
                    CONSOLIDATION
                  </div>
                  <div
                    data-testid="version-group-judge-recommendation"
                    className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-2"
                    style={{
                      ...sessionText.meta,
                      borderColor: 'var(--color-accent-violet-border)',
                      backgroundColor: 'var(--color-accent-violet-bg)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span>
                      Judge recommends{' '}
                      <span style={{ color: 'var(--color-text-primary)' }}>
                        {recommendationLabel}
                      </span>
                    </span>
                    {activeRoundId && confirmWinnerSessionId && onConfirmConsolidationWinner && (
                      <button
                        type="button"
                        data-testid="confirm-consolidation-winner-banner-button"
                        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border transition-colors"
                        title="Confirm judge recommendation"
                        style={{
                          backgroundColor: 'var(--color-bg-hover)',
                          color: 'var(--color-accent-green)',
                          borderColor: 'var(--color-border-subtle)',
                        }}
                        onClick={() => onConfirmConsolidationWinner(activeRoundId, confirmWinnerSessionId)}
                      >
                        <VscCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {consolidationLaneRows.length > 0 && (
                    <div data-testid="version-group-consolidation-candidates" className="mt-2 space-y-1.5">
                      {consolidationLaneRows.map((version, versionIndex) => (
                        renderVersionRow(version, sourceListRows.length + versionIndex)
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
