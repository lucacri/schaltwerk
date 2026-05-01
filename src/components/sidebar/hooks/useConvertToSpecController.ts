import { useCallback, useState } from 'react'
import { isSpec } from '../../../utils/sessionFilters'
import { getSessionDisplayName } from '../../../utils/sessionDisplayName'
import type { EnrichedSession } from '../../../types/session'
import type { Selection } from '../../../store/atoms/selection'
import type { ConvertToSpecModalState } from '../helpers/modalState'

interface UseConvertToSpecControllerParams {
    sessions: EnrichedSession[]
    selection: Selection
    projectPathRef: { current: string | null }
}

interface UseConvertToSpecControllerResult {
    modalState: ConvertToSpecModalState
    setModalState: (next: ConvertToSpecModalState) => void
    closeModal: () => void
    openFromShortcut: () => void
}

const DEFAULT_STATE: ConvertToSpecModalState = {
    open: false,
    sessionName: '',
    projectPath: null,
    hasUncommitted: false,
}

export function useConvertToSpecController({
    sessions,
    selection,
    projectPathRef,
}: UseConvertToSpecControllerParams): UseConvertToSpecControllerResult {
    const [modalState, setModalState] = useState<ConvertToSpecModalState>(DEFAULT_STATE)

    const closeModal = useCallback(() => {
        setModalState(DEFAULT_STATE)
    }, [])

    const openFromShortcut = useCallback(() => {
        if (selection.kind !== 'session') return
        const selectedSession = sessions.find(s => s.info.session_id === selection.payload)
        if (!selectedSession || isSpec(selectedSession.info)) return
        setModalState({
            open: true,
            sessionName: selectedSession.info.session_id,
            projectPath: projectPathRef.current,
            sessionDisplayName: getSessionDisplayName(selectedSession.info),
            hasUncommitted: selectedSession.info.has_uncommitted_changes || false,
        })
    }, [selection, sessions, projectPathRef])

    return { modalState, setModalState, closeModal, openFromShortcut }
}
