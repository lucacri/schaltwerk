import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders the provided label', () => {
    render(<Badge>Info</Badge>)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('renders a leading dot by default', () => {
    render(<Badge>Running</Badge>)
    expect(screen.getByTestId('badge-dot')).toBeInTheDocument()
  })

  it('omits the leading dot when dot=false', () => {
    render(<Badge dot={false}>Silent</Badge>)
    expect(screen.queryByTestId('badge-dot')).not.toBeInTheDocument()
  })

  it('applies variant tokens to colors', () => {
    const { rerender } = render(<Badge variant="success">Success</Badge>)
    const successBadge = screen.getByText('Success').parentElement as HTMLElement
    expect(successBadge.style.backgroundColor).toContain('var(--color-accent-green-bg)')
    expect(successBadge.style.color).toContain('var(--color-accent-green)')

    rerender(<Badge variant="error">Error</Badge>)
    const errorBadge = screen.getByText('Error').parentElement as HTMLElement
    expect(errorBadge.style.backgroundColor).toContain('var(--color-accent-red-bg)')
    expect(errorBadge.style.borderColor).toContain('var(--color-accent-red-border)')
  })

  it('supports the neutral variant with tertiary bg + secondary text', () => {
    render(<Badge variant="neutral">Tag</Badge>)
    const badge = screen.getByText('Tag').parentElement as HTMLElement
    expect(badge.style.backgroundColor).toContain('var(--color-bg-tertiary)')
    expect(badge.style.color).toContain('var(--color-text-secondary)')
  })

  it('allows extending className', () => {
    render(<Badge className="ml-2">Info</Badge>)
    const badge = screen.getByText('Info').parentElement as HTMLElement
    expect(badge.className).toMatch(/ml-2/)
  })
})
