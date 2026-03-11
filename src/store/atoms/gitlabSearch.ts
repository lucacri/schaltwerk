import { atom, type Getter, type Setter } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { GitlabSource, GitlabMrSummary, GitlabIssueSummary } from '../../types/gitlabTypes'
import { logger } from '../../utils/logger'

export interface GitlabSearchEntry<T> {
  results: T[]
  isLoading: boolean
  isRevalidating: boolean
  error: string | null
  fetchedAt: number
}

export interface SearchActionPayload {
  sources: GitlabSource[]
  query: string
  force?: boolean
}

const DEFAULT_MR_ENTRY: GitlabSearchEntry<GitlabMrSummary> = Object.freeze({
  results: [],
  isLoading: false,
  isRevalidating: false,
  error: null,
  fetchedAt: 0,
})

const DEFAULT_ISSUE_ENTRY: GitlabSearchEntry<GitlabIssueSummary> = Object.freeze({
  results: [],
  isLoading: false,
  isRevalidating: false,
  error: null,
  fetchedAt: 0,
})

export function buildSourcesHash(sources: GitlabSource[]): string {
  return sources
    .map(s => `${s.label}|${s.projectPath}|${s.hostname}`)
    .sort()
    .join(';;')
}

export function buildCacheKey(type: 'mrs' | 'issues', sources: GitlabSource[], query: string): string {
  return `${type}:${buildSourcesHash(sources)}:${query}`
}

const inflightRequests = new Map<string, Promise<void>>()

export const gitlabMrSearchEntriesAtom = atom<Map<string, GitlabSearchEntry<GitlabMrSummary>>>(new Map())
export const gitlabIssueSearchEntriesAtom = atom<Map<string, GitlabSearchEntry<GitlabIssueSummary>>>(new Map())

export const gitlabMrSearchEntryAtomFamily = atomFamily((cacheKey: string) =>
  atom(get => {
    const map = get(gitlabMrSearchEntriesAtom)
    return map.get(cacheKey) ?? DEFAULT_MR_ENTRY
  }),
)

export const gitlabIssueSearchEntryAtomFamily = atomFamily((cacheKey: string) =>
  atom(get => {
    const map = get(gitlabIssueSearchEntriesAtom)
    return map.get(cacheKey) ?? DEFAULT_ISSUE_ENTRY
  }),
)

function updateMrEntry(
  get: Getter,
  set: Setter,
  cacheKey: string,
  updater: (entry: GitlabSearchEntry<GitlabMrSummary>) => GitlabSearchEntry<GitlabMrSummary>,
) {
  const currentEntries = get(gitlabMrSearchEntriesAtom)
  const current = currentEntries.get(cacheKey) ?? DEFAULT_MR_ENTRY
  const nextEntry = updater(current)
  if (nextEntry === current) return
  const updated = new Map(currentEntries)
  updated.set(cacheKey, nextEntry)
  set(gitlabMrSearchEntriesAtom, updated)
}

function updateIssueEntry(
  get: Getter,
  set: Setter,
  cacheKey: string,
  updater: (entry: GitlabSearchEntry<GitlabIssueSummary>) => GitlabSearchEntry<GitlabIssueSummary>,
) {
  const currentEntries = get(gitlabIssueSearchEntriesAtom)
  const current = currentEntries.get(cacheKey) ?? DEFAULT_ISSUE_ENTRY
  const nextEntry = updater(current)
  if (nextEntry === current) return
  const updated = new Map(currentEntries)
  updated.set(cacheKey, nextEntry)
  set(gitlabIssueSearchEntriesAtom, updated)
}

function sourceHostnameParam(hostname: string): string | undefined {
  return hostname === 'gitlab.com' ? undefined : hostname
}

