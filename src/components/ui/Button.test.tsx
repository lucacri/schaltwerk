import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { theme } from '../../common/theme'
import { Button } from './Button'

describe('Button', () => {
  test('exposes the shared control height token', () => {
    expect(theme.control.height.md).toBe('var(--control-height-md)')
  })

  test('renders children text', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  test('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('renders disabled state', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  test('does not fire onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Disabled</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  test('renders primary variant', () => {
    render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders danger variant', () => {
    render(<Button variant="danger">Delete</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders warning variant', () => {
    render(<Button variant="warning">Warn</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders success variant', () => {
    render(<Button variant="success">Success</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders dashed variant', () => {
    render(<Button variant="dashed">+ Add</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  test('renders left icon', () => {
    render(<Button leftIcon={<span data-testid="left">+</span>}>Add</Button>)
    expect(screen.getByTestId('left')).toBeInTheDocument()
  })

  test('renders right icon', () => {
    render(<Button rightIcon={<span data-testid="right">&rarr;</span>}>Next</Button>)
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })

  test('disables interaction while loading', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Loading' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  test('applies custom className', () => {
    render(<Button className="custom">Test</Button>)
    expect(screen.getByRole('button').className).toContain('custom')
  })

  test('renders small size', () => {
    render(<Button size="sm">Small</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
