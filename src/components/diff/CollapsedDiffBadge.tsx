import { VscChevronRight } from 'react-icons/vsc'
import { DiffFilterResult, formatDiffSize } from '../../domains/diff/diffFilters'
import { useTranslation } from '../../common/i18n'

interface CollapsedDiffBadgeProps {
  filterResult: DiffFilterResult
  additions?: number
  deletions?: number
  onClick: () => void
}

export function CollapsedDiffBadge({ filterResult, onClick, additions, deletions }: CollapsedDiffBadgeProps) {
  const { t } = useTranslation()
  const { reason, lineCount, sizeBytes } = filterResult

  let badgeText = ''
  if (reason === 'generated') {
    badgeText = t.collapsedDiffBadge.generatedFile
  } else if (reason === 'large' && lineCount && sizeBytes) {
    badgeText = t.collapsedDiffBadge.largeDiff
      .replace('{lines}', lineCount.toLocaleString())
      .replace('{size}', formatDiffSize(sizeBytes))
  } else if (reason === 'both' && lineCount && sizeBytes) {
    badgeText = t.collapsedDiffBadge.generatedLargeDiff
      .replace('{lines}', lineCount.toLocaleString())
      .replace('{size}', formatDiffSize(sizeBytes))
  } else if (reason === 'deleted') {
    badgeText = t.collapsedDiffBadge.deletedFile
  }

  const hasStats = typeof additions === 'number' || typeof deletions === 'number'
  const statsAdditions = additions ?? 0
  const statsDeletions = deletions ?? 0
  const primaryText = badgeText || t.collapsedDiffBadge.clickToExpand

  return (
    <div className="px-4 py-8">
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between gap-4 px-6 py-4 rounded-lg border transition-colors"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-secondary)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
          e.currentTarget.style.borderColor = 'var(--color-accent-blue)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
          e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <VscChevronRight className="text-lg flex-shrink-0" />
          <div className="flex flex-col items-start gap-1 min-w-0">
            <div className="text-sm font-medium text-left" style={{ color: 'var(--color-text-primary)' }}>
              {primaryText}
            </div>
            {badgeText && (
              <div className="text-xs text-left" style={{ color: 'var(--color-text-tertiary)' }}>
                {t.collapsedDiffBadge.clickToExpand}
              </div>
            )}
          </div>
        </div>
        {hasStats && (
          <div className="flex items-center gap-3 text-xs font-medium flex-shrink-0">
            <span style={{ color: 'var(--color-accent-green)' }}>+{statsAdditions}</span>
            <span style={{ color: 'var(--color-accent-red)' }}>-{statsDeletions}</span>
          </div>
        )}
      </button>
    </div>
  )
}
