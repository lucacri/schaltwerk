import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

const rawAgentOrderStateAtom = atom<string[]>([])
export const rawAgentOrderAtom = atom(
    (get) => get(rawAgentOrderStateAtom),
    (_get, set, rawAgentOrder: string[]) => {
        set(rawAgentOrderStateAtom, rawAgentOrder)
        set(rawAgentOrderLoadedAtom, true)
    }
)
export const rawAgentOrderLoadingAtom = atom(false)
export const rawAgentOrderErrorAtom = atom<string | null>(null)
export const rawAgentOrderLoadedAtom = atom(false)

export const loadRawAgentOrderAtom = atom(
    null,
    async (_get, set) => {
        try {
            set(rawAgentOrderLoadingAtom, true)
            set(rawAgentOrderErrorAtom, null)
            const rawAgentOrder = await invoke<string[]>(TauriCommands.GetRawAgentOrder)
            set(rawAgentOrderStateAtom, Array.isArray(rawAgentOrder) ? rawAgentOrder : [])
            set(rawAgentOrderLoadedAtom, true)
        } catch (error) {
            logger.error('Failed to load raw agent order:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load raw agent order'
            set(rawAgentOrderErrorAtom, message)
            set(rawAgentOrderStateAtom, [])
            set(rawAgentOrderLoadedAtom, true)
        } finally {
            set(rawAgentOrderLoadingAtom, false)
        }
    }
)

export const saveRawAgentOrderAtom = atom(
    null,
    async (_get, set, rawAgentOrder: string[]) => {
        try {
            await invoke(TauriCommands.SetRawAgentOrder, { rawAgentOrder })
            set(rawAgentOrderStateAtom, rawAgentOrder)
            set(rawAgentOrderErrorAtom, null)
            set(rawAgentOrderLoadedAtom, true)
            return true
        } catch (error) {
            logger.error('Failed to save raw agent order:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to save raw agent order'
            set(rawAgentOrderErrorAtom, message)
            return false
        }
    }
)
