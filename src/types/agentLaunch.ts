import type { AgentType } from './session'

export interface AgentLaunchSlot {
    agentType: AgentType
    autonomyEnabled?: boolean
}
