import { render, screen } from '@testing-library/react'
import { FormGroup } from './FormGroup'

describe('FormGroup', () => {
  test('renders label and children', () => {
    render(
      <FormGroup label="Name" htmlFor="name">
        <input id="name" />
      </FormGroup>
    )
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  test('renders help text', () => {
    render(
      <FormGroup label="Path" help="Absolute path to the binary">
        <input />
      </FormGroup>
    )
    expect(screen.getByText('Absolute path to the binary')).toBeInTheDocument()
  })

  test('renders error text', () => {
    render(
      <FormGroup label="Email" error="Invalid email address">
        <input />
      </FormGroup>
    )
    expect(screen.getByText('Invalid email address')).toBeInTheDocument()
  })

  test('shows both help and error text simultaneously', () => {
    render(
      <FormGroup label="Email" help="Enter your email" error="Invalid">
        <input />
      </FormGroup>
    )
    expect(screen.getByText('Invalid')).toBeInTheDocument()
    expect(screen.getByText('Enter your email')).toBeInTheDocument()
  })

  test('associates label with htmlFor', () => {
    render(
      <FormGroup label="Name" htmlFor="name-input">
        <input id="name-input" />
      </FormGroup>
    )
    expect(screen.getByText('Name').closest('label')).toHaveAttribute('for', 'name-input')
  })

  test('injects aria-describedby into child element', () => {
    render(
      <FormGroup label="Branch prefix" htmlFor="bp" help="Used when creating branches" error="Required">
        <input id="bp" />
      </FormGroup>
    )
    expect(screen.getByLabelText('Branch prefix')).toHaveAttribute('aria-describedby')
  })

  test('shows required indicator', () => {
    render(
      <FormGroup label="Email" required>
        <input />
      </FormGroup>
    )
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  test('applies custom className', () => {
    const { container } = render(
      <FormGroup label="X" className="custom">
        <input />
      </FormGroup>
    )
    expect(container.firstElementChild?.className).toContain('custom')
  })
})
