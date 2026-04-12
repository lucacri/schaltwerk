import type { ReactNode } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

type SidebarSectionHeaderProps = {
  title: ReactNode
  count: number | string
  collapsed: boolean
  toggleLabel: string
  onToggle: () => void
}

export function SidebarSectionHeader({
  title,
  count,
  collapsed,
  toggleLabel,
  onToggle,
}: SidebarSectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      className="w-full px-2 py-1.5 flex items-center gap-2 text-left rounded-md hover:bg-bg-hover/30 transition-colors"
    >
      <span
        className="uppercase tracking-wider"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-text-secondary)',
          lineHeight: theme.lineHeight.compact,
        }}
      >
        {title}
      </span>
      <span
        className="shrink-0"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-text-muted)',
          lineHeight: theme.lineHeight.compact,
        }}
      >
        {count}
      </span>
      <div data-testid="sidebar-section-divider" className="flex-1 h-px bg-border-subtle" />
      <svg
        className={clsx('w-3 h-3 text-text-muted transition-transform', collapsed && '-rotate-90')}
        data-testid="sidebar-section-chevron"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
      </svg>
    </button>
  )
}
