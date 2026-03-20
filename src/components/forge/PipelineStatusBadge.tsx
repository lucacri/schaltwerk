import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

interface PipelineStatusBadgeProps {
  status: string
  url?: string
}

function getStatusStyle(status: string): { color: string; label: string; key: string } {
  switch (status) {
    case 'success':
      return { color: 'var(--color-accent-green)', label: '', key: 'pipelineSuccess' }
    case 'failed':
      return { color: 'var(--color-accent-red)', label: '', key: 'pipelineFailed' }
    case 'running':
      return { color: 'var(--color-accent-blue)', label: '', key: 'pipelineRunning' }
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
      return { color: 'var(--color-accent-amber)', label: '', key: 'pipelinePending' }
    case 'canceled':
      return { color: 'var(--color-text-muted)', label: '', key: 'pipelineCanceled' }
    case 'manual':
      return { color: 'var(--color-accent-amber)', label: '', key: 'pipelineManual' }
    default:
      return { color: 'var(--color-text-muted)', label: status, key: '' }
  }
}

export function PipelineStatusBadge({ status, url }: PipelineStatusBadgeProps) {
  const { t } = useTranslation()
  const style = getStatusStyle(status)

  const label = style.key
    ? (t.forgePrTab as Record<string, string>)[style.key] ?? status
    : style.label

  const isRunning = status === 'running'

  const badge = (
    <span
      className="inline-flex items-center gap-1"
      style={{
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        color: style.color,
        lineHeight: theme.lineHeight.badge,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: 9999,
          backgroundColor: style.color,
          flexShrink: 0,
          ...(isRunning ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
        }}
      />
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
