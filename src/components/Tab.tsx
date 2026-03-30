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

function RunningIndicator() {
  return (
    <span
      className="inline-flex items-center justify-center w-3 h-3 shrink-0"
      data-testid="running-indicator"
      aria-label="Running sessions active"
      title="Running sessions active"
    >
      <span
        className="w-2 h-2 rounded-full animate-pulse"
        style={{
          backgroundColor: 'var(--color-tab-running-indicator)',
          boxShadow: '0 0 0 1px var(--color-tab-running-glow)',
        }}
      />
    </span>
  )
}

function SessionBadges({ attentionCount }: { attentionCount?: number }) {
  const hasAttention = attentionCount !== undefined && attentionCount > 0

  if (!hasAttention) return null

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span
        className="inline-flex items-center justify-center px-1.5 rounded-full font-medium"
        style={{
          fontSize: theme.fontSize.caption,
          height: '16px',
          minWidth: '16px',
          backgroundColor: 'var(--color-tab-badge-bg)',
          color: 'var(--color-tab-badge-text)',
        }}
        data-testid="attention-badge"
      >
        {formatBadgeLabel(attentionCount!)}
      </span>
    </span>
  )
}

export function Tab({ projectPath, projectName, attentionCount, runningCount, isActive, onSelect, onClose }: TabProps) {
  const hasRunning = (runningCount ?? 0) > 0
  const hasAttention = (attentionCount ?? 0) > 0

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
      statusIndicator={hasRunning ? <RunningIndicator /> : undefined}
      badgeContent={hasAttention ? <SessionBadges attentionCount={attentionCount} /> : undefined}
    />
  )
}
