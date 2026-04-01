/* eslint-disable @typescript-eslint/no-explicit-any */
import { mockSessions, mockEpics } from './mockData'

// ── @tauri-apps/api/core stubs ──────────────────────────────────────────────

export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const handlers: Record<string, () => unknown> = {
    // Session management
    'schaltwerk_core_list_enriched_sessions': () => mockSessions,
    'lucode_core_list_sessions': () => [],
    'schaltwerk_core_mark_session_ready': () => ({}),
    'schaltwerk_core_unmark_session_ready': () => ({}),
    'schaltwerk_core_rename_session_display_name': () => ({}),
    'schaltwerk_core_link_session_to_pr': () => ({}),
    'lucode_core_mark_session_ready': () => ({}),
    'lucode_core_unmark_session_ready': () => ({}),
    'lucode_core_rename_session_display_name': () => ({}),
    'lucode_core_link_session_to_pr': () => ({}),
    'lucode_core_cancel_session': () => ({}),
    'lucode_core_remove_session': () => ({}),
    'lucode_core_convert_to_spec': () => ({}),
    'lucode_core_start_spec_session': () => ({}),
    'lucode_core_update_spec_content': () => ({}),
    'restart_session_terminals': () => ({}),

    // Git operations
    'get_base_branch_name': () => 'main',
    'get_current_branch_name': () => 'main',
    'get_changed_files_from_main': () => [],
    'has_remote_tracking_branch': () => false,

    // Settings
    'get_settings': () => ({
      theme: 'dark',
      language: 'en',
      font_size: 14,
      terminal_font_size: 14,
      terminal_font_family: null,
    }),
    'get_font_sizes': () => ({ terminal: 14, ui: 14 }),
    'lucode_core_set_font_sizes': () => ({}),
    'get_keyboard_shortcuts': () => ({}),
    'get_agent_preferences': () => ({}),
    'get_agent_presets': () => [],
    'get_agent_variants': () => [],
    'get_all_agent_binary_configs': () => ({}),
    'get_agent_binary_config': () => null,
    'get_agent_cli_args': () => [],
    'get_agent_env_vars': () => ({}),
    'get_contextual_actions': () => [],
    'get_default_generation_prompts': () => ({}),
    'get_generation_settings': () => ({}),
    'get_editor_overrides': () => ({}),
    'get_default_open_app': () => null,
    'get_active_project_path': () => '/mock/project',
    'get_auto_update_enabled': () => false,
    'get_dev_error_toasts_enabled': () => false,
    'get_app_version': () => '0.0.0-playground',
    'get_open_tabs_state': () => [],

    // GitHub / GitLab / Forge
    'github_get_status': () => ({ connected: false }),
    'gitlab_get_status': () => ({ connected: false }),
    'detect_project_forge': () => null,
    'forge_get_status': () => ({ connected: false }),
    'gitlab_get_sources': () => [],
    'github_preview_pr': () => ({ title: '', body: '' }),

    // Merge
    'lucode_core_prepare_merge': () => ({ commit_message: '', files: [] }),
    'lucode_core_merge_session': () => ({}),

    // Epics
    'schaltwerk_core_list_epics': () => mockEpics,
    'lucode_core_list_epics': () => mockEpics,
    'lucode_core_create_epic': () => ({ id: 'mock', name: 'Mock' }),

    // Project
    'initialize_project': () => ({}),
    'get_project_sessions_settings': () => ({ filter_mode: 'running' }),
    'get_project_merge_preferences': () => ({ auto_cancel_after_merge: false, auto_cancel_after_pr: false }),
    'save_open_tabs_state': () => ({}),
    'add_recent_project': () => ({}),

    // Misc
    'open_external_url': () => ({}),
    'get_current_directory': () => '/mock/project',
    'get_development_info': () => ({ is_dev: true }),
    'directory_exists': () => true,

    // Schaltwerk core commands (catch common ones)
    'schaltwerk_core_get_theme': () => 'dark',
    'schaltwerk_core_get_language': () => 'en',
    'schaltwerk_core_get_font_sizes': () => ({ terminal: 14, ui: 14 }),
    'schaltwerk_core_set_font_sizes': () => ({}),
    'schaltwerk_core_get_agent_type': () => 'claude',
    'schaltwerk_core_get_orchestrator_agent_type': () => 'claude',
    'schaltwerk_core_get_skip_permissions': () => false,
    'schaltwerk_core_get_orchestrator_skip_permissions': () => false,
    'schaltwerk_core_cancel_session': () => ({}),
    'schaltwerk_core_convert_session_to_draft': () => ({}),
    'schaltwerk_core_log_frontend_message': () => ({}),
    'schaltwerk_core_get_merge_preview': () => ({ commit_message: '', files: [] }),
    'schaltwerk_core_get_merge_preview_with_worktree': () => ({ commit_message: '', files: [] }),
    'schaltwerk_core_merge_session_to_main': () => ({}),
    'schaltwerk_core_prepare_merge': () => ({ commit_message: '', files: [] }),
    'schaltwerk_core_get_archive_max_entries': () => 50,
    'schaltwerk_core_list_archived_specs': () => [],
    'schaltwerk_core_has_uncommitted_changes': () => false,
  }

  const handler = handlers[cmd]
  if (handler) return handler()

  if (cmd.startsWith('schaltwerk_core_') || cmd.startsWith('lucode_core_')) {
    return {}
  }

  console.warn(`[playground] unhandled invoke: ${cmd}`, args)
  return {}
}

