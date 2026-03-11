import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitlabMrSearch } from '../useGitlabMrSearch'
import { invoke } from '@tauri-apps/api/core'
import type { GitlabSource, GitlabMrSummary } from '../../types/gitlabTypes'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}))

const makeSource = (id: string, label: string, projectPath: string, hostname = 'gitlab.com'): GitlabSource => ({
  id, label, projectPath, hostname, issuesEnabled: false, mrsEnabled: true, pipelinesEnabled: false,
})

const makeMr = (iid: number, sourceLabel: string, updatedAt = '2026-01-01T00:00:00Z'): GitlabMrSummary => ({
  iid, title: `MR ${iid}`, state: 'opened', updatedAt, author: 'user', labels: [],
  url: `https://gitlab.com/mrs/${iid}`, sourceBranch: 'feature', targetBranch: 'main', sourceLabel,
})

describe('useGitlabMrSearch', () => {
  const mockInvoke = vi.mocked(invoke)

  beforeEach(() => { vi.clearAllMocks() })

  it('merges results from multiple sources', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b', 'gitlab.example.com')

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve([makeMr(1, 'Project A', '2026-01-02T00:00:00Z')])
      if (args.sourceProject === 'group/project-b') return Promise.resolve([makeMr(2, 'Project B', '2026-01-03T00:00:00Z')])
      return Promise.resolve([])
    })

    const { result } = renderHook(() => useGitlabMrSearch({ sources: [sourceA, sourceB] }))

    await waitFor(() => { expect(result.current.loading).toBe(false) })

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].sourceLabel).toBe('Project B')
    expect(result.current.results[1].sourceLabel).toBe('Project A')
  })

  it('fetches from all sources when sources arrive after initial mount', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b')

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve([makeMr(1, 'Project A')])
      if (args.sourceProject === 'group/project-b') return Promise.resolve([makeMr(2, 'Project B')])
      return Promise.resolve([])
    })

    const { result, rerender } = renderHook(
      ({ sources }) => useGitlabMrSearch({ sources }),
      { initialProps: { sources: [] as GitlabSource[] } }
    )

    await waitFor(() => { expect(result.current.loading).toBe(false) })
    expect(result.current.results).toHaveLength(0)

    rerender({ sources: [sourceA, sourceB] })

    await waitFor(() => { expect(result.current.results).toHaveLength(2) })
  })

  it('shows results from successful source when another fails', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b')

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve([makeMr(1, 'Project A')])
      if (args.sourceProject === 'group/project-b') return Promise.reject(new Error('auth failed'))
      return Promise.resolve([])
    })

    const { result } = renderHook(() => useGitlabMrSearch({ sources: [sourceA, sourceB] }))

    await waitFor(() => { expect(result.current.loading).toBe(false) })

    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].sourceLabel).toBe('Project A')
  })
})
