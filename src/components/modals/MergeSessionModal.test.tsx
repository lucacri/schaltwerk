import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, type MockedFunction } from 'vitest'
import { MergeSessionModal, MergeModeOption } from './MergeSessionModal'
import { ModalProvider } from '../../contexts/ModalContext'
import { TauriCommands } from '../../common/tauriCommands'
import type { ReactNode } from 'react'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null)
}))
import { invoke } from '@tauri-apps/api/core'
const invokeMock = invoke as MockedFunction<(cmd: string, args?: unknown) => Promise<unknown>>

const preview = {
  sessionBranch: 'feature/test-session',
  parentBranch: 'main',
  squashCommands: ['git reset --soft main', 'git commit -m "message"'],
  reapplyCommands: ['git rebase main'],
  defaultCommitMessage: 'Merge test session',
  hasConflicts: false,
  conflictingPaths: [],
  isUpToDate: false,
  commitsAheadCount: 3,
  commits: [
    { id: 'abc1234', subject: 'feat: add login', author: 'Alice', timestamp: 1700000000000 },
    { id: 'def5678', subject: 'fix: resolve bug', author: 'Bob', timestamp: 1700000100000 },
    { id: 'ghi9012', subject: 'chore: update deps', author: 'Alice', timestamp: 1700000200000 },
  ],
}

const singleCommitPreview = {
  ...preview,
  commitsAheadCount: 1,
  commits: [
    { id: 'abc1234', subject: 'feat: add login', author: 'Alice', timestamp: 1700000000000 },
  ],
}

function renderModal(
  props: Partial<React.ComponentProps<typeof MergeSessionModal>> = {}
) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const onResolveInAgentSession = vi.fn()
  const {
    autoCancelEnabled = false,
    onToggleAutoCancel = vi.fn(),
    ...rest
  } = props

  render(
    <ModalProvider>
      <MergeSessionModal
        open
        sessionName="test-session"
        status="ready"
        preview={preview}
        onClose={onClose}
        onConfirm={onConfirm}
        onResolveInAgentSession={onResolveInAgentSession}
        autoCancelEnabled={autoCancelEnabled}
        onToggleAutoCancel={onToggleAutoCancel}
        {...rest}
      />
    </ModalProvider>
  )

  return { onConfirm, onClose, onToggleAutoCancel, onResolveInAgentSession }
}

function findConfirmButton(): HTMLButtonElement {
  const button = screen.getAllByRole('button').find(el => el.textContent?.includes('Merge session'))
  if (!button) {
    throw new Error('Confirm button not found')
  }
  return button as HTMLButtonElement
}

