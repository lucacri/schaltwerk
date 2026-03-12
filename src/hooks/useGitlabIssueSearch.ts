import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabIssueDetails, GitlabIssueSummary, GitlabSource } from '../types/gitlabTypes'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'
import {
  buildCacheKey,
  gitlabIssueSearchEntryAtomFamily,
  searchGitlabIssuesActionAtom,
} from '../store/atoms/gitlabSearch'

export interface UseGitlabIssueSearchResult {
  results: GitlabIssueSummary[]
  loading: boolean
  isRevalidating: boolean
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
  const [query, setQuery] = useState('')
  const [detailError, setDetailError] = useState<string | null>(null)
  const hasInitialFetchedRef = useRef(false)
  const debounceHandle = useRef<number | null>(null)

  const cacheKey = buildCacheKey('issues', sources, query)
  const entry = useAtomValue(gitlabIssueSearchEntryAtomFamily(cacheKey))
  const searchAction = useSetAtom(searchGitlabIssuesActionAtom)

  useEffect(() => {
    if (!enabled) {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
      hasInitialFetchedRef.current = false
      return
    }

    if (!hasInitialFetchedRef.current) {
      hasInitialFetchedRef.current = true
      void searchAction({ sources, query: '' })
    }
  }, [enabled, searchAction, sources])

  useEffect(() => {
    if (!enabled || !hasInitialFetchedRef.current) {
      return
    }

    if (effectiveDebounce === 0) {
      void searchAction({ sources, query })
      return
    }

    if (debounceHandle.current) {
      window.clearTimeout(debounceHandle.current)
    }

    debounceHandle.current = window.setTimeout(() => {
      void searchAction({ sources, query })
    }, effectiveDebounce)

    return () => {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
      }
    }
  }, [query, effectiveDebounce, searchAction, sources, enabled])

  const refresh = useCallback(() => {
    if (!enabled) return
    void searchAction({ sources, query, force: true })
  }, [enabled, searchAction, sources, query])

  const fetchDetails = useCallback(async (iid: number, sourceProject: string, sourceHostname?: string, sourceLabel?: string) => {
    try {
      const payload = await invoke<GitlabIssueDetails>(TauriCommands.GitLabGetIssueDetails, {
        iid,
        sourceProject,
        sourceHostname: sourceHostname === 'gitlab.com' ? undefined : sourceHostname,
        sourceLabel,
      })
      setDetailError(null)
      return {
        ...payload,
        labels: payload.labels ?? [],
        notes: payload.notes ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setDetailError(message)
      throw new Error(message)
    }
  }, [])

  const clearError = useCallback(() => {
    setDetailError(null)
  }, [])

  return {
    results: entry.results,
    loading: entry.isLoading,
    isRevalidating: entry.isRevalidating,
    error: detailError ?? entry.error,
    query,
    setQuery,
    refresh,
    fetchDetails,
    clearError,
  }
}
