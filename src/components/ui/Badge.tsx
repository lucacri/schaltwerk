import { type ReactNode } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

export type BadgeVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral'

export interface BadgeProps {
  variant?: BadgeVariant
  dot?: boolean
  children: ReactNode
  className?: string
}

const variantTokens: Record<BadgeVariant, { bg: string; border: string; text: string }> = {
  info: { bg: '--color-accent-blue-bg', border: '--color-accent-blue-border', text: '--color-accent-blue' },
  success: { bg: '--color-accent-green-bg', border: '--color-accent-green-border', text: '--color-accent-green' },
  warning: { bg: '--color-accent-amber-bg', border: '--color-accent-amber-border', text: '--color-accent-amber' },
  error: { bg: '--color-accent-red-bg', border: '--color-accent-red-border', text: '--color-accent-red' },
  neutral: { bg: '--color-bg-tertiary', border: '--color-border-subtle', text: '--color-text-secondary' },
}

export function Badge({ variant = 'info', dot = true, children, className }: BadgeProps) {
  const tokens = variantTokens[variant]

  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 rounded-full border', className)}
      style={{
        backgroundColor: `var(${tokens.bg})`,
        borderColor: `var(${tokens.border})`,
        color: `var(${tokens.text})`,
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        lineHeight: theme.lineHeight.badge,
        padding: '2px 10px',
      }}
    >
      {dot ? (
        <span
          aria-hidden="true"
          data-testid="badge-dot"
          className="shrink-0 rounded-full"
          style={{
            width: 6,
            height: 6,
            backgroundColor: `var(${tokens.text})`,
          }}
        />
      ) : null}
      <span>{children}</span>
    </span>
  )
}
