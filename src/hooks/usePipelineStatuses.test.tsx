import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { usePipelineStatuses } from './usePipelineStatuses'
import type { ForgePrSummary, ForgePipelineStatus, ForgeSourceConfig } from '../types/forgeTypes'

afterEach(() => {
  cleanup()
})

function makePr(overrides: Partial<ForgePrSummary> = {}): ForgePrSummary {
  return {
    id: '1',
    title: 'Test PR',
    state: 'OPEN',
    author: 'alice',
    labels: [],
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    ...overrides,
  }
}

const gitlabSource: ForgeSourceConfig = {
  projectIdentifier: 'group/project',
  hostname: 'gitlab.example.com',
  label: 'GitLab',
  forgeType: 'gitlab',
}

const emptySources: ForgeSourceConfig[] = []
const gitlabSources = [gitlabSource]

describe('usePipelineStatuses', () => {
  it('returns empty map when forgeType is not gitlab', () => {
    const prs = [makePr()]
    const getPipelineStatus = vi.fn()
    const getSourceForItem = vi.fn()

    const { result, unmount } = renderHook(() =>
      usePipelineStatuses({
        prs,
        forgeType: 'github',
        sources: emptySources,
        getPipelineStatus,
        getSourceForItem,
      })
    )

    expect(result.current.size).toBe(0)
    expect(getPipelineStatus).not.toHaveBeenCalled()
    unmount()
  })

  it('fetches pipeline status for open MRs', async () => {
    const pipeline: ForgePipelineStatus = { id: 123, status: 'success' }
    const prs = [makePr({ id: '10', state: 'OPEN' })]
    const getPipelineStatus = vi.fn().mockResolvedValue(pipeline)
    const getSourceForItem = vi.fn().mockReturnValue(gitlabSource)

    const { result, unmount } = renderHook(() =>
      usePipelineStatuses({
        prs,
        forgeType: 'gitlab',
        sources: gitlabSources,
        getPipelineStatus,
        getSourceForItem,
      })
    )

    await waitFor(() => {
      expect(result.current.get('10')).toEqual(pipeline)
    })
    unmount()
  })

  it('skips closed and merged MRs', () => {
    const prs = [
      makePr({ id: '1', state: 'CLOSED' }),
      makePr({ id: '2', state: 'MERGED' }),
    ]
    const getPipelineStatus = vi.fn().mockResolvedValue({ id: 1, status: 'success' })
    const getSourceForItem = vi.fn().mockReturnValue(gitlabSource)

    const { unmount } = renderHook(() =>
      usePipelineStatuses({
        prs,
        forgeType: 'gitlab',
        sources: gitlabSources,
        getPipelineStatus,
        getSourceForItem,
      })
    )

    expect(getPipelineStatus).not.toHaveBeenCalled()
    unmount()
  })

  it('handles null pipeline status gracefully', async () => {
    const prs = [makePr({ id: '5' })]
    const getPipelineStatus = vi.fn().mockResolvedValue(null)
    const getSourceForItem = vi.fn().mockReturnValue(gitlabSource)

    const { result, unmount } = renderHook(() =>
      usePipelineStatuses({
        prs,
        forgeType: 'gitlab',
        sources: gitlabSources,
        getPipelineStatus,
        getSourceForItem,
      })
    )

    await waitFor(() => {
      expect(getPipelineStatus).toHaveBeenCalled()
    })

    expect(result.current.has('5')).toBe(false)
    unmount()
  })

  it('fetches for multiple open MRs', async () => {
    const prs = [
      makePr({ id: '10', state: 'OPEN', sourceBranch: 'a' }),
      makePr({ id: '20', state: 'opened', sourceBranch: 'b' }),
    ]
    const getPipelineStatus = vi.fn()
      .mockResolvedValueOnce({ id: 1, status: 'success' })
      .mockResolvedValueOnce({ id: 2, status: 'failed' })
    const getSourceForItem = vi.fn().mockReturnValue(gitlabSource)

    const { result, unmount } = renderHook(() =>
      usePipelineStatuses({
        prs,
        forgeType: 'gitlab',
        sources: gitlabSources,
        getPipelineStatus,
        getSourceForItem,
      })
    )

    await waitFor(() => {
      expect(result.current.size).toBe(2)
    })

    expect(result.current.get('10')?.status).toBe('success')
    expect(result.current.get('20')?.status).toBe('failed')
    unmount()
  })
})
