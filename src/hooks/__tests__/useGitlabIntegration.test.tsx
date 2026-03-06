import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest'
import type { ReactNode } from 'react'
import { useGitlabIntegration } from '../useGitlabIntegration'
import { TauriCommands } from '../../common/tauriCommands'
import type { GitLabStatusPayload } from '../../common/events'
import type { GitlabSource } from '../../types/gitlabTypes'
import { invoke } from '@tauri-apps/api/core'
import { SchaltEvent } from '../../common/eventSystem'
import { Provider, createStore } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

const eventHandlers: Partial<Record<SchaltEvent, (payload: unknown) => void>> = {}

vi.mock('../../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../../common/eventSystem')>('../../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async (event: SchaltEvent, handler: (payload: unknown) => void) => {
      eventHandlers[event] = handler
      return async () => {
        delete eventHandlers[event]
      }
    })
  }
})

describe('useGitlabIntegration', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  const createWrapper = (store: ReturnType<typeof createStore>) =>
    ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    )

  const makeSources = (prefix: string): GitlabSource[] => [
    {
      id: `${prefix}-1`,
      label: `${prefix} source`,
      projectPath: `group/${prefix}`,
      hostname: 'gitlab.com',
      issuesEnabled: true,
      mrsEnabled: true,
      pipelinesEnabled: false,
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key as SchaltEvent])
  })

  it('clears sources and re-fetches when projectPath changes', async () => {
    const store = createStore()
    store.set(projectPathAtom, '/project-a')

    const statusA: GitLabStatusPayload = {
      installed: true,
      authenticated: true,
    }
    const sourcesA = makeSources('a')
    const sourcesB = makeSources('b')

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === TauriCommands.GitLabGetStatus) return statusA
      if (command === TauriCommands.GitLabGetSources) return sourcesA
      return undefined
    })

    const { result } = renderHook(() => useGitlabIntegration(), {
      wrapper: createWrapper(store),
    })

    await waitFor(() => {
      expect(result.current.sources).toEqual(sourcesA)
    })

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === TauriCommands.GitLabGetStatus) return statusA
      if (command === TauriCommands.GitLabGetSources) return sourcesB
      return undefined
    })

    await act(async () => {
      store.set(projectPathAtom, '/project-b')
    })

    await waitFor(() => {
      expect(result.current.sources).toEqual(sourcesB)
    })
  })

  it('sources are empty array immediately after projectPath changes before fetch completes', async () => {
    const store = createStore()
    store.set(projectPathAtom, '/project-a')

    const statusA: GitLabStatusPayload = {
      installed: true,
      authenticated: true,
    }
    const sourcesA = makeSources('a')

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === TauriCommands.GitLabGetStatus) return statusA
      if (command === TauriCommands.GitLabGetSources) return sourcesA
      return undefined
    })

    const { result } = renderHook(() => useGitlabIntegration(), {
      wrapper: createWrapper(store),
    })

    await waitFor(() => {
      expect(result.current.sources).toEqual(sourcesA)
    })

    let resolveSourcesFetch: ((value: GitlabSource[]) => void) | undefined
    const sourcesPromise = new Promise<GitlabSource[]>((resolve) => {
      resolveSourcesFetch = resolve
    })

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === TauriCommands.GitLabGetStatus) return statusA
      if (command === TauriCommands.GitLabGetSources) return sourcesPromise
      return undefined
    })

    await act(async () => {
      store.set(projectPathAtom, '/project-b')
    })

    expect(result.current.sources).toEqual([])

    const sourcesB = makeSources('b')
    await act(async () => {
      resolveSourcesFetch!(sourcesB)
    })

    await waitFor(() => {
      expect(result.current.sources).toEqual(sourcesB)
    })
  })
})
