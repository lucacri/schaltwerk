import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
    contextualActionsListAtom,
    contextualActionsLoadingAtom,
    contextualActionsErrorAtom,
    loadContextualActionsAtom,
    saveContextualActionsAtom,
    resetContextualActionsAtom,
} from '../store/atoms/contextualActions'
import type { ContextualAction } from '../types/contextualAction'

interface UseContextualActionsResult {
    actions: ContextualAction[]
    loading: boolean
    error: string | null
    saveActions: (actions: ContextualAction[]) => Promise<boolean>
    resetToDefaults: () => Promise<boolean>
    reloadActions: () => Promise<void>
}

export function useContextualActions(): UseContextualActionsResult {
    const actions = useAtomValue(contextualActionsListAtom)
    const loading = useAtomValue(contextualActionsLoadingAtom)
    const error = useAtomValue(contextualActionsErrorAtom)
    const load = useSetAtom(loadContextualActionsAtom)
    const save = useSetAtom(saveContextualActionsAtom)
    const reset = useSetAtom(resetContextualActionsAtom)

    useEffect(() => {
        void load()
    }, [load])

    const saveActions = useCallback((a: ContextualAction[]) => {
        return save(a)
    }, [save])

    const resetToDefaults = useCallback(() => {
        return reset()
    }, [reset])

    const reloadActions = useCallback(() => {
        return load()
    }, [load])

    return {
        actions,
        loading,
        error,
        saveActions,
        resetToDefaults,
        reloadActions,
    }
}