function sortByUpdatedAtDesc<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const searchGitlabMrsActionAtom = atom(
  null,
  async (get, set, payload: SearchActionPayload) => {
    const { sources, query, force } = payload
    const enabledSources = sources.filter(s => s.mrsEnabled)
    const cacheKey = buildCacheKey('mrs', sources, query)

    if (enabledSources.length === 0) {
      updateMrEntry(get, set, cacheKey, () => ({
        results: [],
        isLoading: false,
        isRevalidating: false,
        error: null,
        fetchedAt: Date.now(),
      }))
      return
    }

    const existing = inflightRequests.get(cacheKey)
    if (existing) {
      await existing
      if (!force) return
    }

    const hasCachedData = (get(gitlabMrSearchEntriesAtom).get(cacheKey)?.results.length ?? 0) > 0

    updateMrEntry(get, set, cacheKey, entry => ({
      ...entry,
      isLoading: !hasCachedData,
      isRevalidating: hasCachedData,
      error: null,
    }))

    const request = (async () => {
      try {
        const allResults = await Promise.all(
          enabledSources.map(source =>
            invoke<GitlabMrSummary[]>(TauriCommands.GitLabSearchMrs, {
              query: query || undefined,
              sourceProject: source.projectPath,
              sourceHostname: sourceHostnameParam(source.hostname),
              sourceLabel: source.label,
            }).catch(err => {
              logger.warn(`[gitlabSearch] Failed to search MRs for source ${source.label}`, err)
              return [] as GitlabMrSummary[]
            }),
          ),
        )

        const merged = sortByUpdatedAtDesc(allResults.flat())

        updateMrEntry(get, set, cacheKey, () => ({
          results: merged,
          isLoading: false,
          isRevalidating: false,
          error: null,
          fetchedAt: Date.now(),
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateMrEntry(get, set, cacheKey, entry => ({
          ...entry,
          isLoading: false,
          isRevalidating: false,
          error: message,
        }))
        logger.error('[gitlabSearch] Failed to search MRs', error)
      } finally {
        inflightRequests.delete(cacheKey)
      }
    })()

    inflightRequests.set(cacheKey, request)
    await request
  },
)

export const searchGitlabIssuesActionAtom = atom(
  null,
  async (get, set, payload: SearchActionPayload) => {
    const { sources, query, force } = payload
    const enabledSources = sources.filter(s => s.issuesEnabled)
    const cacheKey = buildCacheKey('issues', sources, query)

    if (enabledSources.length === 0) {
      updateIssueEntry(get, set, cacheKey, () => ({
        results: [],
        isLoading: false,
        isRevalidating: false,
        error: null,
        fetchedAt: Date.now(),
      }))
      return
    }

    const existing = inflightRequests.get(cacheKey)
    if (existing) {
      await existing
      if (!force) return
    }

    const hasCachedData = (get(gitlabIssueSearchEntriesAtom).get(cacheKey)?.results.length ?? 0) > 0

    updateIssueEntry(get, set, cacheKey, entry => ({
      ...entry,
      isLoading: !hasCachedData,
      isRevalidating: hasCachedData,
      error: null,
    }))

    const request = (async () => {
      try {
        const allResults = await Promise.all(
          enabledSources.map(source =>
            invoke<GitlabIssueSummary[]>(TauriCommands.GitLabSearchIssues, {
              query: query || undefined,
              sourceProject: source.projectPath,
              sourceHostname: sourceHostnameParam(source.hostname),
              sourceLabel: source.label,
            }).catch(err => {
              logger.warn(`[gitlabSearch] Failed to search issues for source ${source.label}`, err)
              return [] as GitlabIssueSummary[]
            }),
          ),
        )

        const merged = sortByUpdatedAtDesc(allResults.flat())

        updateIssueEntry(get, set, cacheKey, () => ({
          results: merged,
          isLoading: false,
          isRevalidating: false,
          error: null,
          fetchedAt: Date.now(),
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateIssueEntry(get, set, cacheKey, entry => ({
          ...entry,
          isLoading: false,
          isRevalidating: false,
          error: message,
        }))
        logger.error('[gitlabSearch] Failed to search issues', error)
      } finally {
        inflightRequests.delete(cacheKey)
      }
    })()

    inflightRequests.set(cacheKey, request)
    await request
  },
)
