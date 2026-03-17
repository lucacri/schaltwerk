import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useForgeSearch } from './useForgeSearch'
import type { ForgeSourceConfig } from '../types/forgeTypes'
import type { UseForgeSearchOptions } from './useForgeSearch'

interface TestSummary {
  id: string
  title: string
  updatedAt?: string
}

interface TestDetails {
  summary: TestSummary
  body: string
}

const source1: ForgeSourceConfig = {
  projectIdentifier: 'owner/repo1',
  hostname: 'github.com',
  label: 'repo1',
  forgeType: 'github',
}

const source2: ForgeSourceConfig = {
  projectIdentifier: 'owner/repo2',
  hostname: 'github.com',
  label: 'repo2',
  forgeType: 'github',
}

function makeItem(id: string, title: string, updatedAt?: string): TestSummary {
  return { id, title, updatedAt }
}

function makeDetails(id: string, title: string): TestDetails {
  return { summary: makeItem(id, title), body: `Body of ${id}` }
}

function defaultOptions(
  overrides: Partial<UseForgeSearchOptions<TestSummary, TestDetails>> = {}
): UseForgeSearchOptions<TestSummary, TestDetails> {
  return {
    searchFn: vi.fn().mockResolvedValue([]),
    detailsFn: vi.fn().mockResolvedValue(makeDetails('1', 'Test')),
    sources: [source1],
    enabled: true,
    debounceMs: 0,
    getId: (item) => item.id,
    getTitle: (item) => item.title,
    getUpdatedAt: (item) => item.updatedAt,
    ...overrides,
  }
}

