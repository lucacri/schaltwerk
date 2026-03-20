import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForgePipelineStatus, ForgePrSummary, ForgeSourceConfig, ForgeType } from '../types/forgeTypes'

const REFRESH_INTERVAL_MS = 15_000
const RUNNING_STATUSES = new Set(['running', 'pending', 'created', 'waiting_for_resource', 'preparing'])
const EMPTY_MAP = new Map<string, ForgePipelineStatus>()

function isOpenState(state: string): boolean {
  const upper = state.toUpperCase()
  return upper === 'OPEN' || upper === 'OPENED'
}

interface UsePipelineStatusesParams {
  prs: ForgePrSummary[]
  forgeType: ForgeType
  sources: ForgeSourceConfig[]
  getPipelineStatus: (source: ForgeSourceConfig, sourceBranch: string) => Promise<ForgePipelineStatus | null>
  getSourceForItem: (pr: ForgePrSummary) => ForgeSourceConfig | undefined
}

export function usePipelineStatuses({
  prs,
  forgeType,
  sources,
  getPipelineStatus,
  getSourceForItem,
}: UsePipelineStatusesParams): Map<string, ForgePipelineStatus> {
  const [statuses, setStatuses] = useState<Map<string, ForgePipelineStatus>>(EMPTY_MAP)
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  const fetchStatuses = useCallback(async (openPrs: ForgePrSummary[]) => {
    if (openPrs.length === 0) return

    const results = await Promise.allSettled(
      openPrs.map(async (pr) => {
        const source = getSourceForItem(pr) ?? sources[0]
        if (!source) return { id: pr.id, pipeline: null }
        const pipeline = await getPipelineStatus(source, pr.sourceBranch)
        return { id: pr.id, pipeline }
      })
    )

    setStatuses((prev) => {
      const next = new Map(prev)
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.pipeline) {
          next.set(result.value.id, result.value.pipeline)
        }
      }
      return next
    })
  }, [getPipelineStatus, getSourceForItem, sources])

  useEffect(() => {
    if (forgeType !== 'gitlab' || prs.length === 0) {
      setStatuses(EMPTY_MAP)
      return
    }

    const openPrs = prs.filter((pr) => isOpenState(pr.state))
    if (openPrs.length === 0) return

    void fetchStatuses(openPrs)

    const interval = setInterval(() => {
      const current = statusesRef.current
      const prsToRefresh = openPrs.filter((pr) => {
        const status = current.get(pr.id)
        return !status || RUNNING_STATUSES.has(status.status)
      })
      if (prsToRefresh.length > 0) {
        void fetchStatuses(prsToRefresh)
      }
    }, REFRESH_INTERVAL_MS)

    return () => {
      clearInterval(interval)
    }
  }, [forgeType, prs, fetchStatuses])

  return statuses
}
