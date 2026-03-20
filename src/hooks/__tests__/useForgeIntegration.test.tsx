import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest'
import type { ReactNode } from 'react'
import { Provider, createStore } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { TauriCommands } from '../../common/tauriCommands'
import { useForgeIntegration, type CreateForgeSessionPrArgs } from '../useForgeIntegration'
import { projectPathAtom } from '../../store/atoms/project'
import type {
  ForgeSourceConfig,
  ForgeStatusPayload,
  ForgePrResult,
  ForgeIssueDetails,
  ForgePrDetails,
  ForgeReviewComment,
} from '../../types/forgeTypes'

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

describe('useForgeIntegration', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>
  const mockListenEvent = listenEvent as unknown as MockedFunction<typeof listenEvent>

  const createWrapper = (projectPath: string) => {
    const store = createStore()
    store.set(projectPathAtom, projectPath)
    return ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(eventHandlers).forEach((key) => delete eventHandlers[key as SchaltEvent])
  })

  it('passes the active project path to forge commands', async () => {
    const projectPath = '/tmp/project'
    const status: ForgeStatusPayload = {
      forgeType: 'github',
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      hostname: 'github.com'
    }
    const source: ForgeSourceConfig = {
      projectIdentifier: 'octo/hello',
      hostname: 'github.com',
      label: 'GitHub',
      forgeType: 'github'
    }

    const issueDetails: ForgeIssueDetails = {
      summary: {
        id: '123',
        title: 'Bug',
        state: 'OPEN',
        labels: []
      },
      comments: []
    }

    const prDetails: ForgePrDetails = {
      summary: {
        id: '42',
        title: 'Fix',
        state: 'OPEN',
        labels: [],
        sourceBranch: 'feature',
        targetBranch: 'main'
      },
      reviews: [],
      reviewComments: [],
      providerData: { type: 'None' }
    }

    const prResult: ForgePrResult = {
      branch: 'feature',
      url: 'https://example.com/pr/42'
    }

    const reviewComments: ForgeReviewComment[] = []

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useForgeIntegration(), {
      wrapper: createWrapper(projectPath)
    })

    await waitFor(() => {
      expect(result.current.status).toEqual(status)
    })

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.ForgeGetStatus, { projectPath })
    expect(mockListenEvent).toHaveBeenCalledWith(SchaltEvent.ForgeStatusChanged, expect.any(Function))

    mockInvoke.mockResolvedValueOnce([])
    await act(async () => {
      await result.current.searchIssues(source, 'bug', 5)
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeSearchIssues, {
      projectPath,
      source,
      query: 'bug',
      limit: 5
    })

    mockInvoke.mockResolvedValueOnce(issueDetails)
    await act(async () => {
      await result.current.getIssueDetails(source, '123')
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeGetIssueDetails, {
      projectPath,
      source,
      id: '123'
    })

    mockInvoke.mockResolvedValueOnce([])
    await act(async () => {
      await result.current.searchPrs(source, 'ready', 3)
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeSearchPrs, {
      projectPath,
      source,
      query: 'ready',
      limit: 3
    })

    mockInvoke.mockResolvedValueOnce(prDetails)
    await act(async () => {
      await result.current.getPrDetails(source, '42')
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeGetPrDetails, {
      projectPath,
      source,
      id: '42'
    })

    mockInvoke.mockResolvedValueOnce(prResult)
    const prArgs: CreateForgeSessionPrArgs = {
      sessionName: 'session-1',
      title: 'Session',
      source,
      mode: 'squash'
    }
    await act(async () => {
      await result.current.createSessionPr(prArgs)
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeCreateSessionPr, {
      args: {
        ...prArgs,
        projectPath
      }
    })

    mockInvoke.mockResolvedValueOnce(reviewComments)
    await act(async () => {
      await result.current.getReviewComments(source, '42')
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeGetReviewComments, {
      projectPath,
      source,
      id: '42'
    })

    mockInvoke.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.approvePr(source, '42')
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeApprovePr, {
      projectPath,
      source,
      id: '42'
    })

    mockInvoke.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.mergePr(source, '42', true, true)
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeMergePr, {
      projectPath,
      source,
      id: '42',
      squash: true,
      deleteBranch: true
    })

    mockInvoke.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.commentOnPr(source, '42', 'Looks good')
    })
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.ForgeCommentOnPr, {
      projectPath,
      source,
      id: '42',
      message: 'Looks good'
    })
  })

  it('returns null pipeline status when forge type is not gitlab', async () => {
    const projectPath = '/tmp/project'
    const status: ForgeStatusPayload = {
      forgeType: 'github',
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      hostname: 'github.com'
    }
    const gitlabSource: ForgeSourceConfig = {
      projectIdentifier: 'group/project',
      hostname: 'gitlab.example.com',
      label: 'Project',
      forgeType: 'gitlab'
    }

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useForgeIntegration(), {
      wrapper: createWrapper(projectPath)
    })

    await waitFor(() => {
      expect(result.current.status?.forgeType).toBe('github')
    })

    mockInvoke.mockClear()
    const pipeline = await result.current.getPipelineStatus(gitlabSource, 'main')
    expect(pipeline).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('fetches gitlab pipeline status via command', async () => {
    const projectPath = '/tmp/project'
    const status: ForgeStatusPayload = {
      forgeType: 'gitlab',
      installed: true,
      authenticated: true,
      userLogin: 'dev',
      hostname: 'gitlab.example.com'
    }
    const gitlabSource: ForgeSourceConfig = {
      projectIdentifier: 'group/project',
      hostname: 'gitlab.example.com',
      label: 'Project',
      forgeType: 'gitlab'
    }

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useForgeIntegration(), {
      wrapper: createWrapper(projectPath)
    })

    await waitFor(() => {
      expect(result.current.status?.forgeType).toBe('gitlab')
    })

    mockInvoke.mockResolvedValueOnce({ id: 7, status: 'running', url: 'https://gitlab/pipelines/7' })

    const pipeline = await result.current.getPipelineStatus(gitlabSource, 'feature')
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.GitLabGetMrPipeline, {
      sourceBranch: 'feature',
      sourceProject: gitlabSource.projectIdentifier,
      sourceHostname: gitlabSource.hostname
    })
    expect(pipeline).toEqual({ id: 7, status: 'running', url: 'https://gitlab/pipelines/7' })
  })

  it('returns null pipeline jobs when forge type is not gitlab', async () => {
    const projectPath = '/tmp/project'
    const status: ForgeStatusPayload = {
      forgeType: 'github',
      installed: true,
      authenticated: true,
      userLogin: 'octocat',
      hostname: 'github.com'
    }
    const gitlabSource: ForgeSourceConfig = {
      projectIdentifier: 'group/project',
      hostname: 'gitlab.example.com',
      label: 'Project',
      forgeType: 'gitlab'
    }

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useForgeIntegration(), {
      wrapper: createWrapper(projectPath)
    })

    await waitFor(() => {
      expect(result.current.status?.forgeType).toBe('github')
    })

    mockInvoke.mockClear()
    const jobs = await result.current.getPipelineJobs(gitlabSource, 'main')
    expect(jobs).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('fetches gitlab pipeline jobs via command', async () => {
    const projectPath = '/tmp/project'
    const status: ForgeStatusPayload = {
      forgeType: 'gitlab',
      installed: true,
      authenticated: true,
      userLogin: 'dev',
      hostname: 'gitlab.example.com'
    }
    const gitlabSource: ForgeSourceConfig = {
      projectIdentifier: 'group/project',
      hostname: 'gitlab.example.com',
      label: 'Project',
      forgeType: 'gitlab'
    }

    mockInvoke.mockResolvedValueOnce(status)

    const { result } = renderHook(() => useForgeIntegration(), {
      wrapper: createWrapper(projectPath)
    })

    await waitFor(() => {
      expect(result.current.status?.forgeType).toBe('gitlab')
    })

    mockInvoke.mockResolvedValueOnce([
      {
        id: 10,
        name: 'build',
        stage: 'build',
        status: 'success',
        url: 'https://gitlab/jobs/10',
        duration: 33
      }
    ])

    const jobs = await result.current.getPipelineJobs(gitlabSource, 'feature')
    expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.GitLabGetPipelineJobs, {
      sourceBranch: 'feature',
      sourceProject: gitlabSource.projectIdentifier,
      sourceHostname: gitlabSource.hostname
    })
    expect(jobs).toEqual([
      {
        id: 10,
        name: 'build',
        stage: 'build',
        status: 'success',
        url: 'https://gitlab/jobs/10',
        duration: 33
      }
    ])
  })
})