describe('useForgeSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns empty results when disabled', () => {
    const opts = defaultOptions({ enabled: false })
    const { result } = renderHook(() => useForgeSearch(opts))

    expect(result.current.results).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(opts.searchFn).not.toHaveBeenCalled()
  })

  it('fetches all items on enable (calls searchFn with no query)', async () => {
    const items = [makeItem('1', 'Bug fix'), makeItem('2', 'Feature')]
    const searchFn = vi.fn().mockResolvedValue(items)
    const opts = defaultOptions({ searchFn })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(searchFn).toHaveBeenCalledWith(source1, undefined)
    expect(result.current.results).toEqual(items)
  })

  it('filters cached items immediately on query change', async () => {
    const items = [
      makeItem('1', 'Bug fix login'),
      makeItem('2', 'Feature auth'),
      makeItem('3', 'Bug fix signup'),
    ]
    const searchFn = vi.fn().mockResolvedValue(items)
    const opts = defaultOptions({ searchFn, debounceMs: 300 })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('auth')
    })

    expect(result.current.results).toEqual([makeItem('2', 'Feature auth')])
  })

  it('fires debounced API search after timer advance', async () => {
    const initialItems = [makeItem('1', 'Bug fix')]
    const searchResults = [makeItem('1', 'Bug fix'), makeItem('99', 'Auth remote')]
    const searchFn = vi.fn()
      .mockResolvedValueOnce(initialItems)
      .mockResolvedValueOnce(searchResults)
    const opts = defaultOptions({ searchFn, debounceMs: 300 })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('auth')
    })

    expect(searchFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    await vi.waitFor(() => {
      expect(searchFn).toHaveBeenCalledTimes(2)
    })

    expect(searchFn).toHaveBeenLastCalledWith(source1, 'auth')
  })

  it('merges API results with cached, deduplicates by id', async () => {
    const initialItems = [
      makeItem('1', 'Bug fix auth', '2024-01-01'),
      makeItem('2', 'Feature auth flow', '2024-01-02'),
    ]
    const apiResults = [
      makeItem('2', 'Feature auth flow', '2024-01-02'),
      makeItem('3', 'Auth service', '2024-01-03'),
    ]
    const searchFn = vi.fn()
      .mockResolvedValueOnce(initialItems)
      .mockResolvedValueOnce(apiResults)
    const opts = defaultOptions({ searchFn, debounceMs: 0 })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('auth')
    })

    await vi.waitFor(() => {
      expect(searchFn).toHaveBeenCalledTimes(2)
    })

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const ids = result.current.results.map(r => r.id)
    expect(ids).toContain('1')
    expect(ids).toContain('2')
    expect(ids).toContain('3')
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('numeric query triggers direct detail fetch when id not in results', async () => {
    const initialItems = [makeItem('1', 'Bug fix')]
    const searchFn = vi.fn().mockResolvedValue(initialItems)
    const detailsFn = vi.fn().mockResolvedValue(makeDetails('42', 'Direct match'))
    const summaryFromDetails = (d: TestDetails) => d.summary
    const opts = defaultOptions({
      searchFn,
      detailsFn,
      summaryFromDetails,
      debounceMs: 0,
    })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('42')
    })

    await vi.waitFor(() => {
      expect(detailsFn).toHaveBeenCalledWith(source1, '42')
    })

    await vi.waitFor(() => {
      expect(result.current.results.some(r => r.id === '42')).toBe(true)
    })
  })

  it('multi-source merges results from all sources', async () => {
    const items1 = [makeItem('1', 'Issue from repo1', '2024-01-02')]
    const items2 = [makeItem('2', 'Issue from repo2', '2024-01-01')]
    const searchFn = vi.fn()
      .mockImplementation((source: ForgeSourceConfig) => {
        if (source.label === 'repo1') return Promise.resolve(items1)
        if (source.label === 'repo2') return Promise.resolve(items2)
        return Promise.resolve([])
      })
    const opts = defaultOptions({ searchFn, sources: [source1, source2] })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(searchFn).toHaveBeenCalledTimes(2)
    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0]!.id).toBe('1')
    expect(result.current.results[1]!.id).toBe('2')
  })

  it('tracks per-source errors without blocking other sources', async () => {
    const items1 = [makeItem('1', 'Issue from repo1')]
    const searchFn = vi.fn()
      .mockImplementation((source: ForgeSourceConfig) => {
        if (source.label === 'repo1') return Promise.resolve(items1)
        if (source.label === 'repo2') return Promise.reject(new Error('Auth failed'))
        return Promise.resolve([])
      })
    const opts = defaultOptions({ searchFn, sources: [source1, source2] })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]!.id).toBe('1')
    expect(result.current.error).not.toBeNull()
    expect(result.current.errorDetails).toHaveLength(1)
    expect(result.current.errorDetails[0]!.sourceLabel).toBe('repo2')
  })

  it('race condition: stale results are ignored', async () => {
    let resolveFirst: (value: TestSummary[]) => void
    let resolveSecond: (value: TestSummary[]) => void

    const firstPromise = new Promise<TestSummary[]>((resolve) => {
      resolveFirst = resolve
    })
    const secondPromise = new Promise<TestSummary[]>((resolve) => {
      resolveSecond = resolve
    })

    const searchFn = vi.fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)

    const opts = defaultOptions({ searchFn, debounceMs: 0 })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setQuery('first')
    })

    act(() => {
      result.current.setQuery('second')
    })

    await act(async () => {
      resolveSecond!([makeItem('2', 'Second result')])
    })

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      resolveFirst!([makeItem('1', 'First result (stale)')])
    })

    expect(result.current.results.some(r => r.id === '2')).toBe(true)
    expect(result.current.results.some(r => r.title === 'First result (stale)')).toBe(false)
  })

  it('fetchDetails returns details for an id', async () => {
    const details = makeDetails('5', 'Detailed issue')
    const detailsFn = vi.fn().mockResolvedValue(details)
    const opts = defaultOptions({ detailsFn })

    const { result } = renderHook(() => useForgeSearch(opts))

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    let fetchedDetails: TestDetails | null = null
    await act(async () => {
      fetchedDetails = await result.current.fetchDetails('5')
    })

    expect(detailsFn).toHaveBeenCalledWith(source1, '5')
    expect(fetchedDetails).toEqual(details)
  })
})
