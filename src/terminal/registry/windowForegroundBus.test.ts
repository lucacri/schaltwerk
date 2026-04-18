import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { windowForegroundBus } from './windowForegroundBus'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(async () => ({
    listen: vi.fn(async () => () => {}),
  })),
}))

describe('windowForegroundBus', () => {
  beforeEach(() => {
    windowForegroundBus.__resetForTests()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    })
  })

  afterEach(() => {
    windowForegroundBus.__resetForTests()
  })

  it('fires subscribers on blur→focus transitions', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    window.dispatchEvent(new Event('blur'))
    expect(cb).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('focus'))
    expect(cb).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('does not fire on repeated focus events without an intervening blur', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    expect(cb).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    expect(cb).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('treats a visibilitychange to visible after hidden as a foreground transition', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(cb).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('fans out a single transition to every subscriber', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const u1 = windowForegroundBus.subscribe(cb1)
    const u2 = windowForegroundBus.subscribe(cb2)

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    u1()
    u2()
  })

  it('unsubscribes cleanly', () => {
    const cb = vi.fn()
    const unsubscribe = windowForegroundBus.subscribe(cb)
    unsubscribe()

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    expect(cb).not.toHaveBeenCalled()
  })
})