describe('MergeSessionModal', () => {
  it('starts with an empty commit message and focuses the field', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('hides the command preview list', () => {
    renderModal()
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('requires commit message in squash mode', () => {
    renderModal()
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    const confirm = findConfirmButton()
    expect(confirm).toBeDisabled()
  })

  it('allows merge in reapply mode without commit message', () => {
    const { onConfirm } = renderModal()
    const reapplyButton = screen.getByRole('button', { name: 'Reapply commits' })
    fireEvent.click(reapplyButton)
    const confirm = findConfirmButton()
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('reapply' as MergeModeOption)
  })

  it('renders resolve-in-agent action for conflict state', () => {
    const { onResolveInAgentSession } = renderModal({
      preview: {
        ...preview,
        hasConflicts: true,
        conflictingPaths: ['src/conflict.ts'],
      },
    })

    const confirm = findConfirmButton()
    expect(confirm).toBeDisabled()

    const resolve = screen.getByRole('button', { name: 'Resolve in agent session' })
    fireEvent.click(resolve)

    expect(onResolveInAgentSession).toHaveBeenCalledTimes(1)
  })

  it('renders auto-cancel toggle reflecting disabled state', () => {
    renderModal({ autoCancelEnabled: false })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(toggle).toHaveClass('peer', 'sr-only')
  })

  it('invokes toggle handler with next state', () => {
    const onToggleAutoCancel = vi.fn()
    renderModal({ autoCancelEnabled: false, onToggleAutoCancel })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' })
    fireEvent.click(toggle)
    expect(onToggleAutoCancel).toHaveBeenCalledWith(true)
  })

  it('restores cached commit message and syncs updates', () => {
    const cached = 'Cached commit message'
    const onCommitMessageChange = vi.fn()
    renderModal({ cachedCommitMessage: cached, onCommitMessageChange })
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    expect(input.value).toBe(cached)

    fireEvent.change(input, { target: { value: 'Updated commit' } })
    expect(onCommitMessageChange).toHaveBeenCalledWith('Updated commit')
  })

  it('marks toggle as pressed when enabled', () => {
    renderModal({ autoCancelEnabled: true })
    const toggle = screen.getByRole('checkbox', { name: 'Auto-cancel after merge' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('surfaces keyboard hints for cancel and confirm actions', () => {
    renderModal()
    const cancel = screen.getAllByRole('button').find(button => button.textContent?.includes('Cancel'))
    expect(cancel).toBeDefined()
    expect(cancel!.textContent).toMatch(/Esc/)
    const confirm = findConfirmButton()
    expect(confirm.textContent).toMatch(/⌘↵/)
  })

  it('focuses commit input after preview finishes loading', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ModalProvider>{children}</ModalProvider>
    )

    const modalProps = {
      sessionName: 'test-session',
      onClose: vi.fn(),
      onConfirm: vi.fn(),
      autoCancelEnabled: false,
      onToggleAutoCancel: vi.fn(),
    }

    const { rerender } = render(
      <MergeSessionModal
        open
        status="loading"
        preview={null}
        {...modalProps}
      />,
      { wrapper },
    )

    expect(screen.queryByLabelText('Commit message')).toBeNull()

    rerender(
      <MergeSessionModal
        open
        status="ready"
        preview={preview}
        {...modalProps}
      />,
    )

    const input = await screen.findByLabelText('Commit message')
    expect(document.activeElement).toBe(input)
  })

  it('defaults to squash mode without prefillMode', () => {
    renderModal()
    expect(screen.getByLabelText('Commit message')).toBeInTheDocument()
  })

  it('selects reapply mode when prefillMode is reapply', () => {
    renderModal({ prefillMode: 'reapply' })
    expect(screen.queryByLabelText('Commit message')).toBeNull()
  })

  it('selects squash mode when prefillMode is squash', () => {
    renderModal({ prefillMode: 'squash' })
    expect(screen.getByLabelText('Commit message')).toBeInTheDocument()
  })

  describe('generate commit message button', () => {
    it('renders the generate commit message button in squash mode', () => {
      renderModal()
      expect(screen.getByTestId('generate-commit-message-button')).toBeInTheDocument()
    })

    it('does not render in reapply mode', () => {
      renderModal({ prefillMode: 'reapply' })
      expect(screen.queryByTestId('generate-commit-message-button')).toBeNull()
    })

    it('calls the generate command and populates commit message', async () => {
      const onCommitMessageChange = vi.fn()
      invokeMock.mockResolvedValueOnce('feat(auth): add login flow')

      renderModal({ onCommitMessageChange })
      const btn = screen.getByTestId('generate-commit-message-button')

      await act(async () => {
        fireEvent.click(btn)
      })

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith(
          TauriCommands.SchaltwerkCoreGenerateCommitMessage,
          { sessionName: 'test-session' }
        )
      })

      await waitFor(() => {
        const input = screen.getByLabelText('Commit message') as HTMLInputElement
        expect(input.value).toBe('feat(auth): add login flow')
      })

      expect(onCommitMessageChange).toHaveBeenCalledWith('feat(auth): add login flow')
    })

    it('shows spinner while generating', async () => {
      let resolveGenerate: (value: unknown) => void = () => {}
      invokeMock.mockImplementationOnce(() => new Promise(resolve => { resolveGenerate = resolve }))

      renderModal()
      const btn = screen.getByTestId('generate-commit-message-button')

      await act(async () => {
        fireEvent.click(btn)
      })

      await waitFor(() => {
        expect(btn).toBeDisabled()
      })

      await act(async () => {
        resolveGenerate('fix: something')
      })

      await waitFor(() => {
        expect(btn).not.toBeDisabled()
      })
    })
  })

  describe('commit list', () => {
    it('renders commit list when commits are present', () => {
      renderModal()
      expect(screen.getByText('abc1234')).toBeInTheDocument()
      expect(screen.getByText('feat: add login')).toBeInTheDocument()
      expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    })

    it('shows overflow footer when commitsAheadCount exceeds commits length', () => {
      renderModal({
        preview: {
          ...preview,
          commitsAheadCount: 55,
          commits: preview.commits,
        },
      })
      expect(screen.getByText(/52 more commits/)).toBeInTheDocument()
    })

    it('does not show overflow footer when all commits are shown', () => {
      renderModal()
      expect(screen.queryByText(/more commits/)).toBeNull()
    })

    it('does not render commit list when up to date', () => {
      renderModal({
        preview: {
          ...preview,
          isUpToDate: true,
        },
      })
      expect(screen.queryByText('abc1234')).toBeNull()
    })

    it('shows commit list for single commit', () => {
      renderModal({ preview: singleCommitPreview })
      expect(screen.getByText('abc1234')).toBeInTheDocument()
      expect(screen.getByText('feat: add login')).toBeInTheDocument()
    })
  })

  describe('single commit fast-forward', () => {
    it('hides strategy buttons when commitsAheadCount is 1', () => {
      renderModal({ preview: singleCommitPreview })
      expect(screen.queryByRole('button', { name: 'Squash & fast-forward' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reapply commits' })).toBeNull()
    })

    it('shows fast-forward description when commitsAheadCount is 1', () => {
      renderModal({ preview: singleCommitPreview })
      expect(screen.getByText(/fast-forward the parent branch directly/)).toBeInTheDocument()
    })

    it('hides commit message input when commitsAheadCount is 1', () => {
      renderModal({ preview: singleCommitPreview })
      expect(screen.queryByLabelText('Commit message')).toBeNull()
    })

    it('confirms with reapply mode when commitsAheadCount is 1', () => {
      const { onConfirm } = renderModal({ preview: singleCommitPreview })
      const confirm = findConfirmButton()
      expect(confirm).not.toBeDisabled()
      fireEvent.click(confirm)
      expect(onConfirm).toHaveBeenCalledWith('reapply')
    })

    it('shows strategy buttons when commitsAheadCount > 1', () => {
      renderModal({ preview: { ...preview, commitsAheadCount: 3 } })
      expect(screen.getByRole('button', { name: 'Squash & fast-forward' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reapply commits' })).toBeInTheDocument()
    })
  })
})
