import { theme } from '../../common/theme'
import type { ForgeLabel } from '../../types/forgeTypes'

function getContrastColor(hexColor: string) {
  const hex = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
  if (hex.length !== 6) return 'var(--color-text-secondary)'

  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 128 ? theme.colors.text.inverse : theme.colors.text.primary
}

export function ForgeLabelChip({ label }: { label: ForgeLabel }) {
  const bgColor = label.color ? (label.color.startsWith('#') ? label.color : `#${label.color}`) : 'var(--color-bg-elevated)'
  const textColor = label.color ? getContrastColor(label.color) : 'var(--color-text-secondary)'

  return (
    <span
      style={{
        display: 'inline-flex',
        fontSize: theme.fontSize.caption,
        fontWeight: 500,
        color: textColor,
        backgroundColor: bgColor,
        border: label.color ? 'none' : '1px solid var(--color-border-default)',
        borderRadius: 9999,
        padding: '1px 8px',
        lineHeight: theme.lineHeight.badge,
        whiteSpace: 'nowrap',
      }}
    >
      {label.name}
    </span>
  )
}
