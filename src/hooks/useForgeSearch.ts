import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeSourceConfig } from '../types/forgeTypes'
import { logger } from '../utils/logger'
import { buildForgeSourcesIdentity } from '../utils/forgeSourcesIdentity'
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
  getSourceForItem: (item: TSummary) => ForgeSourceConfig | undefined
}

export function buildSourceItemKey(source: ForgeSourceConfig | undefined, id: string): string {
  if (!source) return id
  return `${source.forgeType}::${source.hostname ?? 'default'}::${source.projectIdentifier}::${id}`
}

function buildSourceIndex<TSummary extends object>(
  items: TSummary[],
  getId: (item: TSummary) => string,
  sourceByItem: WeakMap<TSummary, ForgeSourceConfig>
): Map<string, ForgeSourceConfig> {
  return new Map(
    items
      .map((item) => {
        const source = sourceByItem.get(item)
        if (!source) return null
        return [buildSourceItemKey(source, getId(item)), source] as const
      })
      .filter((entry): entry is readonly [string, ForgeSourceConfig] => entry !== null)
  )
}

export function useForgeSearch<TSummary extends object, TDetails>(
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
  const queryRef = useRef('')

  const getIdRef = useRef(getId)
  const getTitleRef = useRef(getTitle)
  const getUpdatedAtRef = useRef(getUpdatedAt)
  const summaryFromDetailsRef = useRef(summaryFromDetails)
  const searchFnRef = useRef(searchFn)
  const detailsFnRef = useRef(detailsFn)
  const sourcesRef = useRef(sources)
  const sourcesIdentityRef = useRef<string | null>(null)
  const sourceByItemRef = useRef(new WeakMap<TSummary, ForgeSourceConfig>())
  const sourceIndexRef = useRef(new Map<string, ForgeSourceConfig>())

  getIdRef.current = getId
  getTitleRef.current = getTitle
  getUpdatedAtRef.current = getUpdatedAt
  summaryFromDetailsRef.current = summaryFromDetails
  searchFnRef.current = searchFn
  detailsFnRef.current = detailsFn
  sourcesRef.current = sources

  const sourcesIdentity = useMemo(() => buildForgeSourcesIdentity(sources), [sources])

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
      const key = buildSourceItemKey(
        sourceByItemRef.current.get(item),
        getIdRef.current(item)
      )
      if (!seen.has(key)) {
        seen.set(key, item)
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

  const setResultsWithSources = useCallback((items: TSummary[]) => {
    setResults(items)
    sourceIndexRef.current = buildSourceIndex(
      items,
      getIdRef.current,
      sourceByItemRef.current
    )
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
        for (const item of result.value) {
          sourceByItemRef.current.set(item, currentSources[i]!)
        }
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

    for (let sourceIndex = 0; sourceIndex < settled.length; sourceIndex++) {
      const result = settled[sourceIndex]!
      if (result.status === 'fulfilled') {
        const summary = summaryFromDetailsRef.current!(result.value)
        sourceByItemRef.current.set(summary, currentSources[sourceIndex]!)
        setResults((prev) => {
          const summaryKey = buildSourceItemKey(
            currentSources[sourceIndex]!,
            getIdRef.current(summary)
          )
          if (
            prev.some(
              (item) =>
                buildSourceItemKey(
                  sourceByItemRef.current.get(item),
                  getIdRef.current(item)
                ) === summaryKey
            )
          ) {
            return prev
          }
          const next = [summary, ...prev]
          sourceIndexRef.current = buildSourceIndex(
            next,
            getIdRef.current,
            sourceByItemRef.current
          )
          return next
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
    const merged = deduplicateAndSort([...allResults, ...localFiltered])

    setResultsWithSources(merged)
    setLoading(false)

    if (failedSources.length > 0) {
      setError(`Failed to fetch from ${failedSources.map((f) => f.sourceLabel).join(', ')}`)
      setErrorDetails(failedSources)
    } else {
      setError(null)
      setErrorDetails([])
    }

    void performNumericLookup(trimmed, merged, version)
  }, [executeSearch, filterLocally, deduplicateAndSort, performNumericLookup, setResultsWithSources])

  useEffect(() => {
    const sourcesChanged =
      sourcesIdentityRef.current !== null && sourcesIdentityRef.current !== sourcesIdentity
    sourcesIdentityRef.current = sourcesIdentity

    if (!enabled) {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
      hasInitialFetchedRef.current = false
      setLoading(false)
      setResultsWithSources([])
      cachedItemsRef.current = []
      sourceByItemRef.current = new WeakMap()
      sourceIndexRef.current.clear()
      setError(null)
      setErrorDetails([])
      return
    }

    if (!hasInitialFetchedRef.current || sourcesChanged) {
      hasInitialFetchedRef.current = true
      cachedItemsRef.current = []
      sourceByItemRef.current = new WeakMap()
      sourceIndexRef.current.clear()
      setResultsWithSources([])
      setError(null)
      setErrorDetails([])
      void executeFullSearch(queryRef.current)
    }

    return () => {
      if (debounceHandle.current) {
        window.clearTimeout(debounceHandle.current)
        debounceHandle.current = null
      }
    }
  }, [enabled, executeFullSearch, sourcesIdentity, setResultsWithSources])

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q)
      queryRef.current = q

      if (!enabled || !hasInitialFetchedRef.current) return

      const localFiltered = filterLocally(cachedItemsRef.current, q)
      setResultsWithSources(localFiltered)

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
    [enabled, debounceMs, filterLocally, executeFullSearch, setResultsWithSources]
  )

  const fetchDetails = useCallback(
    async (id: string, source?: ForgeSourceConfig): Promise<TDetails | null> => {
      const targetSource =
        source ??
        Array.from(sourceIndexRef.current.entries())
          .find(([key]) => key.endsWith(`::${id}`))?.[1] ??
        sourcesRef.current[0]
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

  const getSourceForItem = useCallback(
    (item: TSummary): ForgeSourceConfig | undefined =>
      sourceByItemRef.current.get(item),
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
    getSourceForItem,
  }
}
