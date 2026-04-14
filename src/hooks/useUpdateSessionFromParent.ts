import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSessions } from './useSessions'
import { useToast } from '../common/toast/ToastProvider'
import { TauriCommands } from '../common/tauriCommands'
import { getSessionDisplayName } from '../utils/sessionDisplayName'
import { logger } from '../utils/logger'
import { isSpec } from '../utils/sessionFilters'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'

interface UpdateSessionFromParentResult {
  status:
    | 'success'
    | 'already_up_to_date'
    | 'has_uncommitted_changes'
    | 'has_conflicts'
    | 'pull_failed'
    | 'merge_failed'
    | 'no_session'
  parentBranch: string
  message: string
  conflictingPaths: string[]
}

type SessionUpdateOutcome = 'updated' | 'up_to_date' | 'failed'

export function useUpdateSessionFromParent() {
  const { pushToast } = useToast()
  const { sessions } = useSessions()
  const [isUpdating, setIsUpdating] = useState(false)
  const projectPath = useAtomValue(projectPathAtom)

  const updateSessionFromParent = useCallback(async (sessionName: string) => {
    const session = sessions.find(s => s.info.session_id === sessionName)
    if (!session) {
      pushToast({
        tone: 'warning',
        title: 'Session not found',
        description: 'Could not find the selected session.',
      })
      return
    }

    if (isSpec(session.info)) {
      pushToast({
        tone: 'warning',
        title: 'Cannot update spec',
        description: 'Start the session first before updating from parent.',
      })
      return
    }

    setIsUpdating(true)
    try {
      const result = await invoke<UpdateSessionFromParentResult>(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: sessionName, ...(projectPath ? { projectPath } : {}) },
      )

      const displayName = getSessionDisplayName(session.info)

      switch (result.status) {
        case 'success':
          pushToast({
            tone: 'success',
            title: 'Session updated',
            description: `${displayName} updated from ${result.parentBranch}`,
          })
          break

        case 'already_up_to_date':
          pushToast({
            tone: 'info',
            title: 'Already up to date',
            description: `${displayName} is already up to date with ${result.parentBranch}`,
          })
          break

        case 'has_uncommitted_changes':
          pushToast({
            tone: 'warning',
            title: 'Uncommitted changes',
            description: 'Commit or stash your changes before updating.',
          })
          break

        case 'has_conflicts':
          pushToast({
            tone: 'warning',
            title: 'Merge conflicts',
            description:
              result.conflictingPaths.length > 0
                ? `Conflicts in: ${result.conflictingPaths.slice(0, 3).join(', ')}${result.conflictingPaths.length > 3 ? '...' : ''}`
                : result.message,
          })
          break

        case 'pull_failed':
          pushToast({
            tone: 'error',
            title: 'Update failed',
            description: result.message,
          })
          break

        case 'merge_failed':
          pushToast({
            tone: 'error',
            title: 'Merge failed',
            description: result.message,
          })
          break

        case 'no_session':
          pushToast({
            tone: 'warning',
            title: 'No active session',
            description: result.message,
          })
          break
      }
    } catch (error) {
      logger.error('Failed to update session from parent', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: message,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [projectPath, sessions, pushToast])

  const updateAllSessionsFromParent = useCallback(async () => {
    const runningSessions = sessions.filter(session => !isSpec(session.info))

    if (runningSessions.length === 0) {
      pushToast({
        tone: 'warning',
        title: 'No running sessions',
        description: 'There are no running sessions to update.',
      })
      return
    }

    setIsUpdating(true)
    try {
      const results = await Promise.allSettled(
        runningSessions.map(async session => {
          const result = await invoke<UpdateSessionFromParentResult>(
            TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
            { name: session.info.session_id, ...(projectPath ? { projectPath } : {}) },
          )

          if (result.status === 'success') return 'updated' satisfies SessionUpdateOutcome
          if (result.status === 'already_up_to_date') return 'up_to_date' satisfies SessionUpdateOutcome
          return 'failed' satisfies SessionUpdateOutcome
        }),
      )

      let updatedCount = 0
      let upToDateCount = 0
      let failedCount = 0
      const failedNames: string[] = []

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          if (result.value === 'updated') {
            updatedCount += 1
            return
          }

          if (result.value === 'up_to_date') {
            upToDateCount += 1
            return
          }
        }

        failedCount += 1
        failedNames.push(getSessionDisplayName(runningSessions[index].info))
      })

      if (failedCount === 0 && updatedCount > 0) {
        pushToast({
          tone: 'success',
          title: 'All sessions updated',
          description: `${updatedCount} session${updatedCount === 1 ? '' : 's'} updated from parent${upToDateCount > 0 ? `, ${upToDateCount} already up to date` : ''}`,
        })
        return
      }

      if (failedCount === 0) {
        pushToast({
          tone: 'info',
          title: 'All sessions up to date',
          description: `${upToDateCount} session${upToDateCount === 1 ? ' is' : 's are'} already up to date`,
        })
        return
      }

      if (failedCount < runningSessions.length) {
        pushToast({
          tone: 'warning',
          title: 'Some sessions had issues',
          description: `${failedCount} failed: ${failedNames.join(', ')}`,
        })
        return
      }

      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: `All ${failedCount} session${failedCount === 1 ? '' : 's'} failed to update`,
      })
    } catch (error) {
      logger.error('Failed to update sessions from parent', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({
        tone: 'error',
        title: 'Update failed',
        description: message,
      })
    } finally {
      setIsUpdating(false)
    }
  }, [projectPath, sessions, pushToast])

  return {
    updateSessionFromParent,
    updateAllSessionsFromParent,
    isUpdating,
  }
}
