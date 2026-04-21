import { theme } from '../../common/theme'
import { getContrastColor } from '../../common/colorContrast'
import type { ForgeLabel } from '../../types/forgeTypes'

export function ForgeLabelChip({ label }: { label: ForgeLabel }) {
  const bgColor = label.color ? (label.color.startsWith('#') ? label.color : `#${label.color}`) : 'var(--color-bg-elevated)'
  const textColor = label.color ? getContrastColor(bgColor) : 'var(--color-text-secondary)'

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
