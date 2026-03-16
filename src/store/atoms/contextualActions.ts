import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ContextualAction } from '../../types/contextualAction'
import { logger } from '../../utils/logger'

const contextualActionsMapAtom = atom<Map<string, ContextualAction>>(new Map())

export const contextualActionsListAtom = atom((get) => {
    return Array.from(get(contextualActionsMapAtom).values())
})

export const contextualActionsLoadingAtom = atom(false)
export const contextualActionsErrorAtom = atom<string | null>(null)

export const loadContextualActionsAtom = atom(
    null,
    async (_get, set) => {
        try {
            set(contextualActionsLoadingAtom, true)
            set(contextualActionsErrorAtom, null)
            const actions = await invoke<ContextualAction[]>(TauriCommands.GetContextualActions)
            const map = new Map(actions.map((a) => [a.id, a]))
            set(contextualActionsMapAtom, map)
        } catch (error) {
            logger.error('Failed to load contextual actions:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load contextual actions'
            set(contextualActionsErrorAtom, message)
            set(contextualActionsMapAtom, new Map())
        } finally {
            set(contextualActionsLoadingAtom, false)
        }
    }
)

export const saveContextualActionsAtom = atom(
    null,
    async (_get, set, actions: ContextualAction[]) => {
        try {
            await invoke(TauriCommands.SetContextualActions, { actions })
            const map = new Map(actions.map((a) => [a.id, a]))
            set(contextualActionsMapAtom, map)
            return true
        } catch (error) {
            logger.error('Failed to save contextual actions:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to save contextual actions'
            set(contextualActionsErrorAtom, message)
            return false
        }
    }
)

export const resetContextualActionsAtom = atom(
    null,
    async (_get, set) => {
        try {
            const defaults = await invoke<ContextualAction[]>(TauriCommands.ResetContextualActionsToDefaults)
            const map = new Map(defaults.map((a) => [a.id, a]))
            set(contextualActionsMapAtom, map)
            return true
        } catch (error) {
            logger.error('Failed to reset contextual actions:', error)
            const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to reset contextual actions'
            set(contextualActionsErrorAtom, message)
            return false
        }
    }
)
