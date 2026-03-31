import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ContextualAction } from '../../types/contextualAction'
import { createSettingsListAtoms } from './createSettingsListAtoms'
import { logger } from '../../utils/logger'

type RawContextualAction = Omit<ContextualAction, 'context'> & {
    context: ContextualAction['context'] | 'mr'
}

function normalizeContextualAction(action: RawContextualAction): ContextualAction {
    return {
        ...action,
        context: action.context === 'mr' ? 'pr' : action.context,
        promptTemplate: action.promptTemplate.replace(/\bmr\./g, 'pr.').replace(/pr\.headRefName/g, 'pr.sourceBranch'),
    }
}

function normalizeContextualActions(actions: RawContextualAction[]): ContextualAction[] {
    return actions.map(normalizeContextualAction)
}

const atoms = createSettingsListAtoms<ContextualAction>({
    loadCommand: TauriCommands.GetContextualActions,
    saveCommand: TauriCommands.SetContextualActions,
    saveParamName: 'actions',
    label: 'contextual actions',
})

export const contextualActionsListAtom = atom((get) => normalizeContextualActions(get(atoms.listAtom)))
export const contextualActionsLoadingAtom = atoms.loadingAtom
export const contextualActionsErrorAtom = atoms.errorAtom
export const loadContextualActionsAtom = atoms.loadAtom

export const saveContextualActionsAtom = atom(
    null,
    async (_get, set, actions: ContextualAction[]) => {
        return set(atoms.saveAtom, normalizeContextualActions(actions))
    }
)

export const resetContextualActionsAtom = atom(
    null,
    async (_get, set) => {
        try {
            const defaults = await invoke<RawContextualAction[]>(TauriCommands.ResetContextualActionsToDefaults)
            const normalizedDefaults = normalizeContextualActions(defaults)
            set(atoms.mapAtom, new Map(normalizedDefaults.map((a) => [a.id, a])))
            return true
        } catch (error) {
            logger.error('Failed to reset contextual actions:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to reset contextual actions'
            set(atoms.errorAtom, message)
            return false
        }
    }
)
