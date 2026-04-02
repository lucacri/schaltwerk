import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  test('renders with value', () => {
    render(<TextInput value="hello" onChange={() => {}} aria-label="Name" />)
    expect(screen.getByRole('textbox')).toHaveValue('hello')
  })

  test('forwards change events', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextInput aria-label="Branch prefix" value="lucode" onChange={onChange} />)
    await user.type(screen.getByRole('textbox', { name: 'Branch prefix' }), '-dev')
    expect(onChange).toHaveBeenCalled()
  })

  test('renders placeholder', () => {
    render(<TextInput value="" onChange={() => {}} placeholder="Enter text..." />)
    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument()
  })

  test('renders disabled state', () => {
    render(<TextInput value="" onChange={() => {}} disabled aria-label="Name" />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  test('renders left and right adornments', () => {
    render(
      <TextInput
        aria-label="Search"
        value=""
        onChange={() => {}}
        leftIcon={<span data-testid="left-icon">L</span>}
        rightElement={<button type="button">Clear</button>}
      />
    )
    expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  test('renders an error message and invalid state', () => {
    render(<TextInput aria-label="Name" value="" onChange={() => {}} error="Required" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  test('forwards additional input props', () => {
    render(<TextInput value="" onChange={() => {}} aria-label="search" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-label', 'search')
  })
})
