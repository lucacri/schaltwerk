import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { MockedFunction } from 'vitest'
import { createStore } from 'jotai'
import {
  projectPathAtom,
  projectTabsAtom,
  openProjectActionAtom,
  selectProjectActionAtom,
  closeProjectActionAtom,
  __resetProjectsTestingState,
} from './project'
import { resetSelectionAtomsForTest } from './selection'
import { __resetSessionsTestingState } from './sessions'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('../../terminal/transport/backend', () => ({
  createTerminalBackend: vi.fn(() => Promise.resolve()),
  closeTerminalBackend: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../terminal/registry/terminalRegistry', () => ({
  hasTerminalInstance: vi.fn(() => false),
  removeTerminalInstance: vi.fn(),
}))

vi.mock('../../components/terminal/Terminal', () => ({
  clearTerminalStartedTracking: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('project lifecycle atoms', () => {
  let store: ReturnType<typeof createStore>
  type InvokeFn = typeof import('@tauri-apps/api/core')['invoke']
  type InvokeArgsType = Parameters<InvokeFn>[1]
  let invoke: MockedFunction<InvokeFn>

  beforeEach(async () => {
    __resetProjectsTestingState()
    resetSelectionAtomsForTest()
    __resetSessionsTestingState()
    store = createStore()

    const core = await import('@tauri-apps/api/core')
    invoke = vi.mocked(core.invoke)
    invoke.mockReset()
    invoke.mockImplementation(async command => {
      switch (command) {
        case TauriCommands.InitializeProject:
        case TauriCommands.AddRecentProject:
        case TauriCommands.CloseProject:
          return null
        case TauriCommands.DirectoryExists:
        case TauriCommands.PathExists:
          return true
        case TauriCommands.TerminalExists:
          return false
        default:
          return null
      }
    })
  })

  it('defaults project path to null', () => {
    expect(store.get(projectPathAtom)).toBeNull()
  })

  it('opens a project, adds a tab, and focuses it', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })

    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toMatchObject([
      {
        projectPath: '/repo/alpha',
        projectName: 'alpha',
        status: 'ready',
      },
    ])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
    expect(invoke).toHaveBeenCalledWith(TauriCommands.AddRecentProject, { path: '/repo/alpha' })
  })

  it('avoids reinitializing when opening the already active project', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    invoke.mockClear()

    await store.set(openProjectActionAtom, { path: '/repo/alpha' })

    expect(invoke).not.toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
  })

  it('selects an existing project without duplicating tabs', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    invoke.mockClear()

    await store.set(selectProjectActionAtom, { path: '/repo/alpha' })

    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toHaveLength(2)
    expect(invoke).toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
  })

  it('closes the active project and activates the fallback tab', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    invoke.mockClear()

    const result = await store.set(closeProjectActionAtom, { path: '/repo/beta' })

    expect(result.nextActivePath).toBe('/repo/alpha')
    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toMatchObject([
      { projectPath: '/repo/alpha', status: 'ready' },
    ])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.CloseProject, { path: '/repo/beta' })
  })

  it('closes the last project and clears the active path', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/solo' })
    invoke.mockClear()

    const result = await store.set(closeProjectActionAtom, { path: '/repo/solo' })

    expect(result.nextActivePath).toBeNull()
    expect(store.get(projectPathAtom)).toBeNull()
    expect(store.get(projectTabsAtom)).toHaveLength(0)
    expect(invoke).toHaveBeenCalledWith(TauriCommands.CloseProject, { path: '/repo/solo' })
  })

  it('removes the tab immediately while the backend close is pending', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/solo' })
    invoke.mockClear()

    const closeDeferred = deferredPromise()

    invoke.mockImplementation(async (command, args?: InvokeArgsType) => {
      if (command === TauriCommands.CloseProject) {
        const pathArg = (args as { path?: string } | undefined)?.path
        if (pathArg === '/repo/solo') {
          return closeDeferred.promise
        }
      }
      return null
    })

    const closePromise = store.set(closeProjectActionAtom, { path: '/repo/solo' })

    expect(store.get(projectTabsAtom)).toHaveLength(0)

    closeDeferred.resolve()

    const result = await closePromise
    expect(result.closed).toBe(true)
  })

  it('marks a tab as errored when initialization fails', async () => {
    const ignoreBoom = (reason: unknown) => {
      if (reason instanceof Error && reason.message === 'boom') {
        return
      }
      throw reason
    }
    process.on('unhandledRejection', ignoreBoom)
    try {
      invoke.mockImplementation(async command => {
        if (command === TauriCommands.InitializeProject) {
          return Promise.resolve().then(() => {
            throw new Error('boom')
          })
        }
        return null
      })

      const result = await store.set(openProjectActionAtom, { path: '/repo/broken' })

      expect(result).toBe(false)
      expect(store.get(projectPathAtom)).toBeNull()
      expect(store.get(projectTabsAtom)).toMatchObject([
        {
          projectPath: '/repo/broken',
          status: 'error',
        },
      ])
    } finally {
      process.off('unhandledRejection', ignoreBoom)
    }
  })

  it('ignores duplicate project selections while a switch is in flight', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/shared' })
    invoke.mockClear()

    const first = store.set(selectProjectActionAtom, { path: '/repo/shared' })
    const second = store.set(selectProjectActionAtom, { path: '/repo/shared' })

    await first
    await second
    expect(store.get(projectPathAtom)).toBe('/repo/shared')
    expect(invoke).not.toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/shared' })
  })

  it('queues sequential project switches to avoid overlapping initialization', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/base' })
    invoke.mockClear()

    const firstSwitch = deferredPromise()
    const secondSwitch = deferredPromise()

    invoke.mockImplementation(async (command, args?: InvokeArgsType) => {
      const pathArg = (args as { path?: string } | undefined)?.path
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/one') {
        return firstSwitch.promise
      }
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/two') {
        return secondSwitch.promise
      }
      return null
    })

    const first = store.set(selectProjectActionAtom, { path: '/repo/one' })
    const second = store.set(selectProjectActionAtom, { path: '/repo/two' })

    await flushMicrotask()
    expect(initializeCalls(invoke)[0]?.[1]).toEqual({ path: '/repo/one' })
    expect(initializeCalls(invoke).some(([, args]) => args?.path === '/repo/two')).toBe(false)

    firstSwitch.resolve()
    await first
    await flushMicrotask()

    expect(initializeCalls(invoke).some(([, args]) => args?.path === '/repo/two')).toBe(true)

    secondSwitch.resolve()
    await second
    expect(store.get(projectPathAtom)).toBe('/repo/two')
  })

  it('keeps previous project orchestrator terminals alive after opening a new project', async () => {
    const backend = await import('../../terminal/transport/backend')

    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    vi.mocked(backend.closeTerminalBackend).mockClear()

    await store.set(openProjectActionAtom, { path: '/repo/beta' })

    expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalled()
  })

  it('keeps queued project orchestrators alive when the active project changes before execution', async () => {
    const backend = await import('../../terminal/transport/backend')

    await store.set(openProjectActionAtom, { path: '/repo/base' })
    await store.set(openProjectActionAtom, { path: '/repo/two' })
    await store.set(selectProjectActionAtom, { path: '/repo/base' })

    const firstSwitch = deferredPromise()
    const secondSwitch = deferredPromise()
    invoke.mockImplementation(async (command, args?: InvokeArgsType) => {
      const pathArg = (args as { path?: string } | undefined)?.path
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/one') {
        return firstSwitch.promise
      }
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/two') {
        return secondSwitch.promise
      }
      if (command === TauriCommands.InitializeProject) {
        return null
      }
      if (command === TauriCommands.DirectoryExists || command === TauriCommands.PathExists) {
        return true
      }
      if (command === TauriCommands.TerminalExists) {
        return false
      }
      return null
    })

    const first = store.set(openProjectActionAtom, { path: '/repo/one' })
    const queuedSwitch = store.set(selectProjectActionAtom, { path: '/repo/two' })

    await flushMicrotask()
    firstSwitch.resolve()
    await first
    await flushMicrotask()

    vi.mocked(backend.closeTerminalBackend).mockClear()

    secondSwitch.resolve()
    await queuedSwitch

    expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalled()
  })

  it('cleans up project orchestrator terminals when closing a project', async () => {
    const backend = await import('../../terminal/transport/backend')

    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    vi.mocked(backend.closeTerminalBackend).mockClear()

    await store.set(closeProjectActionAtom, { path: '/repo/alpha' })

    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^orchestrator-alpha-[0-9a-f]{1,6}-top$/),
    )
    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^orchestrator-alpha-[0-9a-f]{1,6}-bottom$/),
    )
  })

  it('cleans up only the closed project orchestrator when closing an inactive project', async () => {
    const backend = await import('../../terminal/transport/backend')

    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    vi.mocked(backend.closeTerminalBackend).mockClear()

    await store.set(closeProjectActionAtom, { path: '/repo/alpha' })

    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^orchestrator-alpha-[0-9a-f]{1,6}-top$/),
    )
    expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^orchestrator-alpha-[0-9a-f]{1,6}-bottom$/),
    )
    expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalledWith(
      expect.stringMatching(/^orchestrator-beta-[0-9a-f]{1,6}-top$/),
    )
    expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalledWith(
      expect.stringMatching(/^orchestrator-beta-[0-9a-f]{1,6}-bottom$/),
    )
  })

  it('deduplicates concurrent openProject calls for the same path during initial open', async () => {
    const switchPromise = deferredPromise()

    invoke.mockImplementation(async (command, args?: InvokeArgsType) => {
      const pathArg = (args as { path?: string } | undefined)?.path
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/shared') {
        return switchPromise.promise
      }
      return null
    })

    const first = store.set(openProjectActionAtom, { path: '/repo/shared' })
    const second = store.set(openProjectActionAtom, { path: '/repo/shared' })

    await flushMicrotask()
    expect(initializeCalls(invoke)).toHaveLength(1)

    switchPromise.resolve()
    await first
    await second

    expect(store.get(projectPathAtom)).toBe('/repo/shared')
    expect(initializeCalls(invoke)).toHaveLength(1)
  })

  it('saves open tabs state after opening a project', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await flushMicrotask()

    const calls = saveTabsCalls(invoke)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toEqual({ tabs: ['/repo/alpha'], active: '/repo/alpha' })
  })

  it('saves open tabs state with all tabs after opening multiple projects', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    await flushMicrotask()

    const calls = saveTabsCalls(invoke)
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[1]).toEqual({ tabs: ['/repo/alpha', '/repo/beta'], active: '/repo/beta' })
  })

  it('saves open tabs state after closing a project', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    await store.set(closeProjectActionAtom, { path: '/repo/beta' })
    await flushMicrotask()

    const calls = saveTabsCalls(invoke)
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[1]).toEqual({ tabs: ['/repo/alpha'], active: '/repo/alpha' })
  })

  it('saves open tabs state after selecting a different project', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    invoke.mockClear()

    await store.set(selectProjectActionAtom, { path: '/repo/alpha' })
    await flushMicrotask()

    const calls = saveTabsCalls(invoke)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toEqual({ tabs: ['/repo/alpha', '/repo/beta'], active: '/repo/alpha' })
  })
})

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

async function flushMicrotask() {
  await Promise.resolve()
}

function initializeCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([command]) => command === TauriCommands.InitializeProject)
}

function saveTabsCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([command]) => command === TauriCommands.SaveOpenTabsState)
}
