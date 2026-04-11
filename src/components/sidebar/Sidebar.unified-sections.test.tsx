import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import { EnrichedSession } from '../../types/session'
import { FilterMode } from '../../types/sessionFilters'

vi.mock('@tauri-apps/api/core')

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}))

const createSession = (
  id: string,
  state: 'spec' | 'running',
  readyToMerge = false,
): EnrichedSession => ({
  info: {
    session_id: id,
    display_name: id,
    branch: `branch/${id}`,
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: state === 'spec' ? 'spec' : 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: state,
    ready_to_merge: readyToMerge,
    has_uncommitted_changes: false,
  },
  terminals: [],
})

const getVisibleSessionIds = () =>
  screen
    .getAllByRole('button')
    .filter(button => button.hasAttribute('data-session-id'))
    .map(button => button.getAttribute('data-session-id'))

describe('Sidebar unified sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const sessions = [
      createSession('spec-alpha', 'spec'),
      createSession('run-alpha', 'running'),
      createSession('spec-beta', 'spec'),
      createSession('run-beta', 'running', true),
    ]

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return sessions
        case TauriCommands.GetCurrentDirectory:
          return '/test/dir'
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
          return true
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: FilterMode.All }
        case TauriCommands.SetProjectSessionsSettings:
          return undefined
        case TauriCommands.SchaltwerkCoreGetFontSizes:
          return [13, 12]
        case TauriCommands.SchaltwerkCoreSetFontSizes:
          return undefined
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders specs and running sections together without filter tabs', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-section-specs')).toBeInTheDocument()
      expect(screen.getByTestId('sidebar-section-running')).toBeInTheDocument()
    })

    expect(screen.queryByTitle('Show spec agents')).toBeNull()
    expect(screen.queryByTitle('Show running agents')).toBeNull()
    expect(getVisibleSessionIds()).toEqual(['spec-alpha', 'spec-beta', 'run-alpha', 'run-beta'])
  })

  it('collapses and expands each section independently', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    const collapseSpecs = await screen.findByRole('button', { name: /collapse specs section/i })
    fireEvent.click(collapseSpecs)

    await waitFor(() => {
      expect(screen.queryByText('spec-alpha')).toBeNull()
      expect(screen.queryByText('spec-beta')).toBeNull()
      expect(screen.getByText('run-alpha')).toBeInTheDocument()
      expect(screen.getByText('run-beta')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /collapse running section/i }))

    await waitFor(() => {
      expect(screen.queryByText('run-alpha')).toBeNull()
      expect(screen.queryByText('run-beta')).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: /expand specs section/i }))

    await waitFor(() => {
      expect(screen.getByText('spec-alpha')).toBeInTheDocument()
      expect(screen.getByText('spec-beta')).toBeInTheDocument()
    })
  })
})
