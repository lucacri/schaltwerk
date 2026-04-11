import { useState, useCallback, useRef } from 'react'

export interface SpecLineSelection {
  startLine: number
  endLine: number
  specId: string
}

export function useSpecLineSelection() {
  const [selection, setSelection] = useState<SpecLineSelection | null>(null)
  const selectionRef = useRef<SpecLineSelection | null>(null)
  const lastClickedLine = useRef<{ line: number; specId: string } | null>(null)

  const setSelectionState = useCallback((nextSelection: SpecLineSelection | null) => {
    selectionRef.current = nextSelection
    setSelection(nextSelection)
  }, [])

  const getSelection = useCallback(() => selectionRef.current, [])

  const handleLineClick = useCallback((lineNum: number, specId: string, event?: MouseEvent | React.MouseEvent) => {
    const isShiftClick = event?.shiftKey
    const currentSelection = selectionRef.current

    if (isShiftClick &&
        lastClickedLine.current &&
        lastClickedLine.current.specId === specId) {
      const start = Math.min(lastClickedLine.current.line, lineNum)
      const end = Math.max(lastClickedLine.current.line, lineNum)
      setSelectionState({ startLine: start, endLine: end, specId })
    } else if (currentSelection && currentSelection.specId === specId &&
               lineNum >= currentSelection.startLine && lineNum <= currentSelection.endLine) {
      setSelectionState(null)
      lastClickedLine.current = null
    } else {
      setSelectionState({ startLine: lineNum, endLine: lineNum, specId })
      lastClickedLine.current = { line: lineNum, specId }
    }
  }, [setSelectionState])

  const extendSelection = useCallback((lineNum: number, specId: string) => {
    const currentSelection = selectionRef.current

    if (!currentSelection || currentSelection.specId !== specId) {
      setSelectionState({ startLine: lineNum, endLine: lineNum, specId })
      lastClickedLine.current = { line: lineNum, specId }
    } else {
      const start = Math.min(currentSelection.startLine, lineNum)
      const end = Math.max(currentSelection.endLine, lineNum)
      setSelectionState({ startLine: start, endLine: end, specId })
    }
  }, [setSelectionState])

  const clearSelection = useCallback(() => {
    setSelectionState(null)
    lastClickedLine.current = null
  }, [setSelectionState])

  const setSelectionDirect = useCallback((nextSelection: SpecLineSelection | null) => {
    setSelectionState(nextSelection)
    if (nextSelection) {
      lastClickedLine.current = {
        line: nextSelection.endLine,
        specId: nextSelection.specId,
      }
    } else {
      lastClickedLine.current = null
    }
  }, [setSelectionState])

  const isLineSelected = useCallback((specId: string, lineNum: number | undefined) => {
    if (!selection || !lineNum || selection.specId !== specId) return false
    return lineNum >= selection.startLine && lineNum <= selection.endLine
  }, [selection])

  return {
    selection,
    getSelection,
    handleLineClick,
    extendSelection,
    clearSelection,
    setSelectionDirect,
    isLineSelected
  }
}
