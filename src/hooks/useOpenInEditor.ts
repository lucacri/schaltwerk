import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { useSelection } from './useSelection'
import { logger } from '../utils/logger'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'

interface UseOpenInEditorOptions {
  sessionNameOverride?: string | null
  isCommander?: boolean
}

export const SYSTEM_OPEN_APP_ID = 'system-open'

export type EditorOverrides = Record<string, string>

export function resolveEditorForFile(filePath: string, overrides: EditorOverrides): string {
  const ext = extractExtension(filePath)
  if (ext && overrides[ext]) {
    return overrides[ext]
  }
  return SYSTEM_OPEN_APP_ID
}

export function extractExtension(filePath: string): string | null {
  const basename = filePath.split(/[/\\]/).pop() ?? filePath
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex <= 0) return null
  return basename.slice(dotIndex)
}

export function useOpenInEditor(options: UseOpenInEditorOptions = {}) {
  const { sessionNameOverride, isCommander } = options
  const { selection } = useSelection()
  const projectPath = useAtomValue(projectPathAtom)

  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)

  const resolveEditorAppId = useCallback(async (filePath: string): Promise<string> => {
    try {
      const overrides = await invoke<EditorOverrides>(TauriCommands.GetEditorOverrides)
      return resolveEditorForFile(filePath, overrides)
    } catch (error) {
      logger.error('Failed to load editor overrides', error)
      return SYSTEM_OPEN_APP_ID
    }
  }, [])

  const openInEditor = useCallback(async (filePath: string) => {
    try {
      let basePath: string

      if (isCommander && !sessionName) {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      } else if (sessionName) {
        const projectScope = projectPath ? { projectPath } : {}
        const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName, ...projectScope })
        basePath = sessionData.worktree_path
      } else {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      }

      const fullPath = `${basePath}/${filePath}`
      const appId = await resolveEditorAppId(filePath)
      await invoke(TauriCommands.OpenInApp, {
        appId,
        worktreeRoot: basePath,
        worktreePath: basePath,
        targetPath: fullPath
      })
    } catch (e) {
      logger.error('Failed to open file in editor:', filePath, e)
      const errorMessage = typeof e === 'string' ? e : ((e as Error)?.message || String(e) || 'Unknown error')
      alert(errorMessage)
    }
  }, [isCommander, projectPath, resolveEditorAppId, sessionName])

  return { openInEditor, resolveEditorAppId }
}
