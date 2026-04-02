import React, { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { labelTextStyle } from './styles'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
  indeterminate?: boolean
  className?: string
}

function CheckboxMark({ indeterminate }: { indeterminate?: boolean }) {
  if (indeterminate) {
    return <span aria-hidden="true" className="h-0.5 w-2 rounded-full bg-text-inverse" />
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="h-3 w-3 text-text-inverse">
      <path d="M3 7.25 5.5 10 11 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

export function Checkbox({ checked, onChange, label, disabled = false, indeterminate = false, className }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <label
      className={clsx(
        'inline-flex items-start gap-2.5 text-text-primary',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
      style={labelTextStyle}
    >
      <span className="relative mt-0.5 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : checked}
          className="peer sr-only"
          onChange={(event) => {
            if (!disabled) {
              onChange(event.target.checked)
            }
          }}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'inline-flex h-[14px] w-[14px] items-center justify-center rounded-[2px] border transition-[background-color,border-color,opacity] duration-150 ease-out peer-focus-visible:border-[var(--control-border-focus)]',
            checked || indeterminate
              ? 'border-[var(--color-accent-blue-border)] bg-accent-blue'
              : 'border-[var(--control-border)] bg-[var(--control-bg)]',
          )}
        >
          {checked || indeterminate ? <CheckboxMark indeterminate={indeterminate} /> : null}
        </span>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}
