import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './ModelSelector'
import { AgentType, AGENT_TYPES } from '../../types/session'

const availabilityMock = vi.hoisted(() => ({
  availableAgents: new Set<string>(),
  loading: false,
}))

vi.mock('../../hooks/useAgentAvailability', () => ({
  useAgentAvailability: () => ({
    isAvailable: vi.fn((agent: string) => availabilityMock.availableAgents.has(agent)),
    getRecommendedPath: vi.fn((agent: string) => availabilityMock.availableAgents.has(agent) ? `/usr/local/bin/${agent}` : null),
    getInstallationMethod: vi.fn((agent: string) => availabilityMock.availableAgents.has(agent) ? 'Homebrew' : null),
    loading: availabilityMock.loading,
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
  }
}))

function setup(options: {
  initial?: AgentType
  disabled?: boolean
  allowedAgents?: AgentType[]
  agentSelectionDisabled?: boolean
  variant?: 'grid' | 'compact'
} = {}) {
  const {
    initial = 'claude',
    disabled = false,
    allowedAgents,
    agentSelectionDisabled = false,
    variant,
  } = options
  const onChange = vi.fn()

  function Wrapper() {
    const [value, setValue] = useState<AgentType>(initial)

    const handleChange = (next: AgentType) => {
      setValue(next)
      onChange(next)
    }

    return (
      <ModelSelector
        value={value}
        onChange={handleChange}
        disabled={disabled}
        agentSelectionDisabled={agentSelectionDisabled}
        allowedAgents={allowedAgents}
        variant={variant}
      />
    )
  }

  render(<Wrapper />)
  return { onChange }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    availabilityMock.availableAgents = new Set(AGENT_TYPES)
    availabilityMock.loading = false
  })

  test('renders all supported agents as visible cards without opening a dropdown', () => {
    setup()

    expect(screen.getByRole('button', { name: /^Claude\b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^GitHub Copilot\b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Gemini\b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Codex\b/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Terminal Only\b/i })).toBeInTheDocument()
  })

  test('renders localized agent descriptions on cards', () => {
    setup({ allowedAgents: ['claude', 'opencode'] })

    expect(screen.getByRole('button', { name: /^Claude\b/i })).toHaveTextContent("Anthropic's powerful agent")
    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toHaveTextContent('Open source coding assistant')
  })

  test('marks the selected agent as pressed', () => {
    setup()

    expect(screen.getByRole('button', { name: /^Claude\b/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toHaveAttribute('aria-pressed', 'false')
  })

  test('changes selection when an agent card is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    await user.click(screen.getByRole('button', { name: /^OpenCode\b/i }))

    expect(onChange).toHaveBeenCalledWith('opencode')
  })

  test('shows unavailable status while keeping the agent selectable', async () => {
    const user = userEvent.setup()
    availabilityMock.availableAgents = new Set(['claude'])
    const { onChange } = setup()

    const opencode = screen.getByRole('button', { name: /^OpenCode\b/i })
    expect(opencode).not.toBeDisabled()
    expect(opencode).toHaveTextContent('Not installed')

    await user.click(opencode)

    expect(onChange).toHaveBeenCalledWith('opencode')
  })

  test('includes card status in the accessible name', () => {
    availabilityMock.availableAgents = new Set(['claude'])
    setup()

    expect(screen.getByRole('button', { name: /OpenCode.*Not installed/i })).toBeInTheDocument()
  })

  test('keeps the card focus ring visible despite clipped card content', () => {
    setup()

    expect(screen.getByRole('button', { name: /Claude.*Available/i })).toHaveClass('focus-visible:ring-2')
  })

  test('disabled state prevents card interaction', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ disabled: true })

    const opencode = screen.getByRole('button', { name: /^OpenCode\b/i })
    expect(opencode).toBeDisabled()

    await user.click(opencode)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('default model selection reflects initial value', () => {
    setup({ initial: 'opencode' })
    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toHaveAttribute('aria-pressed', 'true')
  })

  test('falls back to default model when given invalid value', () => {
    const onChange = vi.fn()
    render(<ModelSelector value={'invalid' as unknown as AgentType} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Claude\b/i })).toHaveAttribute('aria-pressed', 'true')
  })

  test('mocks external model API calls with no network during interaction', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      headers: new Headers(),
      status: 200,
      statusText: 'OK'
    } as Response)

    const { onChange } = setup()
    await user.click(screen.getByRole('button', { name: /^OpenCode\b/i }))

    expect(onChange).toHaveBeenCalledWith('opencode')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  test('filters available options when allowedAgents is provided', () => {
    setup({ allowedAgents: ['claude', 'opencode'] })

    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Terminal Only\b/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Gemini\b/i })).not.toBeInTheDocument()
  })

  test('agent selection disabled prevents card interaction', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ agentSelectionDisabled: true })

    const opencode = screen.getByRole('button', { name: /^OpenCode\b/i })
    expect(opencode).toBeDisabled()

    await user.click(opencode)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('compact variant keeps keyboard dropdown selection functional', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ variant: 'compact' })

    const toggle = screen.getByRole('button', { name: /^Claude\b/i })
    toggle.focus()
    await user.keyboard('{Enter}')

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('copilot')
  })

  test('compact variant can select unavailable agents', async () => {
    const user = userEvent.setup()
    availabilityMock.availableAgents = new Set(['claude'])
    const { onChange } = setup({ variant: 'compact' })

    const toggle = screen.getByRole('button', { name: /^Claude\b/i })
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /OpenCode/i }))

    expect(onChange).toHaveBeenCalledWith('opencode')
  })

  test('compact variant shows selected unavailable status on the collapsed control', () => {
    availabilityMock.availableAgents = new Set(['claude'])
    setup({ initial: 'opencode', variant: 'compact' })

    expect(screen.getByRole('button', { name: /^OpenCode\b/i })).toHaveTextContent('Not installed')
  })
})
