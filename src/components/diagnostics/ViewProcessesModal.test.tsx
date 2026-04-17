import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ViewProcessesModal } from './ViewProcessesModal'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../common/eventSystem', () => ({
  SchaltEvent: { ViewProcessesRequested: 'schaltwerk:view-processes-requested' },
  listenEvent: vi.fn(async () => () => {}),
}))

const { invoke } = await import('@tauri-apps/api/core')
const mockInvoke = vi.mocked(invoke)

describe('ViewProcessesModal', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders empty state when no servers are returned', async () => {
    mockInvoke.mockResolvedValueOnce([])
    render(<ViewProcessesModal initiallyOpen />)
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('list_lucode_tmux_servers')
    )
    expect(await screen.findByText(/no lucode tmux servers running/i)).toBeInTheDocument()
  })

  it('renders server with project name, session, and pane rows', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        socket_name: 'lucode-v2-aaaa',
        project_hash: 'aaaa',
        project_path: '/Users/me/proj',
        project_name: 'proj',
        socket_path: '/tmp/tmux-501/lucode-v2-aaaa',
        is_stale: false,
        error: null,
        sessions: [
          {
            name: 'main',
            created_unix: 1700000000,
            last_activity_unix: 1700000100,
            attached: true,
            panes: [
              {
                session_name: 'main',
                pane_id: '%0',
                pid: 42,
                command: 'zsh',
                rss_kb: 12345,
                cpu_percent: 1.5,
              },
            ],
          },
        ],
      },
    ])
    render(<ViewProcessesModal initiallyOpen />)
    expect(await screen.findByText('proj')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('zsh')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('marks stale servers with a Stale badge', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        socket_name: 'lucode-v2-stale',
        project_hash: 'stale',
        project_path: null,
        project_name: null,
        socket_path: '/tmp/tmux-501/lucode-v2-stale',
        is_stale: true,
        error: null,
        sessions: [],
      },
    ])
    render(<ViewProcessesModal initiallyOpen />)
    expect(await screen.findByText(/^stale$/i)).toBeInTheDocument()
    expect(screen.getByText(/Unknown project \(stale\)/)).toBeInTheDocument()
  })

  it('refresh button re-invokes the command', async () => {
    mockInvoke.mockResolvedValue([])
    render(<ViewProcessesModal initiallyOpen />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1))
    const btn = await screen.findByRole('button', { name: /refresh/i })
    fireEvent.click(btn)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))
  })

  it('Escape key closes the modal', async () => {
    mockInvoke.mockResolvedValue([])
    render(<ViewProcessesModal initiallyOpen />)
    expect(await screen.findByText(/lucode-owned tmux servers/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByText(/lucode-owned tmux servers/i)).not.toBeInTheDocument()
    )
  })

  it('renders error state when invoke rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('tmux not installed'))
    render(<ViewProcessesModal initiallyOpen />)
    expect(await screen.findByText(/tmux not installed/)).toBeInTheDocument()
  })
})
