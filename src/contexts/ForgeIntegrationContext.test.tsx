import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { ForgeIntegrationProvider, useForgeIntegrationContext } from './ForgeIntegrationContext'
import { projectPathAtom } from '../store/atoms/project'
import { TauriCommands } from '../common/tauriCommands'
import type { ForgeStatusPayload } from '../types/forgeTypes'
import type { GitlabSource } from '../types/gitlabTypes'

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../common/eventSystem')>('../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async () => () => {}),
  }
})

function createWrapper(projectPath: string | null) {
  const store = createStore()
  if (projectPath) {
    store.set(projectPathAtom, projectPath)
  }
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ForgeIntegrationProvider>{children}</ForgeIntegrationProvider>
    </Provider>
  )
}

describe('ForgeIntegrationContext', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockReset()
  })

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useForgeIntegrationContext())
    }).toThrow('useForgeIntegrationContext must be used within ForgeIntegrationProvider')
  })

  it('starts with unknown forge type and no sources when no project path', () => {
    mockInvoke.mockRejectedValue(new Error('no tauri'))

    const { result } = renderHook(() => useForgeIntegrationContext(), {
      wrapper: createWrapper(null),
    })

    expect(result.current.forgeType).toBe('unknown')
    expect(result.current.sources).toEqual([])
    expect(result.current.hasRepository).toBe(false)
    expect(result.current.hasSources).toBe(false)
  })

  it('provides github sources when authenticated', async () => {
    const status: ForgeStatusPayload = {
      forgeType: 'github',
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      hostname: 'github.com',
    }
    mockInvoke.mockResolvedValue(status)

    const { result } = renderHook(() => useForgeIntegrationContext(), {
      wrapper: createWrapper('/tmp/project'),
    })

    await waitFor(() => {
      expect(result.current.forgeType).toBe('github')
    })

    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0].forgeType).toBe('github')
    expect(result.current.hasRepository).toBe(true)
    expect(result.current.hasSources).toBe(true)
  })

  it('loads gitlab sources when authenticated', async () => {
    const status: ForgeStatusPayload = {
      forgeType: 'gitlab',
      installed: true,
      authenticated: true,
      hostname: 'gitlab.com',
    }
    const gitlabSources: GitlabSource[] = [
      {
        id: '1',
        label: 'My Project',
        projectPath: 'group/my-project',
        hostname: 'gitlab.com',
        issuesEnabled: true,
        mrsEnabled: true,
        pipelinesEnabled: false,
      },
    ]

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.ForgeGetStatus) return status
      if (cmd === TauriCommands.GitLabGetSources) return gitlabSources
      throw new Error(`unexpected command: ${cmd}`)
    })

    const { result } = renderHook(() => useForgeIntegrationContext(), {
      wrapper: createWrapper('/tmp/project'),
    })

    await waitFor(() => {
      expect(result.current.sources).toHaveLength(1)
    })

    expect(result.current.forgeType).toBe('gitlab')
    expect(result.current.sources[0].forgeType).toBe('gitlab')
    expect(result.current.sources[0].projectIdentifier).toBe('group/my-project')
    expect(result.current.hasRepository).toBe(true)
  })

  it('clears sources when not authenticated', async () => {
    const status: ForgeStatusPayload = {
      forgeType: 'github',
      installed: true,
      authenticated: false,
    }
    mockInvoke.mockResolvedValue(status)

    const { result } = renderHook(() => useForgeIntegrationContext(), {
      wrapper: createWrapper('/tmp/project'),
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
    })

    expect(result.current.sources).toEqual([])
    expect(result.current.hasSources).toBe(false)
  })

  it('handles gitlab sources fetch failure gracefully', async () => {
    const status: ForgeStatusPayload = {
      forgeType: 'gitlab',
      installed: true,
      authenticated: true,
      hostname: 'gitlab.com',
    }
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.ForgeGetStatus) return status
      if (cmd === TauriCommands.GitLabGetSources) throw new Error('network error')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const { result } = renderHook(() => useForgeIntegrationContext(), {
      wrapper: createWrapper('/tmp/project'),
    })

    await waitFor(() => {
      expect(result.current.forgeType).toBe('gitlab')
    })

    expect(mockInvoke).toHaveBeenCalledWith(
      TauriCommands.GitLabGetSources,
      expect.objectContaining({ projectPath: '/tmp/project' })
    )
  })
})
