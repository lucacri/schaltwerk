import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSelection, type Selection } from './useSelection'

const mockSelection: Selection = { kind: 'orchestrator' }
const mockTerminals = { top: 'orch-top', bottomBase: 'orch-bottom', workingDirectory: '/tmp/project' }
const mockSetSelectionAtom = vi.fn()
const mockClearTerminalTracking = vi.fn()

vi.mock('../store/atoms/selection', () => ({
  selectionValueAtom: 'selectionValueAtom',
  terminalsAtom: 'terminalsAtom',
  isReadyAtom: 'isReadyAtom',
  isSpecAtom: 'isSpecAtom',
  setSelectionActionAtom: 'setSelectionActionAtom',
  clearTerminalTrackingActionAtom: 'clearTerminalTrackingActionAtom',
}))

let mockIsReady = true
let mockIsSpec = false

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai')
  return {
    ...actual,
    useAtomValue: vi.fn((atomRef: unknown) => {
      if (atomRef === 'isReadyAtom') return mockIsReady
      if (atomRef === 'isSpecAtom') return mockIsSpec
      if (atomRef === 'terminalsAtom') return mockTerminals
      return mockSelection
    }),
    useSetAtom: vi.fn((atomRef: unknown) => {
      if (atomRef === 'setSelectionActionAtom') return mockSetSelectionAtom
      if (atomRef === 'clearTerminalTrackingActionAtom') return mockClearTerminalTracking
      return vi.fn()
    }),
  }
})

describe('useSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsReady = true
    mockIsSpec = false
  })

  it('returns orchestrator selection by default', () => {
    const { result } = renderHook(() => useSelection())
    expect(result.current.selection).toEqual({ kind: 'orchestrator' })
  })

  it('exposes terminals from atom', () => {
    const { result } = renderHook(() => useSelection())
    expect(result.current.terminals).toEqual(mockTerminals)
  })

  it('exposes isReady and isSpec from atoms', () => {
    const { result } = renderHook(() => useSelection())
    expect(result.current.isReady).toBe(true)
    expect(result.current.isSpec).toBe(false)
  })

  it('calls setSelectionActionAtom with correct payload', () => {
    const { result } = renderHook(() => useSelection())
    const next: Selection = { kind: 'session', payload: 'sess-1', worktreePath: '/tmp/sess-1' }

    act(() => {
      result.current.setSelection(next, false, true)
    })

    expect(mockSetSelectionAtom).toHaveBeenCalledWith({
      selection: next,
      forceRecreate: false,
      isIntentional: true,
    })
  })

  it('passes forceRecreate through to the atom setter', () => {
    const { result } = renderHook(() => useSelection())
    const next: Selection = { kind: 'session', payload: 'sess-2' }

    act(() => {
      result.current.setSelection(next, true)
    })

    expect(mockSetSelectionAtom).toHaveBeenCalledWith({
      selection: next,
      forceRecreate: true,
      isIntentional: undefined,
    })
  })

  it('exposes clearTerminalTracking', () => {
    const { result } = renderHook(() => useSelection())
    act(() => {
      result.current.clearTerminalTracking()
    })
    expect(mockClearTerminalTracking).toHaveBeenCalledTimes(1)
  })

  it('re-exports Selection type', () => {
    const sel: Selection = { kind: 'orchestrator' }
    expect(sel.kind).toBe('orchestrator')
  })
})
