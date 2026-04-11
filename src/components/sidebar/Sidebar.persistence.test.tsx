import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { FilterMode } from '../../types/sessionFilters'
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
    session_state: 'running',
    ready_to_merge: readyToMerge,
  },
  terminals: [],
})

const sessionRows = () => screen.getAllByRole('button').filter(button => button.hasAttribute('data-session-id'))

describe('Sidebar session ordering and persistence', () => {
  let savedFilterMode: string = FilterMode.Running
  let lastPersistedSettings: Record<string, unknown> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    savedFilterMode = FilterMode.Running
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
      expect(sessionRows()).toHaveLength(4)
    })

    const orderedButtons = sessionRows()

    expect(orderedButtons.map(button => button.getAttribute('data-session-id'))).toEqual([
      'test_session_b',
      'test_session_a',
      'test_session_c',
      'reviewed_session',
    ])
  })

  it('keeps ready sessions in the running filter', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(sessionRows().map(button => button.getAttribute('data-session-id'))).toContain('reviewed_session')
    })
  })

  it('persists section collapse locally without touching project filter settings', async () => {
    const { unmount } = render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-section-running')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /collapse running section/i }))

    await waitFor(() => {
      expect(screen.queryByText('test_session_b')).toBeNull()
      expect(lastPersistedSettings).toBeNull()
    })

    unmount()

    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /expand running section/i })).toBeInTheDocument()
      expect(screen.queryByText('test_session_b')).toBeNull()
    })
  })
})
