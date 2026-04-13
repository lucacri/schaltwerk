import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { CustomAgentModal } from './CustomAgentModal'

vi.mock('../../hooks/useEnabledAgents', () => ({
  useEnabledAgents: vi.fn(),
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
}))

import { useEnabledAgents } from '../../hooks/useEnabledAgents'

describe('CustomAgentModal', () => {
  const useEnabledAgentsMock = vi.mocked(useEnabledAgents)

  beforeEach(() => {
    useEnabledAgentsMock.mockReturnValue({
      filterAgents: (agents: string[]) => agents.filter(agent => agent !== 'claude'),
      loading: false,
    } as ReturnType<typeof useEnabledAgents>)
  })

  it('defaults to the first enabled agent when claude is disabled', async () => {
    render(
      <CustomAgentModal
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /GitHub Copilot/i })).toBeInTheDocument()
    })
  })

  it('lets focused model cards handle Enter before the modal submit shortcut', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <CustomAgentModal
        open={true}
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    )

    const gemini = await screen.findByRole('button', { name: /^Gemini\b/i })
    gemini.focus()
    await user.keyboard('{Enter}')

    expect(onSelect).not.toHaveBeenCalled()
    expect(gemini).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /Add Tab/i }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ agentType: 'gemini' }))
  })
})
