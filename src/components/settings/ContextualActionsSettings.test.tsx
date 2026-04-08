import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ContextualActionsSettings } from './ContextualActionsSettings'
import { useContextualActions } from '../../hooks/useContextualActions'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'

vi.mock('../../hooks/useContextualActions', () => ({
  useContextualActions: vi.fn(),
}))

vi.mock('../../hooks/useAgentVariants', () => ({
  useAgentVariants: vi.fn(),
}))

vi.mock('../../hooks/useAgentPresets', () => ({
  useAgentPresets: vi.fn(),
}))

vi.mock('../../hooks/useEnabledAgents', () => ({
  useEnabledAgents: vi.fn(),
}))

describe('ContextualActionsSettings', () => {
  const useContextualActionsMock = vi.mocked(useContextualActions)
  const useAgentVariantsMock = vi.mocked(useAgentVariants)
  const useAgentPresetsMock = vi.mocked(useAgentPresets)
  const useEnabledAgentsMock = vi.mocked(useEnabledAgents)

  beforeEach(() => {
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
    useAgentPresetsMock.mockReturnValue({
      presets: [
        { id: 'preset-claude', name: 'Claude Pair', slots: [{ agentType: 'claude' }], isBuiltIn: false },
        { id: 'preset-mixed', name: 'Mixed Pair', slots: [{ agentType: 'claude' }, { agentType: 'codex' }], isBuiltIn: false },
      ],
      loading: false,
      error: null,
      savePresets: vi.fn().mockResolvedValue(true),
      reloadPresets: vi.fn().mockResolvedValue(undefined),
    })
    useContextualActionsMock.mockReturnValue({
      actions: [
        {
          id: 'action-1',
          name: 'Review This PR',
          context: 'pr',
          promptTemplate: 'Review {{pr.title}}',
          mode: 'session',
          isBuiltIn: false,
        },
      ],
      loading: false,
      error: null,
      saveActions: vi.fn().mockResolvedValue(true),
      resetToDefaults: vi.fn().mockResolvedValue(true),
      reloadActions: vi.fn().mockResolvedValue(undefined),
    })
  })

  test('hides disabled-agent sources from agent source selection', async () => {
    render(<ContextualActionsSettings />)
    const user = userEvent.setup()

    await user.click(screen.getByText('Review This PR'))
    await user.click(await screen.findByRole('combobox', { name: 'Agent Source' }))

    expect(screen.getByRole('option', { name: 'claude' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'codex' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude Fast (variant)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Codex Fast (variant)' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude Pair (preset)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Mixed Pair (preset)' })).not.toBeInTheDocument()
  })
})
