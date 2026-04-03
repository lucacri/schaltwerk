import React, { isValidElement, useId } from 'react'
import clsx from 'clsx'
import { Label } from './Label'
import { captionTextStyle } from './styles'

export interface FormGroupProps {
  label?: React.ReactNode
  htmlFor?: string
  required?: boolean
  help?: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function FormGroup({ label, htmlFor, required, help, error, children, className }: FormGroupProps) {
  const labelId = useId()
  const helpId = useId()
  const errorId = useId()
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ')
  const childElement = isValidElement(children) ? (children as React.ReactElement<Record<string, unknown>>) : null

  const content = childElement
    ? React.cloneElement(childElement, {
        'aria-labelledby': [childElement.props['aria-labelledby'], label && !htmlFor ? labelId : null].filter(Boolean).join(' ') || undefined,
        'aria-describedby': [childElement.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : childElement.props['aria-invalid'],
      } as Record<string, unknown>)
    : children

  return (
    <div className={clsx('space-y-2', className)}>
      {label ? <Label id={labelId} htmlFor={htmlFor} required={required}>{label}</Label> : null}
      {content}
      {help ? <p id={helpId} className="text-text-muted" style={captionTextStyle}>{help}</p> : null}
      {error ? <p id={errorId} className="text-accent-red" style={captionTextStyle}>{error}</p> : null}
    </div>
  )
}
