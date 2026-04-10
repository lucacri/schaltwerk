import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { DiffSessionActions } from '../DiffSessionActions'
import { TauriCommands } from '../../../common/tauriCommands'
import type { EnrichedSession } from '../../../types/session'
import { renderWithProviders } from '../../../tests/test-utils'

const invokeMock = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
  switch (command) {
    case TauriCommands.SchaltwerkCoreResetSessionWorktree:
      return undefined
    default:
      return null
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'demo',
      display_name: 'Demo Session',
      branch: 'feature/demo',
      worktree_path: '/tmp/demo',
      base_branch: 'main',
      status: 'active',
      is_current: true,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
      has_uncommitted_changes: false,
      ...overrides
    },
    status: undefined,
    terminals: []
  }
}

describe('DiffSessionActions', () => {
  beforeEach(() => {
    invokeMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders session controls', async () => {
    const onLoadChangedFiles = vi.fn(async () => {})

    renderWithProviders(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession()}
        onClose={vi.fn()}
        onLoadChangedFiles={onLoadChangedFiles}
      >
        {({ headerActions, dialogs }) => (
          <>
            <div data-testid="header">{headerActions}</div>
            <div data-testid="content">{dialogs}</div>
          </>
        )}
      </DiffSessionActions>
    )

    expect(await screen.findByRole('button', { name: /reset session/i })).toBeInTheDocument()
  })

  it('does not render a manual ready action', () => {
    renderWithProviders(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession({ ready_to_merge: true })}
        onClose={() => {}}
        onLoadChangedFiles={async () => {}}
      >
        {({ headerActions }) => <div data-testid="header">{headerActions}</div>}
      </DiffSessionActions>
    )

    expect(screen.queryByRole('button', { name: /mark as reviewed/i })).toBeNull()
  })

  it('resets the session worktree after confirmation', async () => {
    const onClose = vi.fn()
    const onLoadChangedFiles = vi.fn(async () => {})

    renderWithProviders(
      <DiffSessionActions
        isSessionSelection={true}
        sessionName="demo"
        targetSession={createSession()}
        onClose={onClose}
        onLoadChangedFiles={onLoadChangedFiles}
      >
        {({ headerActions, dialogs }) => (
          <>
            <div data-testid="header">{headerActions}</div>
            <div data-testid="dialogs">{dialogs}</div>
          </>
        )}
      </DiffSessionActions>
    )

    const resetButton = await screen.findByRole('button', { name: /reset session/i })
    fireEvent.click(resetButton)

    await screen.findByText(/Reset Session Worktree/i)
    const confirm = await screen.findByRole('button', { name: /^Reset$/i })
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreResetSessionWorktree,
        expect.objectContaining({ sessionName: 'demo' })
      )
    })

    await waitFor(() => expect(onLoadChangedFiles).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
