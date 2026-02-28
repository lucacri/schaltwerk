import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'

export interface DockerProjectState {
  available: boolean
  imageExists: boolean
  sandboxEnabled: boolean
  buildInProgress: boolean
}

const dockerProjectStateBaseAtom = atom<DockerProjectState>({
  available: false,
  imageExists: false,
  sandboxEnabled: false,
  buildInProgress: false,
})

export const dockerProjectStateAtom = atom((get) => get(dockerProjectStateBaseAtom))

export const refreshDockerStatusActionAtom = atom(null, async (_get, set) => {
  try {
    const status = await invoke<{
      available: boolean
      imageExists: boolean
      sandboxEnabled: boolean
    }>(TauriCommands.GetDockerStatus)

    set(dockerProjectStateBaseAtom, (prev) => ({
      ...prev,
      available: status.available,
      imageExists: status.imageExists,
      sandboxEnabled: status.sandboxEnabled,
    }))
  } catch (e) {
    logger.error('[Docker] Failed to refresh status', e)
  }
})

export const setDockerSandboxEnabledActionAtom = atom(
  null,
  async (get, set, enabled: boolean) => {
    try {
      await invoke(TauriCommands.SetDockerSandboxEnabled, { enabled })
      set(dockerProjectStateBaseAtom, {
        ...get(dockerProjectStateBaseAtom),
        sandboxEnabled: enabled,
      })
    } catch (e) {
      logger.error('[Docker] Failed to set sandbox enabled', e)
      throw e
    }
  }
)

export const buildDockerImageActionAtom = atom(null, async (_get, set) => {
  set(dockerProjectStateBaseAtom, (prev) => ({ ...prev, buildInProgress: true }))
  try {
    await invoke(TauriCommands.BuildDockerImage)
    set(dockerProjectStateBaseAtom, (prev) => ({
      ...prev,
      imageExists: true,
      buildInProgress: false,
    }))
  } catch (e) {
    set(dockerProjectStateBaseAtom, (prev) => ({ ...prev, buildInProgress: false }))
    logger.error('[Docker] Image build failed', e)
    throw e
  }
})

export const registerDockerEventListenersActionAtom = atom(null, (_get, set) => {
  const unlisten = listenEvent(SchaltEvent.DockerImageBuildProgress, (payload) => {
    if (payload.complete) {
      set(dockerProjectStateBaseAtom, (prev) => ({
        ...prev,
        buildInProgress: false,
        imageExists: payload.success ? true : prev.imageExists,
      }))
    }
  })
  return unlisten
})
