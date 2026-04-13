import { AgentType } from '../../types/session'

export type AgentEnvVar = { key: string; value: string }

export const displayNameForAgent = (agent: AgentType) => {
    switch (agent) {
        case 'copilot':
            return 'GitHub Copilot'
        case 'opencode':
            return 'OpenCode'
        case 'gemini':
            return 'Gemini'
        case 'codex':
            return 'Codex'
        case 'droid':
            return 'Droid'
        case 'qwen':
            return 'Qwen'
        case 'amp':
            return 'Amp'
        case 'kilocode':
            return 'Kilo Code'
        case 'terminal':
            return 'Terminal Only'
        default:
            return 'Claude'
    }
}
