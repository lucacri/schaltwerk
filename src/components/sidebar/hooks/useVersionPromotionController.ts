import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../../utils/logger'
import { groupSessionsByVersion, selectBestVersionAndCleanup, SessionVersionGroup as SessionVersionGroupType } from '../../../utils/sessionVersions'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { PromoteVersionModalState } from '../helpers/modalState'

interface UseVersionPromotionControllerParams {
    sessions: EnrichedSession[]
    selection: Selection
    projectPathRef: { current: string | null }
}

interface UseVersionPromotionControllerResult {
    modalState: PromoteVersionModalState
    selectBestVersion: (groupBaseName: string, selectedSessionId: string) => void
    promoteSelected: () => void
    closeModal: () => void
    confirmModal: () => void
}

const DEFAULT_STATE: PromoteVersionModalState = {
    open: false,
    versionGroup: null,
    selectedSessionId: '',
}

export function useVersionPromotionController({
    sessions,
    selection,
    projectPathRef,
}: UseVersionPromotionControllerParams): UseVersionPromotionControllerResult {
    const [modalState, setModalState] = useState<PromoteVersionModalState>(DEFAULT_STATE)

    const executePromotion = useCallback(async (targetGroup: SessionVersionGroupType, selectedSessionId: string) => {
        try {
            await selectBestVersionAndCleanup(targetGroup, selectedSessionId, invoke, projectPathRef.current)
        } catch (error) {
            logger.error('Failed to select best version:', error)
            alert(`Failed to select best version: ${error}`)
        }
    }, [projectPathRef])

    const selectBestVersion = useCallback((groupBaseName: string, selectedSessionId: string) => {
        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g => g.baseName === groupBaseName)

        if (!targetGroup) {
            logger.error(`Version group ${groupBaseName} not found`)
            return
        }

        const noConfirmKey = `promote-version-no-confirm-${groupBaseName}`
        const skipConfirmation = localStorage.getItem(noConfirmKey) === 'true'

        if (skipConfirmation) {
            void executePromotion(targetGroup, selectedSessionId)
        } else {
            setModalState({
                open: true,
                versionGroup: targetGroup,
                selectedSessionId,
            })
        }
    }, [sessions, executePromotion])

    const promoteSelected = useCallback(() => {
        if (selection.kind !== 'session' || !selection.payload) return

        const sessionGroups = groupSessionsByVersion(sessions)
        const targetGroup = sessionGroups.find(g =>
            g.isVersionGroup && g.versions.some(v => v.session.info.session_id === selection.payload)
        )

        if (!targetGroup) return

        selectBestVersion(targetGroup.baseName, selection.payload)
    }, [selection, sessions, selectBestVersion])

    const closeModal = useCallback(() => {
        setModalState(DEFAULT_STATE)
    }, [])

    const confirmModal = useCallback(() => {
        const { versionGroup, selectedSessionId } = modalState
        setModalState(DEFAULT_STATE)
        if (versionGroup) {
            void executePromotion(versionGroup, selectedSessionId)
        }
    }, [modalState, executePromotion])

    return {
        modalState,
        selectBestVersion,
        promoteSelected,
        closeModal,
        confirmModal,
    }
}
