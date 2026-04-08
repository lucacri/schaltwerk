import { theme } from '../../common/theme'
import { typography } from '../../common/typography'

interface FavoriteCardProps {
    title: string
    shortcut: string
    summary: string
    accentColor: string
    selected?: boolean
    modified?: boolean
    modifiedLabel?: string
    disabled?: boolean
    tooltip?: string
    onClick: () => void
}

export function FavoriteCard({
    title,
    shortcut,
    summary,
    accentColor,
    selected = false,
    modified = false,
    modifiedLabel = 'modified',
    disabled = false,
    tooltip,
    onClick,
}: FavoriteCardProps) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            title={tooltip}
            onClick={onClick}
            className="relative flex min-h-[72px] min-w-[140px] overflow-hidden rounded-lg text-left transition-opacity"
            style={{
                backgroundColor: 'var(--color-bg-primary)',
                border: `2px solid ${selected ? 'var(--color-accent-blue)' : 'var(--color-border-default)'}`,
                opacity: disabled ? 0.55 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
            }}
        >
            <span
                aria-hidden="true"
                className="shrink-0"
                style={{
                    width: 6,
                    backgroundColor: accentColor,
                }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                <span className="flex items-start justify-between gap-2">
                    <span
                        className="truncate"
                        style={{
                            ...typography.body,
                            color: 'var(--color-text-primary)',
                            fontWeight: 600,
                        }}
                    >
                        {title}
                    </span>
                    <kbd
                        className="shrink-0 rounded px-1.5 py-0.5"
                        style={{
                            ...typography.caption,
                            backgroundColor: 'var(--color-bg-elevated)',
                            color: 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border-subtle)',
                            fontFamily: theme.fontFamily.mono,
                        }}
                    >
                        {shortcut}
                    </kbd>
                </span>
                <span className="flex items-center gap-2">
                    <span
                        className="truncate"
                        style={{
                            ...typography.caption,
                            color: 'var(--color-text-secondary)',
                        }}
                    >
                        {summary}
                    </span>
                    {modified && (
                        <span
                            className="shrink-0 rounded-full px-2 py-0.5"
                            style={{
                                ...typography.caption,
                                backgroundColor: 'var(--color-accent-amber-bg)',
                                color: 'var(--color-accent-amber)',
                                border: '1px solid var(--color-accent-amber-border)',
                            }}
                        >
                            {modifiedLabel}
                        </span>
                    )}
                </span>
            </span>
        </button>
    )
}
