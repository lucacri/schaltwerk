import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentVariantsSettings } from './AgentVariantsSettings'
import { useAgentVariants } from '../../hooks/useAgentVariants'

vi.mock('../../hooks/useAgentVariants', () => ({
  useAgentVariants: vi.fn(),
}))

describe('AgentVariantsSettings', () => {
  const useAgentVariantsMock = vi.mocked(useAgentVariants)

  beforeEach(() => {
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
})
