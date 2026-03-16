import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ContextualAction } from '../../types/contextualAction'
import { createSettingsListAtoms } from './createSettingsListAtoms'
import { logger } from '../../utils/logger'

const atoms = createSettingsListAtoms<ContextualAction>({
    loadCommand: TauriCommands.GetContextualActions,
    saveCommand: TauriCommands.SetContextualActions,
    saveParamName: 'actions',
    label: 'contextual actions',
})

export const contextualActionsListAtom = atoms.listAtom
export const contextualActionsLoadingAtom = atoms.loadingAtom
export const contextualActionsErrorAtom = atoms.errorAtom
export const loadContextualActionsAtom = atoms.loadAtom
export const saveContextualActionsAtom = atoms.saveAtom

export const resetContextualActionsAtom = atom(
    null,
    async (_get, set) => {
        try {
            const defaults = await invoke<ContextualAction[]>(TauriCommands.ResetContextualActionsToDefaults)
            set(atoms.mapAtom, new Map(defaults.map((a) => [a.id, a])))
            return true
        } catch (error) {
            logger.error('Failed to reset contextual actions:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to reset contextual actions'
            set(atoms.errorAtom, message)
            return false
        }
    }
)
