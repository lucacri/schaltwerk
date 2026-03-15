import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabMrDetails, GitlabMrSummary, GitlabPipelinePayload, GitlabSource } from '../types/gitlabTypes'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'
import {
  buildCacheKey,
  gitlabMrSearchEntryAtomFamily,
  searchGitlabMrsActionAtom,
  type SourceError,
} from '../store/atoms/gitlabSearch'

export interface UseGitlabMrSearchResult {
  results: GitlabMrSummary[]
  loading: boolean
  isRevalidating: boolean
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
  const [query, setQuery] = useState('')
  const [detailError, setDetailError] = useState<string | null>(null)
  const hasInitialFetchedRef = useRef(false)
  const debounceHandle = useRef<number | null>(null)

  const cacheKey = buildCacheKey('mrs', sources, query)
  const entry = useAtomValue(gitlabMrSearchEntryAtomFamily(cacheKey))
  const searchAction = useSetAtom(searchGitlabMrsActionAtom)

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
      const payload = await invoke<GitlabMrDetails>(TauriCommands.GitLabGetMrDetails, {
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
        reviewers: payload.reviewers ?? [],
      }
    } catch (err) {
      const message = resolveErrorMessage(err)
      setDetailError(message)
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
    setDetailError(null)
  }, [])

  return {
    results: entry.results,
    loading: entry.isLoading,
    isRevalidating: entry.isRevalidating,
    error: detailError ?? entry.error,
    errorDetails: entry.errorDetails,
    query,
    setQuery,
    refresh,
    fetchDetails,
    fetchPipeline,
    clearError,
  }
}
