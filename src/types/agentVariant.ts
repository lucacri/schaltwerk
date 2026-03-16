import type { AgentType } from './session'

export interface AgentVariant {
    id: string
    name: string
    agentType: AgentType
    model?: string
    reasoningEffort?: string
    cliArgs?: string[]
    envVars?: Record<string, string>
    isBuiltIn: boolean
}
