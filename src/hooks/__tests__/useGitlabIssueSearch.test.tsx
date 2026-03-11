import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitlabIssueSearch } from '../useGitlabIssueSearch'
import { invoke } from '@tauri-apps/api/core'
import type { GitlabSource, GitlabIssueSummary } from '../../types/gitlabTypes'

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
  id, label, projectPath, hostname, issuesEnabled: true, mrsEnabled: false, pipelinesEnabled: false,
})

const makeIssue = (iid: number, sourceLabel: string, updatedAt = '2026-01-01T00:00:00Z'): GitlabIssueSummary => ({
  iid, title: `Issue ${iid}`, state: 'opened', updatedAt, author: 'user', labels: [], url: `https://gitlab.com/issues/${iid}`, sourceLabel,
})

describe('useGitlabIssueSearch', () => {
  const mockInvoke = vi.mocked(invoke)

  beforeEach(() => { vi.clearAllMocks() })

  it('merges results from multiple sources', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b', 'gitlab.example.com')
    const issuesA = [makeIssue(1, 'Project A', '2026-01-02T00:00:00Z')]
    const issuesB = [makeIssue(2, 'Project B', '2026-01-03T00:00:00Z')]

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve(issuesA)
      if (args.sourceProject === 'group/project-b') return Promise.resolve(issuesB)
      return Promise.resolve([])
    })

    const { result } = renderHook(() => useGitlabIssueSearch({ sources: [sourceA, sourceB] }))

    await waitFor(() => { expect(result.current.loading).toBe(false) })

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].sourceLabel).toBe('Project B')
    expect(result.current.results[1].sourceLabel).toBe('Project A')
  })

  it('fetches from all sources when sources arrive after initial mount', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b', 'gitlab.example.com')
    const issuesA = [makeIssue(1, 'Project A')]
    const issuesB = [makeIssue(2, 'Project B')]

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve(issuesA)
      if (args.sourceProject === 'group/project-b') return Promise.resolve(issuesB)
      return Promise.resolve([])
    })

    const { result, rerender } = renderHook(
      ({ sources }) => useGitlabIssueSearch({ sources }),
      { initialProps: { sources: [] as GitlabSource[] } }
    )

    await waitFor(() => { expect(result.current.loading).toBe(false) })
    expect(result.current.results).toHaveLength(0)

    rerender({ sources: [sourceA, sourceB] })

    await waitFor(() => { expect(result.current.results).toHaveLength(2) })
  })

  it('surfaces partial failures while keeping successful source results', async () => {
    const sourceA = makeSource('1', 'Project A', 'group/project-a')
    const sourceB = makeSource('2', 'Project B', 'group/project-b')
    const issuesA = [makeIssue(1, 'Project A')]

    mockInvoke.mockImplementation((_cmd: string, args: Record<string, unknown>) => {
      if (args.sourceProject === 'group/project-a') return Promise.resolve(issuesA)
      if (args.sourceProject === 'group/project-b') return Promise.reject(new Error('auth failed'))
      return Promise.resolve([])
    })

    const { result } = renderHook(() => useGitlabIssueSearch({ sources: [sourceA, sourceB] }))

    await waitFor(() => { expect(result.current.loading).toBe(false) })

    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].sourceLabel).toBe('Project A')
    expect(result.current.error).toContain('Project B')
  })
})
