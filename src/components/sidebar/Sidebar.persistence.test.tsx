import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import type { EnrichedSession } from '../../types/session'
import type { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

const createSession = (id: string, createdAt: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active' as const,
    created_at: createdAt,
    last_modified: createdAt,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    session_state: readyToMerge ? 'reviewed' : 'running',
    ready_to_merge: readyToMerge,
  },
  terminals: [],
})

describe('Sidebar session ordering and persistence', () => {
  let savedFilterMode: string = 'running'
  let lastPersistedSettings: Record<string, unknown> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    savedFilterMode = 'running'
    lastPersistedSettings = null

    const sessions = [
      createSession('test_session_a', '2024-01-01T10:00:00Z'),
      createSession('test_session_b', '2024-01-02T10:00:00Z'),
      createSession('test_session_c', '2023-12-31T10:00:00Z'),
      createSession('reviewed_session', '2024-01-03T10:00:00Z', true),
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return sessions
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetCurrentDirectory:
          return '/test/dir'
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
          return true
        case 'get_buffer':
          return ''
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: savedFilterMode, sort_mode: 'legacy-name' }
        case TauriCommands.SetProjectSessionsSettings: {
          const incoming = (args as { settings?: { filter_mode?: string } })?.settings ?? {}
          savedFilterMode = incoming.filter_mode || savedFilterMode
          lastPersistedSettings = incoming
          return undefined
        }
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sorts running sessions by creation date descending', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const orderedButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(orderedButtons[0]).toHaveTextContent('test_session_b') // newest
    expect(orderedButtons[1]).toHaveTextContent('test_session_a')
    expect(orderedButtons[2]).toHaveTextContent('test_session_c') // oldest
  })

  it('shows reviewed sessions in the Reviewed section when expanded', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    const reviewedSection = await screen.findByTestId('sidebar-section-reviewed')
    fireEvent.click(within(reviewedSection).getByRole('button'))

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('reviewed_session')
      })
      expect(sessionButtons).toHaveLength(1)
      expect(sessionButtons[0]).toHaveTextContent('reviewed_session')
    })
  })
})
