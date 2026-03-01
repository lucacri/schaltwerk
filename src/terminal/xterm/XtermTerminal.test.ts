import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWriteClipboard = vi.fn().mockResolvedValue(true)
const mockReadClipboard = vi.fn().mockResolvedValue(null)

vi.mock('../../utils/clipboard', () => ({
  writeClipboard: (...args: unknown[]) => mockWriteClipboard(...args),
  readClipboard: (...args: unknown[]) => mockReadClipboard(...args),
}))

const mockWriteTerminalBackend = vi.fn().mockResolvedValue(undefined)

vi.mock('../transport/backend', () => ({
  writeTerminalBackend: (...args: unknown[]) => mockWriteTerminalBackend(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@xterm/xterm', () => {
  const instances: unknown[] = []
  class MockXTerm {
    static __instances = instances
    options: Record<string, unknown>
    loadAddon = vi.fn()
    open = vi.fn()
    write = vi.fn()
    dispose = vi.fn()
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }))
    scrollToBottom = vi.fn()
    scrollToLine = vi.fn()
    scrollLines = vi.fn()
    buffer: { active: { baseY: number; viewportY: number } } | undefined = {
      active: { baseY: 0, viewportY: 0 },
    }
    element: HTMLElement | null = null
    parser = {
      registerOscHandler: vi.fn(() => true),
      registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })),
    }
    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }
  }
  return { Terminal: MockXTerm }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
    findPrevious = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    dispose = vi.fn()
  },
}))

const registerMock = vi.fn()

vi.mock('./xtermAddonImporter', () => ({
  XtermAddonImporter: class {
    static registerPreloadedAddon = registerMock
  }
}))

beforeEach(() => {
  registerMock.mockClear()
  mockWriteClipboard.mockClear()
  mockReadClipboard.mockClear()
  mockWriteTerminalBackend.mockClear()
})

