import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabMrDetails, GitlabMrSummary, GitlabPipelinePayload, GitlabSource } from '../types/gitlabTypes'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'
import type { SourceError } from './useGitlabIssueSearch'

export interface UseGitlabMrSearchResult {
  results: GitlabMrSummary[]
  loading: boolean
  error: string | null
  errorDetails: SourceError[] | null
  query: string
  setQuery: (next: string) => void
  refresh: () => void
  fetchDetails: (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => Promise<GitlabMrDetails>
  fetchPipeline: (sourceBranch: string, sourceProject: string, sourceHostname?: string) => Promise<GitlabPipelinePayload | null>
  clearError: () => void
}

interface UseGitlabMrSearchOptions {
  debounceMs?: number
  enabled?: boolean
  sources: GitlabSource[]
}

export function useGitlabMrSearch(options: UseGitlabMrSearchOptions): UseGitlabMrSearchResult {
  const { debounceMs = 300, enabled = true, sources } = options
  const isTestEnv = typeof import.meta !== 'undefined' && Boolean((import.meta as unknown as { vitest?: unknown }).vitest)
  const effectiveDebounce = isTestEnv ? 0 : debounceMs
  const [results, setResults] = useState<GitlabMrSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<SourceError[] | null>(null)
  const [query, setQuery] = useState('')
  const searchVersionRef = useRef(0)
  const debounceHandle = useRef<number | null>(null)
  const sourcesRef = useRef(sources)
  const queryRef = useRef(query)
  const prevQueryRef = useRef(query)

  sourcesRef.current = sources
  queryRef.current = query

  const sourcesKey = useMemo(
    () => sources.map(s => `${s.id}:${s.mrsEnabled}`).join(','),
    [sources]
  )

  const executeSearch = useCallback(async (term: string) => {
    const trimmed = term.trim()
    const version = ++searchVersionRef.current
    const enabledSources = sourcesRef.current.filter(s => s.mrsEnabled)

    if (enabledSources.length === 0) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    const failedSources: SourceError[] = []

    try {
      const allResults = await Promise.all(
        enabledSources.map(source =>
          invoke<GitlabMrSummary[]>(TauriCommands.GitLabSearchMrs, {
            query: trimmed.length > 0 ? trimmed : undefined,
            sourceProject: source.projectPath,
            sourceHostname: source.hostname === 'gitlab.com' ? undefined : source.hostname,
            sourceLabel: source.label,
          }).catch(err => {
            failedSources.push({ source: source.label, message: resolveErrorMessage(err) })
            logger.warn(`Failed to search GitLab MRs for source ${source.label}`, err)
            return [] as GitlabMrSummary[]
          })
        )
      )

      if (searchVersionRef.current !== version) return

      const merged = allResults.flat().sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
      setResults(merged)

      if (failedSources.length > 0) {
        setError(`Failed to fetch merge requests from ${failedSources.map(f => f.source).join(', ')}`)
        setErrorDetails(failedSources)
      } else {
        setError(null)
        setErrorDetails(null)
      }
    } catch (err) {
      if (searchVersionRef.current === version) {
        logger.error(`Failed to search GitLab MRs for query: ${trimmed}`, err)
        setResults([])
        setError(resolveErrorMessage(err))
        setErrorDetails([{ source: 'unknown', message: resolveErrorMessage(err) }])
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

    const enabledSources = sourcesRef.current.filter(s => s.mrsEnabled)
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

    const enabledSources = sourcesRef.current.filter(s => s.mrsEnabled)
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
      const payload = await invoke<GitlabMrDetails>(TauriCommands.GitLabGetMrDetails, {
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
        reviewers: payload.reviewers ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setError(message)
      throw new Error(message)
    }
  }, [])

  const fetchPipeline = useCallback(async (sourceBranch: string, sourceProject: string, sourceHostname?: string): Promise<GitlabPipelinePayload | null> => {
    try {
      return await invoke<GitlabPipelinePayload | null>(TauriCommands.GitLabGetMrPipeline, {
        sourceBranch,
        sourceProject,
        sourceHostname: sourceHostname === 'gitlab.com' ? undefined : sourceHostname,
      })
    } catch (err) {
      logger.warn('Failed to fetch GitLab pipeline', err)
      return null
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setErrorDetails(null)
  }, [])

  return {
    results,
    loading,
    error,
    errorDetails,
    query,
    setQuery,
    refresh,
    fetchDetails,
    fetchPipeline,
    clearError,
  }
}
