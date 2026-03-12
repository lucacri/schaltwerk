import { theme } from '../common/theme'
import { UnifiedTab } from './UnifiedTab'

interface TabProps {
  projectPath: string
  projectName: string
  attentionCount?: number
  runningCount?: number
  isActive: boolean
  onSelect: () => void | Promise<void | boolean>
  onClose: () => void | Promise<void>
}

function formatBadgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count)
}

function SessionBadges({ runningCount, attentionCount }: { runningCount?: number; attentionCount?: number }) {
  const hasRunning = runningCount !== undefined && runningCount > 0
  const hasAttention = attentionCount !== undefined && attentionCount > 0

  if (!hasRunning && !hasAttention) return null

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {hasRunning && (
        <span
          className="inline-flex items-center justify-center px-1.5 rounded-full font-medium"
          style={{
            fontSize: theme.fontSize.caption,
            height: '16px',
            minWidth: '16px',
            backgroundColor: 'var(--color-accent-blue-bg)',
            color: 'var(--color-accent-blue-light)',
          }}
          data-testid="running-badge"
        >
          {formatBadgeLabel(runningCount!)}
        </span>
      )}
      {hasAttention && (
        <span
          className="inline-flex items-center justify-center px-1.5 rounded-full font-medium"
          style={{
            fontSize: theme.fontSize.caption,
            height: '16px',
            minWidth: '16px',
            backgroundColor: 'var(--color-accent-amber-bg)',
            color: 'var(--color-accent-amber-light)',
          }}
          data-testid="attention-badge"
        >
          {formatBadgeLabel(attentionCount!)}
        </span>
      )}
    </span>
  )
}

export function Tab({ projectPath, projectName, attentionCount, runningCount, isActive, onSelect, onClose }: TabProps) {
  const hasAnyBadge = (runningCount ?? 0) > 0 || (attentionCount ?? 0) > 0

  return (
    <UnifiedTab
      id={projectPath}
      label={projectName}
      isActive={isActive}
      onSelect={() => { void onSelect() }}
      onClose={() => { void onClose() }}
      title={projectPath}
      className="h-full"
      style={{
        minWidth: '100px'
      }}
      badgeContent={hasAnyBadge ? <SessionBadges runningCount={runningCount} attentionCount={attentionCount} /> : undefined}
    />
  )
}
