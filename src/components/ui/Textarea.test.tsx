import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from './Textarea'

describe('Textarea', () => {
  test('renders with value', () => {
    render(<Textarea value="content" onChange={() => {}} aria-label="Notes" />)
    expect(screen.getByRole('textbox')).toHaveValue('content')
  })

  test('forwards changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Textarea aria-label="Prompt" value="" onChange={onChange} />)
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'hello')
    expect(onChange).toHaveBeenCalled()
  })

  test('renders placeholder', () => {
    render(<Textarea value="" onChange={() => {}} placeholder="Enter script..." />)
    expect(screen.getByPlaceholderText('Enter script...')).toBeInTheDocument()
  })

  test('renders disabled', () => {
    render(<Textarea value="" onChange={() => {}} disabled aria-label="Notes" />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  test('applies rows attribute', () => {
    render(<Textarea value="" onChange={() => {}} rows={5} aria-label="Notes" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '5')
  })

  test('supports resize and monospace options', () => {
    render(<Textarea aria-label="Script" value="" onChange={() => {}} resize="vertical" monospace />)
    const textarea = screen.getByRole('textbox', { name: 'Script' })
    expect(textarea).toHaveAttribute('data-resize', 'vertical')
    expect(textarea).toHaveAttribute('data-monospace', 'true')
  })

  test('forwards additional textarea attributes', () => {
    render(<Textarea value="" onChange={() => {}} aria-label="description" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-label', 'description')
  })
})
