import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

vi.mock('../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: {},
}))

import {
  epicsAtom,
  epicsLoadingAtom,
  refreshEpicsActionAtom,
  ensureEpicsLoadedActionAtom,
  createEpicActionAtom,
  updateEpicActionAtom,
  deleteEpicActionAtom,
  setItemEpicActionAtom,
} from './epics'
import { projectPathAtom } from './project'
import type { Epic } from '../../types/session'

function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'epic-1',
    name: 'Alpha',
    color: '#ff0000',
    ...overrides,
  }
}

describe('epics atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
  })

  it('defaults to empty items and not loading', () => {
    expect(store.get(epicsAtom)).toEqual([])
    expect(store.get(epicsLoadingAtom)).toBe(false)
  })

  describe('refreshEpicsActionAtom', () => {
    it('clears state when projectPath is null', async () => {
      store.set(projectPathAtom, null)
      await store.set(refreshEpicsActionAtom)
      expect(store.get(epicsAtom)).toEqual([])
      expect(store.get(epicsLoadingAtom)).toBe(false)
    })

    it('fetches and sorts epics by name', async () => {
      store.set(projectPathAtom, '/my/project')
      const epics = [makeEpic({ id: '2', name: 'Zeta' }), makeEpic({ id: '1', name: 'Alpha' })]
      mockInvoke.mockResolvedValueOnce(epics)

      await store.set(refreshEpicsActionAtom)

      const items = store.get(epicsAtom)
      expect(items).toHaveLength(2)
      expect(items[0].name).toBe('Alpha')
      expect(items[1].name).toBe('Zeta')
      expect(store.get(epicsLoadingAtom)).toBe(false)
    })

    it('rethrows on fetch failure', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockRejectedValueOnce(new Error('network error'))

      await expect(store.set(refreshEpicsActionAtom)).rejects.toThrow('network error')
      expect(store.get(epicsLoadingAtom)).toBe(false)
    })
  })

  describe('ensureEpicsLoadedActionAtom', () => {
    it('does nothing when projectPath is null and state is clean', async () => {
      store.set(projectPathAtom, null)
      await store.set(ensureEpicsLoadedActionAtom)
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('loads epics on first call with a project path', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([makeEpic()])

      await store.set(ensureEpicsLoadedActionAtom)

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListEpics)
      expect(store.get(epicsAtom)).toHaveLength(1)
    })

    it('does not refetch when already loaded for same project', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([makeEpic()])
      await store.set(ensureEpicsLoadedActionAtom)
      mockInvoke.mockClear()

      await store.set(ensureEpicsLoadedActionAtom)
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('createEpicActionAtom', () => {
    it('adds epic to the store sorted by name', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([makeEpic({ id: '1', name: 'Beta' })])
      await store.set(refreshEpicsActionAtom)

      const newEpic = makeEpic({ id: '2', name: 'Alpha' })
      mockInvoke.mockResolvedValueOnce(newEpic)

      const result = await store.set(createEpicActionAtom, { name: 'Alpha', color: '#00ff00' })

      expect(result).toEqual(newEpic)
      const items = store.get(epicsAtom)
      expect(items[0].name).toBe('Alpha')
      expect(items[1].name).toBe('Beta')
    })

    it('invokes the create command with correct params', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([])
      await store.set(refreshEpicsActionAtom)

      mockInvoke.mockResolvedValueOnce(makeEpic())
      await store.set(createEpicActionAtom, { name: 'Test', color: null })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreCreateEpic, {
        name: 'Test',
        color: null,
      })
    })
  })

  describe('updateEpicActionAtom', () => {
    it('replaces existing epic and re-sorts', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([
        makeEpic({ id: '1', name: 'Alpha' }),
        makeEpic({ id: '2', name: 'Beta' }),
      ])
      await store.set(refreshEpicsActionAtom)

      const updated = makeEpic({ id: '1', name: 'Zeta' })
      mockInvoke.mockResolvedValueOnce(updated)

      await store.set(updateEpicActionAtom, { id: '1', name: 'Zeta', color: null })

      const items = store.get(epicsAtom)
      expect(items[0].name).toBe('Beta')
      expect(items[1].name).toBe('Zeta')
    })
  })

  describe('deleteEpicActionAtom', () => {
    it('removes epic from the store', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([
        makeEpic({ id: '1', name: 'Alpha' }),
        makeEpic({ id: '2', name: 'Beta' }),
      ])
      await store.set(refreshEpicsActionAtom)

      mockInvoke.mockResolvedValueOnce(undefined)
      await store.set(deleteEpicActionAtom, '1')

      const items = store.get(epicsAtom)
      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('2')
    })

    it('invokes the delete command', async () => {
      store.set(projectPathAtom, '/my/project')
      mockInvoke.mockResolvedValueOnce([makeEpic()])
      await store.set(refreshEpicsActionAtom)

      mockInvoke.mockResolvedValueOnce(undefined)
      await store.set(deleteEpicActionAtom, 'epic-1')

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreDeleteEpic, { id: 'epic-1' })
    })
  })

  describe('setItemEpicActionAtom', () => {
    it('invokes the set item epic command', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await store.set(setItemEpicActionAtom, { name: 'session-1', epicId: 'epic-1' })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetItemEpic, {
        name: 'session-1',
        epicId: 'epic-1',
      })
    })

    it('allows null epicId to unset the epic', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)
      await store.set(setItemEpicActionAtom, { name: 'session-1', epicId: null })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetItemEpic, {
        name: 'session-1',
        epicId: null,
      })
    })
  })
})
