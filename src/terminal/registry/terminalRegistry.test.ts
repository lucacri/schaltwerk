import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireTerminalInstance,
  attachTerminalInstance,
  detachTerminalInstance,
  removeTerminalInstance,
  isTerminalBracketedPasteEnabled,
  selectAllTerminal,
  addTerminalOutputCallback,
  removeTerminalOutputCallback,
} from './terminalRegistry'
import { terminalOutputManager } from '../stream/terminalOutputManager'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('../stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    ensureStarted: vi.fn(async () => {}),
    rehydrate: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    getSeqCursor: vi.fn(() => null),
  },
}))

vi.mock('../gpu/gpuRendererRegistry', () => ({
  disposeGpuRenderer: vi.fn(),
}))

const invokeMock = vi.fn(async () => undefined)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
}))

vi.mock('./windowForegroundBus', () => {
  let subscriber: (() => void) | null = null
  return {
    windowForegroundBus: {
      subscribe: vi.fn((cb: () => void) => {
        subscriber = cb
        return () => {
          if (subscriber === cb) subscriber = null
        }
      }),
      isForeground: () => true,
      __fireForTests: () => subscriber?.(),
    },
  }
})

import { windowForegroundBus } from './windowForegroundBus'
import { UiEvent, type SelectionChangedDetail, type ProjectSwitchCompleteDetail } from '../../common/uiEvents'
const fireForeground = (windowForegroundBus as unknown as {
  __fireForTests: () => void
}).__fireForTests
const foregroundSubscribeMock = windowForegroundBus.subscribe as unknown as ReturnType<typeof vi.fn>

function fireUiEvent<T>(event: UiEvent, detail: T): void {
  window.dispatchEvent(new CustomEvent(String(event), { detail }))
}

const addListenerMock = terminalOutputManager.addListener as unknown as ReturnType<typeof vi.fn>
const ensureStartedMock = terminalOutputManager.ensureStarted as unknown as ReturnType<typeof vi.fn>
const rehydrateMock = (terminalOutputManager as unknown as { rehydrate: ReturnType<typeof vi.fn> }).rehydrate
const getSeqCursorMock = (terminalOutputManager as unknown as { getSeqCursor: ReturnType<typeof vi.fn> }).getSeqCursor

