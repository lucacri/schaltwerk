import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { AgentPreset } from '../../types/agentPreset'
import { logger } from '../../utils/logger'

const agentPresetsMapAtom = atom<Map<string, AgentPreset>>(new Map())

export const agentPresetsListAtom = atom((get) => {
    return Array.from(get(agentPresetsMapAtom).values())
})

export const agentPresetsLoadingAtom = atom(false)
export const agentPresetsErrorAtom = atom<string | null>(null)

export const loadAgentPresetsAtom = atom(
    null,
    async (_get, set) => {
        try {
            set(agentPresetsLoadingAtom, true)
            set(agentPresetsErrorAtom, null)
            const presets = await invoke<AgentPreset[]>(TauriCommands.GetAgentPresets)
            const map = new Map(presets.map((p) => [p.id, p]))
            set(agentPresetsMapAtom, map)
        } catch (error) {
            logger.error('Failed to load agent presets:', error)
            const message = error instanceof Error ? error.message : 'Failed to load agent presets'
            set(agentPresetsErrorAtom, message)
            set(agentPresetsMapAtom, new Map())
        } finally {
            set(agentPresetsLoadingAtom, false)
        }
    }
)

export const saveAgentPresetsAtom = atom(
    null,
    async (_get, set, presets: AgentPreset[]) => {
        try {
            await invoke(TauriCommands.SetAgentPresets, { presets })
            const map = new Map(presets.map((p) => [p.id, p]))
            set(agentPresetsMapAtom, map)
            return true
        } catch (error) {
            logger.error('Failed to save agent presets:', error)
            const message = error instanceof Error ? error.message : 'Failed to save agent presets'
            set(agentPresetsErrorAtom, message)
            return false
        }
    }
)
