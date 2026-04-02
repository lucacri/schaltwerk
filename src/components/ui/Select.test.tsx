import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from './Select'

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
]

describe('Select', () => {
  test('renders with placeholder when no value selected', () => {
    render(<Select value="" onChange={() => {}} options={options} placeholder="Choose fruit" />)
    expect(screen.getByRole('combobox', { name: 'Choose fruit' })).toBeInTheDocument()
  })

  test('renders selected option label', () => {
    render(<Select value="banana" onChange={() => {}} options={options} />)
    expect(screen.getByRole('combobox', { name: 'Banana' })).toBeInTheDocument()
  })

  test('opens and selects an option with the mouse', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="" onChange={onChange} options={options} placeholder="Choose" />)
    await user.click(screen.getByRole('combobox', { name: 'Choose' }))
    await user.click(screen.getByRole('option', { name: 'Cherry' }))
    expect(onChange).toHaveBeenCalledWith('cherry')
  })

  test('closes dropdown after selection', async () => {
    const user = userEvent.setup()
    render(<Select value="" onChange={() => {}} options={options} placeholder="Choose" />)
    await user.click(screen.getByRole('combobox', { name: 'Choose' }))
    await user.click(screen.getByRole('option', { name: 'Apple' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('supports keyboard navigation and selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="apple" onChange={onChange} options={options} />)
    const trigger = screen.getByRole('combobox', { name: 'Apple' })
    trigger.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('banana')
  })

  test('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<Select value="" onChange={() => {}} options={options} placeholder="Choose" />)
    await user.click(screen.getByRole('combobox', { name: 'Choose' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('supports type-ahead while open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="" onChange={onChange} options={options} placeholder="Choose" />)
    const trigger = screen.getByRole('combobox', { name: 'Choose' })
    trigger.focus()
    await user.keyboard('{ArrowDown}c{Enter}')
    expect(onChange).toHaveBeenCalledWith('cherry')
  })

  test('renders disabled state', () => {
    render(<Select value="" onChange={() => {}} options={options} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  test('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(<Select value="" onChange={() => {}} options={options} disabled />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
