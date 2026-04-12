import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../tests/test-utils'
import { EpicGroupHeader } from './EpicGroupHeader'
import type { Epic } from '../../types/session'

const baseEpic: Epic = {
    id: 'epic-7',
    name: 'Checkout rewrite',
    color: 'blue',
}

function renderHeader(overrides: Partial<Parameters<typeof EpicGroupHeader>[0]> = {}) {
    const props = {
        epic: baseEpic,
        collapsed: false,
        countLabel: '4 running · 2 specs',
        menuOpen: false,
        onMenuOpenChange: vi.fn(),
        onToggleCollapsed: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        ...overrides,
    }

    render(<EpicGroupHeader {...props} />)
    return props
}

function renderHeaderAndReturnContainer(overrides: Partial<Parameters<typeof EpicGroupHeader>[0]> = {}) {
    const props = {
        epic: baseEpic,
        collapsed: false,
        countLabel: '4 running · 2 specs',
        menuOpen: false,
        onMenuOpenChange: vi.fn(),
        onToggleCollapsed: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        ...overrides,
    }

    const result = render(<EpicGroupHeader {...props} />)
    const rerender = (next: Partial<Parameters<typeof EpicGroupHeader>[0]>) => {
        result.rerender(<EpicGroupHeader {...{ ...props, ...next }} />)
    }

    return { container: result.container, rerender }
}

function EpicGroupHeaderHarness(props: Omit<Parameters<typeof EpicGroupHeader>[0], 'menuOpen' | 'onMenuOpenChange'>) {
    const [menuOpen, setMenuOpen] = useState(false)
    return (
        <EpicGroupHeader
            {...props}
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
        />
    )
}

describe('EpicGroupHeader', () => {
    it('renders the anatomy that the style guide depends on', () => {
        renderHeader()

        expect(screen.getByTestId(`epic-header-${baseEpic.id}`)).toBeInTheDocument()
        expect(screen.getByText(baseEpic.name)).toBeInTheDocument()
        expect(screen.getByText('4 running · 2 specs')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /epic actions/i })).toBeInTheDocument()
    })

    it('rotates the chevron to the expanded position when not collapsed', () => {
        const { container, rerender } = renderHeaderAndReturnContainer({ collapsed: false })

        const chevron = container.querySelector('[aria-hidden="true"]')
        expect(chevron).not.toBeNull()
        expect(chevron?.className).toMatch(/rotate-90/)

        rerender({ collapsed: true })
        const collapsedChevron = container.querySelector('[aria-hidden="true"]')
        expect(collapsedChevron?.className).toMatch(/rotate-0/)
    })

    it('exposes edit and delete items through the overflow menu', () => {
        const onMenuOpenChange = vi.fn()
        const onEdit = vi.fn()
        const onDelete = vi.fn()

        const { rerender } = render(
            <EpicGroupHeader
                epic={baseEpic}
                collapsed={false}
                countLabel="2 running"
                menuOpen={false}
                onMenuOpenChange={onMenuOpenChange}
                onToggleCollapsed={vi.fn()}
                onEdit={onEdit}
                onDelete={onDelete}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: /epic actions/i }))
        expect(onMenuOpenChange).toHaveBeenCalledWith(true)

        rerender(
            <EpicGroupHeader
                epic={baseEpic}
                collapsed={false}
                countLabel="2 running"
                menuOpen={true}
                onMenuOpenChange={onMenuOpenChange}
                onToggleCollapsed={vi.fn()}
                onEdit={onEdit}
                onDelete={onDelete}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: /edit epic/i }))
        expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('fires the delete callback when the delete item is selected', () => {
        const onDelete = vi.fn()

        render(
            <EpicGroupHeader
                epic={baseEpic}
                collapsed={false}
                countLabel="1 running"
                menuOpen={true}
                onMenuOpenChange={vi.fn()}
                onToggleCollapsed={vi.fn()}
                onEdit={vi.fn()}
                onDelete={onDelete}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: /delete epic/i }))
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('toggles collapsed when the header label is clicked', () => {
        const onToggleCollapsed = vi.fn()
        render(
            <EpicGroupHeader
                epic={baseEpic}
                collapsed={false}
                countLabel="3 running"
                menuOpen={false}
                onMenuOpenChange={vi.fn()}
                onToggleCollapsed={onToggleCollapsed}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: /checkout rewrite/i }))
        expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
    })

    it('renders the overflow menu as an anchored portal overlay', async () => {
        const user = userEvent.setup()

        renderWithProviders(
            <EpicGroupHeaderHarness
                epic={baseEpic}
                collapsed={false}
                countLabel="3 sessions"
                onToggleCollapsed={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        )

        await user.click(screen.getByRole('button', { name: /epic actions/i }))

        const editItem = await screen.findByRole('button', { name: /edit epic/i })
        const menu = editItem.parentElement

        expect(menu?.parentElement).toBe(document.body)
        expect(menu ? window.getComputedStyle(menu).position : '').toBe('fixed')
    })
})
