import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomizeAccordion } from './CustomizeAccordion'

describe('CustomizeAccordion', () => {
    it('renders collapsed content behind a toggle button', () => {
        render(
            <CustomizeAccordion title="Customize" expanded={false} onToggle={vi.fn()}>
                <div>Advanced controls</div>
            </CustomizeAccordion>
        )

        const button = screen.getByRole('button', { name: /Customize/i })
        expect(button).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('Advanced controls')).not.toBeInTheDocument()
    })

    it('renders expanded content when opened', () => {
        render(
            <CustomizeAccordion title="Customize" expanded onToggle={vi.fn()}>
                <div>Advanced controls</div>
            </CustomizeAccordion>
        )

        expect(screen.getByRole('button', { name: /Customize/i })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('Advanced controls')).toBeInTheDocument()
    })

    it('delegates toggle clicks to the parent controller', () => {
        const onToggle = vi.fn()

        render(
            <CustomizeAccordion title="Customize" expanded={false} onToggle={onToggle}>
                <div>Advanced controls</div>
            </CustomizeAccordion>
        )

        fireEvent.click(screen.getByRole('button', { name: /Customize/i }))

        expect(onToggle).toHaveBeenCalledTimes(1)
    })
})
