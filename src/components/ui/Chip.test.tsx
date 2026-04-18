import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Chip } from './Chip'

describe('Chip', () => {
  it('renders children', () => {
    render(<Chip>TypeScript</Chip>)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('uses neutral tokens by default', () => {
    render(<Chip>Rust</Chip>)
    const chip = screen.getByText('Rust') as HTMLElement
    expect(chip.style.backgroundColor).toContain('var(--color-bg-tertiary)')
    expect(chip.style.borderColor).toContain('var(--color-border-subtle)')
    expect(chip.style.color).toContain('var(--color-text-secondary)')
  })

  it('renders a solid accent variant with inverse text', () => {
    render(<Chip variant="accent" accent="blue">Running</Chip>)
    const chip = screen.getByText('Running') as HTMLElement
    expect(chip.style.backgroundColor).toContain('var(--color-accent-blue-dark)')
    expect(chip.style.color).toContain('var(--color-white')
  })

  it('allows extending className', () => {
    render(<Chip className="ml-1">Tag</Chip>)
    const chip = screen.getByText('Tag') as HTMLElement
    expect(chip.className).toMatch(/ml-1/)
  })
})
