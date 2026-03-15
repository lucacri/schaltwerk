import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import {
    agentPresetsListAtom,
    agentPresetsLoadingAtom,
    agentPresetsErrorAtom,
    loadAgentPresetsAtom,
    saveAgentPresetsAtom,
} from '../store/atoms/agentPresets'
import type { AgentPreset } from '../types/agentPreset'

interface UseAgentPresetsResult {
    presets: AgentPreset[]
    loading: boolean
    error: string | null
    savePresets: (presets: AgentPreset[]) => Promise<boolean>
    reloadPresets: () => Promise<void>
}

export function useAgentPresets(): UseAgentPresetsResult {
    const presets = useAtomValue(agentPresetsListAtom)
    const loading = useAtomValue(agentPresetsLoadingAtom)
    const error = useAtomValue(agentPresetsErrorAtom)
    const load = useSetAtom(loadAgentPresetsAtom)
    const save = useSetAtom(saveAgentPresetsAtom)

    useEffect(() => {
        void load()
    }, [load])

    const savePresets = useCallback((p: AgentPreset[]) => {
        return save(p)
    }, [save])

    const reloadPresets = useCallback(() => {
        return load()
    }, [load])

    return {
        presets,
        loading,
        error,
        savePresets,
        reloadPresets,
    }
}
