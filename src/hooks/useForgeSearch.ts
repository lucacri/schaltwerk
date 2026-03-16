import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForgeSourceConfig } from '../types/forgeTypes'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'

export interface SourceError {
  sourceLabel: string
  error: string
}

export interface UseForgeSearchOptions<TSummary, TDetails> {
  searchFn: (source: ForgeSourceConfig, query?: string) => Promise<TSummary[]>
  detailsFn: (source: ForgeSourceConfig, id: string) => Promise<TDetails>
  sources: ForgeSourceConfig[]
  enabled: boolean
  debounceMs?: number
  getId: (item: TSummary) => string
  getTitle: (item: TSummary) => string
  getUpdatedAt?: (item: TSummary) => string | undefined
  summaryFromDetails?: (details: TDetails) => TSummary
}

export interface UseForgeSearchResult<TSummary, TDetails> {
  query: string
  setQuery: (q: string) => void
  results: TSummary[]
  loading: boolean
  error: string | null
  errorDetails: SourceError[]
  clearError: () => void
  fetchDetails: (id: string, source?: ForgeSourceConfig) => Promise<TDetails | null>
}

export function useForgeSearch<TSummary, TDetails>(
  options: UseForgeSearchOptions<TSummary, TDetails>
): UseForgeSearchResult<TSummary, TDetails> {
  const {
    searchFn,
    detailsFn,
    sources,
    enabled,
    debounceMs = 300,
    getId,
    getTitle,
    getUpdatedAt,
    summaryFromDetails,
  } = options

  const [results, setResults] = useState<TSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<SourceError[]>([])
  const [query, setQueryState] = useState('')

  const cachedItemsRef = useRef<TSummary[]>([])
  const versionRef = useRef(0)
  const debounceHandle = useRef<number | null>(null)
  const hasInitialFetchedRef = useRef(false)

  const getIdRef = useRef(getId)
  const getTitleRef = useRef(getTitle)
  const getUpdatedAtRef = useRef(getUpdatedAt)
  const summaryFromDetailsRef = useRef(summaryFromDetails)
  const searchFnRef = useRef(searchFn)
  const detailsFnRef = useRef(detailsFn)
  const sourcesRef = useRef(sources)

  getIdRef.current = getId
  getTitleRef.current = getTitle
  getUpdatedAtRef.current = getUpdatedAt
  summaryFromDetailsRef.current = summaryFromDetails
  searchFnRef.current = searchFn
  detailsFnRef.current = detailsFn
  sourcesRef.current = sources

  const filterLocally = useCallback((items: TSummary[], q: string): TSummary[] => {
    if (!q.trim()) return items
    const lower = q.toLowerCase()
    return items.filter(
      (item) =>
        getIdRef.current(item).toLowerCase().includes(lower) ||
        getTitleRef.current(item).toLowerCase().includes(lower)
    )
  }, [])

  const deduplicateAndSort = useCallback((items: TSummary[]): TSummary[] => {
    const seen = new Map<string, TSummary>()
    for (const item of items) {
      const id = getIdRef.current(item)
      if (!seen.has(id)) {
        seen.set(id, item)
      }
    }
    const deduped = Array.from(seen.values())
    const getter = getUpdatedAtRef.current
    if (getter) {
      deduped.sort((a, b) => {
        const aDate = getter(a) ?? ''
        const bDate = getter(b) ?? ''
        return bDate.localeCompare(aDate)
      })
    }
    return deduped
  }, [])

  const executeSearch = useCallback(async (term: string | undefined, version: number) => {
    const currentSources = sourcesRef.current
    const failedSources: SourceError[] = []

    const settled = await Promise.allSettled(
      currentSources.map((source) => searchFnRef.current(source, term))
    )

    const allResults: TSummary[] = []
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!
      if (result.status === 'fulfilled') {
        allResults.push(...result.value)
      } else {
        const sourceLabel = currentSources[i]!.label
        const errorMsg = resolveErrorMessage(result.reason)
        failedSources.push({ sourceLabel, error: errorMsg })
        logger.warn(`Failed to search forge for source ${sourceLabel}`, result.reason)
      }
    }

    if (versionRef.current !== version) return null

    return { allResults, failedSources }
  }, [])

  const performNumericLookup = useCallback(async (
    q: string,
    currentResults: TSummary[],
    version: number
  ) => {
    if (!/^\d+$/.test(q)) return
    if (!summaryFromDetailsRef.current) return
    if (currentResults.some((item) => getIdRef.current(item) === q)) return

    const currentSources = sourcesRef.current
    const settled = await Promise.allSettled(
      currentSources.map((source) => detailsFnRef.current(source, q))
    )

    if (versionRef.current !== version) return

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const summary = summaryFromDetailsRef.current!(result.value)
        setResults((prev) => {
          if (prev.some((item) => getIdRef.current(item) === getIdRef.current(summary))) {
            return prev
          }
          return [summary, ...prev]
        })
        return
      }
    }
  }, [])

  const executeFullSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    const version = ++versionRef.current
    setLoading(true)

    const searchResult = await executeSearch(
      trimmed.length > 0 ? trimmed : undefined,
      version
    )
    if (!searchResult) return

    const { allResults, failedSources } = searchResult

    if (trimmed.length === 0) {
      cachedItemsRef.current = allResults
    }

    const localFiltered = filterLocally(cachedItemsRef.current, trimmed)
    const merged = deduplicateAndSort([...localFiltered, ...allResults])

    setResults(merged)
    setLoading(false)

    if (failedSources.length > 0) {
      setError(`Failed to fetch from ${failedSources.map((f) => f.sourceLabel).join(', ')}`)
      setErrorDetails(failedSources)
    } else {
      setError(null)
      setErrorDetails([])
    }

    void performNumericLookup(trimmed, merged, version)
  }, [executeSearch, filterLocally, deduplicateAndSort, performNumericLookup])

  useEffect(() => {
    if (!enabled) {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
      hasInitialFetchedRef.current = false
      setLoading(false)
      setResults([])
      cachedItemsRef.current = []
      return
    }

    if (!hasInitialFetchedRef.current) {
      hasInitialFetchedRef.current = true
      void executeFullSearch('')
    }
  }, [enabled, executeFullSearch])

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q)

      if (!enabled || !hasInitialFetchedRef.current) return

      const localFiltered = filterLocally(cachedItemsRef.current, q)
      setResults(localFiltered)

      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
      }

      if (debounceMs === 0) {
        void executeFullSearch(q)
        return
      }

      debounceHandle.current = window.setTimeout(() => {
        void executeFullSearch(q)
      }, debounceMs)
    },
    [enabled, debounceMs, filterLocally, executeFullSearch]
  )

  const fetchDetails = useCallback(
    async (id: string, source?: ForgeSourceConfig): Promise<TDetails | null> => {
      const targetSource = source ?? sourcesRef.current[0]
      if (!targetSource) return null
      try {
        return await detailsFnRef.current(targetSource, id)
      } catch (err) {
        logger.error(`Failed to fetch details for id ${id}`, err)
        return null
      }
    },
    []
  )

  const clearError = useCallback(() => {
    setError(null)
    setErrorDetails([])
  }, [])

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    errorDetails,
    clearError,
    fetchDetails,
  }
}
