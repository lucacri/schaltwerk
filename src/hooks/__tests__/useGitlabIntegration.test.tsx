import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useGitlabIntegration } from '../useGitlabIntegration'
import type { GitLabStatusPayload } from '../../common/events'
import { invoke } from '@tauri-apps/api/core'
import type { SchaltEvent } from '../../common/eventSystem'
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
  const mockInvoke = invoke as ReturnType<typeof vi.fn>

  let store: ReturnType<typeof createStore>

  const createWrapper = (projectPath?: string) => {
    store = createStore()
    if (typeof projectPath === 'string') {
      store.set(projectPathAtom, projectPath)
    }
    return ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key as SchaltEvent])
  })

  it('clears status to null when projectPath changes', async () => {
    const status: GitLabStatusPayload = {
      installed: true,
      authenticated: true,
      userLogin: 'dev',
      hostname: 'gitlab.com'
    }

    mockInvoke.mockResolvedValueOnce(status)    // GitLabGetStatus
    mockInvoke.mockResolvedValueOnce([])        // GitLabGetSources

    const wrapper = createWrapper('/tmp/project-a')

    const { result } = renderHook(() => useGitlabIntegration(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      store.set(projectPathAtom, '/tmp/project-b')
    })

    expect(result.current.status).toBeNull()
  })
})
