import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../../common/tauriCommands'
import { logger } from '../../../utils/logger'

interface UseSessionEditCallbacksResult {
    handleRenameSession: (sessionId: string, newName: string) => Promise<void>
    handleLinkPr: (sessionId: string, prNumber: number, prUrl: string) => Promise<void>
}

export function useSessionEditCallbacks(): UseSessionEditCallbacksResult {
    const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreRenameSessionDisplayName, {
                sessionId,
                newDisplayName: newName,
            })
        } catch (error) {
            logger.error('Failed to rename session:', error)
            throw error
        }
    }, [])

    const handleLinkPr = useCallback(async (sessionId: string, prNumber: number, prUrl: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreLinkSessionToPr, {
                name: sessionId,
                prNumber,
                prUrl,
            })
        } catch (error) {
            logger.error('Failed to link session to PR:', error)
        }
    }, [])

    return { handleRenameSession, handleLinkPr }
}
