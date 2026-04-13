import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SidebarSectionHeader } from './SidebarSectionHeader'

describe('SidebarSectionHeader', () => {
  it('renders the shared section header contract and toggles collapse', () => {
    const onToggle = vi.fn()

    render(
      <SidebarSectionHeader
        title="Running"
        count={4}
        collapsed={false}
        toggleLabel="Collapse running section"
        onToggle={onToggle}
      />,
    )

    const button = screen.getByRole('button', { name: 'Collapse running section' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-section-divider')).toBeInTheDocument()

    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('marks the section collapsed when requested', () => {
    render(
      <SidebarSectionHeader
        title="Specs"
        count={2}
        collapsed
        toggleLabel="Expand specs section"
        onToggle={() => {}}
      />,
    )

    const button = screen.getByRole('button', { name: 'Expand specs section' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('sidebar-section-chevron')).toBeInTheDocument()
  })

  it('renders the count inside a bordered pill matching the style guide', () => {
    render(
      <SidebarSectionHeader
        title="Running"
        count={7}
        collapsed={false}
        toggleLabel="Collapse running section"
        onToggle={() => {}}
      />,
    )

    const countPill = screen.getByTestId('sidebar-section-count')
    expect(countPill).toHaveTextContent('7')
    expect(countPill.className).toMatch(/border/)
    expect(countPill.className).toMatch(/rounded/)
  })
})
