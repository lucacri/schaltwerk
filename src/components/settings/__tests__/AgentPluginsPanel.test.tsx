import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { AgentPluginsPanel } from '../AgentPluginsPanel'
import { TauriCommands } from '../../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('AgentPluginsPanel', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders nothing for non-claude agents', () => {
    invokeMock.mockResolvedValue({ claudeLucodeTerminalHooks: true })
    const { container } = render(<AgentPluginsPanel agent="codex" />)
    expect(container.firstChild).toBeNull()
  })

  test('loads the current config and reflects it in the checkbox', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === TauriCommands.GetProjectAgentPluginConfig) {
        return Promise.resolve({ claudeLucodeTerminalHooks: false }) as ReturnType<typeof invoke>
      }
      return Promise.reject(new Error(`unexpected ${String(cmd)}`)) as ReturnType<typeof invoke>
    })

    render(<AgentPluginsPanel agent="claude" />)

    const checkbox = await screen.findByRole('checkbox', { name: /Enable plugin/i })
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  test('persists a toggle change via SetProjectAgentPluginConfig', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === TauriCommands.GetProjectAgentPluginConfig) {
        return Promise.resolve({ claudeLucodeTerminalHooks: true }) as ReturnType<typeof invoke>
      }
      if (cmd === TauriCommands.SetProjectAgentPluginConfig) {
        return Promise.resolve(null) as ReturnType<typeof invoke>
      }
      return Promise.reject(new Error(`unexpected ${String(cmd)}`)) as ReturnType<typeof invoke>
    })

    render(<AgentPluginsPanel agent="claude" />)

    const checkbox = await screen.findByRole('checkbox', { name: /Enable plugin/i })
    await waitFor(() => expect(checkbox).toBeChecked())

    await userEvent.click(checkbox)

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SetProjectAgentPluginConfig, {
        config: { claudeLucodeTerminalHooks: false },
      })
    )
  })

  test('surfaces error when saving fails', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === TauriCommands.GetProjectAgentPluginConfig) {
        return Promise.resolve({ claudeLucodeTerminalHooks: true }) as ReturnType<typeof invoke>
      }
      if (cmd === TauriCommands.SetProjectAgentPluginConfig) {
        return Promise.reject(new Error('backend blew up')) as ReturnType<typeof invoke>
      }
      return Promise.reject(new Error(`unexpected ${String(cmd)}`)) as ReturnType<typeof invoke>
    })

    render(<AgentPluginsPanel agent="claude" />)
    const checkbox = await screen.findByRole('checkbox', { name: /Enable plugin/i })
    await waitFor(() => expect(checkbox).toBeChecked())

    await userEvent.click(checkbox)

    expect(await screen.findByRole('alert')).toHaveTextContent(/backend blew up/)
  })
})
