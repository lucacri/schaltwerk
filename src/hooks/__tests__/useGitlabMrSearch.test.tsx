import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import React, { createElement, type ReactNode } from 'react'
import { useGitlabMrSearch } from '../useGitlabMrSearch'
import type { GitlabMrSummary, GitlabSource } from '../../types/gitlabTypes'
import {
  buildCacheKey,
  gitlabMrSearchEntriesAtom,
  type GitlabSearchEntry,
} from '../../store/atoms/gitlabSearch'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const TEST_SOURCES: GitlabSource[] = [
  {
    id: 'src-1',
    label: 'My Project',
    projectPath: 'group/project',
    hostname: 'gitlab.com',
    issuesEnabled: false,
    mrsEnabled: true,
    pipelinesEnabled: false,
  },
]

function makeMrSummary(overrides: Partial<GitlabMrSummary> = {}): GitlabMrSummary {
  return {
    iid: 1,
    title: 'Test MR',
    state: 'opened',
    updatedAt: '2025-01-01T00:00:00Z',
    labels: [],
    url: 'https://gitlab.com/group/project/-/merge_requests/1',
    sourceBranch: 'feature',
    targetBranch: 'main',
    sourceLabel: 'My Project',
    ...overrides,
  }
}

function HydrateAtoms({ initialValues, children }: { initialValues: Array<[any, any]>; children: ReactNode }): ReactNode {
  useHydrateAtoms(initialValues)
  return children
}

function createWrapper(store: ReturnType<typeof createStore>, initialValues: Array<[any, any]> = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(Provider, { store },
      createElement(HydrateAtoms as React.FC<{ initialValues: Array<[any, any]> }>, { initialValues }, children),
    )
  }
}

describe('useGitlabMrSearch', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createStore()
  })

  it('returns cached results immediately when atom has data', () => {
    const cacheKey = buildCacheKey('mrs', TEST_SOURCES, '')
    const cached: GitlabSearchEntry<GitlabMrSummary> = {
      results: [makeMrSummary(), makeMrSummary({ iid: 2, title: 'Second MR' })],
      isLoading: false,
      isRevalidating: false,
      error: null,
      errorDetails: null,
      fetchedAt: Date.now(),
    }
    const entries = new Map<string, GitlabSearchEntry<GitlabMrSummary>>()
    entries.set(cacheKey, cached)

    const wrapper = createWrapper(store, [[gitlabMrSearchEntriesAtom, entries]])

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].title).toBe('Test MR')
    expect(result.current.results[1].title).toBe('Second MR')
    expect(result.current.loading).toBe(false)
  })

  it('exposes isRevalidating from the atom entry', () => {
    const cacheKey = buildCacheKey('mrs', TEST_SOURCES, '')
    const cached: GitlabSearchEntry<GitlabMrSummary> = {
      results: [makeMrSummary()],
      isLoading: false,
      isRevalidating: true,
      error: null,
      errorDetails: null,
      fetchedAt: Date.now(),
    }
    const entries = new Map<string, GitlabSearchEntry<GitlabMrSummary>>()
    entries.set(cacheKey, cached)

    const wrapper = createWrapper(store, [[gitlabMrSearchEntriesAtom, entries]])

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.isRevalidating).toBe(true)
  })

  it('includes fetchDetails and fetchPipeline in return value', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(typeof result.current.fetchDetails).toBe('function')
    expect(typeof result.current.fetchPipeline).toBe('function')
  })

  it('returns loading: false and isRevalidating: false for initial state', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.isRevalidating).toBe(false)
  })

  it('provides setQuery that updates the query', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.query).toBe('')

    act(() => {
      result.current.setQuery('test search')
    })

    expect(result.current.query).toBe('test search')
  })

  it('provides clearError callback', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabMrSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(typeof result.current.clearError).toBe('function')
  })
})
