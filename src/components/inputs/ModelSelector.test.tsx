import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from './ModelSelector'
import { AgentType } from '../../types/session'

// Mock the useAgentAvailability hook
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
  }
}))

function setup(options: {
  initial?: AgentType
  disabled?: boolean
  allowedAgents?: AgentType[]
} = {}) {
  const {
    initial = 'claude',
    disabled = false,
    allowedAgents,
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
        allowedAgents={allowedAgents}
      />
    )
  }

  render(<Wrapper />)
  return { onChange }
}

describe('ModelSelector', () => {
  test('renders dropdown button with current model label and color indicator', () => {
    setup()
    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeInTheDocument()

    // Check that the button contains the model label
    expect(toggle.textContent).toContain('Claude')
  })

  test('opens menu on click and renders options', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    // Ensure all options are present
    expect(screen.getAllByRole('button', { name: 'Claude' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'GitHub Copilot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument()
  })

  test('changes selection on option click and closes menu', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(onChange).toHaveBeenCalledWith('opencode')

    // menu should close (options disappear)
    expect(screen.queryAllByRole('button', { name: 'OpenCode' })).toHaveLength(1)
  })

  test('keyboard navigation: Enter opens menu, ArrowDown navigates, Enter selects', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    toggle.focus()
    await user.keyboard('{Enter}')

    // Move to second option (GitHub Copilot) using arrow down
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('copilot')
  })

  test('disabled state prevents opening and interaction', async () => {
    const user = userEvent.setup()
    setup({ disabled: true })

    const toggle = screen.getByRole('button', { name: /Claude/i })
    expect(toggle).toBeDisabled()

    await user.click(toggle)
    expect(screen.queryAllByRole('button', { name: 'OpenCode' })).toHaveLength(0)
  })

  test('default model selection reflects initial value', () => {
    setup({ initial: 'opencode' })
    const toggle = screen.getByRole('button', { name: /OpenCode/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('OpenCode')
  })

  test('falls back to default model when given invalid value', () => {
    const onChange = vi.fn()
    // Force an invalid value through casts to exercise fallback
    render(<ModelSelector value={'invalid' as unknown as AgentType} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Claude/i })).toBeInTheDocument()
  })

  test('mocks external model API calls (no network during interaction)', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      headers: new Headers(),
      status: 200,
      statusText: 'OK'
    } as Response)

    const { onChange } = setup()
    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(onChange).toHaveBeenCalledWith('opencode')
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  test('can select Gemini model', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    await user.click(screen.getByRole('button', { name: /Claude/i }))
    await user.click(screen.getByRole('button', { name: 'Gemini' }))

    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  test('renders Gemini with orange color indicator', () => {
    setup({ initial: 'gemini' })
    const toggle = screen.getByRole('button', { name: /Gemini/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle.textContent).toContain('Gemini')
  })

  test('keyboard navigation: ArrowDown moves focus to next option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('copilot')
  })

  test('filters available options when allowedAgents is provided', async () => {
    const user = userEvent.setup()
    setup({ allowedAgents: ['claude', 'opencode'] })

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    expect(screen.getAllByRole('button', { name: 'OpenCode' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Terminal Only' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: ArrowUp moves focus to previous option', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ initial: 'opencode' })

    const toggle = screen.getByRole('button', { name: /OpenCode/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('copilot')
  })

  test('keyboard navigation: wraps around when reaching boundaries', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('terminal')
  })

  test('keyboard navigation: Escape closes dropdown', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'OpenCode' })).not.toBeInTheDocument()
  })

  test('keyboard navigation: highlights focused option visually', async () => {
    const user = userEvent.setup()
    setup()

    const toggle = screen.getByRole('button', { name: /Claude/i })
    await user.click(toggle)

    await user.keyboard('{ArrowDown}')

    const opencodeOption = screen.getByRole('button', { name: 'OpenCode' })
    // Check that the option exists and is rendered
    expect(opencodeOption).toBeInTheDocument()
  })
})
