import { renderHook, waitFor, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { ReactNode } from 'react'
import { useDiffPreloader } from './useDiffPreloader'
import { projectPathAtom } from '../store/atoms/project'
import { diffPreloader } from '../domains/diff/preloader'
import { SchaltEvent } from '../common/eventSystem'

const { listenEventMock, fileChangeHandlers } = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => unknown> = {}
  const defaultImpl = async (event: string, handler: (payload: unknown) => unknown) => {
    handlers[event] = handler
    return () => {
      delete handlers[event]
    }
  }

  return {
    listenEventMock: vi.fn(defaultImpl),
    fileChangeHandlers: handlers,
  }
})

vi.mock('./useSelection', () => ({
  useSelection: () => ({
    selection: {
      kind: 'session' as const,
      payload: 'shared-session',
      sessionState: 'running' as const,
      worktreePath: '/tmp/shared-session',
      projectPath: '/projects/alpha',
    },
  }),
}))

vi.mock('../common/eventSystem', async importOriginal => {
  const actual = await importOriginal<typeof import('../common/eventSystem')>()
  return {
    ...actual,
    listenEvent: listenEventMock,
  }
})

vi.mock('../domains/diff/preloader', () => ({
  diffPreloader: {
    preload: vi.fn(),
    invalidate: vi.fn(),
  },
}))

function createWrapper(projectPath: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const store = createStore()
    store.set(projectPathAtom, projectPath)
    return <Provider store={store}>{children}</Provider>
  }
}

describe('useDiffPreloader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listenEventMock.mockImplementation(async (event: string, handler: (payload: unknown) => unknown) => {
      fileChangeHandlers[event] = handler
      return () => {
        delete fileChangeHandlers[event]
      }
    })
    Object.keys(fileChangeHandlers).forEach(key => {
      delete fileChangeHandlers[key]
    })
  })

  it('ignores file change events from another project', async () => {
    renderHook(() => useDiffPreloader(), {
      wrapper: createWrapper('/projects/alpha'),
    })

    await waitFor(() => {
      expect(vi.mocked(diffPreloader.preload)).toHaveBeenCalledWith('shared-session', false, 'unified', '/projects/alpha')
    })

    vi.mocked(diffPreloader.preload).mockClear()
    vi.mocked(diffPreloader.invalidate).mockClear()

    await act(async () => {
      await fileChangeHandlers[SchaltEvent.FileChanges]?.({
        session_name: 'shared-session',
        project_path: '/projects/beta',
      })
    })

    expect(vi.mocked(diffPreloader.invalidate)).not.toHaveBeenCalled()
    expect(vi.mocked(diffPreloader.preload)).not.toHaveBeenCalled()
  })
})
