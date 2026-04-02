import type { CSSProperties } from 'react'
import { theme } from '../../common/theme'

export const controlTextStyle: CSSProperties = {
  fontSize: theme.fontSize.input,
  fontFamily: theme.fontFamily.sans,
  lineHeight: theme.lineHeight.body,
}

export const controlCodeStyle: CSSProperties = {
  fontSize: theme.fontSize.code,
  fontFamily: theme.fontFamily.mono,
  lineHeight: theme.lineHeight.body,
}

export const buttonTextStyle: CSSProperties = {
  fontSize: theme.fontSize.button,
  fontFamily: theme.fontFamily.sans,
  lineHeight: theme.lineHeight.compact,
}

export const labelTextStyle: CSSProperties = {
  fontSize: theme.fontSize.label,
  fontFamily: theme.fontFamily.sans,
  lineHeight: theme.lineHeight.compact,
}

export const captionTextStyle: CSSProperties = {
  fontSize: theme.fontSize.caption,
  fontFamily: theme.fontFamily.sans,
  lineHeight: theme.lineHeight.compact,
}

export const controlHeightStyles = {
  sm: { height: theme.control.height.sm },
  md: { height: theme.control.height.md },
  lg: { height: theme.control.height.lg },
} satisfies Record<'sm' | 'md' | 'lg', CSSProperties>
