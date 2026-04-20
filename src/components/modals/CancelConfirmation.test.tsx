import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CancelConfirmation } from './CancelConfirmation'
import type { CancelBlocker } from '../../common/events'

describe('CancelConfirmation', () => {
  const baseProps = {
    open: true,
    displayName: 'sess',
    branch: 'para/sess',
    hasUncommittedChanges: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders and confirms cancel', () => {
    const onConfirm = vi.fn()
    render(<CancelConfirmation {...baseProps} onConfirm={onConfirm} />)
    expect(screen.getByText('Cancel Session: sess (para/sess)?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cancel Session/ }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('renders warning when uncommitted and still asks for normal cancel first', () => {
    const onConfirm = vi.fn()
    render(<CancelConfirmation {...baseProps} hasUncommittedChanges={true} onConfirm={onConfirm} />)
    expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Cancel Session/ }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('handles keyboard: Esc cancels, Enter confirms', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<CancelConfirmation {...baseProps} onConfirm={onConfirm} onCancel={onCancel} hasUncommittedChanges={false} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  const blockerCases: Array<[string, CancelBlocker, string, string]> = [
    [
      'UncommittedChanges',
      { type: 'UncommittedChanges', data: { files: ['src/App.tsx', 'README.md'] } },
      'Uncommitted changes are present',
      'src/App.tsx',
    ],
    [
      'OrphanedWorktree',
      { type: 'OrphanedWorktree', data: { expected_path: '/tmp/project/.lucode/worktrees/missing' } },
      'The worktree folder is already missing',
      '/tmp/project/.lucode/worktrees/missing',
    ],
    [
      'WorktreeLocked',
      { type: 'WorktreeLocked', data: { reason: 'maintenance' } },
      'The git worktree is locked',
      'maintenance',
    ],
    [
      'GitError',
      { type: 'GitError', data: { operation: 'inspect_uncommitted_changes', message: 'permission denied' } },
      'Git could not inspect the worktree',
      'permission denied',
    ],
  ]

  it.each(blockerCases)('renders structured blocker details for %s', (_variant, cancelBlocker, reason, detail) => {
    const onForceRemove = vi.fn()
    render(
      <CancelConfirmation
        {...baseProps}
        cancelBlocker={cancelBlocker}
        onForceRemove={onForceRemove}
      />
    )

    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes(detail))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Force remove \(discards work\)/ }))
    expect(onForceRemove).toHaveBeenCalled()
  })
})
