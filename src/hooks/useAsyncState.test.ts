import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAsyncState } from './useAsyncState'

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('useAsyncState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns data after async function resolves', async () => {
    const asyncFn = vi.fn((_signal: AbortSignal) => Promise.resolve('result'))

    const { result } = renderHook(() => useAsyncState(asyncFn, []))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toBe('result')
    expect(result.current.error).toBeNull()
  })

  it('sets error when async function rejects', async () => {
    const asyncFn = vi.fn((_signal: AbortSignal) =>
      Promise.reject(new Error('fetch failed')),
    )

    const { result } = renderHook(() => useAsyncState(asyncFn, []))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('fetch failed')
  })

  it('wraps non-Error rejections in an Error', async () => {
    const asyncFn = vi.fn((_signal: AbortSignal) =>
      Promise.reject('string error'),
    )

    const { result } = renderHook(() => useAsyncState(asyncFn, []))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('string error')
  })

  it('re-executes when deps change', async () => {
    let callCount = 0
    const asyncFn = (_signal: AbortSignal) => {
      callCount++
      return Promise.resolve(`result-${callCount}`)
    }

    const { result, rerender } = renderHook(
      ({ dep }) => useAsyncState(asyncFn, [dep]),
      { initialProps: { dep: 'a' } },
    )

    await waitFor(() => {
      expect(result.current.data).toBe('result-1')
    })

    rerender({ dep: 'b' })

    await waitFor(() => {
      expect(result.current.data).toBe('result-2')
    })

    expect(callCount).toBe(2)
  })

  it('aborts previous request when deps change', async () => {
    const signals: AbortSignal[] = []
    const asyncFn = (signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('done'), 100)
        signal.addEventListener('abort', () => clearTimeout(timer))
      })
    }

    const { rerender } = renderHook(
      ({ dep }) => useAsyncState(asyncFn, [dep]),
      { initialProps: { dep: 'a' } },
    )

    rerender({ dep: 'b' })

    expect(signals[0].aborted).toBe(true)
  })

  it('aborts on unmount', async () => {
    let capturedSignal: AbortSignal | null = null
    const asyncFn = (signal: AbortSignal) => {
      capturedSignal = signal
      return new Promise<string>(() => {})
    }

    const { unmount } = renderHook(() => useAsyncState(asyncFn, []))

    await waitFor(() => {
      expect(capturedSignal).not.toBeNull()
    })

    unmount()

    expect(capturedSignal!.aborted).toBe(true)
  })

  it('does not update state after unmount', async () => {
    let resolvePromise: (value: string) => void
    const asyncFn = (_signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        resolvePromise = resolve
      })

    const { result, unmount } = renderHook(() => useAsyncState(asyncFn, []))

    expect(result.current.loading).toBe(true)

    unmount()
    resolvePromise!('late result')

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('retry re-executes the async function', async () => {
    let callCount = 0
    const asyncFn = (_signal: AbortSignal) => {
      callCount++
      return Promise.resolve(`result-${callCount}`)
    }

    const { result } = renderHook(() => useAsyncState(asyncFn, []))

    await waitFor(() => {
      expect(result.current.data).toBe('result-1')
    })

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(result.current.data).toBe('result-2')
    })

    expect(callCount).toBe(2)
  })

  it('passes abort signal to the async function', async () => {
    const asyncFn = vi.fn((_signal: AbortSignal) => Promise.resolve('ok'))

    renderHook(() => useAsyncState(asyncFn, []))

    await waitFor(() => {
      expect(asyncFn).toHaveBeenCalledTimes(1)
    })

    const signal = asyncFn.mock.calls[0][0]
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})
