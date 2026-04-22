import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { OpenInSplitButton } from './OpenInSplitButton'
import { TauriCommands } from '../common/tauriCommands'
import { TestProviders } from '../tests/test-utils'
import { emitUiEvent, UiEvent } from '../common/uiEvents'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('OpenInSplitButton', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens with the canonical backend default even when it is not the first visible app', async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.ListAvailableOpenApps:
          return Promise.resolve([
            { id: 'vscode', name: 'VS Code', kind: 'editor' },
            { id: 'phpstorm', name: 'PhpStorm', kind: 'editor' },
          ]) as ReturnType<typeof invoke>
        case TauriCommands.GetDefaultOpenApp:
          return Promise.resolve('phpstorm') as ReturnType<typeof invoke>
        case TauriCommands.OpenInApp:
          return Promise.resolve(undefined) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
            typeof invoke
          >
      }
    })

    render(
      <TestProviders>
        <OpenInSplitButton resolvePath={() => Promise.resolve('/tmp/worktree')} />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /open/i }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.OpenInApp, expect.objectContaining({
        appId: 'phpstorm',
        worktreeRoot: '/tmp/worktree',
      }))
    })
  })

  test('reloads the visible app catalog after open-app settings change events', async () => {
    let catalogVersion = 0
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.ListAvailableOpenApps:
          return Promise.resolve(
            catalogVersion === 0
              ? [
                  { id: 'vscode', name: 'VS Code', kind: 'editor' },
                  { id: 'phpstorm', name: 'PhpStorm', kind: 'editor' },
                ]
              : [{ id: 'phpstorm', name: 'PhpStorm', kind: 'editor' }]
          ) as ReturnType<typeof invoke>
        case TauriCommands.GetDefaultOpenApp:
          return Promise.resolve(catalogVersion === 0 ? 'vscode' : 'phpstorm') as ReturnType<typeof invoke>
        case TauriCommands.OpenInApp:
          return Promise.resolve(undefined) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
            typeof invoke
          >
      }
    })

    render(
      <TestProviders>
        <OpenInSplitButton resolvePath={() => Promise.resolve('/tmp/worktree')} />
      </TestProviders>
    )

    await screen.findByRole('button', { name: /open/i })

    catalogVersion = 1
    emitUiEvent(UiEvent.OpenAppsUpdated)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open/i })).toHaveAttribute('title', 'Open in PhpStorm')
    })

    fireEvent.click(screen.getByRole('button', { name: /open/i }))

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.OpenInApp, expect.objectContaining({
        appId: 'phpstorm',
        worktreeRoot: '/tmp/worktree',
      }))
    })
  })
})
