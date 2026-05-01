import { useEffect, useEffectEvent, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { UnlistenFn } from '@tauri-apps/api/event'
import { TauriCommands } from '../../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../../common/eventSystem'
import { matchesProjectScope } from '../../../common/events'
import { logger } from '../../../utils/logger'
import { ORCHESTRATOR_SESSION_NAME } from '../../../constants/sessions'
import type { Selection } from '../../../store/atoms/selection'

interface UseOrchestratorBranchParams {
    selection: Selection
    projectPathRef: { current: string | null }
    createSafeUnlistener: (fn: UnlistenFn) => UnlistenFn
}

interface UseOrchestratorBranchResult {
    orchestratorBranch: string
}

export function useOrchestratorBranch({
    selection,
    projectPathRef,
    createSafeUnlistener,
}: UseOrchestratorBranchParams): UseOrchestratorBranchResult {
    const [orchestratorBranch, setOrchestratorBranch] = useState<string>('main')

    const fetchOrchestratorBranch = useEffectEvent(async () => {
        try {
            const projectPath = projectPathRef.current
            const branch = await invoke<string>(TauriCommands.GetCurrentBranchName, {
                sessionName: null,
                ...(projectPath ? { projectPath } : {}),
            })
            setOrchestratorBranch(branch || 'main')
        } catch (error) {
            logger.warn('Failed to get current branch, defaulting to main:', error)
            setOrchestratorBranch('main')
        }
    })

    useEffect(() => { void fetchOrchestratorBranch() }, [])

    useEffect(() => {
        if (selection.kind !== 'orchestrator') return
        void fetchOrchestratorBranch()
    }, [selection])

    useEffect(() => {
        let unlistenProjectReady: UnlistenFn | null = null
        let unlistenFileChanges: UnlistenFn | null = null

        const attach = async () => {
            try {
                const raw = await listenEvent(SchaltEvent.ProjectReady, () => { void fetchOrchestratorBranch() })
                unlistenProjectReady = createSafeUnlistener(raw)
            } catch (error) {
                logger.warn('Failed to listen for project ready events:', error)
            }

            try {
                const raw = await listenEvent(SchaltEvent.FileChanges, event => {
                    if (!matchesProjectScope(event.project_path, projectPathRef.current)) {
                        return
                    }
                    if (event.session_name === ORCHESTRATOR_SESSION_NAME) {
                        setOrchestratorBranch(event.branch_info.current_branch || 'HEAD')
                    }
                })
                unlistenFileChanges = createSafeUnlistener(raw)
            } catch (error) {
                logger.warn('Failed to listen for orchestrator file changes:', error)
            }
        }

        void attach()

        return () => {
            if (unlistenProjectReady) {
                unlistenProjectReady()
            }
            if (unlistenFileChanges) {
                unlistenFileChanges()
            }
        }
    }, [createSafeUnlistener, projectPathRef])

    return { orchestratorBranch }
}
