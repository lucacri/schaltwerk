import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ForgeLabelChip } from './ForgeLabelChip'
import { theme } from '../../common/theme'
import type { ForgeLabel } from '../../types/forgeTypes'

describe('ForgeLabelChip', () => {
  it('renders label name', () => {
    const label: ForgeLabel = { name: 'bug' }
    render(<ForgeLabelChip label={label} />)
    expect(screen.getByText('bug')).toBeInTheDocument()
  })

  it('applies colored background when color is provided', () => {
    const label: ForgeLabel = { name: 'urgent', color: 'ff0000' }
    render(<ForgeLabelChip label={label} />)
    const chip = screen.getByText('urgent')
    expect(chip.style.backgroundColor).toBe('#ff0000')
  })

  it('uses default theme styling when no color', () => {
    const label: ForgeLabel = { name: 'docs' }
    render(<ForgeLabelChip label={label} />)
    const chip = screen.getByText('docs')
    expect(chip.style.backgroundColor).toBe('var(--color-bg-elevated)')
  })

  it('handles color with hash prefix', () => {
    const label: ForgeLabel = { name: 'feat', color: '#00ff00' }
    render(<ForgeLabelChip label={label} />)
    const chip = screen.getByText('feat')
    expect(chip.style.backgroundColor).toBe('#00ff00')
  })

  it('uses light text on dark backgrounds', () => {
    const label: ForgeLabel = { name: 'dark', color: '000000' }
    render(<ForgeLabelChip label={label} />)
    const chip = screen.getByText('dark')
    expect(chip.style.color).toBe(theme.colors.text.primary)
  })

  it('uses dark text on light backgrounds', () => {
    const label: ForgeLabel = { name: 'light', color: 'ffffff' }
    render(<ForgeLabelChip label={label} />)
    const chip = screen.getByText('light')
    expect(chip.style.color).toBe(theme.colors.text.inverse)
  })
})
