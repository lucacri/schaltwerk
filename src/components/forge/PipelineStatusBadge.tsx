import type { CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { getPipelineStatusVisual, type PipelineStatusVisual } from './pipelineStatusVisual'

interface PipelineStatusBadgeProps {
  status: string
  url?: string
}

function buildBadgeStyle(visual: PipelineStatusVisual): CSSProperties {
  const base: CSSProperties = {
    fontSize: theme.fontSize.caption,
    color: visual.pillText,
    lineHeight: theme.lineHeight.badge,
  }

  if (visual.tier === 1) {
    return {
      ...base,
      fontWeight: 600,
      backgroundColor: visual.pillBg ?? 'transparent',
      border: `1px solid ${visual.pillBorder ?? 'transparent'}`,
      borderRadius: 9999,
      padding: '2px 10px',
    }
  }

  if (visual.tier === 2) {
    return {
      ...base,
      fontWeight: 500,
      backgroundColor: 'transparent',
      border: `1px solid ${visual.pillBorder ?? 'transparent'}`,
      borderRadius: 9999,
      padding: '2px 10px',
    }
  }

  return {
    ...base,
    fontWeight: 500,
  }
}

export function PipelineStatusBadge({ status, url }: PipelineStatusBadgeProps) {
  const { t } = useTranslation()
  const visual = getPipelineStatusVisual(status)

  const label = visual.labelKey
    ? (t.forgePrTab as Record<string, string>)[visual.labelKey] ?? status
    : visual.fallbackLabel

  const badge = (
    <span className="inline-flex items-center gap-1" style={buildBadgeStyle(visual)}>
      {visual.showLeadingDot && (
        <span
          data-testid="pipeline-leading-dot"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 9999,
            backgroundColor: visual.pillText,
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  )

  if (url) {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          invoke<void>(TauriCommands.OpenExternalUrl, { url }).catch((err: unknown) => {
            logger.warn('[PipelineStatusBadge] Failed to open URL via Tauri', err)
            window.open(url, '_blank', 'noopener,noreferrer')
          })
        }}
        style={{ textDecoration: 'none' }}
      >
        {badge}
      </a>
    )
  }

  return badge
}
