import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'
import { projectPathAtom } from '../store/atoms/project'
import type {
  ForgeIssueSummary,
  ForgeIssueDetails,
  ForgePrSummary,
  ForgePrDetails,
  ForgePrResult,
  ForgeReviewComment,
  ForgeSourceConfig,
  ForgeStatusPayload,
} from '../types/forgeTypes'

export interface ForgeIntegrationValue {
  status: ForgeStatusPayload | null
  loading: boolean
  refreshStatus: () => Promise<void>
  searchIssues: (source: ForgeSourceConfig, query?: string, limit?: number) => Promise<ForgeIssueSummary[]>
  getIssueDetails: (source: ForgeSourceConfig, id: string) => Promise<ForgeIssueDetails>
  searchPrs: (source: ForgeSourceConfig, query?: string, limit?: number) => Promise<ForgePrSummary[]>
  getPrDetails: (source: ForgeSourceConfig, id: string) => Promise<ForgePrDetails>
  createSessionPr: (args: CreateForgeSessionPrArgs) => Promise<ForgePrResult>
  getReviewComments: (source: ForgeSourceConfig, id: string) => Promise<ForgeReviewComment[]>
  approvePr: (source: ForgeSourceConfig, id: string) => Promise<void>
  mergePr: (source: ForgeSourceConfig, id: string, squash: boolean, deleteBranch: boolean) => Promise<void>
  commentOnPr: (source: ForgeSourceConfig, id: string, message: string) => Promise<void>
}

export interface CreateForgeSessionPrArgs {
  sessionName: string
  title: string
  body?: string
  baseBranch?: string
  prBranchName?: string
  commitMessage?: string
  source: ForgeSourceConfig
  mode: 'squash' | 'reapply'
  cancelAfterPr?: boolean
  projectPath?: string
}

export function useForgeIntegration(): ForgeIntegrationValue {
  const projectPath = useAtomValue(projectPathAtom)
  const [status, setStatus] = useState<ForgeStatusPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const unlistenRef = useRef<(() => void) | null>(null)

  const ensureProjectPath = useCallback(() => {
    if (!projectPath) {
      throw new Error('Project path is not available')
    }
    return projectPath
  }, [projectPath])

  const refreshStatus = useCallback(async () => {
    if (!projectPath) {
      setStatus(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await invoke<ForgeStatusPayload>(TauriCommands.ForgeGetStatus, { projectPath })
      setStatus(result)
    } catch (error) {
      logger.error('[useForgeIntegration] Failed to fetch forge status', error)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (!projectPath) {
      setStatus(null)
      setLoading(false)
      return
    }

    void refreshStatus()

    void listenEvent(SchaltEvent.ForgeStatusChanged, (payload) => {
      setStatus(payload)
    }).then(unlisten => {
      unlistenRef.current = unlisten
    })

    return () => {
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [projectPath, refreshStatus])

  const searchIssues = useCallback(
    async (source: ForgeSourceConfig, query?: string, limit?: number) => {
      const path = ensureProjectPath()
      return invoke<ForgeIssueSummary[]>(TauriCommands.ForgeSearchIssues, { projectPath: path, source, query, limit })
    },
    [ensureProjectPath]
  )

  const getIssueDetails = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      const path = ensureProjectPath()
      return invoke<ForgeIssueDetails>(TauriCommands.ForgeGetIssueDetails, { projectPath: path, source, id })
    },
    [ensureProjectPath]
  )

  const searchPrs = useCallback(
    async (source: ForgeSourceConfig, query?: string, limit?: number) => {
      const path = ensureProjectPath()
      return invoke<ForgePrSummary[]>(TauriCommands.ForgeSearchPrs, { projectPath: path, source, query, limit })
    },
    [ensureProjectPath]
  )

  const getPrDetails = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      const path = ensureProjectPath()
      return invoke<ForgePrDetails>(TauriCommands.ForgeGetPrDetails, { projectPath: path, source, id })
    },
    [ensureProjectPath]
  )

  const createSessionPr = useCallback(
    async (args: CreateForgeSessionPrArgs) => {
      const path = ensureProjectPath()
      return invoke<ForgePrResult>(TauriCommands.ForgeCreateSessionPr, {
        args: {
          ...args,
          projectPath: path,
        },
      })
    },
    [ensureProjectPath]
  )

  const getReviewComments = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      const path = ensureProjectPath()
      return invoke<ForgeReviewComment[]>(TauriCommands.ForgeGetReviewComments, { projectPath: path, source, id })
    },
    [ensureProjectPath]
  )

  const approvePr = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      const path = ensureProjectPath()
      await invoke<void>(TauriCommands.ForgeApprovePr, { projectPath: path, source, id })
    },
    [ensureProjectPath]
  )

  const mergePr = useCallback(
    async (source: ForgeSourceConfig, id: string, squash: boolean, deleteBranch: boolean) => {
      const path = ensureProjectPath()
      await invoke<void>(TauriCommands.ForgeMergePr, { projectPath: path, source, id, squash, deleteBranch })
    },
    [ensureProjectPath]
  )

  const commentOnPr = useCallback(
    async (source: ForgeSourceConfig, id: string, message: string) => {
      const path = ensureProjectPath()
      await invoke<void>(TauriCommands.ForgeCommentOnPr, { projectPath: path, source, id, message })
    },
    [ensureProjectPath]
  )

  return useMemo(() => ({
    status,
    loading,
    refreshStatus,
    searchIssues,
    getIssueDetails,
    searchPrs,
    getPrDetails,
    createSessionPr,
    getReviewComments,
    approvePr,
    mergePr,
    commentOnPr,
  }), [status, loading, refreshStatus, searchIssues, getIssueDetails, searchPrs, getPrDetails, createSessionPr, getReviewComments, approvePr, mergePr, commentOnPr])
}
