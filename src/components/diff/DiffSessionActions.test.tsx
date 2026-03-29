import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiffSessionActions } from './DiffSessionActions'
import type { EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

const mockPushToast = vi.fn()
vi.mock('../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}))

const mockFetchAndPasteToTerminal = vi.fn()
vi.mock('../../hooks/usePrComments', () => ({
  usePrComments: () => ({
    fetchingComments: false,
    fetchAndPasteToTerminal: mockFetchAndPasteToTerminal,
  }),
}))

vi.mock('../../common/i18n', () => ({
  useTranslation: () => ({
    t: {
      diffSessionActions: {
        sendPrComments: 'Send PR #{number} comments',
        fetching: 'Fetching...',
        prComments: 'PR #{number}',
        openPrInBrowser: 'Open PR #{number}',
        restartTerminals: 'Restart Terminals',
        discardAllChanges: 'Discard all changes',
        resetSession: 'Reset Session',
        markAsReviewedTitle: 'Mark as reviewed',
        markAsReviewed: 'Mark Reviewed',
      },
    },
    currentLanguage: 'en',
  }),
}))

vi.mock('../../common/uiEvents', async () => {
  const actual = await vi.importActual<typeof import('../../common/uiEvents')>('../../common/uiEvents')
  return { ...actual, emitUiEvent: vi.fn() }
})

vi.mock('../common/ConfirmResetDialog', () => ({
  ConfirmResetDialog: ({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) => {
    if (!open) return null
    return (
      <div data-testid="confirm-reset-dialog">
        <button data-testid="cancel-reset" onClick={onCancel}>Cancel</button>
        <button data-testid="confirm-reset" onClick={onConfirm}>Confirm</button>
      </div>
    )
  },
}))

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      name: 'test-session',
      branch: 'test-branch',
      worktree_path: '/tmp/wt',
      status: 'running',
      agent_type: 'claude',
      spec_content: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
      prompt: null,
      epic_id: null,
      pr_number: null,
      pr_url: null,
      ...overrides,
    },
    git_stats: null,
    terminals: [],
  } as EnrichedSession
}

function renderActions(props: Partial<Parameters<typeof DiffSessionActions>[0]> = {}) {
  const defaultProps = {
    isSessionSelection: true,
    sessionName: 'test-session',
    targetSession: createSession(),
    canMarkReviewed: false,
    onClose: vi.fn(),
    onReloadSessions: vi.fn().mockResolvedValue(undefined),
    onLoadChangedFiles: vi.fn().mockResolvedValue(undefined),
    children: ({ headerActions, dialogs }: { headerActions: React.ReactNode; dialogs: React.ReactNode }) => (
      <div>
        <div data-testid="header-actions">{headerActions}</div>
        <div data-testid="dialogs">{dialogs}</div>
      </div>
    ),
    ...props,
  }
  return render(<DiffSessionActions {...defaultProps} />)
}

describe('DiffSessionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
  })

  it('renders restart terminals button for session selection', () => {
    renderActions()
    expect(screen.getByText('Restart Terminals')).toBeTruthy()
  })

  it('renders reset session button for session selection', () => {
    renderActions()
    expect(screen.getByText('Reset Session')).toBeTruthy()
  })

  it('does not render header actions when not a session selection', () => {
    renderActions({ isSessionSelection: false })
    expect(screen.queryByText('Restart Terminals')).toBeNull()
    expect(screen.queryByText('Reset Session')).toBeNull()
  })

  it('renders mark reviewed button when canMarkReviewed is true', () => {
    renderActions({ canMarkReviewed: true })
    expect(screen.getByText('Mark Reviewed')).toBeTruthy()
  })

  it('does not render mark reviewed button when canMarkReviewed is false', () => {
    renderActions({ canMarkReviewed: false })
    expect(screen.queryByText('Mark Reviewed')).toBeNull()
  })

  it('calls invoke to restart terminals when restart button clicked', async () => {
    renderActions()
    fireEvent.click(screen.getByText('Restart Terminals'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.RestartSessionTerminals, {
        sessionName: 'test-session',
      })
    })
  })

  it('shows toast after restarting terminals', async () => {
    renderActions()
    fireEvent.click(screen.getByText('Restart Terminals'))

    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'info', title: 'Terminals restarting' })
      )
    })
  })

  it('shows error toast when restart terminals fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('restart failed'))
    renderActions()
    fireEvent.click(screen.getByText('Restart Terminals'))

    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'error', title: 'Failed to restart terminals' })
      )
    })
  })

  it('opens confirm reset dialog when reset button clicked', () => {
    renderActions()
    fireEvent.click(screen.getByText('Reset Session'))
    expect(screen.getByTestId('confirm-reset-dialog')).toBeTruthy()
  })

  it('calls invoke to mark session reviewed', async () => {
    const onClose = vi.fn()
    const onReloadSessions = vi.fn().mockResolvedValue(undefined)
    renderActions({ canMarkReviewed: true, onClose, onReloadSessions })

    fireEvent.click(screen.getByText('Mark Reviewed'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, {
        name: 'test-session',
      })
    })
  })

  it('renders PR comment button when session has pr_number', () => {
    const session = createSession({ pr_number: 42 })
    renderActions({ targetSession: session })
    expect(screen.getByText('PR #42')).toBeTruthy()
  })

  it('renders PR external link when session has pr_url', () => {
    const session = createSession({ pr_number: 42, pr_url: 'https://github.com/pr/42' })
    renderActions({ targetSession: session })
    const linkButtons = screen.getAllByRole('button')
    const externalButton = linkButtons.find(b => b.getAttribute('title')?.includes('Open PR'))
    expect(externalButton).toBeTruthy()
  })

  it('does not render PR buttons when session has no pr_number', () => {
    renderActions()
    expect(screen.queryByText(/PR #/)).toBeNull()
  })

  it('handles confirm reset flow', async () => {
    const onLoadChangedFiles = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    renderActions({ onLoadChangedFiles, onClose })

    fireEvent.click(screen.getByText('Reset Session'))
    fireEvent.click(screen.getByTestId('confirm-reset'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetSessionWorktree, {
        sessionName: 'test-session',
      })
    })
  })
})
