import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabIssueDetails, GitlabIssueSummary, GitlabSource } from '../types/gitlabTypes'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'

export interface UseGitlabIssueSearchResult {
  results: GitlabIssueSummary[]
  loading: boolean
  error: string | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => Promise<GitlabIssueDetails>
  clearError: () => void
}

interface UseGitlabIssueSearchOptions {
  debounceMs?: number
  enabled?: boolean
  sources: GitlabSource[]
}

export function useGitlabIssueSearch(options: UseGitlabIssueSearchOptions): UseGitlabIssueSearchResult {
  const { debounceMs = 300, enabled = true, sources } = options
  const isTestEnv = typeof import.meta !== 'undefined' && Boolean((import.meta as unknown as { vitest?: unknown }).vitest)
  const effectiveDebounce = isTestEnv ? 0 : debounceMs
  const [results, setResults] = useState<GitlabIssueSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const searchVersionRef = useRef(0)
  const debounceHandle = useRef<number | null>(null)
  const sourcesRef = useRef(sources)
  const queryRef = useRef(query)
  const prevQueryRef = useRef(query)

  sourcesRef.current = sources
  queryRef.current = query

  const sourcesKey = useMemo(
    () => sources.map(s => `${s.id}:${s.issuesEnabled}`).join(','),
    [sources]
  )

  const executeSearch = useCallback(async (term: string) => {
    const trimmed = term.trim()
    const version = ++searchVersionRef.current
    const enabledSources = sourcesRef.current.filter(s => s.issuesEnabled)

    if (enabledSources.length === 0) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    const failedSources: string[] = []

    try {
      const allResults = await Promise.all(
        enabledSources.map(source =>
          invoke<GitlabIssueSummary[]>(TauriCommands.GitLabSearchIssues, {
            query: trimmed.length > 0 ? trimmed : undefined,
            sourceProject: source.projectPath,
            sourceHostname: source.hostname === 'gitlab.com' ? undefined : source.hostname,
            sourceLabel: source.label,
          }).catch(err => {
            failedSources.push(source.label)
            logger.warn(`Failed to search GitLab issues for source ${source.label}`, err)
            return [] as GitlabIssueSummary[]
          })
        )
      )

      if (searchVersionRef.current !== version) return

      const merged = allResults.flat().sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
      setResults(merged)

      if (failedSources.length > 0) {
        setError(`Failed to fetch issues from ${failedSources.join(', ')}`)
      } else {
        setError(null)
      }
    } catch (err) {
      if (searchVersionRef.current === version) {
        logger.error(`Failed to search GitLab issues for query: ${trimmed}`, err)
        setResults([])
        setError(resolveErrorMessage(err))
      }
    } finally {
      if (searchVersionRef.current === version) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
      setLoading(false)
      setResults([])
      return
    }

    const enabledSources = sourcesRef.current.filter(s => s.issuesEnabled)
    if (enabledSources.length === 0) {
      setResults([])
      return
    }

    void executeSearch(queryRef.current)
  }, [enabled, sourcesKey, executeSearch])

  useEffect(() => {
    if (!enabled) return

    if (prevQueryRef.current === query) {
      prevQueryRef.current = query
      return
    }
    prevQueryRef.current = query

    const enabledSources = sourcesRef.current.filter(s => s.issuesEnabled)
    if (enabledSources.length === 0) return

    if (effectiveDebounce === 0) {
      void executeSearch(query)
      return
    }

    if (debounceHandle.current) {
      window.clearTimeout(debounceHandle.current)
    }

    debounceHandle.current = window.setTimeout(() => {
      void executeSearch(query)
    }, effectiveDebounce)

    return () => {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
      }
    }
  }, [query, effectiveDebounce, executeSearch, enabled])

  const refresh = useCallback(() => {
    if (!enabled) return
    void executeSearch(queryRef.current)
  }, [enabled, executeSearch])

  const fetchDetails = useCallback(async (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => {
    try {
      const payload = await invoke<GitlabIssueDetails>(TauriCommands.GitLabGetIssueDetails, {
        iid,
        sourceProject,
        sourceHostname: sourceHostname === 'gitlab.com' ? undefined : sourceHostname,
        sourceLabel,
      })
      setError(null)
      return {
        ...payload,
        labels: payload.labels ?? [],
        notes: payload.notes ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setError(message)
      throw new Error(message)
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    results,
    loading,
    error,
    query,
    setQuery,
    refresh,
    fetchDetails,
    clearError,
  }
}
