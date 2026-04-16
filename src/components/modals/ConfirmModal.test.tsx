import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ConfirmModal } from './ConfirmModal'

function openModal(overrides: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmModal
      open={true}
      title={overrides.title ?? 'Confirm action'}
      body={overrides.body ?? 'Are you sure?'}
      confirmText={overrides.confirmText ?? 'Confirm'}
      cancelText={overrides.cancelText ?? 'Cancel'}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmDisabled={overrides.confirmDisabled ?? false}
      loading={overrides.loading ?? false}
      variant={overrides.variant ?? 'default'}
    />
  )
  return { onConfirm, onCancel }
}

describe('ConfirmModal', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders title/body and buttons when open', () => {
    openModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Confirm action')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeInTheDocument()
  })

  it('portals the dialog to document.body so parent layout does not clip it', () => {
    const { container } = render(
      <div data-testid="layout-shell" className="overflow-hidden">
        <ConfirmModal
          open={true}
          title="Confirm action"
          body="Are you sure?"
          confirmText="Confirm"
          cancelText="Cancel"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>
    )

    const dialog = screen.getByRole('dialog')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body).toContainElement(dialog)
  })

  it('invokes onCancel on Esc key', async () => {
    const { onCancel } = openModal()
    const esc = new KeyboardEvent('keydown', { key: 'Escape' })
    window.dispatchEvent(esc)
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
  })

  it('invokes onConfirm on Enter key when enabled', async () => {
    const { onConfirm } = openModal()
    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    window.dispatchEvent(enter)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('does not confirm when loading or disabled', async () => {
    const { onConfirm: onConfirmDisabled } = openModal({ confirmDisabled: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await waitFor(() => {
      expect(onConfirmDisabled).not.toHaveBeenCalled()
    })

    cleanup()
    const { onConfirm: onConfirmLoading } = openModal({ loading: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await waitFor(() => {
      expect(onConfirmLoading).not.toHaveBeenCalled()
    })
  })

  it('focuses confirm button when opened', async () => {
    openModal()
    const confirm = screen.getByRole('button', { name: /Confirm/i })
    await waitFor(() => expect(confirm).toHaveFocus())
  })

  it('clicking buttons triggers handlers', async () => {
    const { onConfirm, onCancel } = openModal()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled()
      expect(onConfirm).toHaveBeenCalled()
    })
  })

  it('renders an optional tertiary action between cancel and confirm', () => {
    const onTertiary = vi.fn()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmModal
        open
        title="Title"
        confirmText="Confirm"
        cancelText="Cancel"
        tertiaryText="Tertiary"
        onTertiary={onTertiary}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Tertiary/i }))
    expect(onTertiary).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('omits tertiary button when tertiaryText is undefined', () => {
    render(
      <ConfirmModal
        open
        title="Title"
        confirmText="Confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /Tertiary/i })).toBeNull()
  })

  it('disables tertiary when loading or tertiaryDisabled is true', () => {
    const onTertiary = vi.fn()
    render(
      <ConfirmModal
        open
        title="Title"
        confirmText="Confirm"
        cancelText="Cancel"
        tertiaryText="Tertiary"
        tertiaryDisabled
        onTertiary={onTertiary}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Tertiary/i }))
    expect(onTertiary).not.toHaveBeenCalled()
  })
})
