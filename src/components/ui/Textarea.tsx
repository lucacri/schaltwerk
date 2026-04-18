import React, { forwardRef, useId } from 'react'
import clsx from 'clsx'
import { captionTextStyle, controlCodeStyle, controlTextStyle } from './styles'

type TextareaResize = 'none' | 'vertical' | 'both'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  resize?: TextareaResize
  monospace?: boolean
  error?: React.ReactNode
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { resize = 'vertical', monospace = false, className, disabled, error, style, ...props },
  ref,
) {
  const errorId = useId()
  const describedBy = [props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={clsx('w-full space-y-1.5', className)}>
      <textarea
        {...props}
        ref={ref}
        disabled={disabled}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        data-resize={resize}
        data-monospace={monospace ? 'true' : 'false'}
        className={clsx(
          'w-full rounded-[var(--control-border-radius)] border bg-[var(--control-bg)] px-[var(--control-padding-x)] py-[var(--control-padding-y)] text-text-primary transition-[background-color,border-color,opacity] duration-150 ease-out placeholder:text-text-muted focus:border-[var(--control-border-focus)] focus:outline-none',
          error ? 'border-[var(--control-border-error)]' : 'border-[var(--control-border)]',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--control-bg-hover)]',
        )}
        style={{ resize, ...(monospace ? controlCodeStyle : controlTextStyle), ...style }}
      />
      {error ? <p id={errorId} className="text-accent-red" style={captionTextStyle}>{error}</p> : null}
    </div>
  )
})
