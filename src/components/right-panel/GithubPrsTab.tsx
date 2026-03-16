import { useState, useCallback } from 'react'
import { VscClose, VscSearch } from 'react-icons/vsc'
import { useGithubPrSearch } from '../../hooks/useGithubPrSearch'
import { GithubPrDetail } from '../github/GithubPrDetail'
import { GithubLabelChip } from '../github/GithubLabelChip'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import type { GithubPrDetails, GithubPrSummary } from '../../types/githubIssues'

export function GithubPrsTab() {
  const { t } = useTranslation()
  const search = useGithubPrSearch()
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null)
  const [details, setDetails] = useState<GithubPrDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const handleSelect = useCallback(async (pr: GithubPrSummary) => {
    setSelectedPrNumber(pr.number)
    setLoadingDetails(true)

    try {
      const d = await search.fetchDetails(pr.number)
      setDetails(d)
    } catch (err) {
      logger.error('[GithubPrsTab] Failed to fetch PR details', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [search])

  const handleBack = useCallback(() => {
    setSelectedPrNumber(null)
    setDetails(null)
  }, [])

  if (selectedPrNumber && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.githubPrTab.loading}
        </span>
      </div>
    )
  }

  if (selectedPrNumber && details) {
    return <GithubPrDetail details={details} onBack={handleBack} />
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
          placeholder={t.githubPrTab.searchPlaceholder}
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
              {t.githubPrTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.githubPrTab.noPrsFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.githubPrTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((pr) => (
            <PrRow key={pr.number} pr={pr} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  )
}

function PrStateBadgeInline({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string

  switch (state) {
    case 'MERGED':
      label = t.githubPrTab.merged
      color = 'var(--color-accent-violet)'
      break
    case 'CLOSED':
      label = t.githubPrTab.closed
      color = 'var(--color-accent-red)'
      break
    default:
      label = t.githubPrTab.opened
      color = 'var(--color-accent-green)'
      break
  }

  return (
    <span style={{ fontSize: theme.fontSize.caption, fontWeight: 600, color }}>
      {label}
    </span>
  )
}

function PrRow({ pr, onSelect }: { pr: GithubPrSummary; onSelect: (pr: GithubPrSummary) => Promise<void> }) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => { void onSelect(pr) }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <PrStateBadgeInline state={pr.state} />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          #{pr.number}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.githubPrTab.updated.replace('{time}', formatRelativeDate(pr.updatedAt))}
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
        {pr.title}
      </div>
      <div className="flex items-center gap-1.5 overflow-hidden">
        <span
          className="truncate"
          style={{
            fontSize: theme.fontSize.caption,
            fontFamily: theme.fontFamily.mono,
            color: 'var(--color-text-muted)',
          }}
          title={pr.headRefName}
        >
          {pr.headRefName}
        </span>
      </div>
      {pr.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {pr.labels.map((label) => (
            <GithubLabelChip key={label.name} label={label} />
          ))}
        </div>
      )}
    </button>
  )
}
