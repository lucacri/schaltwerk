import { type ReactNode } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

export type ChipVariant = 'neutral' | 'accent'
export type ChipAccent = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan'

export interface ChipProps {
  variant?: ChipVariant
  accent?: ChipAccent
  children: ReactNode
  className?: string
}

const solidAccentBg: Record<ChipAccent, string> = {
  blue: '--color-accent-blue-dark',
  green: '--color-accent-green-dark',
  amber: '--color-accent-amber-dark',
  red: '--color-accent-red-dark',
  violet: '--color-accent-violet-dark',
  cyan: '--color-accent-cyan-dark',
}

export function Chip({ variant = 'neutral', accent = 'blue', children, className }: ChipProps) {
  const isAccent = variant === 'accent'

  return (
    <span
      className={clsx('inline-flex items-center rounded-full', !isAccent && 'border', className)}
      style={{
        backgroundColor: isAccent
          ? `var(${solidAccentBg[accent]})`
          : 'var(--color-bg-tertiary)',
        borderColor: isAccent ? undefined : 'var(--color-border-subtle)',
        color: isAccent ? 'var(--color-white)' : 'var(--color-text-secondary)',
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        lineHeight: theme.lineHeight.badge,
        padding: '2px 10px',
      }}
    >
      {children}
    </span>
  )
}
