import { describe, it, expect } from 'vitest'
import { getContrastColor } from './colorContrast'
import { theme } from './theme'

describe('getContrastColor', () => {
  it('returns inverse text on bright backgrounds', () => {
    expect(getContrastColor('#FFB000')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('#e5c07b')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('#40B0A6')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('#B66DFF')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('#ffffff')).toBe(theme.colors.text.inverse)
  })

  it('returns primary text on dark backgrounds', () => {
    expect(getContrastColor('#994F00')).toBe(theme.colors.text.primary)
    expect(getContrastColor('#DC267F')).toBe(theme.colors.text.primary)
    expect(getContrastColor('#1e293b')).toBe(theme.colors.text.primary)
    expect(getContrastColor('#000000')).toBe(theme.colors.text.primary)
  })

  it('accepts hex with or without leading hash', () => {
    expect(getContrastColor('FFB000')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('#FFB000')).toBe(theme.colors.text.inverse)
    expect(getContrastColor('994F00')).toBe(theme.colors.text.primary)
    expect(getContrastColor('#994F00')).toBe(theme.colors.text.primary)
  })

  it('falls back to secondary text for malformed input', () => {
    expect(getContrastColor('not-a-hex')).toBe('var(--color-text-secondary)')
    expect(getContrastColor('#abc')).toBe('var(--color-text-secondary)')
    expect(getContrastColor('#12zz34')).toBe('var(--color-text-secondary)')
    expect(getContrastColor('')).toBe('var(--color-text-secondary)')
  })
})