describe('XtermTerminal wrapper', () => {
  it('creates a terminal instance, loads addons, and attaches to a container', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')
    const { buildTerminalTheme } = await import('../../common/themes/terminalTheme')
    const terminalTheme = buildTerminalTheme('dark')

    const wrapper = new XtermTerminal({
      terminalId: 'test-id',
      theme: terminalTheme,
      config: {
        scrollback: 12000,
        fontSize: 14,
        fontFamily: 'Fira Code',
        readOnly: false,
        minimumContrastRatio: 1.3,
        smoothScrolling: true,
      },
    })
    await wrapper.ensureCoreAddonsLoaded()

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown>; loadAddon: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    expect(MockTerminal.__instances).toHaveLength(1)
    const instance = MockTerminal.__instances[0]
    expect(instance.options.scrollback).toBe(12000)
    expect(instance.options.fontSize).toBe(14)
    expect(instance.options.fontFamily).toBe('Fira Code')
    expect(instance.options.disableStdin).toBe(false)
    expect(instance.options.minimumContrastRatio).toBe(1.3)
    expect(instance.options.smoothScrollDuration).toBeGreaterThan(0)
    expect(instance.options.theme).toMatchObject(terminalTheme)
    expect(instance.loadAddon).toHaveBeenCalledTimes(3)
    expect(registerMock).toHaveBeenCalledWith('fit', expect.any(Function))
    expect(registerMock).toHaveBeenCalledWith('search', expect.any(Function))
    expect(registerMock).toHaveBeenCalledWith('webLinks', expect.any(Function))
    expect(instance.parser.registerOscHandler).toHaveBeenCalledTimes(10)
    for (const code of [10, 11, 12, 13, 14, 15, 16, 17, 19, 52]) {
      expect(instance.parser.registerOscHandler).toHaveBeenCalledWith(code, expect.any(Function))
    }

    const container = document.createElement('div')
    wrapper.attach(container)

    expect(container.children).toHaveLength(1)
    const child = container.children[0] as HTMLElement
    expect(child.dataset.terminalId).toBe('test-id')
    expect(child.classList.contains('schaltwerk-terminal-wrapper')).toBe(true)
    expect(child.style.position).toBe('relative')
    expect(child.style.width).toBe('100%')
    expect(child.style.height).toBe('100%')
    expect(child.style.display).toBe('block')
    expect(instance.open).toHaveBeenCalledTimes(1)

    wrapper.detach()
    expect((child as HTMLElement).style.display).toBe('none')

    wrapper.attach(container)
    expect((child as HTMLElement).style.display).toBe('block')
    expect(instance.open).toHaveBeenCalledTimes(1)
  })

  it('updates underlying xterm options via updateOptions', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'opts',
      config: {
        scrollback: 10000,
        fontSize: 13,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })
    await wrapper.ensureCoreAddonsLoaded()
    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!
    expect(instance.options.fontSize).toBe(13)

    wrapper.updateOptions({ fontSize: 17, fontFamily: 'Fira Code' })
    expect(instance.options.fontSize).toBe(17)
    expect(instance.options.fontFamily).toBe('Fira Code')
  })

  it('applies config updates through applyConfig and updateOptions', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'cfg',
      config: {
        scrollback: 10000,
        fontSize: 13,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: true,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    wrapper.applyConfig({ readOnly: true, minimumContrastRatio: 1.6, scrollback: 12000, smoothScrolling: false })
    expect(instance.options.disableStdin).toBe(true)
    expect(instance.options.minimumContrastRatio).toBe(1.6)
    expect(instance.options.scrollback).toBe(12000)
    expect(instance.options.smoothScrollDuration).toBe(0)

    wrapper.updateOptions({ disableStdin: false, scrollback: 8000, smoothScrollDuration: 125 })
    expect(instance.options.disableStdin).toBe(false)
    expect(instance.options.scrollback).toBe(8000)
    expect(instance.options.smoothScrollDuration).toBe(125)

    wrapper.setSmoothScrolling(true)
    expect(instance.options.smoothScrollDuration).toBeGreaterThan(0)
  })

  it('toggles smooth scrolling independently', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'smooth',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: true,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!
    expect(instance.options.smoothScrollDuration).toBeGreaterThan(0)
    wrapper.setSmoothScrolling(false)
    expect(instance.options.smoothScrollDuration).toBe(0)
    wrapper.setSmoothScrolling(true)
    expect(instance.options.smoothScrollDuration).toBeGreaterThan(0)
  })

  it('hides the cursor in TUI mode on attach', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'tui',
      uiMode: 'tui',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown>; write: ReturnType<typeof vi.fn> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const container = document.createElement('div')
    wrapper.attach(container)

    expect(instance.options.cursorBlink).toBe(false)
    expect(instance.write).toHaveBeenCalledWith('\x1b[?25l')
  })

  it('registers a CSI J handler to block clear scrollback in TUI mode', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    new XtermTerminal({
      terminalId: 'csi-test',
      uiMode: 'tui',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ parser: { registerCsiHandler: ReturnType<typeof vi.fn> } }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    expect(instance.parser.registerCsiHandler).toHaveBeenCalledWith(
      { final: 'J' },
      expect.any(Function)
    )
  })

  it('registers an OSC 52 handler that returns true to consume the sequence', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    new XtermTerminal({
      terminalId: 'osc52-consume',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const osc52Call = instance.parser.registerOscHandler.mock.calls.find(
      (call: unknown[]) => call[0] === 52
    )
    expect(osc52Call).toBeDefined()

    const handler = osc52Call![1] as (payload: string) => boolean
    const result = handler('c;SGVsbG8=')
    expect(result).toBe(true)
  })

  it('decodes OSC 52 write payload and calls writeClipboard', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    new XtermTerminal({
      terminalId: 'osc52-write',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const osc52Call = instance.parser.registerOscHandler.mock.calls.find(
      (call: unknown[]) => call[0] === 52
    )
    const handler = osc52Call![1] as (payload: string) => boolean
    handler('c;SGVsbG8gV29ybGQ=')

    await vi.waitFor(() => {
      expect(mockWriteClipboard).toHaveBeenCalledWith('Hello World')
    })
  })

  it('responds to OSC 52 read query with base64-encoded clipboard content', async () => {
    mockReadClipboard.mockResolvedValue('Test Content')

    const { XtermTerminal } = await import('./XtermTerminal')

    new XtermTerminal({
      terminalId: 'osc52-read',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const osc52Call = instance.parser.registerOscHandler.mock.calls.find(
      (call: unknown[]) => call[0] === 52
    )
    const handler = osc52Call![1] as (payload: string) => boolean
    handler('c;?')

    await vi.waitFor(() => {
      expect(mockReadClipboard).toHaveBeenCalled()
    })

    await vi.waitFor(() => {
      expect(mockWriteTerminalBackend).toHaveBeenCalledWith(
        'osc52-read',
        `\x1b]52;c;${btoa('Test Content')}\x07`
      )
    })
  })

  it('does not write back when readClipboard returns null', async () => {
    mockReadClipboard.mockResolvedValue(null)

    const { XtermTerminal } = await import('./XtermTerminal')

    new XtermTerminal({
      terminalId: 'osc52-null',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const osc52Call = instance.parser.registerOscHandler.mock.calls.find(
      (call: unknown[]) => call[0] === 52
    )
    const handler = osc52Call![1] as (payload: string) => boolean
    handler('c;?')

    await vi.waitFor(() => {
      expect(mockReadClipboard).toHaveBeenCalled()
    })

    expect(mockWriteTerminalBackend).not.toHaveBeenCalled()
  })

  it('saves and restores scroll position on detach/attach', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'scroll-test',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ buffer: { active: { viewportY: number } }; scrollToLine: ReturnType<typeof vi.fn> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const container = document.createElement('div')
    wrapper.attach(container)

    instance.buffer.active.viewportY = 42
    wrapper.detach()

    wrapper.attach(container)

    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(instance.scrollToLine).toHaveBeenCalledWith(42)
  })
})
