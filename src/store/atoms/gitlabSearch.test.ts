import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import type { GitlabSource, GitlabMrSummary, GitlabIssueSummary } from '../../types/gitlabTypes'
import {
  buildCacheKey,
  buildSourcesHash,
  gitlabMrSearchEntriesAtom,
  gitlabIssueSearchEntriesAtom,
  gitlabMrSearchEntryAtomFamily,
  gitlabIssueSearchEntryAtomFamily,
  searchGitlabMrsActionAtom,
  searchGitlabIssuesActionAtom,
} from './gitlabSearch'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeSource(overrides: Partial<GitlabSource> = {}): GitlabSource {
  return {
    id: 'src-1',
    label: 'My Project',
    projectPath: 'group/project',
    hostname: 'gitlab.com',
    issuesEnabled: true,
    mrsEnabled: true,
    pipelinesEnabled: false,
    ...overrides,
  }
}

function makeMr(overrides: Partial<GitlabMrSummary> = {}): GitlabMrSummary {
  return {
    iid: 1,
    title: 'MR Title',
    state: 'opened',
    updatedAt: '2025-01-15T10:00:00Z',
    labels: [],
    url: 'https://gitlab.com/group/project/-/merge_requests/1',
    sourceBranch: 'feature',
    targetBranch: 'main',
    sourceLabel: 'My Project',
    ...overrides,
  }
}

function makeIssue(overrides: Partial<GitlabIssueSummary> = {}): GitlabIssueSummary {
  return {
    iid: 1,
    title: 'Issue Title',
    state: 'opened',
    updatedAt: '2025-01-15T10:00:00Z',
    labels: [],
    url: 'https://gitlab.com/group/project/-/issues/1',
    sourceLabel: 'My Project',
    ...overrides,
  }
}

