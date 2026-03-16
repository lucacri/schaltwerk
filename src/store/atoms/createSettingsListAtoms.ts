import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../utils/logger'

interface SettingsListAtomsConfig {
    loadCommand: string
    saveCommand: string
    saveParamName: string
    label: string
}

export function createSettingsListAtoms<T extends { id: string }>(config: SettingsListAtomsConfig) {
    const mapAtom = atom<Map<string, T>>(new Map())

    const listAtom = atom((get) => Array.from(get(mapAtom).values()))
    const loadingAtom = atom(false)
    const errorAtom = atom<string | null>(null)

    const loadAtom = atom(
        null,
        async (_get, set) => {
            try {
                set(loadingAtom, true)
                set(errorAtom, null)
                const items = await invoke<T[]>(config.loadCommand)
                set(mapAtom, new Map(items.map((item) => [item.id, item])))
            } catch (error) {
                logger.error(`Failed to load ${config.label}:`, error)
                const message = error instanceof Error ? error.message : typeof error === 'string' ? error : `Failed to load ${config.label}`
                set(errorAtom, message)
                set(mapAtom, new Map())
            } finally {
                set(loadingAtom, false)
            }
        }
    )

    const saveAtom = atom(
        null,
        async (_get, set, items: T[]) => {
            try {
                await invoke(config.saveCommand, { [config.saveParamName]: items })
                set(mapAtom, new Map(items.map((item) => [item.id, item])))
                return true
            } catch (error) {
                logger.error(`Failed to save ${config.label}:`, error)
                const message = error instanceof Error ? error.message : typeof error === 'string' ? error : `Failed to save ${config.label}`
                set(errorAtom, message)
                return false
            }
        }
    )

    return { mapAtom, listAtom, loadingAtom, errorAtom, loadAtom, saveAtom }
}
