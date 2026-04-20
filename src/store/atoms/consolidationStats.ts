import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import type { ConsolidationStats, ConsolidationStatsFilters } from '../../types/consolidationStats'

export const consolidationStatsAtom = atom<ConsolidationStats | null>(null)
export const consolidationStatsLoadingAtom = atom(false)
export const consolidationStatsErrorAtom = atom<string | null>(null)
export const consolidationStatsFiltersAtom = atom<ConsolidationStatsFilters>({})

export const loadConsolidationStatsAtom = atom(null, async (get, set) => {
  const filters = get(consolidationStatsFiltersAtom)
  set(consolidationStatsLoadingAtom, true)
  set(consolidationStatsErrorAtom, null)

  try {
    const stats = await invoke<ConsolidationStats>(TauriCommands.SchaltwerkCoreGetConsolidationStats, {
      repositoryPath: filters.repositoryPath,
      vertical: filters.vertical,
    })
    set(consolidationStatsAtom, stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('[consolidationStats] Failed to load consolidation stats', error)
    set(consolidationStatsErrorAtom, message)
  } finally {
    set(consolidationStatsLoadingAtom, false)
  }
})
