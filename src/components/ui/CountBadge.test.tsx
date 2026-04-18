import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CountBadge } from './CountBadge'

describe('CountBadge', () => {
  it('renders the numeric content', () => {
    render(<CountBadge>3</CountBadge>)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('uses attention tokens by default', () => {
    render(<CountBadge>5</CountBadge>)
    const badge = screen.getByText('5') as HTMLElement
    expect(badge.style.backgroundColor).toContain('var(--color-tab-badge-bg)')
    expect(badge.style.color).toContain('var(--color-tab-badge-text)')
  })

  it('switches to running tone when requested', () => {
    render(<CountBadge tone="running">2</CountBadge>)
    const badge = screen.getByText('2') as HTMLElement
    expect(badge.style.backgroundColor).toContain('var(--color-tab-running-badge-bg)')
  })

  it('supports a neutral tone for sidebar counts', () => {
    render(<CountBadge tone="neutral">7</CountBadge>)
    const badge = screen.getByText('7') as HTMLElement
    expect(badge.style.backgroundColor).toContain('var(--color-bg-tertiary)')
    expect(badge.style.color).toContain('var(--color-text-tertiary)')
  })

  it('passes aria-label through for screen readers', () => {
    render(
      <CountBadge aria-label="3 unread notifications">3</CountBadge>,
    )
    expect(screen.getByLabelText('3 unread notifications')).toBeInTheDocument()
  })
})