describe('gitlabSearch atoms', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  describe('buildCacheKey', () => {
    it('produces a stable key from type, sources, and query', () => {
      const sources = [makeSource()]
      const key1 = buildCacheKey('mrs', sources, 'test')
      const key2 = buildCacheKey('mrs', sources, 'test')
      expect(key1).toBe(key2)
    })

    it('produces different keys for different query strings', () => {
      const sources = [makeSource()]
      const key1 = buildCacheKey('mrs', sources, 'alpha')
      const key2 = buildCacheKey('mrs', sources, 'beta')
      expect(key1).not.toBe(key2)
    })

    it('produces different keys for mrs vs issues', () => {
      const sources = [makeSource()]
      const key1 = buildCacheKey('mrs', sources, 'test')
      const key2 = buildCacheKey('issues', sources, 'test')
      expect(key1).not.toBe(key2)
    })
  })

  describe('buildSourcesHash', () => {
    it('produces the same hash regardless of source order', () => {
      const src1 = makeSource({ id: '1', label: 'A', projectPath: 'a/a', hostname: 'h1' })
      const src2 = makeSource({ id: '2', label: 'B', projectPath: 'b/b', hostname: 'h2' })
      const hash1 = buildSourcesHash([src1, src2])
      const hash2 = buildSourcesHash([src2, src1])
      expect(hash1).toBe(hash2)
    })
  })

  describe('MR search', () => {
    it('returns default entry when no data has been fetched', () => {
      const store = createStore()
      const entry = store.get(gitlabMrSearchEntryAtomFamily('nonexistent'))
      expect(entry.results).toEqual([])
      expect(entry.isLoading).toBe(false)
      expect(entry.isRevalidating).toBe(false)
      expect(entry.error).toBeNull()
    })

    it('fetches MRs from enabled sources and stores results', async () => {
      const store = createStore()
      const source = makeSource()
      const mr = makeMr()

      mockInvoke.mockResolvedValue([mr])

      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'test' })

      const key = buildCacheKey('mrs', [source], 'test')
      const entry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(entry.results).toHaveLength(1)
      expect(entry.results[0].iid).toBe(1)
      expect(entry.isLoading).toBe(false)
      expect(entry.isRevalidating).toBe(false)
      expect(entry.error).toBeNull()
      expect(entry.fetchedAt).toBeGreaterThan(0)
    })

    it('passes undefined for sourceHostname when hostname is gitlab.com', async () => {
      const store = createStore()
      const source = makeSource({ hostname: 'gitlab.com' })

      mockInvoke.mockResolvedValue([])

      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: '' })

      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.GitLabSearchMrs,
        expect.objectContaining({ sourceHostname: undefined }),
      )
    })

    it('passes sourceHostname when hostname is not gitlab.com', async () => {
      const store = createStore()
      const source = makeSource({ hostname: 'gitlab.example.com' })

      mockInvoke.mockResolvedValue([])

      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: '' })

      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.GitLabSearchMrs,
        expect.objectContaining({ sourceHostname: 'gitlab.example.com' }),
      )
    })

    it('skips sources where mrsEnabled is false', async () => {
      const store = createStore()
      const disabledSource = makeSource({ mrsEnabled: false })

      await store.set(searchGitlabMrsActionAtom, { sources: [disabledSource], query: 'test' })

      expect(mockInvoke).not.toHaveBeenCalled()

      const key = buildCacheKey('mrs', [disabledSource], 'test')
      const entry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(entry.results).toEqual([])
      expect(entry.isLoading).toBe(false)
    })

    it('merges results from multiple sources sorted by updatedAt descending', async () => {
      const store = createStore()
      const src1 = makeSource({ id: '1', label: 'P1', projectPath: 'g/p1' })
      const src2 = makeSource({ id: '2', label: 'P2', projectPath: 'g/p2' })

      const mr1 = makeMr({ iid: 1, updatedAt: '2025-01-10T00:00:00Z', sourceLabel: 'P1' })
      const mr2 = makeMr({ iid: 2, updatedAt: '2025-01-20T00:00:00Z', sourceLabel: 'P2' })
      const mr3 = makeMr({ iid: 3, updatedAt: '2025-01-15T00:00:00Z', sourceLabel: 'P1' })

      mockInvoke
        .mockResolvedValueOnce([mr1, mr3])
        .mockResolvedValueOnce([mr2])

      await store.set(searchGitlabMrsActionAtom, { sources: [src1, src2], query: '' })

      const key = buildCacheKey('mrs', [src1, src2], '')
      const entry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(entry.results.map(r => r.iid)).toEqual([2, 3, 1])
    })

    it('sets isLoading on initial fetch (no cached data)', async () => {
      const store = createStore()
      const source = makeSource()

      let resolveInvoke: (v: GitlabMrSummary[]) => void = () => {}
      mockInvoke.mockReturnValue(new Promise<GitlabMrSummary[]>(r => { resolveInvoke = r }))

      const promise = store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })

      const key = buildCacheKey('mrs', [source], 'q')
      const loadingEntry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(loadingEntry.isLoading).toBe(true)
      expect(loadingEntry.isRevalidating).toBe(false)

      resolveInvoke([])
      await promise
    })

    it('sets isRevalidating when cached data exists', async () => {
      const store = createStore()
      const source = makeSource()
      const mr = makeMr()

      mockInvoke.mockResolvedValueOnce([mr])
      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })

      let resolveInvoke: (v: GitlabMrSummary[]) => void = () => {}
      mockInvoke.mockReturnValue(new Promise<GitlabMrSummary[]>(r => { resolveInvoke = r }))

      const promise = store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q', force: true })

      const key = buildCacheKey('mrs', [source], 'q')
      const revalidatingEntry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(revalidatingEntry.isRevalidating).toBe(true)
      expect(revalidatingEntry.isLoading).toBe(false)
      expect(revalidatingEntry.results).toHaveLength(1)

      resolveInvoke([])
      await promise
    })

    it('returns empty results and surfaces error when a single source fails (per-source error isolation)', async () => {
      const store = createStore()
      const source = makeSource()

      mockInvoke.mockRejectedValueOnce(new Error('network error'))
      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })

      const key = buildCacheKey('mrs', [source], 'q')
      const entry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(entry.results).toEqual([])
      expect(entry.error).toBe('Failed to fetch merge requests from My Project')
      expect(entry.errorDetails).toEqual([{ source: 'My Project', message: 'network error' }])
      expect(entry.isLoading).toBe(false)
    })

    it('returns partial results and surfaces error when one source fails and another succeeds', async () => {
      const store = createStore()
      const src1 = makeSource({ id: '1', label: 'P1', projectPath: 'g/p1' })
      const src2 = makeSource({ id: '2', label: 'P2', projectPath: 'g/p2' })
      const mr = makeMr({ iid: 42, sourceLabel: 'P2' })

      mockInvoke
        .mockRejectedValueOnce(new Error('source 1 down'))
        .mockResolvedValueOnce([mr])

      await store.set(searchGitlabMrsActionAtom, { sources: [src1, src2], query: '' })

      const key = buildCacheKey('mrs', [src1, src2], '')
      const entry = store.get(gitlabMrSearchEntryAtomFamily(key))
      expect(entry.results).toHaveLength(1)
      expect(entry.results[0].iid).toBe(42)
      expect(entry.error).toBe('Failed to fetch merge requests from P1')
      expect(entry.errorDetails).toEqual([{ source: 'P1', message: 'source 1 down' }])
    })
  })

  describe('Issue search', () => {
    it('fetches issues from enabled sources and stores results', async () => {
      const store = createStore()
      const source = makeSource()
      const issue = makeIssue()

      mockInvoke.mockResolvedValue([issue])

      await store.set(searchGitlabIssuesActionAtom, { sources: [source], query: 'bug' })

      const key = buildCacheKey('issues', [source], 'bug')
      const entry = store.get(gitlabIssueSearchEntryAtomFamily(key))
      expect(entry.results).toHaveLength(1)
      expect(entry.results[0].iid).toBe(1)
      expect(entry.isLoading).toBe(false)
      expect(entry.error).toBeNull()
    })

    it('skips sources where issuesEnabled is false', async () => {
      const store = createStore()
      const disabledSource = makeSource({ issuesEnabled: false })

      await store.set(searchGitlabIssuesActionAtom, { sources: [disabledSource], query: 'test' })

      expect(mockInvoke).not.toHaveBeenCalled()

      const key = buildCacheKey('issues', [disabledSource], 'test')
      const entry = store.get(gitlabIssueSearchEntryAtomFamily(key))
      expect(entry.results).toEqual([])
    })

    it('merges results from multiple sources sorted by updatedAt descending', async () => {
      const store = createStore()
      const src1 = makeSource({ id: '1', label: 'P1', projectPath: 'g/p1' })
      const src2 = makeSource({ id: '2', label: 'P2', projectPath: 'g/p2' })

      const issue1 = makeIssue({ iid: 1, updatedAt: '2025-01-10T00:00:00Z', sourceLabel: 'P1' })
      const issue2 = makeIssue({ iid: 2, updatedAt: '2025-01-20T00:00:00Z', sourceLabel: 'P2' })

      mockInvoke
        .mockResolvedValueOnce([issue1])
        .mockResolvedValueOnce([issue2])

      await store.set(searchGitlabIssuesActionAtom, { sources: [src1, src2], query: '' })

      const key = buildCacheKey('issues', [src1, src2], '')
      const entry = store.get(gitlabIssueSearchEntryAtomFamily(key))
      expect(entry.results.map(r => r.iid)).toEqual([2, 1])
    })

    it('returns empty results and surfaces error when a single source fails (per-source error isolation)', async () => {
      const store = createStore()
      const source = makeSource()

      mockInvoke.mockRejectedValueOnce(new Error('timeout'))
      await store.set(searchGitlabIssuesActionAtom, { sources: [source], query: 'q' })

      const key = buildCacheKey('issues', [source], 'q')
      const entry = store.get(gitlabIssueSearchEntryAtomFamily(key))
      expect(entry.results).toEqual([])
      expect(entry.error).toBe('Failed to fetch issues from My Project')
      expect(entry.errorDetails).toEqual([{ source: 'My Project', message: 'timeout' }])
    })

    it('returns partial results and surfaces error when one source fails and another succeeds', async () => {
      const store = createStore()
      const src1 = makeSource({ id: '1', label: 'P1', projectPath: 'g/p1' })
      const src2 = makeSource({ id: '2', label: 'P2', projectPath: 'g/p2' })
      const issue = makeIssue({ iid: 42, sourceLabel: 'P2' })

      mockInvoke
        .mockRejectedValueOnce(new Error('source 1 down'))
        .mockResolvedValueOnce([issue])

      await store.set(searchGitlabIssuesActionAtom, { sources: [src1, src2], query: '' })

      const key = buildCacheKey('issues', [src1, src2], '')
      const entry = store.get(gitlabIssueSearchEntryAtomFamily(key))
      expect(entry.results).toHaveLength(1)
      expect(entry.results[0].iid).toBe(42)
      expect(entry.error).toBe('Failed to fetch issues from P1')
      expect(entry.errorDetails).toEqual([{ source: 'P1', message: 'source 1 down' }])
    })
  })

  describe('inflight deduplication', () => {
    it('does not send duplicate requests for the same MR cache key', async () => {
      const store = createStore()
      const source = makeSource()

      mockInvoke.mockResolvedValue([makeMr()])

      const p1 = store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })
      const p2 = store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })
      await Promise.all([p1, p2])

      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it('sends a new request when force is true even if inflight exists', async () => {
      const store = createStore()
      const source = makeSource()
      const mr = makeMr()

      mockInvoke.mockResolvedValueOnce([mr])
      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q' })

      mockInvoke.mockResolvedValueOnce([mr])
      await store.set(searchGitlabMrsActionAtom, { sources: [source], query: 'q', force: true })

      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })
  })

  describe('base entries atom', () => {
    it('starts with empty maps', () => {
      const store = createStore()
      expect(store.get(gitlabMrSearchEntriesAtom).size).toBe(0)
      expect(store.get(gitlabIssueSearchEntriesAtom).size).toBe(0)
    })
  })
})
