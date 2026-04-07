import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData, ViewMode } from './loadDiffs'
import type { ChangedFile } from '../../common/events'
import { SchaltEvent } from '../../common/eventSystem'
import { diffPreloader } from '../../domains/diff/preloader'

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
}))

const sampleDiff: FileDiffData = {
  file: createChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 1 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 12, language: 'typescript' }
}

const loadFileDiffMock = vi.fn<
  (sessionName: string, file: ChangedFile, diffLayout: ViewMode) => Promise<FileDiffData>
>(async () => sampleDiff)

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn()
  }
})

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: { kind: 'session', payload: 'demo', sessionState: 'running' },
      terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    })
  }
})

let fileChangeHandler: ((payload: unknown) => void | Promise<void>) | null = null

vi.mock('../../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../../common/eventSystem')>('../../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async (event, handler) => {
      if (event === SchaltEvent.FileChanges) {
        fileChangeHandler = handler
      }
      return () => {}
    }),
  }
})

vi.mock('../../domains/diff/preloader', () => ({
  diffPreloader: {
    preload: vi.fn(),
    invalidate: vi.fn(),
    getChangedFiles: vi.fn(),
    getFileDiff: vi.fn(),
  },
}))

const changedFiles = [
  createChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 2, deletions: 0 }),
  createChangedFile({ path: 'src/b.ts', change_type: 'modified', additions: 3, deletions: 1 }),
]

const staleDiff: FileDiffData = {
  file: createChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 1 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const stale = true' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 22, language: 'typescript' }
}

let staleCacheActive = false

function setupInvokeMock() {
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    switch (cmd) {
      case TauriCommands.GetChangedFilesFromMain:
        return changedFiles
      case TauriCommands.GetCurrentBranchName:
        return 'feature/demo'
      case TauriCommands.GetBaseBranchName:
        return 'main'
      case TauriCommands.GetCommitComparisonInfo:
        return ['abc123', 'def456']
      case TauriCommands.GetDiffViewPreferences:
        return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
      case TauriCommands.GetSessionPreferences:
        return { skip_confirmation_modals: false }
      case TauriCommands.ListAvailableOpenApps:
        return []
      case TauriCommands.GetDefaultOpenApp:
        return 'code'
      case TauriCommands.GetProjectSettings:
        return { project_name: 'demo', project_path: '/tmp/demo' }
      default:
        throw new Error(`Unhandled invoke: ${cmd} ${JSON.stringify(args)}`)
    }
  })
}

beforeEach(() => {
  invokeMock.mockReset()
  loadFileDiffMock.mockClear()
  fileChangeHandler = null
  vi.mocked(diffPreloader.preload).mockReset()
  vi.mocked(diffPreloader.invalidate).mockReset()
  vi.mocked(diffPreloader.getChangedFiles).mockReset()
  vi.mocked(diffPreloader.getFileDiff).mockReset()

  staleCacheActive = false
  vi.mocked(diffPreloader.invalidate).mockImplementation((sessionName: string) => {
    if (sessionName === 'demo') {
      staleCacheActive = false
    }
  })
  vi.mocked(diffPreloader.getChangedFiles).mockImplementation((sessionName: string) => {
    if (staleCacheActive && sessionName === 'demo') {
      return changedFiles
    }
    return null
  })
  vi.mocked(diffPreloader.getFileDiff).mockImplementation((sessionName: string, filePath: string) => {
    if (staleCacheActive && sessionName === 'demo' && filePath === 'src/a.ts') {
      return staleDiff
    }
    return null
  })
})

describe('UnifiedDiffModal sidebar stability', () => {
  it('keeps the current file selected when file change events report the same files', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetChangedFilesFromMain, { sessionName: 'demo' })
    })

    const secondFile = await screen.findByText('b.ts')
    fireEvent.click(secondFile)

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/b.ts')
    })

    await waitFor(() => {
      expect(typeof fileChangeHandler).toBe('function')
    })

    await act(async () => {
      await fileChangeHandler?.({
        session_name: 'demo',
        changed_files: changedFiles,
        branch_info: {
          current_branch: 'feature/demo',
          base_branch: 'main',
          base_commit: 'abc123',
          head_commit: 'def456',
        },
      })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/b.ts')
    })
  })

  it('invalidates stale preloader cache when file changes arrive', async () => {
    setupInvokeMock()
    staleCacheActive = true

    render(
      <TestProviders>
        <UnifiedDiffModal filePath="src/a.ts" isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(typeof fileChangeHandler).toBe('function')
    })

    await waitFor(() => {
      expect(vi.mocked(diffPreloader.getChangedFiles)).toHaveBeenCalledWith('demo', null)
    })

    const initialCallsForA = loadFileDiffMock.mock.calls.filter(
      ([sessionName, file]) =>
        sessionName === 'demo' && file.path === 'src/a.ts',
    ).length

    await act(async () => {
      await fileChangeHandler?.({
        session_name: 'demo',
        changed_files: changedFiles,
        branch_info: {
          current_branch: 'feature/demo',
          base_branch: 'main',
          base_commit: 'abc123',
          head_commit: 'def456',
        },
      })
    })

    await waitFor(() => {
      expect(vi.mocked(diffPreloader.invalidate)).toHaveBeenCalledWith('demo', '/test/project')
    })

    await waitFor(() => {
      const callsForAAfterEvent = loadFileDiffMock.mock.calls.filter(
        ([sessionName, file]) =>
          sessionName === 'demo' && file.path === 'src/a.ts',
      ).length
      expect(callsForAAfterEvent).toBeGreaterThan(initialCallsForA)
    })
  })
})
