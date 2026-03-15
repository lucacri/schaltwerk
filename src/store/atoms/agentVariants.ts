import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { AgentVariant } from '../../types/agentVariant'
import { logger } from '../../utils/logger'

const agentVariantsMapAtom = atom<Map<string, AgentVariant>>(new Map())

export const agentVariantsListAtom = atom((get) => {
    return Array.from(get(agentVariantsMapAtom).values())
})

export const agentVariantsLoadingAtom = atom(false)
export const agentVariantsErrorAtom = atom<string | null>(null)

export const loadAgentVariantsAtom = atom(
    null,
    async (_get, set) => {
        try {
            set(agentVariantsLoadingAtom, true)
            set(agentVariantsErrorAtom, null)
            const variants = await invoke<AgentVariant[]>(TauriCommands.GetAgentVariants)
            const map = new Map(variants.map((v) => [v.id, v]))
            set(agentVariantsMapAtom, map)
        } catch (error) {
            logger.error('Failed to load agent variants:', error)
            const message = error instanceof Error ? error.message : 'Failed to load agent variants'
            set(agentVariantsErrorAtom, message)
            set(agentVariantsMapAtom, new Map())
        } finally {
            set(agentVariantsLoadingAtom, false)
        }
    }
)

export const saveAgentVariantsAtom = atom(
    null,
    async (_get, set, variants: AgentVariant[]) => {
        try {
            await invoke(TauriCommands.SetAgentVariants, { variants })
            const map = new Map(variants.map((v) => [v.id, v]))
            set(agentVariantsMapAtom, map)
            return true
        } catch (error) {
            logger.error('Failed to save agent variants:', error)
            const message = error instanceof Error ? error.message : 'Failed to save agent variants'
            set(agentVariantsErrorAtom, message)
            return false
        }
    }
)
