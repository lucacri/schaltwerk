import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CloseConfirmation } from './CloseConfirmation'

describe('CloseConfirmation', () => {
  const baseProps = {
    open: true,
    runningCount: 3,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('does not render when closed', () => {
    render(<CloseConfirmation {...baseProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders with running session count', () => {
    render(<CloseConfirmation {...baseProps} />)
    expect(screen.getByText(/3 running session/)).toBeInTheDocument()
  })

  it('calls onConfirm when confirm clicked', () => {
    const onConfirm = vi.fn()
    render(<CloseConfirmation {...baseProps} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /Close/ }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn()
    render(<CloseConfirmation {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Keep Open/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('handles keyboard: Esc cancels, Enter confirms', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<CloseConfirmation {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
