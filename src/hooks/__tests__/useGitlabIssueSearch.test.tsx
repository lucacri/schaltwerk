import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import React, { createElement, type ReactNode } from 'react'
import { useGitlabIssueSearch } from '../useGitlabIssueSearch'
import type { GitlabIssueSummary, GitlabSource } from '../../types/gitlabTypes'
import {
  buildCacheKey,
  gitlabIssueSearchEntriesAtom,
  type GitlabSearchEntry,
} from '../../store/atoms/gitlabSearch'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../utils/resolveErrorMessage', () => ({
  resolveErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}))

const TEST_SOURCES: GitlabSource[] = [
  {
    id: 'src-1',
    label: 'My Project',
    projectPath: 'group/project',
    hostname: 'gitlab.com',
    issuesEnabled: true,
    mrsEnabled: false,
    pipelinesEnabled: false,
  },
]

function makeIssueSummary(overrides: Partial<GitlabIssueSummary> = {}): GitlabIssueSummary {
  return {
    iid: 1,
    title: 'Test Issue',
    state: 'opened',
    updatedAt: '2025-01-01T00:00:00Z',
    labels: [],
    url: 'https://gitlab.com/group/project/-/issues/1',
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

describe('useGitlabIssueSearch', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    vi.clearAllMocks()
    store = createStore()
  })

  it('returns cached results immediately when atom has data', () => {
    const cacheKey = buildCacheKey('issues', TEST_SOURCES, '')
    const cached: GitlabSearchEntry<GitlabIssueSummary> = {
      results: [makeIssueSummary(), makeIssueSummary({ iid: 2, title: 'Second Issue' })],
      isLoading: false,
      isRevalidating: false,
      error: null,
      fetchedAt: Date.now(),
    }
    const entries = new Map<string, GitlabSearchEntry<GitlabIssueSummary>>()
    entries.set(cacheKey, cached)

    const wrapper = createWrapper(store, [[gitlabIssueSearchEntriesAtom, entries]])

    const { result } = renderHook(
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].title).toBe('Test Issue')
    expect(result.current.results[1].title).toBe('Second Issue')
    expect(result.current.loading).toBe(false)
  })

  it('exposes isRevalidating from the atom entry', () => {
    const cacheKey = buildCacheKey('issues', TEST_SOURCES, '')
    const cached: GitlabSearchEntry<GitlabIssueSummary> = {
      results: [makeIssueSummary()],
      isLoading: false,
      isRevalidating: true,
      error: null,
      fetchedAt: Date.now(),
    }
    const entries = new Map<string, GitlabSearchEntry<GitlabIssueSummary>>()
    entries.set(cacheKey, cached)

    const wrapper = createWrapper(store, [[gitlabIssueSearchEntriesAtom, entries]])

    const { result } = renderHook(
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.isRevalidating).toBe(true)
  })

  it('includes fetchDetails in return value', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(typeof result.current.fetchDetails).toBe('function')
  })

  it('returns loading: false and isRevalidating: false for initial state', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.isRevalidating).toBe(false)
  })

  it('provides setQuery that updates the query', () => {
    const wrapper = createWrapper(store)

    const { result } = renderHook(
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
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
      () => useGitlabIssueSearch({ sources: TEST_SOURCES, enabled: true }),
      { wrapper },
    )

    expect(typeof result.current.clearError).toBe('function')
  })
})
