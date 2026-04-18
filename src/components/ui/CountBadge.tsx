import { type ReactNode } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

export type CountBadgeTone = 'attention' | 'running' | 'neutral'

export interface CountBadgeProps {
  tone?: CountBadgeTone
  children: ReactNode
  className?: string
  'aria-label'?: string
}

const toneTokens: Record<CountBadgeTone, { bg: string; text: string }> = {
  attention: { bg: '--color-tab-badge-bg', text: '--color-tab-badge-text' },
  running: { bg: '--color-tab-running-badge-bg', text: '--color-tab-running-badge-text' },
  neutral: { bg: '--color-bg-tertiary', text: '--color-text-tertiary' },
}

export function CountBadge({ tone = 'attention', children, className, 'aria-label': ariaLabel }: CountBadgeProps) {
  const tokens = toneTokens[tone]

  return (
    <span
      aria-label={ariaLabel}
      className={clsx('inline-flex items-center justify-center rounded-full', className)}
      style={{
        backgroundColor: `var(${tokens.bg})`,
        color: `var(${tokens.text})`,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        lineHeight: theme.lineHeight.badge,
        minWidth: 16,
        height: 16,
        padding: '0 6px',
      }}
    >
      {children}
    </span>
  )
}
