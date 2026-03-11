import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { UnifiedDiffView } from './UnifiedDiffView'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData } from './loadDiffs'
import type { EnrichedSession } from '../../types/session'
import type { ChangedFile } from '../../common/events'
import { FilterMode } from '../../types/sessionFilters'
import { sessionTerminalGroup, stableSessionTerminalId } from '../../common/terminalIdentity'

let selectionState: {
  kind: 'session' | 'orchestrator'
  payload?: string
  sessionState?: 'spec' | 'processing' | 'running' | 'reviewed'
}
let sessionsState: EnrichedSession[]
const reloadSessionsMock = vi.fn(async () => {})
const demoTerminals = sessionTerminalGroup('demo')

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: selectionState,
      terminals: { ...demoTerminals, workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    })
  }
})

vi.mock('../../hooks/useSessions', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useSessions')>('../../hooks/useSessions')
  return {
    ...actual,
    useSessions: () => ({
      sessions: sessionsState,
      allSessions: sessionsState,
      filteredSessions: sessionsState,
      sortedSessions: sessionsState,
      loading: false,
      filterMode: FilterMode.Running,
      searchQuery: '',
      isSearchVisible: false,
      setFilterMode: vi.fn(),
      setSearchQuery: vi.fn(),
      setIsSearchVisible: vi.fn(),
      setCurrentSelection: vi.fn(),
      reloadSessions: reloadSessionsMock,
      updateSessionStatus: vi.fn(),
      createDraft: vi.fn(),
    })
  }
})

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

const fileA = createChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 1 })
const fileB = createChangedFile({ path: 'src/b.ts', change_type: 'modified', additions: 2 })

const sampleDiff: FileDiffData = {
  file: fileA,
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 12, language: 'typescript' },
}

const changedFiles: ChangedFile[] = [fileA, fileB]

const loadFileDiffMock = vi.fn(async () => sampleDiff)

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn(),
  }
})

const baseInvoke = async (cmd: string): Promise<unknown> => {
  switch (cmd) {
    case TauriCommands.GetChangedFilesFromMain:
      return changedFiles
    case TauriCommands.GetCurrentBranchName:
      return 'feature/demo'
    case TauriCommands.GetBaseBranchName:
      return 'main'
    case TauriCommands.GetCommitComparisonInfo:
      return ['abc', 'def']
    case TauriCommands.GetDiffViewPreferences:
      return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320, inline_sidebar_default: true }
    case TauriCommands.GetSessionPreferences:
      return { always_show_large_diffs: false }
    case TauriCommands.GetProjectSettings:
      return { project_name: 'demo', project_path: '/tmp/demo' }
    case TauriCommands.GetActiveProjectPath:
      return '/tmp/demo'
    case TauriCommands.ListAvailableOpenApps:
      return []
    case TauriCommands.GetDefaultOpenApp:
      return 'code'
    case TauriCommands.SchaltwerkCoreGetSession:
      return { worktree_path: '/tmp/demo' }
    case TauriCommands.SetDiffViewPreferences:
    case TauriCommands.ClipboardWriteText:
      return undefined
    default:
      return null
  }
}

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'demo',
      display_name: 'Demo Session',
      branch: 'feature/demo',
      worktree_path: '/tmp/demo',
      base_branch: 'main',
      status: 'active',
      is_current: true,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
      has_uncommitted_changes: false,
      ...overrides,
    },
    status: undefined,
    terminals: [
      stableSessionTerminalId('demo', 'top'),
      stableSessionTerminalId('demo', 'bottom'),
    ],
  }
}

describe('UnifiedDiffView first-open scroll', () => {
  beforeEach(() => {
    selectionState = { kind: 'session', payload: 'demo', sessionState: 'running' }
    sessionsState = [createSession()]
    reloadSessionsMock.mockClear()
    loadFileDiffMock.mockClear()
    invokeMock.mockImplementation(baseInvoke)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('selects the requested file when opening for the first time', async () => {
    const { rerender } = render(
      <TestProviders>
        <UnifiedDiffView
          filePath="src/b.ts"
          isOpen={false}
          onClose={() => {}}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    rerender(
      <TestProviders>
        <UnifiedDiffView
          filePath="src/b.ts"
          isOpen={true}
          onClose={() => {}}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(loadFileDiffMock).toHaveBeenCalledWith(
        'demo',
        expect.objectContaining({ path: 'src/b.ts' }),
        'unified'
      )
    })
  })

  it('does not re-scroll when filePath stays the same while already open', async () => {
    render(
      <TestProviders>
        <UnifiedDiffView
          filePath="src/a.ts"
          isOpen={true}
          onClose={() => {}}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(loadFileDiffMock).toHaveBeenCalled()
    })

    loadFileDiffMock.mockClear()

    await waitFor(() => {
      expect(loadFileDiffMock).not.toHaveBeenCalled()
    })
  })
})
