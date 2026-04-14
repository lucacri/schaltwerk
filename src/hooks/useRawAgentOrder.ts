import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
    loadRawAgentOrderAtom,
    rawAgentOrderAtom,
    rawAgentOrderErrorAtom,
    rawAgentOrderLoadedAtom,
    rawAgentOrderLoadingAtom,
    saveRawAgentOrderAtom,
} from '../store/atoms/rawAgentOrder'

export function useRawAgentOrder() {
    const rawAgentOrder = useAtomValue(rawAgentOrderAtom)
    const loaded = useAtomValue(rawAgentOrderLoadedAtom)
    const loading = useAtomValue(rawAgentOrderLoadingAtom)
    const error = useAtomValue(rawAgentOrderErrorAtom)
    const load = useSetAtom(loadRawAgentOrderAtom)
    const save = useSetAtom(saveRawAgentOrderAtom)

    useEffect(() => {
        if (loaded || loading || error) return
        void load()
    }, [loaded, loading, error, load])

    const saveRawAgentOrder = useCallback((next: string[]) => save(next), [save])
    const reloadRawAgentOrder = useCallback(() => load(), [load])

    return {
        rawAgentOrder,
        loaded,
        loading,
        error,
        saveRawAgentOrder,
        reloadRawAgentOrder,
    }
}
