import { atom, type Setter } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import {
  createDefaultEnabledAgents,
  mergeEnabledAgents,
  type EnabledAgents,
} from '../../types/session'
import { logger } from '../../utils/logger'

const enabledAgentsStateAtom = atom<EnabledAgents>(createDefaultEnabledAgents())
const enabledAgentsInitializedAtom = atom(false)

export const enabledAgentsAtom = atom((get) => get(enabledAgentsStateAtom))
export const enabledAgentsLoadingAtom = atom(true)
export const enabledAgentsErrorAtom = atom<string | null>(null)

async function loadEnabledAgentsIntoState(set: Setter) {
  set(enabledAgentsLoadingAtom, true)
  try {
    const enabledAgents = await invoke<Partial<EnabledAgents> | null>(TauriCommands.GetEnabledAgents)
    set(enabledAgentsStateAtom, mergeEnabledAgents(enabledAgents))
    set(enabledAgentsErrorAtom, null)
  } catch (error) {
    logger.error('Failed to load enabled agents:', error)
    const message = error instanceof Error ? error.message : 'Failed to load enabled agents'
    set(enabledAgentsErrorAtom, message)
    set(enabledAgentsStateAtom, createDefaultEnabledAgents())
  } finally {
    set(enabledAgentsLoadingAtom, false)
  }
}

export const loadEnabledAgentsAtom = atom(null, async (get, set) => {
  if (get(enabledAgentsInitializedAtom)) {
    return
  }

  await loadEnabledAgentsIntoState(set)
  set(enabledAgentsInitializedAtom, true)
})

export const reloadEnabledAgentsAtom = atom(null, async (_get, set) => {
  await loadEnabledAgentsIntoState(set)
  set(enabledAgentsInitializedAtom, true)
})

export const saveEnabledAgentsAtom = atom(null, async (_get, set, enabledAgents: EnabledAgents) => {
  const merged = mergeEnabledAgents(enabledAgents)
  try {
    await invoke(TauriCommands.SetEnabledAgents, { enabledAgents: merged })
    set(enabledAgentsStateAtom, merged)
    set(enabledAgentsInitializedAtom, true)
    set(enabledAgentsErrorAtom, null)
    return true
  } catch (error) {
    logger.error('Failed to save enabled agents:', error)
    const message = error instanceof Error ? error.message : 'Failed to save enabled agents'
    set(enabledAgentsErrorAtom, message)
    return false
  }
})

export const setEnabledAgentsAtom = atom(null, (_get, set, enabledAgents: EnabledAgents) => {
  set(enabledAgentsStateAtom, mergeEnabledAgents(enabledAgents))
  set(enabledAgentsInitializedAtom, true)
  set(enabledAgentsErrorAtom, null)
})
