import { useState, useCallback } from 'react'
import { VscClose, VscInfo, VscSearch } from 'react-icons/vsc'
import { ForgeErrorDetailModal } from './ForgeErrorDetailModal'
import { useForgeIntegrationContext } from '../../contexts/ForgeIntegrationContext'
import { useForgeSearch } from '../../hooks/useForgeSearch'
import { ForgePrDetail } from './ForgePrDetail'
import { ForgeLabelChip } from './ForgeLabelChip'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import type { ForgePrSummary, ForgePrDetails, ForgeSourceConfig } from '../../types/forgeTypes'

function isOpen(state: string): boolean {
  const upper = state.toUpperCase()
  return upper === 'OPEN' || upper === 'OPENED'
}

function isMerged(state: string): boolean {
  return state.toUpperCase() === 'MERGED'
}

function PrStateBadgeInline({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string

  if (isMerged(state)) {
    label = t.forgePrTab.merged
    color = 'var(--color-accent-violet)'
  } else if (isOpen(state)) {
    label = t.forgePrTab.opened
    color = 'var(--color-accent-green)'
  } else {
    label = t.forgePrTab.closed
    color = 'var(--color-accent-red)'
  }

  return (
    <span style={{ fontSize: theme.fontSize.caption, fontWeight: 600, color }}>
      {label}
    </span>
  )
}

function PrRow({
  pr,
  onSelect,
  showSource,
}: {
  pr: ForgePrSummary
  onSelect: (pr: ForgePrSummary) => void
  showSource?: boolean
}) {
  const displayLabels = pr.labels.slice(0, 3)

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => onSelect(pr)}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <PrStateBadgeInline state={pr.state} />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          #{pr.id}
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
            {pr.sourceBranch}
          </span>
        )}
        <span className="flex-1" />
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
          title={pr.sourceBranch}
        >
          {pr.sourceBranch}
        </span>
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

export function ForgePrsTab() {
  const { t } = useTranslation()
  const forge = useForgeIntegrationContext()

  const search = useForgeSearch<ForgePrSummary, ForgePrDetails>({
    searchFn: forge.searchPrs,
    detailsFn: forge.getPrDetails,
    sources: forge.sources,
    enabled: forge.hasSources,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    summaryFromDetails: (details) => details.summary,
  })

  const [showErrorDetail, setShowErrorDetail] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<ForgePrDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedSource, setSelectedSource] = useState<ForgeSourceConfig | undefined>(undefined)

  const handleSelect = useCallback(
    (pr: ForgePrSummary) => {
      setSelectedId(pr.id)
      setLoadingDetails(true)

      const source = forge.sources[0]
      setSelectedSource(forge.sources.length > 1 ? source : undefined)

      void search.fetchDetails(pr.id, source).then((d) => {
        setDetails(d)
        setLoadingDetails(false)
      }).catch((err) => {
        logger.error('[ForgePrsTab] Failed to fetch PR details', err)
        setLoadingDetails(false)
      })
    },
    [search, forge.sources]
  )

  const handleBack = useCallback(() => {
    setSelectedId(null)
    setDetails(null)
    setSelectedSource(undefined)
  }, [])

  const handleApprove = useCallback(async () => {
    if (!selectedId || !forge.sources[0]) return
    await forge.approvePr(forge.sources[0], selectedId)
  }, [selectedId, forge])

  const handleMerge = useCallback(async (squash: boolean, deleteBranch: boolean) => {
    if (!selectedId || !forge.sources[0]) return
    await forge.mergePr(forge.sources[0], selectedId, squash, deleteBranch)
  }, [selectedId, forge])

  const handleComment = useCallback(async (message: string) => {
    if (!selectedId || !forge.sources[0]) return
    await forge.commentOnPr(forge.sources[0], selectedId, message)
  }, [selectedId, forge])

  if (selectedId && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.forgePrTab.loading}
        </span>
      </div>
    )
  }

  if (selectedId && details) {
    return (
      <ForgePrDetail
        details={details}
        onBack={handleBack}
        sourceLabel={selectedSource?.label}
        forgeType={forge.forgeType}
        onApprove={handleApprove}
        onMerge={handleMerge}
        onComment={handleComment}
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
          placeholder={t.forgePrTab.searchPlaceholder}
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
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowErrorDetail(true)}
              aria-label="error details"
              style={{ color: 'var(--color-accent-red)' }}
            >
              <VscInfo className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => { search.clearError(); setShowErrorDetail(false) }}
              style={{ color: 'var(--color-accent-red)' }}
            >
              <VscClose className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      <ForgeErrorDetailModal
        isOpen={showErrorDetail}
        onClose={() => setShowErrorDetail(false)}
        errorDetails={search.errorDetails}
      />

      <div className="flex-1 overflow-y-auto">
        {search.loading && search.results.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.forgePrTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.forgePrTab.noPrsFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.forgePrTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((pr) => (
            <PrRow
              key={pr.id}
              pr={pr}
              onSelect={handleSelect}
              showSource={multiSource}
            />
          ))
        )}
      </div>
    </div>
  )
}
