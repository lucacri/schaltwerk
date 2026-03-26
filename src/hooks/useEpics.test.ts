import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEpics } from './useEpics'
import type { Epic } from '../types/session'

const mockEpics: Epic[] = [
  { id: 'e1', name: 'Auth Epic', color: '#ff0000' },
  { id: 'e2', name: 'Dashboard Epic', color: null },
]

const mockEnsureLoaded = vi.fn(async () => {})
const mockRefresh = vi.fn(async () => {})
const mockCreateEpic = vi.fn(async ({ name, color }: { name: string; color: string | null }) => ({
  id: 'new-id',
  name,
  color,
}))
const mockUpdateEpic = vi.fn(async ({ id, name, color }: { id: string; name: string; color: string | null }) => ({
  id,
  name,
  color,
}))
const mockDeleteEpic = vi.fn(async () => {})
const mockSetItemEpic = vi.fn(async () => {})

vi.mock('../store/atoms/epics', () => ({
  epicsAtom: 'epicsAtom',
  epicsLoadingAtom: 'epicsLoadingAtom',
  refreshEpicsActionAtom: 'refreshEpicsActionAtom',
  ensureEpicsLoadedActionAtom: 'ensureEpicsLoadedActionAtom',
  createEpicActionAtom: 'createEpicActionAtom',
  updateEpicActionAtom: 'updateEpicActionAtom',
  deleteEpicActionAtom: 'deleteEpicActionAtom',
  setItemEpicActionAtom: 'setItemEpicActionAtom',
}))

let currentLoading = false

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai')
  return {
    ...actual,
    useAtomValue: vi.fn((atomRef: unknown) => {
      if (atomRef === 'epicsLoadingAtom') return currentLoading
      if (atomRef === 'epicsAtom') return mockEpics
      return undefined
    }),
    useSetAtom: vi.fn((atomRef: unknown) => {
      if (atomRef === 'ensureEpicsLoadedActionAtom') return mockEnsureLoaded
      if (atomRef === 'refreshEpicsActionAtom') return mockRefresh
      if (atomRef === 'createEpicActionAtom') return mockCreateEpic
      if (atomRef === 'updateEpicActionAtom') return mockUpdateEpic
      if (atomRef === 'deleteEpicActionAtom') return mockDeleteEpic
      if (atomRef === 'setItemEpicActionAtom') return mockSetItemEpic
      return vi.fn()
    }),
  }
})

describe('useEpics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentLoading = false
  })

  it('exposes epics from atoms', () => {
    const { result } = renderHook(() => useEpics())
    expect(result.current.epics).toEqual(mockEpics)
    expect(result.current.loading).toBe(false)
  })

  it('delegates ensureLoaded to the action atom', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.ensureLoaded()
    })
    expect(mockEnsureLoaded).toHaveBeenCalledTimes(1)
  })

  it('delegates refresh to the action atom', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('delegates createEpic with name and color', async () => {
    const { result } = renderHook(() => useEpics())
    let created: Epic | undefined
    await act(async () => {
      created = await result.current.createEpic('New Feature', '#00ff00')
    })
    expect(mockCreateEpic).toHaveBeenCalledWith({ name: 'New Feature', color: '#00ff00' })
    expect(created).toEqual({ id: 'new-id', name: 'New Feature', color: '#00ff00' })
  })

  it('delegates updateEpic with id, name, and color', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.updateEpic('e1', 'Renamed', null)
    })
    expect(mockUpdateEpic).toHaveBeenCalledWith({ id: 'e1', name: 'Renamed', color: null })
  })

  it('delegates deleteEpic with id', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.deleteEpic('e1')
    })
    expect(mockDeleteEpic).toHaveBeenCalledWith('e1')
  })

  it('delegates setItemEpic with name and epicId', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.setItemEpic('session-name', 'e2')
    })
    expect(mockSetItemEpic).toHaveBeenCalledWith({ name: 'session-name', epicId: 'e2' })
  })

  it('allows setting epicId to null', async () => {
    const { result } = renderHook(() => useEpics())
    await act(async () => {
      await result.current.setItemEpic('session-name', null)
    })
    expect(mockSetItemEpic).toHaveBeenCalledWith({ name: 'session-name', epicId: null })
  })
})
