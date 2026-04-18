import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { logger } from '../../utils/logger'

type ForegroundListener = () => void

interface BusState {
  listeners: Set<ForegroundListener>
  isForeground: boolean
  windowHandlers: {
    focus: () => void
    blur: () => void
    visibility: () => void
  } | null
  tauriUnlisten: UnlistenFn[]
}

function computeInitialForeground(): boolean {
  if (typeof document === 'undefined') return true
  const visible = document.visibilityState !== 'hidden'
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  return visible && focused
}

const state: BusState = {
  listeners: new Set(),
  isForeground: computeInitialForeground(),
  windowHandlers: null,
  tauriUnlisten: [],
}

function notify(): void {
  for (const listener of Array.from(state.listeners)) {
    try {
      listener()
    } catch (error) {
      logger.debug('[windowForegroundBus] listener error', error)
    }
  }
}

function transitionToForeground(): void {
  if (state.isForeground) return
  state.isForeground = true
  notify()
}

function transitionToBackground(): void {
  if (!state.isForeground) return
  state.isForeground = false
}

function attachDomListeners(): void {
  if (state.windowHandlers || typeof window === 'undefined') return

  const focus = () => transitionToForeground()
  const blur = () => transitionToBackground()
  const visibility = () => {
    if (typeof document === 'undefined') return
    const visible = document.visibilityState !== 'hidden'
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
    if (visible && focused) {
      transitionToForeground()
    } else {
      transitionToBackground()
    }
  }

  window.addEventListener('focus', focus)
  window.addEventListener('blur', blur)
  document.addEventListener('visibilitychange', visibility)

  state.windowHandlers = { focus, blur, visibility }

  void (async () => {
    try {
      const current = await getCurrentWindow()
      const focusEvents = ['tauri://focus', 'tauri://active', 'tauri://resumed']
      const blurEvents = ['tauri://blur', 'tauri://inactive']
      const visibilityEvents = ['tauri://visible-change', 'tauri://visibility-change']
      const register = async (names: string[], handler: () => void) => {
        for (const name of names) {
          try {
            const unlisten = await current.listen(name, handler)
            state.tauriUnlisten.push(unlisten)
            return
          } catch (error) {
            logger.debug(`[windowForegroundBus] failed to listen for ${name}`, error)
          }
        }
      }
      await register(focusEvents, () => transitionToForeground())
      await register(blurEvents, () => transitionToBackground())
      await register(visibilityEvents, () => {
        if (typeof document === 'undefined') return
        const visible = document.visibilityState !== 'hidden'
        if (visible) transitionToForeground()
        else transitionToBackground()
      })
    } catch (error) {
      logger.debug('[windowForegroundBus] tauri listener setup failed', error)
    }
  })()
}

function detachDomListeners(): void {
  if (state.windowHandlers && typeof window !== 'undefined') {
    window.removeEventListener('focus', state.windowHandlers.focus)
    window.removeEventListener('blur', state.windowHandlers.blur)
    document.removeEventListener('visibilitychange', state.windowHandlers.visibility)
  }
  state.windowHandlers = null
  for (const unlisten of state.tauriUnlisten) {
    try {
      const result = unlisten()
      void Promise.resolve(result).catch(error =>
        logger.debug('[windowForegroundBus] async unlisten error', error),
      )
    } catch (error) {
      logger.debug('[windowForegroundBus] unlisten error', error)
    }
  }
  state.tauriUnlisten = []
}

export const windowForegroundBus = {
  subscribe(listener: ForegroundListener): () => void {
    if (state.listeners.size === 0) {
      attachDomListeners()
    }
    state.listeners.add(listener)
    return () => {
      state.listeners.delete(listener)
      if (state.listeners.size === 0) {
        detachDomListeners()
      }
    }
  },
  isForeground(): boolean {
    return state.isForeground
  },
  __resetForTests(): void {
    state.listeners.clear()
    detachDomListeners()
    state.isForeground = computeInitialForeground()
  },
}
