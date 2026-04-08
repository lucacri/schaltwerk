import type { ReactNode } from 'react'
import { typography } from '../../common/typography'

interface CustomizeAccordionProps {
    title: string
    expanded: boolean
    onToggle: () => void
    children: ReactNode
    badge?: ReactNode
}

export function CustomizeAccordion({
    title,
    expanded,
    onToggle,
    children,
    badge,
}: CustomizeAccordionProps) {
    return (
        <section
            className="overflow-hidden rounded-lg"
            style={{
                backgroundColor: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border-default)',
            }}
        >
            <button
                type="button"
                aria-expanded={expanded}
                onClick={onToggle}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                style={{
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                }}
            >
                <span className="flex items-center gap-2">
                    <span style={{ ...typography.body, fontWeight: 600 }}>{title}</span>
                    {badge}
                </span>
                <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    style={{
                        color: 'var(--color-text-secondary)',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 120ms ease',
                    }}
                >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                </svg>
            </button>
            {expanded && (
                <div
                    className="border-t px-3 py-3"
                    style={{
                        borderColor: 'var(--color-border-subtle)',
                    }}
                >
                    {children}
                </div>
            )}
        </section>
    )
}
