import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  test('renders unchecked by default', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Remember me" />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  test('renders checked when checked prop is true', () => {
    render(<Checkbox checked={true} onChange={() => {}} label="Remember me" />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  test('calls onChange with boolean when toggled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Enable previews" />)
    await user.click(screen.getByRole('checkbox', { name: 'Enable previews' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('renders label text', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Subscribe" />)
    expect(screen.getByText('Subscribe')).toBeInTheDocument()
  })

  test('renders without label', () => {
    render(<Checkbox checked={false} onChange={() => {}} />)
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  test('renders disabled state', () => {
    render(<Checkbox checked={false} onChange={() => {}} disabled label="Disabled" />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  test('does not fire changes when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} disabled onChange={onChange} label="Disabled" />)
    await user.click(screen.getByRole('checkbox', { name: 'Disabled' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  test('exposes mixed state when indeterminate', () => {
    render(<Checkbox checked={false} indeterminate onChange={() => {}} label="Partial selection" />)
    expect(screen.getByRole('checkbox', { name: 'Partial selection' })).toHaveAttribute('aria-checked', 'mixed')
  })

  test('applies custom className', () => {
    const { container } = render(
      <Checkbox checked={false} onChange={() => {}} className="custom" label="Test" />
    )
    expect(container.firstElementChild?.className).toContain('custom')
  })
})
