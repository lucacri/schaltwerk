import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

const favoriteOrderStateAtom = atom<string[]>([])
export const favoriteOrderAtom = atom(
    (get) => get(favoriteOrderStateAtom),
    (_get, set, favoriteOrder: string[]) => {
        set(favoriteOrderStateAtom, favoriteOrder)
        set(favoriteOrderLoadedAtom, true)
    }
)
export const favoriteOrderLoadingAtom = atom(false)
export const favoriteOrderErrorAtom = atom<string | null>(null)
export const favoriteOrderLoadedAtom = atom(false)

export const loadFavoriteOrderAtom = atom(
    null,
    async (_get, set) => {
        try {
            set(favoriteOrderLoadingAtom, true)
            set(favoriteOrderErrorAtom, null)
            const favoriteOrder = await invoke<string[]>(TauriCommands.GetFavoriteOrder)
            set(favoriteOrderStateAtom, Array.isArray(favoriteOrder) ? favoriteOrder : [])
            set(favoriteOrderLoadedAtom, true)
        } catch (error) {
            logger.error('Failed to load favorite order:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load favorite order'
            set(favoriteOrderErrorAtom, message)
            set(favoriteOrderStateAtom, [])
            set(favoriteOrderLoadedAtom, true)
        } finally {
            set(favoriteOrderLoadingAtom, false)
        }
    }
)

export const saveFavoriteOrderAtom = atom(
    null,
    async (_get, set, favoriteOrder: string[]) => {
        try {
            await invoke(TauriCommands.SetFavoriteOrder, { favoriteOrder })
            set(favoriteOrderStateAtom, favoriteOrder)
            set(favoriteOrderErrorAtom, null)
            set(favoriteOrderLoadedAtom, true)
            return true
        } catch (error) {
            logger.error('Failed to save favorite order:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to save favorite order'
            set(favoriteOrderErrorAtom, message)
            return false
        }
    }
)
