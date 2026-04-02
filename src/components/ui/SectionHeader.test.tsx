import { render, screen } from '@testing-library/react'
import { SectionHeader } from './SectionHeader'

describe('SectionHeader', () => {
  test('renders title as heading', () => {
    render(<SectionHeader title="Appearance" />)
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  })

  test('renders description when provided', () => {
    render(<SectionHeader title="Theme" description="Choose your color theme" />)
    expect(screen.getByText('Choose your color theme')).toBeInTheDocument()
  })

  test('does not render description element when not provided', () => {
    const { container } = render(<SectionHeader title="Theme" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  test('applies custom className', () => {
    const { container } = render(<SectionHeader title="Test" className="my-class" />)
    expect(container.firstElementChild?.className).toContain('my-class')
  })
})
