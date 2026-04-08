import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
