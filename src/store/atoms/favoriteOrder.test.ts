import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import {
    favoriteOrderAtom,
    favoriteOrderLoadingAtom,
    favoriteOrderErrorAtom,
    loadFavoriteOrderAtom,
    saveFavoriteOrderAtom,
} from './favoriteOrder'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

describe('favoriteOrder atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
    })

    it('starts with an empty favorite order', () => {
        expect(store.get(favoriteOrderAtom)).toEqual([])
        expect(store.get(favoriteOrderLoadingAtom)).toBe(false)
        expect(store.get(favoriteOrderErrorAtom)).toBeNull()
    })

    it('loads favorite order from backend', async () => {
        mockInvoke.mockResolvedValueOnce(['variant-codex-fast', 'preset-review'])

        await store.set(loadFavoriteOrderAtom)

        expect(store.get(favoriteOrderAtom)).toEqual(['variant-codex-fast', 'preset-review'])
        expect(store.get(favoriteOrderLoadingAtom)).toBe(false)
        expect(store.get(favoriteOrderErrorAtom)).toBeNull()
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetFavoriteOrder)
    })

    it('saves favorite order to backend', async () => {
        const favoriteOrder = ['variant-claude-opus', 'preset-triage']
        mockInvoke.mockResolvedValueOnce(undefined)

        const result = await store.set(saveFavoriteOrderAtom, favoriteOrder)

        expect(result).toBe(true)
        expect(store.get(favoriteOrderAtom)).toEqual(favoriteOrder)
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetFavoriteOrder, { favoriteOrder })
    })

    it('records load failures', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('favorite load failed'))

        await store.set(loadFavoriteOrderAtom)

        expect(store.get(favoriteOrderAtom)).toEqual([])
        expect(store.get(favoriteOrderErrorAtom)).toBe('favorite load failed')
    })
})
