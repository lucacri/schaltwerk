import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentVariantsSettings } from './AgentVariantsSettings'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'

vi.mock('../../hooks/useAgentVariants', () => ({
  useAgentVariants: vi.fn(),
}))

vi.mock('../../hooks/useEnabledAgents', () => ({
  useEnabledAgents: vi.fn(),
}))

describe('AgentVariantsSettings', () => {
  const useAgentVariantsMock = vi.mocked(useAgentVariants)
  const useEnabledAgentsMock = vi.mocked(useEnabledAgents)

  beforeEach(() => {
    useEnabledAgentsMock.mockReturnValue({
      filterAgents: (agents: string[]) => agents,
      loading: false,
    } as ReturnType<typeof useEnabledAgents>)
    useAgentVariantsMock.mockReturnValue({
      variants: [
        {
          id: 'variant-1',
          name: 'Primary Variant',
          agentType: 'claude',
          isBuiltIn: false,
        },
      ],
      loading: false,
      error: null,
      saveVariants: vi.fn().mockResolvedValue(true),
      reloadVariants: vi.fn().mockResolvedValue(undefined),
    })
  })

  test('exposes the agent type selector through its visible label', async () => {
    render(<AgentVariantsSettings />)
    const user = userEvent.setup()

    await user.click(screen.getByText('Primary Variant'))

    expect(await screen.findByRole('combobox', { name: 'Agent Type' })).toBeInTheDocument()
  })

  test('uses the first enabled agent when adding a variant', async () => {
    useEnabledAgentsMock.mockReturnValue({
      filterAgents: (agents: string[]) => agents.filter(agent => agent !== 'claude'),
      loading: false,
    } as ReturnType<typeof useEnabledAgents>)

    render(<AgentVariantsSettings />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '+ Add Variant' }))

    expect(await screen.findByRole('combobox', { name: 'Agent Type' })).toHaveTextContent('copilot')
  })
})