describe('terminalRegistry stream flushing', () => {
  const rafHandles: number[] = []
  const originalRaf = global.requestAnimationFrame
  const originalCaf = global.cancelAnimationFrame

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(global as unknown as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = (cb: FrameRequestCallback) => {
      const handle = setTimeout(() => cb(performance.now()), 0) as unknown as number
      rafHandles.push(handle)
      return handle
    }
    ;(global as unknown as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = (handle: number) => {
      clearTimeout(handle as unknown as NodeJS.Timeout)
    }
  })

  afterEach(() => {
    ;(global as unknown as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = originalRaf
    ;(global as unknown as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = originalCaf
    rafHandles.splice(0, rafHandles.length)
    vi.useRealTimers()
  })

  it('batches and flushes pending chunks on animation frame', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('stream-test', factory)
    attachTerminalInstance('stream-test', document.createElement('div'))

    expect(addListenerMock).toHaveBeenCalledWith(
      'stream-test',
      expect.any(Function),
    )

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    // Simulate a rapid stream of chunks
    listener('a')
    listener('b')
    listener('c')

    // Nothing flushed until the next animation frame
    expect(rawWrite).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    // All chunks batched into single write
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('abc', expect.any(Function))

    removeTerminalInstance('stream-test')
  })

  it('clears pending chunks when clear sequence is detected', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('clear-test', factory)
    attachTerminalInstance('clear-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    // Simulate some output followed by a clear sequence
    listener('old content')
    listener('\x1b[3J') // Clear scrollback sequence

    await vi.runAllTimersAsync()

    // Only the clear sequence should be written (old content cleared)
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('\x1b[3J', expect.any(Function))

    removeTerminalInstance('clear-test')
  })

  it('tracks bracketed paste mode from output sequences (including split chunks)', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('paste-mode-test', factory)
    attachTerminalInstance('paste-mode-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(false)

    listener('\x1b[?20')
    listener('04h')
    await vi.runAllTimersAsync()
    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(true)

    listener('\x1b[?200')
    listener('4l')
    await vi.runAllTimersAsync()
    expect(isTerminalBracketedPasteEnabled('paste-mode-test')).toBe(false)

    removeTerminalInstance('paste-mode-test')
  })

  it('does not force scrollToBottom in alternate buffer', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'alternate',
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('alternate-buffer-test', factory)
    attachTerminalInstance('alternate-buffer-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('alternate-buffer-test')
  })

  it('does not force scrollToBottom when cursor is moved near bottom in normal buffer', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          rows: 10,
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
              cursorY: 8,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('cursor-move-test', factory)
    attachTerminalInstance('cursor-move-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('frame update')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('cursor-move-test')
  })

  it('does not follow output when shouldFollowOutput returns false', async () => {
    const scrollToBottom = vi.fn()
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom,
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-follow-test', factory)
    attachTerminalInstance('tui-follow-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(scrollToBottom).not.toHaveBeenCalled()

    removeTerminalInstance('tui-follow-test')
  })

  it('strips clear scrollback sequence in TUI mode to prevent viewport jumps', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-clear-test', factory)
    attachTerminalInstance('tui-clear-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('some content\x1b[3Jmore content')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('some contentmore content', expect.any(Function))

    removeTerminalInstance('tui-clear-test')
  })

  it('holds TUI clear-screen redraw until content arrives', async () => {
    const rawWrite = vi.fn()
    const rawWriteSync = vi.fn()
    const refresh = vi.fn()
    const forceScrollbarRefresh = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          writeSync: rawWriteSync,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
        forceScrollbarRefresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-deferral-test', factory)
    attachTerminalInstance('tui-deferral-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('\x1b[2J\x1b[H')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).not.toHaveBeenCalled()

    listener('hello')
    await vi.runOnlyPendingTimersAsync()

    expect(rawWrite).not.toHaveBeenCalled()
    expect(rawWriteSync).toHaveBeenCalledTimes(1)
    expect(rawWriteSync).toHaveBeenCalledWith('\x1b[?2026h\x1b[2J\x1b[Hhello\x1b[?2026l')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(forceScrollbarRefresh).toHaveBeenCalledTimes(1)

    removeTerminalInstance('tui-deferral-test')
  })

  it('does not start a second TUI write while the first one is still parsing', async () => {
    let pendingWriteCallback: (() => void) | undefined
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      pendingWriteCallback = cb as (() => void) | undefined
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-parse-barrier-test', factory)
    attachTerminalInstance('tui-parse-barrier-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('first')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    // Parsing still in flight (callback not invoked), second chunk should not trigger another write yet.
    listener('second')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    // Once parsing completes, the buffered chunk should flush.
    pendingWriteCallback?.()
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(2)

    removeTerminalInstance('tui-parse-barrier-test')
  })

  it('refreshes attached TUI terminals after callback-driven writes finish parsing', async () => {
    let pendingWriteCallback: (() => void) | undefined
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      pendingWriteCallback = cb as (() => void) | undefined
    })
    const refresh = vi.fn()
    const forceScrollbarRefresh = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
        forceScrollbarRefresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-refresh-after-write-test', factory)
    attachTerminalInstance('tui-refresh-after-write-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[addListenerMock.mock.calls.length - 1][1] as (chunk: string) => void

    listener('plain output')
    await vi.runOnlyPendingTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()

    pendingWriteCallback?.()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(forceScrollbarRefresh).toHaveBeenCalledTimes(1)

    removeTerminalInstance('tui-refresh-after-write-test')
  })

  it('fires output callbacks after write flush completes', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('output-test', factory)
    attachTerminalInstance('output-test', document.createElement('div'))

    const outCb = vi.fn()
    addTerminalOutputCallback('output-test', outCb)

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void
    listener('hello')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(outCb).not.toHaveBeenCalled()

    const writeCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    writeCallback()

    expect(outCb).toHaveBeenCalledTimes(1)

    removeTerminalOutputCallback('output-test', outCb)
    removeTerminalInstance('output-test')
  })

  it('drops detached top-terminal output instead of replaying it on attach', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('session-detach-buffer-top', factory)
    attachTerminalInstance('session-detach-buffer-top', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('a')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)
    const firstWriteCallback = rawWrite.mock.calls[0][1] as unknown as () => void
    firstWriteCallback()

    detachTerminalInstance('session-detach-buffer-top')

    listener('b')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    attachTerminalInstance('session-detach-buffer-top', document.createElement('div'))
    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)

    removeTerminalInstance('session-detach-buffer-top')
  })

  it('selects all output for existing terminals', () => {
    const selectAll = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          selectAll,
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('select-all-test', factory)
    expect(selectAllTerminal('select-all-test')).toBe(true)
    expect(selectAll).toHaveBeenCalledTimes(1)
    removeTerminalInstance('select-all-test')
  })

  it('returns false when selecting all for unknown terminal IDs', () => {
    expect(selectAllTerminal('missing-terminal')).toBe(false)
  })

  it('writes small payloads in a single call', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('small-payload-test', factory)
    attachTerminalInstance('small-payload-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    listener('small data')

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite).toHaveBeenCalledWith('small data', expect.any(Function))

    removeTerminalInstance('small-payload-test')
  })

  it('splits large payloads across multiple write calls', async () => {
    const writeCallbacks: Array<() => void> = []
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      if (typeof cb === 'function') {
        writeCallbacks.push(cb as () => void)
      }
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('large-payload-test', factory)
    attachTerminalInstance('large-payload-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[0][1] as (chunk: string) => void

    const largeChunk = 'x'.repeat(16 * 1024)
    listener(largeChunk)

    await vi.runAllTimersAsync()

    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite.mock.calls[0][0].length).toBe(8 * 1024)

    writeCallbacks[0]()
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(2)
    expect(rawWrite.mock.calls[1][0].length).toBe(8 * 1024)

    writeCallbacks[1]()

    const totalWritten = rawWrite.mock.calls.reduce((sum: number, call: unknown[]) => sum + (call[0] as string).length, 0)
    expect(totalWritten).toBe(16 * 1024)

    removeTerminalInstance('large-payload-test')
  })

  it('yields to the event loop between chunked writes', async () => {
    const writeCallbacks: Array<() => void> = []
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      if (typeof cb === 'function') {
        writeCallbacks.push(cb as () => void)
      }
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('yield-test', factory)
    attachTerminalInstance('yield-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[addListenerMock.mock.calls.length - 1][1] as (chunk: string) => void

    const largeChunk = 'x'.repeat(24 * 1024)
    listener(largeChunk)

    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    writeCallbacks[0]()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(2)

    writeCallbacks[1]()
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(3)

    writeCallbacks[2]()

    const totalWritten = rawWrite.mock.calls.reduce((sum: number, call: unknown[]) => sum + (call[0] as string).length, 0)
    expect(totalWritten).toBe(24 * 1024)

    removeTerminalInstance('yield-test')
  })

  it('defers flush when xterm parser is still processing previous write', async () => {
    const writeCallbacks: Array<() => void> = []
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      if (typeof cb === 'function') {
        writeCallbacks.push(cb as () => void)
      }
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('backpressure-test', factory)
    attachTerminalInstance('backpressure-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[addListenerMock.mock.calls.length - 1][1] as (chunk: string) => void

    listener('first batch')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)
    expect(rawWrite.mock.calls[0][0]).toBe('first batch')

    listener('second batch')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    writeCallbacks[0]()
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(2)
    expect(rawWrite.mock.calls[1][0]).toBe('second batch')

    removeTerminalInstance('backpressure-test')
  })

  it('continues large attached TUI writes as soon as the previous chunk finishes parsing', async () => {
    const writeCallbacks: Array<() => void> = []
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      if (typeof cb === 'function') {
        writeCallbacks.push(cb as () => void)
      }
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
              type: 'normal',
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('tui-large-payload-test', factory)
    attachTerminalInstance('tui-large-payload-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[addListenerMock.mock.calls.length - 1][1] as (chunk: string) => void

    listener('x'.repeat(24 * 1024))
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    writeCallbacks[0]?.()
    expect(rawWrite).toHaveBeenCalledTimes(2)

    removeTerminalInstance('tui-large-payload-test')
  })

  it('caps pending buffer for attached terminals under backpressure', async () => {
    const writeCallbacks: Array<() => void> = []
    const rawWrite = vi.fn((_data: string, cb?: unknown) => {
      if (typeof cb === 'function') {
        writeCallbacks.push(cb as () => void)
      }
    })
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('cap-test', factory)
    attachTerminalInstance('cap-test', document.createElement('div'))

    const listener = addListenerMock.mock.calls[addListenerMock.mock.calls.length - 1][1] as (chunk: string) => void

    listener('initial')
    await vi.runAllTimersAsync()
    expect(rawWrite).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 10; i++) {
      listener('x'.repeat(1024 * 1024))
    }

    writeCallbacks[0]()
    await vi.runAllTimersAsync()

    const totalWritten = rawWrite.mock.calls.reduce(
      (sum: number, call: unknown[]) => sum + (call[0] as string).length, 0,
    )
    expect(totalWritten).toBeLessThanOrEqual(4 * 1024 * 1024 + 128 * 1024)

    removeTerminalInstance('cap-test')
  })

  it('rehydrates on reattach of an existing terminal record', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 10,
              viewportY: 10,
            },
          },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('session-rehydrate-top', factory)
    attachTerminalInstance('session-rehydrate-top', document.createElement('div'))

    expect(ensureStartedMock).toHaveBeenCalledWith('session-rehydrate-top')
    expect(rehydrateMock).not.toHaveBeenCalled()

    detachTerminalInstance('session-rehydrate-top')

    attachTerminalInstance('session-rehydrate-top', document.createElement('div'))

    expect(rehydrateMock).toHaveBeenCalledWith('session-rehydrate-top', null)
    expect(rehydrateMock).toHaveBeenCalledTimes(1)

    removeTerminalInstance('session-rehydrate-top')
  })

  it('snapshots the dispatch cursor on detach and passes it as the rehydrate baseline', async () => {
    const factory = () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 10, viewportY: 10 } },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('session-cursor-snapshot-top', factory)
    attachTerminalInstance('session-cursor-snapshot-top', document.createElement('div'))

    getSeqCursorMock.mockReturnValueOnce(4096)
    detachTerminalInstance('session-cursor-snapshot-top')

    attachTerminalInstance('session-cursor-snapshot-top', document.createElement('div'))

    expect(rehydrateMock).toHaveBeenCalledWith('session-cursor-snapshot-top', 4096)
    expect(rehydrateMock).toHaveBeenCalledTimes(1)

    removeTerminalInstance('session-cursor-snapshot-top')
  })

  it('clears the snapshot after the reattach rehydrate fires', async () => {
    const factory = () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('session-cursor-clear-top', factory)
    attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))

    getSeqCursorMock.mockReturnValueOnce(1000)
    detachTerminalInstance('session-cursor-clear-top')
    attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))
    expect(rehydrateMock).toHaveBeenLastCalledWith('session-cursor-clear-top', 1000)

    getSeqCursorMock.mockReturnValueOnce(2500)
    detachTerminalInstance('session-cursor-clear-top')
    attachTerminalInstance('session-cursor-clear-top', document.createElement('div'))
    expect(rehydrateMock).toHaveBeenLastCalledWith('session-cursor-clear-top', 2500)
    expect(rehydrateMock).toHaveBeenCalledTimes(2)

    removeTerminalInstance('session-cursor-clear-top')
  })

  it('subscribes to the foreground bus and refreshes every attached xterm', async () => {
    const refreshA = vi.fn()
    const refreshB = vi.fn()

    const makeFactory = (refresh: () => void) => () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('foreground-a', makeFactory(refreshA))
    acquireTerminalInstance('foreground-b', makeFactory(refreshB))
    attachTerminalInstance('foreground-a', document.createElement('div'))
    attachTerminalInstance('foreground-b', document.createElement('div'))

    expect(foregroundSubscribeMock).toHaveBeenCalled()

    fireForeground()

    expect(refreshA).toHaveBeenCalledTimes(1)
    expect(refreshB).toHaveBeenCalledTimes(1)

    removeTerminalInstance('foreground-a')
    removeTerminalInstance('foreground-b')
  })

  it('does not refresh xterms that are currently detached on foreground transition', async () => {
    const refresh = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => false,
        isTuiMode: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('foreground-detached', factory)
    attachTerminalInstance('foreground-detached', document.createElement('div'))
    detachTerminalInstance('foreground-detached')

    fireForeground()
    expect(refresh).not.toHaveBeenCalled()

    removeTerminalInstance('foreground-detached')
  })

  it('swallows refresh errors so one bad xterm does not skip the rest', async () => {
    const refreshBad = vi.fn(() => { throw new Error('boom') })
    const refreshGood = vi.fn()
    const makeFactory = (refresh: () => void) => () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('foreground-bad', makeFactory(refreshBad))
    acquireTerminalInstance('foreground-good', makeFactory(refreshGood))
    attachTerminalInstance('foreground-bad', document.createElement('div'))
    attachTerminalInstance('foreground-good', document.createElement('div'))

    fireForeground()
    expect(refreshBad).toHaveBeenCalledTimes(1)
    expect(refreshGood).toHaveBeenCalledTimes(1)

    removeTerminalInstance('foreground-bad')
    removeTerminalInstance('foreground-good')
  })

  it('refreshes attached xterms when a project switch completes', async () => {
    const refresh = vi.fn()
    const factory = () =>
      ({
        raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('proj-rebind', factory)
    attachTerminalInstance('proj-rebind', document.createElement('div'))

    const detail: ProjectSwitchCompleteDetail = { projectPath: '/repo' }
    fireUiEvent(UiEvent.ProjectSwitchComplete, detail)

    expect(refresh).toHaveBeenCalledTimes(1)
    removeTerminalInstance('proj-rebind')
  })

  it('refreshes attached xterms when the selection changes to a session or orchestrator', async () => {
    const refresh = vi.fn()
    const factory = () =>
      ({
        raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh,
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('bottom-tab-survives', factory)
    attachTerminalInstance('bottom-tab-survives', document.createElement('div'))

    const sessionDetail: SelectionChangedDetail = { kind: 'session', payload: 's1', sessionState: 'running' }
    fireUiEvent(UiEvent.SelectionChanged, sessionDetail)
    expect(refresh).toHaveBeenCalledTimes(1)

    const orchDetail: SelectionChangedDetail = { kind: 'orchestrator', payload: 'orch' }
    fireUiEvent(UiEvent.SelectionChanged, orchDetail)
    expect(refresh).toHaveBeenCalledTimes(2)

    removeTerminalInstance('bottom-tab-survives')
  })

  it('tears down ui-event subscriptions when the registry empties', async () => {
    const factory = () =>
      ({
        raw: { write: vi.fn(), scrollToBottom: vi.fn(), buffer: { active: { baseY: 0, viewportY: 0 } } },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('cleanup-temp', factory)
    removeTerminalInstance('cleanup-temp')

    expect(() =>
      fireUiEvent(UiEvent.ProjectSwitchComplete, { projectPath: '/repo' } as ProjectSwitchCompleteDetail),
    ).not.toThrow()
  })

  it('does not snapshot a cursor for bottom (non-top) terminals', async () => {
    const factory = () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
        refresh: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('session-foo-bottom-0', factory)
    attachTerminalInstance('session-foo-bottom-0', document.createElement('div'))
    detachTerminalInstance('session-foo-bottom-0')
    attachTerminalInstance('session-foo-bottom-0', document.createElement('div'))

    expect(getSeqCursorMock).not.toHaveBeenCalled()
    expect(rehydrateMock).toHaveBeenCalledWith('session-foo-bottom-0', null)

    removeTerminalInstance('session-foo-bottom-0')
  })

  it('does not rehydrate on first attach of a brand new terminal', async () => {
    const rawWrite = vi.fn()
    const factory = () =>
      ({
        raw: {
          write: rawWrite,
          scrollToBottom: vi.fn(),
          buffer: {
            active: {
              baseY: 0,
              viewportY: 0,
            },
          },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal)

    acquireTerminalInstance('fresh-terminal-test', factory)
    attachTerminalInstance('fresh-terminal-test', document.createElement('div'))

    expect(ensureStartedMock).toHaveBeenCalledWith('fresh-terminal-test')
    expect(rehydrateMock).not.toHaveBeenCalled()

    removeTerminalInstance('fresh-terminal-test')
  })

  it('does not call RefreshTerminalView on the very first attach', () => {
    const id = 'session-fresh~aaaaaaaa-top'
    acquireTerminalInstance(id, () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal),
    )

    attachTerminalInstance(id, document.createElement('div'))

    expect(invokeMock).not.toHaveBeenCalledWith(TauriCommands.RefreshTerminalView, expect.anything())
    removeTerminalInstance(id)
  })

  it('calls RefreshTerminalView on reattach of a top terminal', () => {
    const id = 'session-reattach~bbbbbbbb-top'
    acquireTerminalInstance(id, () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal),
    )

    attachTerminalInstance(id, document.createElement('div'))
    detachTerminalInstance(id)
    invokeMock.mockClear()
    attachTerminalInstance(id, document.createElement('div'))

    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.RefreshTerminalView, { id })
    removeTerminalInstance(id)
  })

  it('does not call RefreshTerminalView for a non-top terminal on reattach', () => {
    const id = 'session-bottom~cccccccc-bottom'
    acquireTerminalInstance(id, () =>
      ({
        raw: {
          write: vi.fn(),
          scrollToBottom: vi.fn(),
          buffer: { active: { baseY: 0, viewportY: 0 } },
        },
        shouldFollowOutput: () => true,
        isTuiMode: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        dispose: vi.fn(),
      } as unknown as import('../xterm/XtermTerminal').XtermTerminal),
    )

    attachTerminalInstance(id, document.createElement('div'))
    detachTerminalInstance(id)
    invokeMock.mockClear()
    attachTerminalInstance(id, document.createElement('div'))

    expect(invokeMock).not.toHaveBeenCalledWith(TauriCommands.RefreshTerminalView, expect.anything())
    removeTerminalInstance(id)
  })
})
