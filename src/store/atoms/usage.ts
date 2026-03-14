import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent } from '../../common/eventSystem'
import { SchaltEvent } from '../../common/events'
import { logger } from '../../utils/logger'

export interface UsageSnapshot {
  session_percent: number
  session_reset_time: string | null
  weekly_percent: number
  weekly_reset_time: string | null
  provider: string
  fetched_at: string
  error?: string
}

export const usageAtom = atom<UsageSnapshot | null>(null)
export const usageLoadingAtom = atom(false)

export const fetchUsageActionAtom = atom(null, async (_get, set) => {
  set(usageLoadingAtom, true)
  try {
    const snapshot = await invoke<UsageSnapshot>(TauriCommands.FetchUsage)
    set(usageAtom, snapshot)
  } catch (error) {
    logger.warn('Failed to fetch usage', error)
    set(usageAtom, {
      session_percent: 0,
      session_reset_time: null,
      weekly_percent: 0,
      weekly_reset_time: null,
      provider: 'anthropic',
      fetched_at: new Date().toISOString(),
      error: String(error),
    })
  } finally {
    set(usageLoadingAtom, false)
  }
})

export const registerUsageEventListenerActionAtom = atom(null, (_get, set) => {
  return listenEvent(SchaltEvent.UsageUpdated, (payload) => {
    set(usageAtom, payload as UsageSnapshot)
  })
})
