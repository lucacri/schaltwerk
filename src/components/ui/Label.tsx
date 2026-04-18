import React from 'react'
import clsx from 'clsx'
import { labelTextStyle } from './styles'

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

export function Label({ children, required = false, className, ...props }: LabelProps) {
  return (
    <label {...props} className={clsx('inline-flex items-center gap-0.5 text-text-secondary font-medium', className)} style={labelTextStyle}>
      <span>{children}</span>
      {required ? <span className="text-accent-red" aria-hidden="true">*</span> : null}
    </label>
  )
}
