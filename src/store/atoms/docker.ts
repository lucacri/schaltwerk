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

export const dockerSandboxEnabledAtom = atom(
  (get) => get(dockerProjectStateBaseAtom).sandboxEnabled
)

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
  async (_get, set, enabled: boolean) => {
    try {
      await invoke(TauriCommands.SetDockerSandboxEnabled, { enabled })
      set(dockerProjectStateBaseAtom, (prev) => ({
        ...prev,
        sandboxEnabled: enabled,
      }))
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

export const rebuildDockerImageActionAtom = atom(null, async (_get, set) => {
  set(dockerProjectStateBaseAtom, (prev) => ({ ...prev, buildInProgress: true }))
  try {
    await invoke(TauriCommands.RebuildDockerImage)
    set(dockerProjectStateBaseAtom, (prev) => ({
      ...prev,
      imageExists: true,
      buildInProgress: false,
    }))
  } catch (e) {
    set(dockerProjectStateBaseAtom, (prev) => ({ ...prev, buildInProgress: false }))
    logger.error('[Docker] Image rebuild failed', e)
    throw e
  }
})

export const registerDockerEventListenersActionAtom = atom(null, (_get, set) => {
  const unlistenBuild = listenEvent(SchaltEvent.DockerImageBuildProgress, (payload) => {
    if (payload.complete) {
      set(dockerProjectStateBaseAtom, (prev) => ({
        ...prev,
        buildInProgress: false,
        imageExists: payload.success ? true : prev.imageExists,
      }))
    }
  })

  const unlistenStatus = listenEvent(SchaltEvent.DockerStatusChanged, (payload) => {
    set(dockerProjectStateBaseAtom, (prev) => ({
      ...prev,
      available: payload.available,
      imageExists: payload.imageExists,
      sandboxEnabled: payload.sandboxEnabled,
    }))
  })

  return { unlistenBuild, unlistenStatus }
})
