import { useState, useCallback, useEffect, useRef } from 'react'
import { logger } from '../utils/logger'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  retry: () => void
}

export function useAsyncState<T>(
  asyncFn: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const asyncFnRef = useRef(asyncFn)
  asyncFnRef.current = asyncFn

  const execute = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    asyncFnRef.current(controller.signal)
      .then((result) => {
        if (!mountedRef.current || controller.signal.aborted) return
        setData(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || controller.signal.aborted) return
        const error = err instanceof Error ? err : new Error(String(err))
        logger.error('[useAsyncState] async operation failed:', error)
        setError(error)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    execute()

    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, ...deps])

  const retry = useCallback(() => {
    execute()
  }, [execute])

  return { data, loading, error, retry }
}
