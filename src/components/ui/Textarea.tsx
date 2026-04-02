import React, { forwardRef } from 'react'
import clsx from 'clsx'
import { controlCodeStyle, controlTextStyle } from './styles'

type TextareaResize = 'none' | 'vertical' | 'both'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  resize?: TextareaResize
  monospace?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { resize = 'vertical', monospace = false, className, disabled, style, ...props },
  ref,
) {
  return (
    <textarea
      {...props}
      ref={ref}
      disabled={disabled}
      data-resize={resize}
      data-monospace={monospace ? 'true' : 'false'}
      className={clsx(
        'w-full rounded-[var(--control-border-radius)] border border-[var(--control-border)] bg-[var(--control-bg)] px-[var(--control-padding-x)] py-[var(--control-padding-y)] text-text-primary transition-[background-color,border-color,opacity] duration-150 ease-out placeholder:text-text-muted focus:border-[var(--control-border-focus)] focus:outline-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--control-bg-hover)]',
        className,
      )}
      style={{ resize, ...(monospace ? controlCodeStyle : controlTextStyle), ...style }}
    />
  )
})
