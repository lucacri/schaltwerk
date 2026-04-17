import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../../common/eventSystem'
import { ResizableModal } from '../shared/ResizableModal'
import { Button } from '../ui/Button'
import { typography } from '../../common/typography'
import { logger } from '../../utils/logger'
import type { TmuxPaneInfo, TmuxServerInfo, TmuxSessionInfo } from '../../types/tmuxInspect'

interface ViewProcessesModalProps {
  initiallyOpen?: boolean
}

function formatTimestamp(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown'
  return new Date(value * 1000).toLocaleString()
}

function formatMiB(rssKb: number | null): string {
  if (rssKb == null) return '—'
  return (rssKb / 1024).toFixed(1)
}

function formatCpu(cpuPercent: number | null): string {
  if (cpuPercent == null) return '—'
  return cpuPercent.toFixed(1)
}

function ServerHeader({ server }: { server: TmuxServerInfo }) {
  const title = server.project_name ?? `Unknown project (${server.project_hash})`
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div style={{ ...typography.heading, color: 'var(--color-text-primary)' }}>
          {title}
        </div>
        {server.project_path && (
          <div
            className="truncate"
            style={{ ...typography.caption, color: 'var(--color-text-secondary)' }}
            title={server.project_path}
          >
            {server.project_path}
          </div>
        )}
        <div
          className="truncate"
          style={{ ...typography.code, color: 'var(--color-text-tertiary)' }}
          title={server.socket_path}
        >
          {server.socket_name}
        </div>
      </div>
      {server.is_stale && (
        <span
          className="rounded px-2 py-0.5 shrink-0"
          style={{
            ...typography.caption,
            backgroundColor: 'var(--color-accent-amber-bg)',
            color: 'var(--color-accent-amber)',
            border: '1px solid var(--color-accent-amber-border)',
          }}
        >
          Stale
        </span>
      )}
    </div>
  )
}

function SessionBlock({ session }: { session: TmuxSessionInfo }) {
  return (
    <div
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--color-border-subtle)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="truncate"
            style={{ ...typography.bodyLarge, color: 'var(--color-text-primary)' }}
          >
            {session.name}
          </div>
          <div style={{ ...typography.caption, color: 'var(--color-text-tertiary)' }}>
            Created {formatTimestamp(session.created_unix)} · Activity{' '}
            {formatTimestamp(session.last_activity_unix)}
          </div>
        </div>
        <span
          className="rounded px-2 py-0.5 shrink-0"
          style={{
            ...typography.caption,
            backgroundColor: session.attached
              ? 'var(--color-accent-green-bg)'
              : 'var(--color-bg-tertiary)',
            color: session.attached
              ? 'var(--color-accent-green)'
              : 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          {session.attached ? 'Attached' : 'Detached'}
        </span>
      </div>
      {session.panes.length > 0 && (
        <table className="w-full" style={{ ...typography.caption, color: 'var(--color-text-secondary)' }}>
          <thead>
            <tr>
              <th className="text-left">Command</th>
              <th className="text-right">PID</th>
              <th className="text-right">RSS (MiB)</th>
              <th className="text-right">CPU %</th>
            </tr>
          </thead>
          <tbody>
            {session.panes.map(pane => (
              <PaneRow key={pane.pane_id} pane={pane} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PaneRow({ pane }: { pane: TmuxPaneInfo }) {
  return (
    <tr>
      <td style={{ ...typography.code, color: 'var(--color-text-primary)' }}>{pane.command}</td>
      <td className="text-right" style={typography.code}>{pane.pid}</td>
      <td className="text-right">{formatMiB(pane.rss_kb)}</td>
      <td className="text-right">{formatCpu(pane.cpu_percent)}</td>
    </tr>
  )
}

export function ViewProcessesModal({ initiallyOpen = false }: ViewProcessesModalProps) {
  const [open, setOpen] = useState(initiallyOpen)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TmuxServerInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const servers = await invoke<TmuxServerInfo[]>(TauriCommands.ListLucodeTmuxServers)
      setData(servers)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      logger.warn('[ViewProcessesModal] list_lucode_tmux_servers failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false
    void listenEvent(SchaltEvent.ViewProcessesRequested, () => {
      setOpen(true)
      void refresh()
    }).then(fn => {
      if (cancelled) {
        fn()
      } else {
        unsub = fn
      }
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [refresh])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  return (
    <ResizableModal
      isOpen={open}
      onClose={() => setOpen(false)}
      title="View Processes"
      storageKey="view-processes"
      defaultWidth={820}
      defaultHeight={620}
      minWidth={560}
      minHeight={400}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0" style={{ ...typography.body, color: 'var(--color-text-secondary)' }}>
            Lucode-owned tmux servers and pane processes.
          </p>
          <Button onClick={() => void refresh()} loading={loading} size="sm">
            Refresh
          </Button>
        </div>
        {error ? (
          <div
            className="rounded p-3"
            style={{
              ...typography.body,
              backgroundColor: 'var(--color-accent-red-bg)',
              color: 'var(--color-accent-red)',
              border: '1px solid var(--color-accent-red-border)',
            }}
          >
            {error}
          </div>
        ) : data && data.length === 0 ? (
          <div style={{ ...typography.body, color: 'var(--color-text-secondary)' }}>
            No Lucode tmux servers running.
          </div>
        ) : data && data.length > 0 ? (
          <div className="flex flex-col gap-3 overflow-y-auto pb-2">
            {data.map(server => (
              <section
                key={server.socket_name}
                className="flex flex-col gap-3 rounded p-3"
                style={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border-default)',
                }}
              >
                <ServerHeader server={server} />
                {server.error && (
                  <div
                    className="rounded p-2"
                    style={{
                      ...typography.caption,
                      backgroundColor: 'var(--color-accent-amber-bg)',
                      color: 'var(--color-accent-amber)',
                      border: '1px solid var(--color-accent-amber-border)',
                    }}
                  >
                    {server.error}
                  </div>
                )}
                {!server.is_stale && server.sessions.length === 0 && (
                  <div
                    style={{ ...typography.body, color: 'var(--color-text-secondary)' }}
                  >
                    No tmux sessions reported.
                  </div>
                )}
                {server.sessions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {server.sessions.map(session => (
                      <SessionBlock key={session.name} session={session} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </ResizableModal>
  )
}
