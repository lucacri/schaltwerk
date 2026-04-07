import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ChangedFile } from '../../common/events'
import { loadFileDiff, type FileDiffData, type ViewMode } from '../../components/diff/loadDiffs'
import { logger } from '../../utils/logger'

class DiffPreloadManager {
  private activeSession: string | null = null
  private controller: AbortController | null = null
  private preloadedFiles = new Map<string, ChangedFile[]>()
  private preloadedDiffs = new Map<string, Map<string, FileDiffData>>()

  private getCacheKey(sessionName: string, projectPath?: string | null): string {
    return `${projectPath ?? '__default__'}::${sessionName}`
  }

  preload(
    sessionName: string | null,
    isOrchestrator: boolean,
    diffLayout: ViewMode,
    projectPath?: string | null,
  ): void {
    if (!sessionName) return
    const cacheKey = this.getCacheKey(sessionName, projectPath)

    if (this.activeSession === cacheKey && this.preloadedFiles.has(cacheKey)) {
      return
    }

    logger.debug(`[DiffPreloader] Starting preload for session=${sessionName} orchestrator=${isOrchestrator} layout=${diffLayout}`)

    this.controller?.abort()
    this.controller = new AbortController()
    this.activeSession = cacheKey

    const { signal } = this.controller

    void this.runPreload(sessionName, isOrchestrator, diffLayout, signal, projectPath)
  }

  invalidate(sessionName: string, projectPath?: string | null): void {
    const cacheKey = this.getCacheKey(sessionName, projectPath)
    this.preloadedFiles.delete(cacheKey)
    this.preloadedDiffs.delete(cacheKey)
    if (this.activeSession === cacheKey) {
      this.activeSession = null
    }
  }

  getChangedFiles(sessionName: string, projectPath?: string | null): ChangedFile[] | null {
    const cacheKey = this.getCacheKey(sessionName, projectPath)
    const result = this.preloadedFiles.get(cacheKey) ?? null
    logger.debug(`[DiffPreloader] getChangedFiles(${sessionName}): ${result ? `${result.length} files` : 'miss'}`)
    return result
  }

  getFileDiff(sessionName: string, filePath: string, projectPath?: string | null): FileDiffData | null {
    const cacheKey = this.getCacheKey(sessionName, projectPath)
    return this.preloadedDiffs.get(cacheKey)?.get(filePath) ?? null
  }

  private async runPreload(
    sessionName: string,
    isOrchestrator: boolean,
    diffLayout: ViewMode,
    signal: AbortSignal,
    projectPath?: string | null,
  ): Promise<void> {
    const cacheKey = this.getCacheKey(sessionName, projectPath)
    const startTime = performance.now()
    try {
      const changedFiles = isOrchestrator
        ? await invoke<ChangedFile[]>(TauriCommands.GetOrchestratorWorkingChanges)
        : await invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName })

      if (signal.aborted) return

      logger.debug(`[DiffPreloader] Fetched ${changedFiles.length} changed files in ${Math.round(performance.now() - startTime)}ms`)
      this.preloadedFiles.set(cacheKey, changedFiles)

      if (changedFiles.length === 0) return

      const diffMap = new Map<string, FileDiffData>()
      this.preloadedDiffs.set(cacheKey, diffMap)

      let index = 0
      const concurrency = 4
      const files = changedFiles

      const runNext = async (): Promise<void> => {
        while (index < files.length) {
          if (signal.aborted) return
          const myIndex = index++
          const file = files[myIndex]
          try {
            const diff = await loadFileDiff(sessionName, file, diffLayout)
            if (signal.aborted) return
            diffMap.set(file.path, diff)
          } catch (e) {
            logger.debug(`[DiffPreloader] Failed to preload diff for ${file.path}`, e)
          }
        }
      }

      const workers = Math.min(concurrency, files.length)
      const loadTasks: Promise<void>[] = []
      for (let i = 0; i < workers; i++) {
        loadTasks.push(runNext())
      }
      await Promise.all(loadTasks)

      if (signal.aborted) return

      const elapsed = Math.round(performance.now() - startTime)
      logger.debug(`[DiffPreloader] Preload complete: ${diffMap.size} diffs loaded in ${elapsed}ms`)
    } catch (e) {
      if (!signal.aborted) {
        logger.debug('[DiffPreloader] Preload failed', e)
      }
    }
  }
}

export const diffPreloader = new DiffPreloadManager()
