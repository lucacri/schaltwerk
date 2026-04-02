import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  test('renders unchecked', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Dark mode" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  test('renders checked', () => {
    render(<Toggle checked={true} onChange={() => {}} label="Dark mode" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  test('calls onChange with true when clicking unchecked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Preview localhost" />)
    await user.click(screen.getByRole('switch', { name: 'Preview localhost' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('calls onChange with false when clicking checked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle checked={true} onChange={onChange} label="Toggle" />)
    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  test('renders label text', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Notifications" />)
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  test('renders disabled state', () => {
    render(<Toggle checked={false} onChange={() => {}} disabled label="Disabled" />)
    expect(screen.getByRole('switch')).toBeDisabled()
  })

  test('does not call onChange when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle checked={false} disabled onChange={onChange} label="Disabled toggle" />)
    await user.click(screen.getByRole('switch', { name: 'Disabled toggle' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
