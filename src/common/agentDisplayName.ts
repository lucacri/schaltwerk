// Phase 8 W.2: extracted from src/components/modals/newSession/favoriteOptions
// (which retires with the legacy NewSessionModal). Pure utility — agent
// type → human-readable label. Used by SettingsModal and any future
// task-aware surface that needs to label an agent.

import type { AgentType } from '../types/session'

export function agentDisplayName(agent: AgentType): string {
    switch (agent) {
        case 'claude':
            return 'Claude'
        case 'codex':
            return 'Codex'
        case 'gemini':
            return 'Gemini'
        case 'copilot':
            return 'Copilot'
        case 'droid':
            return 'Factory Droid'
        case 'qwen':
            return 'Qwen'
        case 'amp':
            return 'Amp'
        case 'kilocode':
            return 'Kilo Code'
        case 'terminal':
            return 'Terminal'
        case 'opencode':
            return 'OpenCode'
    }
}
