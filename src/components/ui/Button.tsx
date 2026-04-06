import React, { forwardRef } from 'react'
import clsx from 'clsx'
import { buttonTextStyle, controlHeightStyles } from './styles'

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'dashed' | 'warning' | 'success'
type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'border-border-subtle bg-bg-elevated text-text-secondary hover:border-border-strong hover:bg-[var(--control-bg-hover)] hover:text-text-primary',
  primary: 'border-[var(--color-accent-blue-border)] bg-accent-blue text-text-inverse hover:bg-[var(--color-accent-blue-dark)]',
  danger: 'border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-accent-red hover:bg-[var(--color-accent-red)] hover:text-text-inverse',
  warning: 'border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-accent-amber hover:bg-[var(--color-accent-amber-dark)] hover:text-text-inverse',
  success: 'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-accent-green hover:bg-[var(--color-accent-green-dark)] hover:text-text-inverse',
  ghost: 'border-transparent bg-transparent text-text-secondary hover:bg-[rgba(var(--color-bg-hover-rgb),0.35)] hover:text-text-primary',
  dashed: 'border-[var(--control-border)] border-dashed bg-transparent text-text-tertiary hover:border-border-strong hover:text-text-secondary',
}

const paddingClasses: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-2.5',
  md: 'gap-2 px-3',
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    leftIcon,
    rightIcon,
    loading = false,
    disabled = false,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--control-border-radius)] border transition-[background-color,border-color,color,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:border-[var(--control-border-focus)] disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        paddingClasses[size],
        className,
      )}
      style={{ ...buttonTextStyle, ...controlHeightStyles[size] }}
    >
      {loading ? (
        <>
          <Spinner />
          <span className="sr-only">Loading</span>
        </>
      ) : (
        <>
          {leftIcon ? <span aria-hidden="true" className="inline-flex shrink-0 items-center">{leftIcon}</span> : null}
          <span>{children}</span>
          {rightIcon ? <span aria-hidden="true" className="inline-flex shrink-0 items-center">{rightIcon}</span> : null}
        </>
      )}
    </button>
  )
})
