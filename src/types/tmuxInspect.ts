export interface TmuxPaneInfo {
  session_name: string
  pane_id: string
  pid: number
  command: string
  rss_kb: number | null
  cpu_percent: number | null
}

export interface TmuxSessionInfo {
  name: string
  created_unix: number | null
  last_activity_unix: number | null
  attached: boolean
  panes: TmuxPaneInfo[]
}

export interface TmuxServerInfo {
  socket_name: string
  project_hash: string
  project_path: string | null
  project_name: string | null
  socket_path: string
  is_stale: boolean
  error: string | null
  sessions: TmuxSessionInfo[]
}
