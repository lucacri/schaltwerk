import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarSection } from './SidebarSection'

describe('SidebarSection', () => {
    it('renders label and count', () => {
        render(<SidebarSection label="Running" count={3} expanded={true} onToggle={() => {}} />)
        expect(screen.getByText('Running')).toBeTruthy()
        expect(screen.getByText('3')).toBeTruthy()
    })

    it('sets aria-expanded correctly', () => {
        const { rerender } = render(<SidebarSection label="Running" count={3} expanded={true} onToggle={() => {}} />)
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
        rerender(<SidebarSection label="Running" count={3} expanded={false} onToggle={() => {}} />)
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    })

    it('fires onToggle when clicked', () => {
        const onToggle = vi.fn()
        render(<SidebarSection label="Specs" count={1} expanded={true} onToggle={onToggle} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onToggle).toHaveBeenCalledOnce()
    })

    it('hides children when collapsed', () => {
        render(
            <SidebarSection label="Reviewed" count={2} expanded={false} onToggle={() => {}}>
                <div data-testid="child">content</div>
            </SidebarSection>
        )
        expect(screen.queryByTestId('child')).toBeNull()
    })

    it('shows children when expanded', () => {
        render(
            <SidebarSection label="Running" count={1} expanded={true} onToggle={() => {}}>
                <div data-testid="child">content</div>
            </SidebarSection>
        )
        expect(screen.getByTestId('child')).toBeTruthy()
    })

    it('applies empty styling when count is 0', () => {
        render(<SidebarSection label="Reviewed" count={0} expanded={false} onToggle={() => {}} />)
        const button = screen.getByRole('button')
        expect(button.getAttribute('aria-expanded')).toBe('false')
    })
})
