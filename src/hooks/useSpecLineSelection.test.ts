import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpecLineSelection, type SpecLineSelection } from './useSpecLineSelection'

type SpecLineSelectionTestApi = ReturnType<typeof useSpecLineSelection> & {
  getSelection?: () => SpecLineSelection | null
  setSelectionDirect?: (selection: SpecLineSelection | null) => void
}

describe('useSpecLineSelection', () => {
  const specId = 'review-spec'

  it('selects a single line on click', () => {
    const { result } = renderHook(() => useSpecLineSelection())

    act(() => {
      result.current.handleLineClick(5, specId)
    })

    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 5,
      specId,
    })
  })

  it('exposes the latest selection synchronously during the same interaction', () => {
    const { result } = renderHook(() => useSpecLineSelection())
    const selectionApi = result.current as SpecLineSelectionTestApi

    let selectionDuringClick: SpecLineSelection | null | undefined

    act(() => {
      result.current.handleLineClick(3, specId)
      selectionDuringClick = selectionApi.getSelection?.()
    })

    expect(selectionApi.getSelection).toBeTypeOf('function')
    expect(selectionDuringClick).toEqual({
      startLine: 3,
      endLine: 3,
      specId,
    })
    expect(result.current.selection).toEqual({
      startLine: 3,
      endLine: 3,
      specId,
    })
  })

  it('extends selection with shift-click', () => {
    const { result } = renderHook(() => useSpecLineSelection())

    act(() => {
      result.current.handleLineClick(2, specId)
    })

    act(() => {
      result.current.handleLineClick(4, specId, { shiftKey: true } as React.MouseEvent)
    })

    expect(result.current.selection).toEqual({
      startLine: 2,
      endLine: 4,
      specId,
    })
  })

  it('extends selection while dragging', () => {
    const { result } = renderHook(() => useSpecLineSelection())

    act(() => {
      result.current.handleLineClick(2, specId)
    })

    act(() => {
      result.current.extendSelection(5, specId)
    })

    expect(result.current.selection).toEqual({
      startLine: 2,
      endLine: 5,
      specId,
    })
  })

  it('clears selection and the synchronous getter state', () => {
    const { result } = renderHook(() => useSpecLineSelection())
    const selectionApi = result.current as SpecLineSelectionTestApi

    act(() => {
      result.current.handleLineClick(4, specId)
      result.current.clearSelection()
    })

    expect(result.current.selection).toBeNull()
    expect(selectionApi.getSelection).toBeTypeOf('function')
    expect(selectionApi.getSelection?.()).toBeNull()
  })
})
