import { useCallback, useEffect, useRef, useState } from 'react'
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
}

export function useForgeIntegration(): ForgeIntegrationValue {
  const projectPath = useAtomValue(projectPathAtom)
  const [status, setStatus] = useState<ForgeStatusPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const unlistenRef = useRef<(() => void) | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<ForgeStatusPayload>(TauriCommands.ForgeGetStatus)
      setStatus(result)
    } catch (error) {
      logger.error('[useForgeIntegration] Failed to fetch forge status', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectPath) return

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
      return invoke<ForgeIssueSummary[]>(TauriCommands.ForgeSearchIssues, { source, query, limit })
    },
    []
  )

  const getIssueDetails = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      return invoke<ForgeIssueDetails>(TauriCommands.ForgeGetIssueDetails, { source, id })
    },
    []
  )

  const searchPrs = useCallback(
    async (source: ForgeSourceConfig, query?: string, limit?: number) => {
      return invoke<ForgePrSummary[]>(TauriCommands.ForgeSearchPrs, { source, query, limit })
    },
    []
  )

  const getPrDetails = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      return invoke<ForgePrDetails>(TauriCommands.ForgeGetPrDetails, { source, id })
    },
    []
  )

  const createSessionPr = useCallback(
    async (args: CreateForgeSessionPrArgs) => {
      return invoke<ForgePrResult>(TauriCommands.ForgeCreateSessionPr, { args })
    },
    []
  )

  const getReviewComments = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      return invoke<ForgeReviewComment[]>(TauriCommands.ForgeGetReviewComments, { source, id })
    },
    []
  )

  const approvePr = useCallback(
    async (source: ForgeSourceConfig, id: string) => {
      await invoke<void>(TauriCommands.ForgeApprovePr, { source, id })
    },
    []
  )

  const mergePr = useCallback(
    async (source: ForgeSourceConfig, id: string, squash: boolean, deleteBranch: boolean) => {
      await invoke<void>(TauriCommands.ForgeMergePr, { source, id, squash, deleteBranch })
    },
    []
  )

  const commentOnPr = useCallback(
    async (source: ForgeSourceConfig, id: string, message: string) => {
      await invoke<void>(TauriCommands.ForgeCommentOnPr, { source, id, message })
    },
    []
  )

  return {
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
  }
}
