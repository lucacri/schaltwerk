import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabErrorDetailsModal } from '../GitlabErrorDetailsModal'
import { describe, it, expect, vi } from 'vitest'

describe('GitlabErrorDetailsModal', () => {
  it('renders per-source errors', () => {
    const errors = [
      { sourceLabel: 'Backend', error: 'glab command failed: 403 Forbidden' },
      { sourceLabel: 'Frontend', error: 'glab command failed: network timeout' },
    ]
    renderWithProviders(
      <GitlabErrorDetailsModal errors={errors} onClose={vi.fn()} />
    )

    expect(screen.getByText('Backend')).toBeInTheDocument()
    expect(screen.getByText('glab command failed: 403 Forbidden')).toBeInTheDocument()
    expect(screen.getByText('Frontend')).toBeInTheDocument()
    expect(screen.getByText('glab command failed: network timeout')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <GitlabErrorDetailsModal
        errors={[{ sourceLabel: 'Test', error: 'error' }]}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <GitlabErrorDetailsModal
        errors={[{ sourceLabel: 'Test', error: 'error' }]}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
