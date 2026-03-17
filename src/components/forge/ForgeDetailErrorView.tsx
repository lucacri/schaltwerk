import { theme } from '../../common/theme'

interface ForgeDetailErrorViewProps {
  message: string
  retryLabel: string
  backLabel: string
  onRetry: () => void
  onBack: () => void
}

export function ForgeDetailErrorView({ message, retryLabel, backLabel, onRetry, onBack }: ForgeDetailErrorViewProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2">
      <span style={{ fontSize: theme.fontSize.body, color: 'var(--color-text-muted)' }}>
        {message}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
          }}
        >
          {retryLabel}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-muted)',
            backgroundColor: 'transparent',
            border: '1px solid var(--color-border-default)',
          }}
        >
          {backLabel}
        </button>
      </div>
    </div>
  )
}