export function convertFileSrc(path: string): string {
  return path
}

// ── @tauri-apps/api/event stubs ─────────────────────────────────────────────

type UnlistenFn = () => void

export async function listen(_event: string, _handler: (...args: any[]) => void): Promise<UnlistenFn> {
  return () => {}
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {}

export async function once(_event: string, _handler: (...args: any[]) => void): Promise<UnlistenFn> {
  return () => {}
}

// ── @tauri-apps/plugin-shell stubs ──────────────────────────────────────────

export class Command {
  static create(_program: string, _args?: string[]) {
    return new Command()
  }
  async execute() {
    return { code: 0, stdout: '', stderr: '' }
  }
}

export async function open(_url: string): Promise<void> {}

// ── @tauri-apps/plugin-os stubs ─────────────────────────────────────────────

export async function platform(): Promise<string> {
  return 'macos'
}

export function type(): string {
  return 'Darwin'
}

// ── @tauri-apps/plugin-process stubs ────────────────────────────────────────

export async function exit(_code?: number): Promise<void> {}
export async function relaunch(): Promise<void> {}

// ── @tauri-apps/plugin-dialog stubs ─────────────────────────────────────────

export async function message(_msg: string): Promise<void> {}
export async function ask(_msg: string): Promise<boolean> { return false }
export async function confirm(_msg: string): Promise<boolean> { return false }

// ── @tauri-apps/plugin-updater stubs ────────────────────────────────────────

export function check(): Promise<null> { return Promise.resolve(null) }

// ── @tauri-apps/plugin-notification stubs ───────────────────────────────────

export async function isPermissionGranted(): Promise<boolean> { return false }
export async function requestPermission(): Promise<string> { return 'denied' }
export async function sendNotification(_options: any): Promise<void> {}

// ── @tauri-apps/api/window stubs ────────────────────────────────────────────

export function getCurrentWindow() {
  return {
    listen: async (_event: string, _handler: any) => () => {},
    emit: async (_event: string, _payload?: any) => {},
    setTitle: async (_title: string) => {},
    setDecorations: async (_decorations: boolean) => {},
    onCloseRequested: async (_handler: any) => () => {},
    onFocusChanged: async (_handler: any) => () => {},
    innerSize: async () => ({ width: 1200, height: 800, toLogical: () => ({ width: 1200, height: 800 }) }),
    setSize: async () => {},
    setMinSize: async () => {},
    setPosition: async () => {},
    center: async () => {},
    show: async () => {},
    hide: async () => {},
    close: async () => {},
    isVisible: async () => true,
    isFocused: async () => true,
  }
}

export class Window {
  static getByLabel(_label: string) { return getCurrentWindow() }
  static getCurrent() { return getCurrentWindow() }
}

// ── @tauri-apps/api/webview stubs ───────────────────────────────────────────

export class Webview {
  static getByLabel(_label: string) { return null }
  static getCurrent() {
    return {
      position: async () => ({ x: 0, y: 0 }),
      size: async () => ({ width: 0, height: 0 }),
      setPosition: async () => {},
      setSize: async () => {},
      show: async () => {},
      hide: async () => {},
    }
  }
}

export class WebviewWindow {
  static getByLabel(_label: string) { return null }
}

// ── @tauri-apps/api/dpi stubs ───────────────────────────────────────────────

export class LogicalPosition {
  x: number
  y: number
  constructor(x: number, y: number) { this.x = x; this.y = y }
}

export class LogicalSize {
  width: number
  height: number
  constructor(width: number, height: number) { this.width = width; this.height = height }
}

export class PhysicalPosition {
  x: number
  y: number
  constructor(x: number, y: number) { this.x = x; this.y = y }
  toLogical(_scaleFactor: number) { return new LogicalPosition(this.x, this.y) }
}

export class PhysicalSize {
  width: number
  height: number
  constructor(width: number, height: number) { this.width = width; this.height = height }
  toLogical(_scaleFactor: number) { return new LogicalSize(this.width, this.height) }
}

// ── @tauri-apps/api/path stubs ──────────────────────────────────────────────

export async function homeDir(): Promise<string> { return '/Users/playground' }
export async function appDataDir(): Promise<string> { return '/Users/playground/.lucode' }
export async function appConfigDir(): Promise<string> { return '/Users/playground/.config/lucode' }
export async function resolve(...paths: string[]): Promise<string> { return paths.join('/') }
export async function join(...paths: string[]): Promise<string> { return paths.join('/') }
