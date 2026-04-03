import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MCPConfigPanel } from '../MCPConfigPanel'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('MCPConfigPanel', () => {
  const invokeMock = vi.mocked(invoke)
  const openCodeStatus = {
    mcp_server_path:
      '/Applications/Lucode.app/Contents/Resources/mcp-server/build/lucode-mcp-server.js',
    is_embedded: true,
    cli_available: true,
    node_command: '/Users/example/.local/bin/node',
    client: 'opencode',
    is_configured: true,
    setup_command:
      'Add to opencode.json in the project root:\n{\n  "mcp": {\n    "lucode": {\n      "type": "local",\n      "command": ["node", "/Applications/Lucode.app/Contents/Resources/mcp-server/build/lucode-mcp-server.js"],\n      "enabled": true\n    }\n  }\n}',
    project_path: '/Users/example/project',
    node_available: true
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('shows Node.js installation warning when Node.js is unavailable', async () => {
    invokeMock.mockImplementation((command, _args) => {
      if (command === TauriCommands.GetMcpStatus) {
        return Promise.resolve({
          mcp_server_path: '/Applications/Lucode.app/Contents/Resources/mcp-server/build/lucode-mcp-server.js',
          is_embedded: true,
          cli_available: true,
          node_command: '/Users/example/.local/state/fnm_multishells/node',
          client: 'codex',
          is_configured: true,
          setup_command: 'node /Applications/Lucode.app/Contents/Resources/mcp-server/build/lucode-mcp-server.js',
          project_path: '/Users/example/project',
          node_available: false
        }) as ReturnType<typeof invoke>
      }

      return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
        typeof invoke
      >
    })

    render(<MCPConfigPanel projectPath="/Users/example/project" agent="codex" />)

    await waitFor(() =>
      expect(
        screen.getByText('Node.js is required to run the Lucode MCP server.')
      ).toBeInTheDocument()
    )

    expect(
      screen.getByText('Install Node.js and restart Codex to enable MCP tools.')
    ).toBeInTheDocument()
  })

  test('shows the canonical OpenCode manual setup snippet for the project root config', async () => {
    invokeMock.mockImplementation((command, _args) => {
      if (command === TauriCommands.GetMcpStatus) {
        return Promise.resolve(openCodeStatus) as ReturnType<typeof invoke>
      }

      return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
        typeof invoke
      >
    })

    render(<MCPConfigPanel projectPath="/Users/example/project" agent="opencode" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Manual Setup' })).toBeInTheDocument()
    )

    await userEvent.click(screen.getByRole('button', { name: 'Manual Setup' }))

    expect(screen.getByText('Add to opencode.json in the project root:')).toBeInTheDocument()

    const snippet = screen.getByText((_, element) => {
      return (
        element?.tagName === 'CODE' &&
        element.textContent?.includes('"lucode"') === true &&
        element.textContent?.includes('"command": ["node",') === true &&
        element.textContent?.includes('"type": "local"') === true
      )
    })

    expect(snippet).toBeInTheDocument()
    expect(snippet.textContent).not.toContain('schaltwerk')
  })

  test('explains that Lucode manages the project-local OpenCode config file', async () => {
    invokeMock.mockImplementation((command, _args) => {
      if (command === TauriCommands.GetMcpStatus) {
        return Promise.resolve(openCodeStatus) as ReturnType<typeof invoke>
      }

      return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
        typeof invoke
      >
    })

    render(<MCPConfigPanel projectPath="/Users/example/project" agent="opencode" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Manual Setup' })).toBeInTheDocument()
    )

    await userEvent.click(screen.getByRole('button', { name: 'Manual Setup' }))

    expect(
      screen.getByText(
        'Lucode writes this project-local config to opencode.json. OpenCode also merges ~/.config/opencode/opencode.json on startup, but project config takes precedence for this repo.'
      )
    ).toBeInTheDocument()
  })
})
