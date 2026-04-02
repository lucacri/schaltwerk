import { render, screen } from '@testing-library/react'
import { Label } from './Label'

describe('Label', () => {
  test('renders children text', () => {
    render(<Label>Username</Label>)
    expect(screen.getByText('Username')).toBeInTheDocument()
  })

  test('associates with input via htmlFor', () => {
    render(<Label htmlFor="username-input">Username</Label>)
    const label = screen.getByText('Username')
    expect(label.closest('label')).toHaveAttribute('for', 'username-input')
  })

  test('shows required indicator when required', () => {
    render(<Label required>Email</Label>)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  test('does not show required indicator by default', () => {
    render(<Label>Email</Label>)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  test('applies custom className', () => {
    render(<Label className="custom-class">Test</Label>)
    const label = screen.getByText('Test').closest('label')
    expect(label?.className).toContain('custom-class')
  })
})
