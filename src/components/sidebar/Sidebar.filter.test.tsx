import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { EnrichedSession } from '../../types/session'

vi.mock('@tauri-apps/api/core')

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn()
}))

const createSession = (id: string, readyToMerge = false, sessionState?: 'spec' | 'active'): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
    session_state: sessionState === 'spec' ? 'spec' : (readyToMerge ? 'reviewed' : 'running')
  },
  terminals: []
})

describe('Sidebar section layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const sessions = [
      createSession('alpha', false, 'spec'),
      createSession('bravo', false, 'active'),  // running
      createSession('charlie', false, 'spec'),
      createSession('delta', true, 'active'),  // reviewed
      createSession('echo', true, 'active'),  // reviewed
    ]

    vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === 'get_buffer') return ''
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all three sections with correct session counts', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    const runningSection = await screen.findByTestId('sidebar-section-running')
    expect(runningSection).toHaveTextContent('1')

    const specsSection = screen.getByTestId('sidebar-section-specs')
    expect(specsSection).toHaveTextContent('2')

    const reviewedSection = screen.getByTestId('sidebar-section-reviewed')
    expect(reviewedSection).toHaveTextContent('2')
  })

  it('shows running sessions in Running section expanded by default', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await screen.findByTestId('sidebar-section-running')

    await waitFor(() => {
      expect(screen.getByText('bravo')).toBeInTheDocument()
    })
  })

  it('shows spec sessions in Specs section expanded by default', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await screen.findByTestId('sidebar-section-specs')

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('charlie')).toBeInTheDocument()
    })
  })

  it('keeps Reviewed section collapsed by default and shows sessions on expand', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    const reviewedSection = await screen.findByTestId('sidebar-section-reviewed')

    expect(screen.queryByText('delta')).not.toBeInTheDocument()

    const toggle = within(reviewedSection).getByRole('button', { expanded: false })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.getByText('delta')).toBeInTheDocument()
      expect(screen.getByText('echo')).toBeInTheDocument()
    })
  })

  it('collapses and expands sections independently', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await screen.findByTestId('sidebar-section-running')

    await waitFor(() => {
      expect(screen.getByText('bravo')).toBeInTheDocument()
    })

    const runningSection = screen.getByTestId('sidebar-section-running')
    const runningToggle = within(runningSection).getByRole('button', { expanded: true })

    fireEvent.click(runningToggle)

    expect(screen.queryByText('bravo')).not.toBeInTheDocument()

    // Specs section should still be expanded
    expect(screen.getByText('alpha')).toBeInTheDocument()
  })
})
