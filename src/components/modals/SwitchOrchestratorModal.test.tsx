import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SwitchOrchestratorModal } from './SwitchOrchestratorModal'

const mockGetOrchestratorAgentType = vi.fn().mockResolvedValue('opencode')
const mockGetAgentType = vi.fn().mockResolvedValue('claude')
const filterAgentsMock = vi.fn((agents: string[]) => agents)

vi.mock('../../hooks/useClaudeSession', () => ({
  useClaudeSession: () => ({
    getOrchestratorAgentType: mockGetOrchestratorAgentType,
    getAgentType: mockGetAgentType,
  }),
}))

vi.mock('../../hooks/useAgentAvailability', () => ({
  useAgentAvailability: () => ({
    isAvailable: vi.fn().mockReturnValue(true),
    getRecommendedPath: vi.fn().mockReturnValue('/usr/local/bin/agent'),
    getInstallationMethod: vi.fn().mockReturnValue('Homebrew'),
    loading: false,
    availability: {},
    refreshAvailability: vi.fn(),
    refreshSingleAgent: vi.fn(),
    clearCache: vi.fn(),
    forceRefresh: vi.fn(),
  }),
  InstallationMethod: {
    Homebrew: 'Homebrew',
    Npm: 'Npm',
    Pip: 'Pip',
    Manual: 'Manual',
    System: 'System',
  },
}))

vi.mock('../../hooks/useEnabledAgents', () => ({
  useEnabledAgents: () => ({
    filterAgents: filterAgentsMock,
    loading: false,
  }),
}))

function openModal(overrides: Partial<React.ComponentProps<typeof SwitchOrchestratorModal>> = {}) {
  const onClose = vi.fn()
  const onSwitch = vi.fn().mockResolvedValue(undefined)
  render(
    <SwitchOrchestratorModal open={true} onClose={onClose} onSwitch={onSwitch} {...overrides} />
  )
  return { onClose, onSwitch }
}

describe('SwitchOrchestratorModal', () => {
  let prevUnhandled: OnErrorEventHandler
  const noop = () => {}

  beforeAll(() => {
    prevUnhandled = (window as Window & { onunhandledrejection: OnErrorEventHandler }).onunhandledrejection
    ;(window as Window & { onunhandledrejection: (e: PromiseRejectionEvent) => void }).onunhandledrejection = (e: PromiseRejectionEvent) => {
      e.preventDefault()
    }
    process.on('unhandledRejection', noop)
  })

  afterAll(() => {
    ;(window as Window & { onunhandledrejection: OnErrorEventHandler }).onunhandledrejection = prevUnhandled
    process.off('unhandledRejection', noop)
  })

  beforeEach(() => {
    vi.useRealTimers()
    filterAgentsMock.mockClear()
    filterAgentsMock.mockImplementation((agents: string[]) => agents)
    mockGetOrchestratorAgentType.mockReset()
    mockGetOrchestratorAgentType.mockResolvedValue('opencode')
    mockGetAgentType.mockReset()
    mockGetAgentType.mockResolvedValue('claude')
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when closed, shows content when open', async () => {
    const { rerender } = render(
      <SwitchOrchestratorModal open={false} onClose={vi.fn()} onSwitch={vi.fn()} />
    )
    expect(screen.queryByText('Switch Orchestrator Agent')).not.toBeInTheDocument()

    await act(async () => {
      rerender(<SwitchOrchestratorModal open={true} onClose={vi.fn()} onSwitch={vi.fn()} />)
    })

    expect(screen.getByRole('heading', { name: 'Switch Orchestrator Agent' })).toBeInTheDocument()
  })

  it('loads current agent type on open and displays it', async () => {
    openModal()
    await waitFor(() => expect(screen.getByRole('button', { name: /opencode/i })).toBeInTheDocument())
  })

  it('calls onSwitch with the currently selected agent type', async () => {
    const { onSwitch } = openModal()
    const user = userEvent.setup()

    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))

    await user.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'opencode' }))

    await user.click(screen.getByRole('button', { name: /opencode/i }))
    await user.click(await screen.findByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: /switch agent/i }))

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'claude' }))
  })

  it('does not render permission controls', async () => {
    mockGetOrchestratorAgentType.mockResolvedValue('claude')
    openModal()

    await waitFor(() => screen.getByRole('button', { name: /claude/i }))
    expect(screen.queryByRole('button', { name: /Skip permissions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Require permissions/i })).not.toBeInTheDocument()
  })

  it('switches model on click (success path)', async () => {
    const slowResolve = vi.fn().mockImplementation(async () => {
      await Promise.resolve()
    })
    openModal({ onSwitch: slowResolve })

    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))

    await waitFor(() => expect(slowResolve).toHaveBeenCalledTimes(1))
  })

  it('lets focused model cards handle Enter before the modal switch shortcut', async () => {
    const user = userEvent.setup()
    const { onSwitch } = openModal()

    const gemini = await screen.findByRole('button', { name: /^Gemini\b/i })
    gemini.focus()
    await user.keyboard('{Enter}')

    expect(onSwitch).not.toHaveBeenCalled()
    expect(gemini).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'gemini' }))
  })

  it('re-enables controls after switch failure', async () => {
    const rejectOnce = vi.fn().mockImplementation(async () => {
      await Promise.resolve()
      throw new Error('boom')
    })
    openModal({ onSwitch: rejectOnce })

    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    const switchBtn = screen.getByRole('button', { name: /switch agent/i }) as HTMLButtonElement

    const handler = (e: PromiseRejectionEvent) => {
      e.preventDefault()
    }
    window.addEventListener('unhandledrejection', handler)
    try {
      fireEvent.click(switchBtn)
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(switchBtn).not.toBeDisabled())

      fireEvent.click(switchBtn)
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(2))
    } finally {
      window.removeEventListener('unhandledrejection', handler)
    }
  })

  it('does not offer the terminal-only agent for orchestrator', async () => {
    openModal()
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    await userEvent.click(screen.getByRole('button', { name: /opencode/i }))

    expect(screen.queryByRole('button', { name: /Terminal Only/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()
  })

  it('hides agents disabled in enabled-agent settings', async () => {
    filterAgentsMock.mockImplementation((agents: string[]) => agents.filter(agent => agent !== 'gemini'))

    openModal()
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    await userEvent.click(screen.getByRole('button', { name: /opencode/i }))

    expect(filterAgentsMock).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Gemini\b/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claude\b/i })).toBeInTheDocument()
  })

  it('uses session-specific configuration when scope=session', async () => {
    mockGetAgentType.mockResolvedValue('opencode')
    const { onSwitch } = openModal({ scope: 'session' })

    await waitFor(() => expect(mockGetAgentType).toHaveBeenCalled())
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))

    expect(screen.getByText('Switch Session Agent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'opencode' }))
  })
})
