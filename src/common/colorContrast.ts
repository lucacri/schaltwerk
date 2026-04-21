import { theme } from './theme'

const SIX_DIGIT_HEX = /^[0-9a-fA-F]{6}$/

export function getContrastColor(hexColor: string): string {
  const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
  if (!SIX_DIGIT_HEX.test(hex)) {
    return 'var(--color-text-secondary)'
  }

  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 128 ? theme.colors.text.inverse : theme.colors.text.primary
}
