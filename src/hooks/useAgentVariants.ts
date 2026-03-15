import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
    agentVariantsListAtom,
    agentVariantsLoadingAtom,
    agentVariantsErrorAtom,
    loadAgentVariantsAtom,
    saveAgentVariantsAtom,
} from '../store/atoms/agentVariants'
import type { AgentVariant } from '../types/agentVariant'

interface UseAgentVariantsResult {
    variants: AgentVariant[]
    loading: boolean
    error: string | null
    saveVariants: (variants: AgentVariant[]) => Promise<boolean>
    reloadVariants: () => Promise<void>
}

export function useAgentVariants(): UseAgentVariantsResult {
    const variants = useAtomValue(agentVariantsListAtom)
    const loading = useAtomValue(agentVariantsLoadingAtom)
    const error = useAtomValue(agentVariantsErrorAtom)
    const load = useSetAtom(loadAgentVariantsAtom)
    const save = useSetAtom(saveAgentVariantsAtom)

    useEffect(() => {
        void load()
    }, [load])

    const saveVariants = useCallback((v: AgentVariant[]) => {
        return save(v)
    }, [save])

    const reloadVariants = useCallback(() => {
        return load()
    }, [load])

    return {
        variants,
        loading,
        error,
        saveVariants,
        reloadVariants,
    }
}
