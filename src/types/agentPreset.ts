import type { AgentType } from './session'

export interface AgentPresetSlot {
    agentType: AgentType
    variantId?: string
    autonomyEnabled?: boolean
}

export interface AgentPreset {
    id: string
    name: string
    slots: AgentPresetSlot[]
    isBuiltIn: boolean
}
