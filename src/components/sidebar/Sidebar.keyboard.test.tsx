import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor, act } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import * as uiEvents from '../../common/uiEvents'

// Use real keyboard hook behavior

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), UnlistenFn: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const sessionRows = () => screen.getAllByRole('button').filter(button => button.hasAttribute('data-session-id'))


async function press(key: string, opts: KeyboardEventInit = {}) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, ...opts })
    window.dispatchEvent(event)
  })
}

async function click(element: HTMLElement | null) {
  if (!element) {
    throw new Error('Expected element to click')
  }
  await act(async () => {
    element.click()
  })
}

describe('Sidebar keyboard navigation basic', () => {
  async function renderSidebar() {
    let utils: ReturnType<typeof render> | undefined
    await act(async () => {
      utils = render(<TestProviders><Sidebar /></TestProviders>)
    })
    return utils!
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    const sessions = [
      { info: { session_id: 'a', branch: 'para/a', worktree_path: '/a', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'b', branch: 'para/b', worktree_path: '/b', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'c', branch: 'para/c', worktree_path: '/c', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    vi.mocked(listen).mockImplementation(async () => {
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Cmd+ArrowDown selects first session from orchestrator; Cmd+ArrowUp returns to orchestrator', async () => {
    await renderSidebar()

    await waitFor(() => {
      const items = screen.getAllByRole('button')
      expect(items.some(b => (b.textContent || '').includes('orchestrator'))).toBe(true)
      expect(sessionRows()).toHaveLength(3)
    })

    // Orchestrator selected by default (has blue ring class)
    const orchestratorBtn = screen.getByLabelText(/Select orchestrator/i)
    expect(orchestratorBtn.className).toContain('session-ring-blue')

    // Move down
    await press('ArrowDown', { metaKey: true })

    await waitFor(() => {
      const selectedSession = screen
        .getAllByRole('button')
        .find((btn) => btn.getAttribute('data-session-selected') === 'true' && btn.getAttribute('data-session-id') !== 'orchestrator')
      expect(selectedSession).toBeDefined()
    })

    // Move up to orchestrator
    await press('ArrowUp', { metaKey: true })

    await waitFor(() => {
      const orch = screen.getByLabelText(/Select orchestrator/i)
      expect(orch.className).toContain('session-ring-blue')
    })
  })

  it('Cmd+Shift+R switches spec selection to orchestrator and emits refine events', async () => {
    const specSessions = [
      {
        info: {
          session_id: 'spec-session',
          display_name: 'Spec Draft',
          branch: 'spec/branch',
          worktree_path: '/spec',
          base_branch: 'main',
          status: 'spec',
          session_state: 'spec',
          is_current: false,
          session_type: 'worktree',
          ready_to_merge: false,
        },
        terminals: [],
      },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return specSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'spec', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })

    const emitSpy = vi.spyOn(uiEvents, 'emitUiEvent')

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('Spec Draft')).toBeInTheDocument()
    })

    const specButton = screen.getByText('Spec Draft').closest('[role="button"]') as HTMLElement | null
    expect(specButton).toBeTruthy()
    await click(specButton)

    await waitFor(() => {
      const selected = screen.getByText('Spec Draft').closest('[role="button"]')
      expect(selected?.getAttribute('data-session-selected')).toBe('true')
    })

    emitSpy.mockClear()

    await press('R', { metaKey: true, shiftKey: true })

    await waitFor(() => {
      const selectionChange = emitSpy.mock.calls.find(
        ([event, detail]) =>
          event === uiEvents.UiEvent.SelectionChanged &&
          typeof detail === 'object' &&
          detail !== null &&
          (detail as { kind?: string; payload?: string; sessionState?: string }).kind === 'session' &&
          (detail as { kind?: string; payload?: string; sessionState?: string }).payload === 'spec-session' &&
          (detail as { kind?: string; payload?: string; sessionState?: string }).sessionState === 'spec',
      )
      expect(selectionChange).toBeDefined()
    })
    expect(emitSpy).not.toHaveBeenCalledWith(uiEvents.UiEvent.OpenSpecInOrchestrator, expect.anything())
    expect(emitSpy).not.toHaveBeenCalledWith(uiEvents.UiEvent.RefineSpecInNewTab, expect.anything())
  })

  it('does not trigger a manual review action for spec sessions', async () => {
    const specSessions = [
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main', status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return specSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'spec', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('spec-session')).toBeInTheDocument()
    })

    const specButton = screen.getByText('spec-session').closest('[role="button"]') as HTMLElement | null
    if (specButton) {
      await click(specButton)
    }

    await waitFor(() => {
      const selectedSpecButton = screen.getByText('spec-session').closest('[role="button"]')
      expect(selectedSpecButton?.className).toContain('session-ring')
    })

    await press('r', { metaKey: true })

    expect(invoke).not.toHaveBeenCalledWith('schaltwerk_core_mark_session_ready', expect.anything())
  })

  it('does not trigger a manual review action for running sessions', async () => {
    const runningSessions = [
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return runningSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('running-session')).toBeInTheDocument()
    })

    const runningButton = screen.getByText('running-session').closest('[role="button"]') as HTMLElement | null
    if (runningButton) {
      await click(runningButton)
    }

    await waitFor(() => {
      const selectedRunningButton = screen.getByText('running-session').closest('[role="button"]')
      expect(selectedRunningButton?.className).toContain('session-ring')
    })

    await press('r', { metaKey: true })

    expect(invoke).not.toHaveBeenCalledWith('schaltwerk_core_mark_session_ready', expect.anything())
  })

  it('prevents converting spec sessions to specs with Cmd+S', async () => {
    const specSessions = [
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main', status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return specSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'spec', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('spec-session')).toBeInTheDocument()
    })

    const specButton = screen.getByText('spec-session').closest('[role="button"]') as HTMLElement | null
    if (specButton) {
      await click(specButton)
    }

    await waitFor(() => {
      const selectedSpecButton = screen.getByText('spec-session').closest('[role="button"]')
      expect(selectedSpecButton?.className).toContain('session-ring')
    })

    await press('s', { metaKey: true })

    await waitFor(() => {
      expect(screen.queryByText('Convert to Spec')).not.toBeInTheDocument()
    })
  })

  it('does not trigger a manual review action for ready sessions', async () => {
    const readySessions = [
      { info: { session_id: 'ready-session', branch: 'review/branch', worktree_path: '/review', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: true, session_state: 'running' }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return readySessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('ready-session')).toBeInTheDocument()
    })

    const readyButton = screen.getByText('ready-session').closest('[role="button"]') as HTMLElement | null
    if (readyButton) {
      await click(readyButton)
    }

    await waitFor(() => {
      const selectedButton = screen.getByText('ready-session').closest('[role="button"]')
      expect(selectedButton?.getAttribute('data-session-selected')).toBe('true')
    })

    await press('r', { metaKey: true })

    expect(invoke).not.toHaveBeenCalledWith('schaltwerk_core_mark_session_ready', expect.anything())
  })

  it('allows converting running sessions to specs with Cmd+S', async () => {
    const runningSessions = [
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return runningSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    await renderSidebar()

    await waitFor(() => {
      expect(screen.getByText('running-session')).toBeInTheDocument()
    })

    const runningButton = screen.getByText('running-session').closest('[role="button"]') as HTMLElement | null
    if (runningButton) {
      await click(runningButton)
    }

    await waitFor(() => {
      const selectedRunningButton = screen.getByText('running-session').closest('[role="button"]')
      expect(selectedRunningButton?.className).toContain('session-ring')
    })

    await press('s', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByText('Convert to Spec')).toBeInTheDocument()
    })
  })

})
