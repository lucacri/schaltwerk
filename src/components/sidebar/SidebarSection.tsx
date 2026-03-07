import { memo, type ReactNode } from 'react'
import { theme } from '../../common/theme'

interface SidebarSectionProps {
    label: string
    count: number
    expanded: boolean
    onToggle: () => void
    focused?: boolean
    children?: ReactNode
}

export const SidebarSection = memo(function SidebarSection({
    label,
    count,
    expanded,
    onToggle,
    focused = false,
    children,
}: SidebarSectionProps) {
    const isEmpty = count === 0

    return (
        <div data-testid={`sidebar-section-${label.toLowerCase()}`}>
            <button
                onClick={onToggle}
                aria-expanded={expanded}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors"
                style={{
                    color: isEmpty
                        ? 'var(--color-text-muted)'
                        : 'var(--color-text-secondary)',
                    fontSize: theme.fontSize.caption,
                    outline: focused ? '1px solid var(--color-accent-blue)' : 'none',
                    outlineOffset: '-1px',
                }}
            >
                <svg
                    className="w-3 h-3 transition-transform flex-shrink-0"
                    style={{
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                >
                    <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                    />
                </svg>
                <span className="font-medium uppercase tracking-wider">{label}</span>
                <span
                    style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                >
                    {count}
                </span>
            </button>
            {expanded && children}
        </div>
    )
})
