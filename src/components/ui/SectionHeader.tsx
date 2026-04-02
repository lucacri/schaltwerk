import React from 'react'
import clsx from 'clsx'
import { captionTextStyle, controlTextStyle } from './styles'

export interface SectionHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  className?: string
}

export function SectionHeader({ title, description, className }: SectionHeaderProps) {
  return (
    <div className={clsx('border-b border-border-subtle pb-3', className)}>
      <h3 className="font-semibold text-text-primary" style={controlTextStyle}>{title}</h3>
      {description ? <p className="mt-1 text-text-muted" style={captionTextStyle}>{description}</p> : null}
    </div>
  )
}
