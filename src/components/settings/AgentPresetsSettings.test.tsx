import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentPresetsSettings } from './AgentPresetsSettings'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'

vi.mock('../../hooks/useAgentPresets', () => ({
  useAgentPresets: vi.fn(),
}))

vi.mock('../../hooks/useAgentVariants', () => ({
  useAgentVariants: vi.fn(),
}))

vi.mock('../../hooks/useEnabledAgents', () => ({
  useEnabledAgents: vi.fn(),
}))

describe('AgentPresetsSettings', () => {
  const useAgentPresetsMock = vi.mocked(useAgentPresets)
  const useAgentVariantsMock = vi.mocked(useAgentVariants)
  const useEnabledAgentsMock = vi.mocked(useEnabledAgents)

  beforeEach(() => {
    useEnabledAgentsMock.mockReturnValue({
      filterAgents: (agents: string[]) => agents,
      loading: false,
    } as ReturnType<typeof useEnabledAgents>)
    useAgentVariantsMock.mockReturnValue({
      variants: [],
      loading: false,
      error: null,
      saveVariants: vi.fn().mockResolvedValue(true),
      reloadVariants: vi.fn().mockResolvedValue(undefined),
    })

    useAgentPresetsMock.mockReturnValue({
      presets: [
        {
          id: 'preset-1',
          name: 'Review Squad',
          slots: [{ agentType: 'claude' }],
          isBuiltIn: false,
        },
      ],
      loading: false,
      error: null,
      savePresets: vi.fn().mockResolvedValue(true),
      reloadPresets: vi.fn().mockResolvedValue(undefined),
    })
  })

  test('exposes each slot selector through a descriptive label', async () => {
    render(<AgentPresetsSettings />)
    const user = userEvent.setup()

    await user.click(screen.getByText('Review Squad'))

    expect(await screen.findByRole('combobox', { name: 'Agent Slot 1' })).toBeInTheDocument()
  })

  test('hides variants backed by disabled agents from slot selection', async () => {
    useEnabledAgentsMock.mockReturnValue({
      filterAgents: (agents: string[]) => agents.filter(agent => agent !== 'codex'),
      loading: false,
    } as ReturnType<typeof useEnabledAgents>)
    useAgentVariantsMock.mockReturnValue({
      variants: [
        { id: 'variant-claude', name: 'Claude Fast', agentType: 'claude', isBuiltIn: false },
        { id: 'variant-codex', name: 'Codex Fast', agentType: 'codex', isBuiltIn: false },
      ],
      loading: false,
      error: null,
      saveVariants: vi.fn().mockResolvedValue(true),
      reloadVariants: vi.fn().mockResolvedValue(undefined),
    })

    render(<AgentPresetsSettings />)
    const user = userEvent.setup()

    await user.click(screen.getByText('Review Squad'))
    await user.click(await screen.findByRole('combobox', { name: 'Agent Slot 1' }))

    expect(screen.getByRole('option', { name: 'Claude Fast (claude)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Codex Fast (codex)' })).not.toBeInTheDocument()
  })
})
