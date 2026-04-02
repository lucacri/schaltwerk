import React from 'react'
import clsx from 'clsx'
import { labelTextStyle } from './styles'

type ToggleSize = 'sm' | 'md'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
  size?: ToggleSize
}

const sizeStyles: Record<ToggleSize, { track: string; knob: string; translate: string }> = {
  sm: {
    track: 'h-4 w-8',
    knob: 'h-3 w-3',
    translate: 'translate-x-4',
  },
  md: {
    track: 'h-5 w-9',
    knob: 'h-4 w-4',
    translate: 'translate-x-4',
  },
}

export function Toggle({ checked, onChange, label, disabled = false, size = 'md' }: ToggleProps) {
  const config = sizeStyles[size]
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === 'string' ? label : undefined}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange(!checked)
        }
      }}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full border p-[1px] transition-[background-color,border-color,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:border-[var(--control-border-focus)] disabled:cursor-not-allowed disabled:opacity-50',
        config.track,
        checked
          ? 'border-[var(--color-accent-blue-border)] bg-accent-blue'
          : 'border-[var(--control-border)] bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)]',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'rounded-full bg-text-inverse transition-transform duration-150 ease-out',
          config.knob,
          checked ? config.translate : 'translate-x-0',
        )}
      />
    </button>
  )

  if (!label) {
    return button
  }

  return (
    <label className={clsx('inline-flex items-center gap-3 text-text-primary', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')} style={labelTextStyle}>
      {button}
      <span>{label}</span>
    </label>
  )
}
