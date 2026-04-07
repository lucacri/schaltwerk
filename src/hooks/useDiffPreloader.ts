import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { useSelection } from './useSelection'
import { diffLayoutPreferenceAtom } from '../store/atoms/diffPreferences'
import { diffPreloader } from '../domains/diff/preloader'
import { matchesProjectScope } from '../common/events'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { logger } from '../utils/logger'
import { projectPathAtom } from '../store/atoms/project'

export function useDiffPreloader(): void {
  const { selection } = useSelection()
  const diffLayout = useAtomValue(diffLayoutPreferenceAtom)
  const projectPath = useAtomValue(projectPathAtom)

  useEffect(() => {
    if (selection.sessionState === 'spec') return

    const sessionName = selection.payload ?? null
    const isOrchestrator = selection.kind === 'orchestrator'

    diffPreloader.preload(sessionName, isOrchestrator, diffLayout, projectPath)

    let disposed = false
    let unlisten: (() => void) | null = null

    void listenEvent(SchaltEvent.FileChanges, (event) => {
      if (disposed) return
      if (!matchesProjectScope(event.project_path, projectPath)) return
      const eventSession = event.session_name
      if (sessionName && eventSession === sessionName) {
        diffPreloader.invalidate(sessionName, projectPath)
        diffPreloader.preload(sessionName, isOrchestrator, diffLayout, projectPath)
      }
    }).then(fn => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    }).catch(e => {
      logger.debug('[useDiffPreloader] Failed to listen for FileChanges', e)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [selection.payload, selection.kind, selection.sessionState, diffLayout, projectPath])
}
