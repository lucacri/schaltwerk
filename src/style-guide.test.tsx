import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCommands } from './common/tauriCommands'

type TauriInternalsWindow = typeof window & {
  __TAURI_INTERNALS__?: {
    invoke: (...args: unknown[]) => Promise<unknown>
    transformCallback: () => number
  }
}

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}))

vi.mock('./index.css', () => ({}))
vi.mock('./style-guide/StyleGuide', () => ({
  StyleGuide: () => <div data-testid="style-guide" />,
}))

describe('style-guide.tsx entry', () => {
  beforeEach(() => {
    vi.resetModules()
    renderMock.mockReset()
    createRootMock.mockClear()
    localStorage.clear()
    window.history.replaceState({}, '', '/style-guide.html')
    document.body.innerHTML = '<div id="root"></div>'
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('color-scheme')
    delete (window as TauriInternalsWindow).__TAURI_INTERNALS__

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  it('mounts the style guide and installs a browser-only tauri shim', async () => {
    await import('./style-guide')

    expect(createRootMock).toHaveBeenCalledWith(document.getElementById('root'))
    expect(renderMock).toHaveBeenCalled()
    expect((window as TauriInternalsWindow).__TAURI_INTERNALS__).toMatchObject({
      invoke: expect.any(Function),
      transformCallback: expect.any(Function),
    })
    expect(document.documentElement.dataset.theme).toBe('darcula')
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark')
  })

  it('prefers the theme URL param over local storage when bootstrapping', async () => {
    localStorage.setItem('lucode-style-guide-theme', 'light')
    window.history.replaceState({}, '', '/style-guide.html?theme=kanagawa')

    await import('./style-guide')

    expect(document.documentElement.dataset.theme).toBe('kanagawa')
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark')
    expect(localStorage.getItem('lucode-style-guide-theme')).toBe('kanagawa')
  })

  it('installs preview settings data into the browser-only tauri shim', async () => {
    await import('./style-guide')

    const tauri = (window as TauriInternalsWindow).__TAURI_INTERNALS__

    expect(await tauri?.invoke(TauriCommands.GetAgentVariants)).toHaveLength(2)
    expect(await tauri?.invoke(TauriCommands.GetAgentPresets)).toHaveLength(3)
    expect(await tauri?.invoke(TauriCommands.GetContextualActions)).toHaveLength(3)
  })
})
