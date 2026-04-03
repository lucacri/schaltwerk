import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { EditorOverridesSettings } from '../EditorOverridesSettings'
import { TauriCommands } from '../../../common/tauriCommands'

describe('EditorOverridesSettings', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('labels the add-override fields for keyboard and screen-reader access', async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.GetEditorOverrides:
          return Promise.resolve({}) as ReturnType<typeof invoke>
        case TauriCommands.ListAvailableOpenApps:
          return Promise.resolve([
            { id: 'zed', name: 'Zed', kind: 'editor' },
            { id: 'cursor', name: 'Cursor', kind: 'editor' },
          ]) as ReturnType<typeof invoke>
        default:
          return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
            typeof invoke
          >
      }
    })

    render(<EditorOverridesSettings onNotification={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Extension')).toBeInTheDocument()
    })

    expect(screen.getByRole('combobox', { name: 'Editor' })).toBeInTheDocument()
  })
})
