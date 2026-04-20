import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, createStore } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import type { ConsolidationStats } from '../../types/consolidationStats'
import { ConsolidationStatsPanel } from './ConsolidationStatsPanel'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

const stats: ConsolidationStats = {
  selected_project: null,
  selected_vertical: null,
  projects: [
    { repository_path: '/projects/lucode', repository_name: 'lucode' }
  ],
  verticals: ['backend', 'frontend'],
  last_week: [
    {
      model: 'gpt-5',
      agent_types: ['codex'],
      wins: 1,
      losses: 1,
      total: 2,
      win_rate: 0.5,
    }
  ],
  all_time: [
    {
      model: 'opus',
      agent_types: ['claude'],
      wins: 3,
      losses: 1,
      total: 4,
      win_rate: 0.75,
    }
  ],
}

describe('ConsolidationStatsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(stats)
  })

  it('loads and renders rolling and all-time model win rates', async () => {
    render(
      <Provider store={createStore()}>
        <ConsolidationStatsPanel />
      </Provider>
    )

    expect(await screen.findByText('Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('All time')).toBeInTheDocument()
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('opus')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreGetConsolidationStats, {
      repositoryPath: undefined,
      vertical: undefined,
    })
  })

  it('reloads when a vertical filter is selected', async () => {
    const user = userEvent.setup()
    render(
      <Provider store={createStore()}>
        <ConsolidationStatsPanel />
      </Provider>
    )

    await screen.findByText('gpt-5')
    await user.selectOptions(screen.getByLabelText('Vertical'), 'backend')

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.SchaltwerkCoreGetConsolidationStats, {
        repositoryPath: undefined,
        vertical: 'backend',
      })
    })
  })
})
