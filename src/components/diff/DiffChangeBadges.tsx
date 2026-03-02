import clsx from 'clsx'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n'

type BadgeLayout = 'row' | 'column'
type BadgeSize = 'default' | 'compact'

interface DiffChangeBadgesProps {
  additions: number
  deletions: number
  changes?: number
  isBinary?: boolean
  className?: string
  layout?: BadgeLayout
  size?: BadgeSize
}

const baseNumberClass = 'font-semibold tracking-tight tabular-nums'
const additionClass = 'text-green-400'
const deletionClass = 'text-red-400'
const binaryClass = 'text-purple-300 font-medium'

const fontSizeFor = (layout: BadgeLayout, size: BadgeSize): string => {
  if (layout === 'column') {
    return size === 'compact' ? theme.fontSize.caption : theme.fontSize.caption
  }
  return size === 'compact' ? theme.fontSize.caption : theme.fontSize.caption
}

const gapFor = (layout: BadgeLayout) =>
  layout === 'column' ? 'flex-col items-end gap-0.5' : 'items-center gap-2'

export function DiffChangeBadges({
  additions,
  deletions,
  changes,
  isBinary,
  className,
  layout = 'column',
  size = 'default',
}: DiffChangeBadgesProps) {
  const { t } = useTranslation()
  void changes

  const containerClasses = clsx(
    'flex justify-end',
    gapFor(layout),
    className
  )

  const containerStyle = { fontSize: fontSizeFor(layout, size) }

  if (isBinary) {
    return (
      <div className={containerClasses} style={containerStyle}>
        <span className={clsx(baseNumberClass, binaryClass)}>{t.diffChangeBadges.binary}</span>
      </div>
    )
  }

  const itemClass = layout === 'column'
    ? 'flex items-baseline gap-0.5'
    : 'flex items-baseline gap-1'

  return (
    <div className={containerClasses} style={containerStyle}>
      <span className={itemClass}>
        <span className={clsx(baseNumberClass, additionClass)}>+{additions}</span>
      </span>
      <span className={itemClass}>
        <span className={clsx(baseNumberClass, deletionClass)}>-{deletions}</span>
      </span>
    </div>
  )
}
