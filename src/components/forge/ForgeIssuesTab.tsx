import { useState, useCallback } from 'react'
import { VscClose, VscSearch } from 'react-icons/vsc'
import { useForgeIntegrationContext } from '../../contexts/ForgeIntegrationContext'
import { useForgeSearch } from '../../hooks/useForgeSearch'
import { ForgeIssueDetail } from './ForgeIssueDetail'
import { ForgeLabelChip } from './ForgeLabelChip'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import type { ForgeIssueSummary, ForgeIssueDetails, ForgeSourceConfig } from '../../types/forgeTypes'

function isOpen(state: string): boolean {
  return state.toUpperCase() === 'OPEN' || state === 'opened'
}

function IssueRow({
  issue,
  onSelect,
  showSource,
}: {
  issue: ForgeIssueSummary
  onSelect: (issue: ForgeIssueSummary) => void
  showSource?: boolean
}) {
  const { t } = useTranslation()
  const open = isOpen(issue.state)
  const displayLabels = issue.labels.slice(0, 3)

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => onSelect(issue)}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: open ? 'var(--color-accent-green)' : 'var(--color-accent-red)',
          }}
        >
          {open ? t.forgeIssueTab.opened : t.forgeIssueTab.closed}
        </span>
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          #{issue.id}
        </span>
        {showSource && (
          <span
            style={{
              fontSize: theme.fontSize.caption,
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-elevated)',
              borderRadius: 9999,
              padding: '1px 6px',
              lineHeight: theme.lineHeight.badge,
            }}
          >
            {t.forgeIssueTab.source}
          </span>
        )}
        <span className="flex-1" />
        {issue.updatedAt && (
          <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
            {t.forgeIssueTab.updated.replace('{time}', formatRelativeDate(issue.updatedAt))}
          </span>
        )}
      </div>
      <div
        className="truncate"
        style={{
          fontSize: theme.fontSize.body,
          color: 'var(--color-text-primary)',
          fontFamily: theme.fontFamily.sans,
          lineHeight: theme.lineHeight.body,
        }}
      >
        {issue.title}
      </div>
      {displayLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {displayLabels.map((label) => (
            <ForgeLabelChip key={label.name} label={label} />
          ))}
        </div>
      )}
    </button>
  )
}

export function ForgeIssuesTab() {
  const { t } = useTranslation()
  const forge = useForgeIntegrationContext()

  const search = useForgeSearch<ForgeIssueSummary, ForgeIssueDetails>({
    searchFn: forge.searchIssues,
    detailsFn: forge.getIssueDetails,
    sources: forge.sources,
    enabled: forge.hasSources,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getUpdatedAt: (item) => item.updatedAt,
    summaryFromDetails: (details) => details.summary,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<ForgeIssueDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedSource, setSelectedSource] = useState<ForgeSourceConfig | undefined>(undefined)

  const handleSelect = useCallback(
    (issue: ForgeIssueSummary) => {
      setSelectedId(issue.id)
      setLoadingDetails(true)

      void search.fetchDetails(issue.id).then((d) => {
        setDetails(d)
        setLoadingDetails(false)
      }).catch((err) => {
        logger.error('[ForgeIssuesTab] Failed to fetch issue details', err)
        setLoadingDetails(false)
      })

      setSelectedSource(forge.sources.length > 1 ? forge.sources[0] : undefined)
    },
    [search, forge.sources]
  )

  const handleBack = useCallback(() => {
    setSelectedId(null)
    setDetails(null)
    setSelectedSource(undefined)
  }, [])

  if (selectedId && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.forgeIssueTab.loading}
        </span>
      </div>
    )
  }

  if (selectedId && details) {
    return (
      <ForgeIssueDetail
        details={details}
        onBack={handleBack}
        sourceLabel={selectedSource?.label}
        forgeType={forge.forgeType}
      />
    )
  }

  const multiSource = forge.sources.length > 1

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-default)' }}
      >
        <VscSearch className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
        <input
          type="text"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          placeholder={t.forgeIssueTab.searchPlaceholder}
          className="flex-1 bg-transparent border-none outline-none"
          style={{
            fontSize: theme.fontSize.body,
            color: 'var(--color-text-primary)',
            fontFamily: theme.fontFamily.sans,
          }}
        />
        {search.query && (
          <button
            type="button"
            onClick={() => search.setQuery('')}
            style={{ color: 'var(--color-text-muted)' }}
          >
            <VscClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {search.error && (
        <div
          className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red)',
            backgroundColor: 'var(--color-accent-red-bg)',
          }}
        >
          <span className="truncate">
            {search.error}
            {search.errorDetails.length > 1 && ` (${search.errorDetails.length} sources failed)`}
          </span>
          <button
            type="button"
            onClick={search.clearError}
            style={{ color: 'var(--color-accent-red)' }}
          >
            <VscClose className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {search.loading && search.results.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.forgeIssueTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.forgeIssueTab.noIssuesFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.forgeIssueTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onSelect={handleSelect}
              showSource={multiSource}
            />
          ))
        )}
      </div>
    </div>
  )
}
