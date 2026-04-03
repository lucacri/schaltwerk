import type { AgentType } from './session'

export interface AgentLaunchSlot {
    agentType: AgentType
    skipPermissions?: boolean
    autonomyEnabled?: boolean
}
