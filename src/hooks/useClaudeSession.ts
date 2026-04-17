import { useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { DEFAULT_AGENT } from '../constants/agents'

interface ClaudeSessionOptions {
    sessionName?: string
    isCommander?: boolean
    terminalId?: string
}

export interface ConsolidationDefaultFavorite {
    agentType: string | null
    presetId: string | null
}

export function useClaudeSession() {
    const startClaude = useCallback(async (options: ClaudeSessionOptions = {}) => {
        try {
            if (options.isCommander) {
                await invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, {
                    terminalId: options.terminalId || 'orchestrator-default-top',
                })
                return { success: true }
            } else if (options.sessionName) {
                await invoke(TauriCommands.SchaltwerkCoreStartSessionAgent, {
                    sessionName: options.sessionName,
                })
                return { success: true }
            } else {
                logger.error('[useClaudeSession] Invalid Claude session options: must specify either isCommander or sessionName')
                return { success: false, error: 'Invalid options' }
            }
        } catch (error) {
            logger.error('[useClaudeSession] Failed to start Claude:', error)
            return { success: false, error: String(error) }
        }
    }, [])

    const getAgentType = useCallback(async (): Promise<string> => {
        try {
            return await invoke<string>(TauriCommands.SchaltwerkCoreGetAgentType)
        } catch (error) {
            logger.error('Failed to get agent type:', error)
            return DEFAULT_AGENT
        }
    }, [])

    const setAgentType = useCallback(async (agentType: string): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetAgentType, { agentType })
            return true
        } catch (error) {
            logger.error('Failed to set agent type:', error)
            return false
        }
    }, [])

    const getOrchestratorAgentType = useCallback(async (): Promise<string> => {
        try {
            return await invoke<string>(TauriCommands.SchaltwerkCoreGetOrchestratorAgentType)
        } catch (error) {
            logger.error('Failed to get orchestrator agent type:', error)
            return DEFAULT_AGENT
        }
    }, [])

    const setOrchestratorAgentType = useCallback(async (agentType: string): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetOrchestratorAgentType, { agentType })
            return true
        } catch (error) {
            logger.error('Failed to set orchestrator agent type:', error)
            return false
        }
    }, [])

    const getSpecClarificationAgentType = useCallback(async (): Promise<string> => {
        try {
            return await invoke<string>(TauriCommands.SchaltwerkCoreGetSpecClarificationAgentType)
        } catch (error) {
            logger.error('Failed to get spec clarification agent type:', error)
            return DEFAULT_AGENT
        }
    }, [])

    const setSpecClarificationAgentType = useCallback(async (agentType: string): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetSpecClarificationAgentType, { agentType })
            return true
        } catch (error) {
            logger.error('Failed to set spec clarification agent type:', error)
            return false
        }
    }, [])

    const getConsolidationDefaultFavorite = useCallback(async (): Promise<ConsolidationDefaultFavorite> => {
        try {
            const value = await invoke<ConsolidationDefaultFavorite | null>(
                TauriCommands.SchaltwerkCoreGetConsolidationDefaultFavorite,
            )
            return {
                agentType: value?.agentType ?? null,
                presetId: value?.presetId ?? null,
            }
        } catch (error) {
            logger.error('Failed to get consolidation default favorite:', error)
            return { agentType: DEFAULT_AGENT, presetId: null }
        }
    }, [])

    const setConsolidationDefaultFavorite = useCallback(async (value: ConsolidationDefaultFavorite): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetConsolidationDefaultFavorite, { value })
            return true
        } catch (error) {
            logger.error('Failed to set consolidation default favorite:', error)
            return false
        }
    }, [])

    return {
        startClaude,
        getAgentType,
        setAgentType,
        getOrchestratorAgentType,
        setOrchestratorAgentType,
        getSpecClarificationAgentType,
        setSpecClarificationAgentType,
        getConsolidationDefaultFavorite,
        setConsolidationDefaultFavorite,
    }
}
