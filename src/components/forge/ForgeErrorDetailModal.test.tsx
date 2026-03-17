import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../tests/test-utils'
import { ForgeErrorDetailModal } from './ForgeErrorDetailModal'
import { describe, it, expect, vi } from 'vitest'

const sampleErrors = [
  { sourceLabel: 'GitHub', error: 'gh command failed: exit status 1\nstderr: authentication required' },
  { sourceLabel: 'GitLab', error: 'glab command failed: 403 Forbidden' },
]

describe('ForgeErrorDetailModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = renderWithProviders(
      <ForgeErrorDetailModal isOpen={false} onClose={vi.fn()} errorDetails={sampleErrors} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders modal with error details when open', () => {
    renderWithProviders(
      <ForgeErrorDetailModal isOpen={true} onClose={vi.fn()} errorDetails={sampleErrors} />
    )

    expect(screen.getByText('Error Details')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText((_, el) =>
      el?.tagName === 'PRE' && el.textContent === 'gh command failed: exit status 1\nstderr: authentication required'
    )).toBeInTheDocument()
    expect(screen.getByText('GitLab')).toBeInTheDocument()
    expect(screen.getByText('glab command failed: 403 Forbidden')).toBeInTheDocument()
  })

  it('closes on X button click', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ForgeErrorDetailModal isOpen={true} onClose={onClose} errorDetails={sampleErrors} />
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ForgeErrorDetailModal isOpen={true} onClose={onClose} errorDetails={sampleErrors} />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on backdrop click', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ForgeErrorDetailModal isOpen={true} onClose={onClose} errorDetails={sampleErrors} />
    )

    fireEvent.click(screen.getByText('Error Details').closest('[data-testid="modal-backdrop"]')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when clicking modal content', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <ForgeErrorDetailModal isOpen={true} onClose={onClose} errorDetails={sampleErrors} />
    )

    fireEvent.click(screen.getByText('Error Details'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
