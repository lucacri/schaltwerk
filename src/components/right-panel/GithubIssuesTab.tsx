import { useState, useCallback } from 'react'
import { VscClose, VscSearch } from 'react-icons/vsc'
import { useGithubIssueSearch } from '../../hooks/useGithubIssueSearch'
import { GithubIssueDetail } from '../github/GithubIssueDetail'
import { GithubLabelChip } from '../github/GithubLabelChip'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import type { GithubIssueDetails, GithubIssueSummary } from '../../types/githubIssues'

export function GithubIssuesTab() {
  const { t } = useTranslation()
  const search = useGithubIssueSearch()
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null)
  const [details, setDetails] = useState<GithubIssueDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const handleSelect = useCallback(async (issue: GithubIssueSummary) => {
    setSelectedIssueNumber(issue.number)
    setLoadingDetails(true)

    try {
      const d = await search.fetchDetails(issue.number)
      setDetails(d)
    } catch (err) {
      logger.error('[GithubIssuesTab] Failed to fetch issue details', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [search])

  const handleBack = useCallback(() => {
    setSelectedIssueNumber(null)
    setDetails(null)
  }, [])

  if (selectedIssueNumber && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.githubIssueTab.loading}
        </span>
      </div>
    )
  }

  if (selectedIssueNumber && details) {
    return <GithubIssueDetail details={details} onBack={handleBack} />
  }

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
          placeholder={t.githubIssueTab.searchPlaceholder}
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
          <span className="truncate">{search.error}</span>
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
              {t.githubIssueTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.githubIssueTab.noIssuesFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.githubIssueTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((issue) => (
            <IssueRow key={issue.number} issue={issue} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  )
}

function IssueRow({ issue, onSelect }: { issue: GithubIssueSummary; onSelect: (issue: GithubIssueSummary) => Promise<void> }) {
  const { t } = useTranslation()
  const isOpen = issue.state === 'OPEN'

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => { void onSelect(issue) }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: isOpen ? 'var(--color-accent-green)' : 'var(--color-accent-red)',
          }}
        >
          {isOpen ? t.githubIssueTab.opened : t.githubIssueTab.closed}
        </span>
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          #{issue.number}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.githubIssueTab.updated.replace('{time}', formatRelativeDate(issue.updatedAt))}
        </span>
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
      {issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {issue.labels.map((label) => (
            <GithubLabelChip key={label.name} label={label} />
          ))}
        </div>
      )}
    </button>
  )
}
