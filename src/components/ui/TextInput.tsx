import React, { forwardRef, useId } from 'react'
import clsx from 'clsx'
import { controlHeightStyles, controlTextStyle, captionTextStyle } from './styles'

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leftIcon?: React.ReactNode
  rightElement?: React.ReactNode
  error?: React.ReactNode
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { leftIcon, rightElement, className, error, disabled, style, ...props },
  ref,
) {
  const errorId = useId()
  const describedBy = [props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={clsx('w-full space-y-1.5', className)}>
      <div
        className={clsx(
          'flex w-full items-center gap-2 rounded-[var(--control-border-radius)] border border-[var(--control-border)] bg-[var(--control-bg)] px-[var(--control-padding-x)] transition-[background-color,border-color,opacity] duration-150 ease-out focus-within:border-[var(--control-border-focus)]',
          error ? 'border-[var(--control-border-error)]' : 'hover:bg-[var(--control-bg-hover)]',
          disabled ? 'cursor-not-allowed opacity-50' : undefined,
        )}
        style={controlHeightStyles.md}
      >
        {leftIcon ? <span aria-hidden="true" className="inline-flex shrink-0 items-center text-text-muted">{leftIcon}</span> : null}
        <input
          {...props}
          ref={ref}
          disabled={disabled}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
          style={{ ...controlTextStyle, ...style }}
        />
        {rightElement ? <span className="inline-flex shrink-0 items-center">{rightElement}</span> : null}
      </div>
      {error ? <p id={errorId} className="text-accent-red" style={captionTextStyle}>{error}</p> : null}
    </div>
  )
})
