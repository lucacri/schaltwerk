import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TauriCommands } from '../../common/tauriCommands'
import { createChangedFile } from '../../tests/test-utils'
import { ToastProvider } from '../../common/toast/ToastProvider'
import { GithubIntegrationProvider } from '../../contexts/GithubIntegrationContext'
import { expandedFilesAtom } from '../../store/atoms/diffPreferences'
import { diffPreloader } from '../../domains/diff/preloader'

const invokeMock = vi.fn()
let selectionSession = 'demo'
let currentChangedFiles = [
  createChangedFile({ path: 'src/first.ts', change_type: 'modified', additions: 3, deletions: 1 }),
  createChangedFile({ path: 'src/second.ts', change_type: 'modified', additions: 5, deletions: 2 }),
]

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

vi.mock('../../contexts/ReviewContext', () => ({
  useReview: () => ({
    currentReview: null,
    addComment: vi.fn(),
    removeComment: vi.fn(),
    updateComment: vi.fn(),
    clearReview: vi.fn(),
    startReview: vi.fn(),
    getCommentsForFile: vi.fn(() => [])
  })
}))

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: () => ({
    setFocusForSession: vi.fn(),
    setCurrentFocus: vi.fn()
  })
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: [],
    reloadSessions: vi.fn()
  })
}))

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: selectionSession, sessionState: 'running' as const },
    terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
    setSelection: vi.fn(),
    clearTerminalTracking: vi.fn(),
    isReady: true,
    isSpec: false,
  })
}))

vi.mock('../../hooks/useHighlightWorker', () => ({
  useHighlightWorker: () => ({
    highlightPlans: new Map(),
    readBlockLine: vi.fn(),
    requestBlockHighlight: vi.fn(),
    highlightCode: vi.fn((options: { code: string }) => options.code),
  })
}))

vi.mock('../../hooks/useDiffHover', () => ({
  useDiffHover: () => ({
    setHoveredLineInfo: vi.fn(),
    clearHoveredLine: vi.fn(),
    useHoverKeyboardShortcuts: () => {},
  })
}))

vi.mock('../../hooks/useLineSelection', () => ({
  useLineSelection: () => ({
    selection: null,
    handleLineClick: vi.fn(),
    extendSelection: vi.fn(),
    clearSelection: vi.fn(),
    isLineSelected: vi.fn(),
    isLineInRange: vi.fn()
  })
}))

const diffResponse = {
  lines: [
    { type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1, content: 'a' },
    { type: 'added' as const, newLineNumber: 2, content: 'b' },
  ],
  stats: { additions: 1, deletions: 0 },
  fileInfo: { sizeBytes: 32 },
  isLargeFile: false,
}

function renderModal(filePath: string | null = null) {
  const store = createStore()
  const view = render(
    <Provider store={store}>
      <GithubIntegrationProvider>
        <ToastProvider>
          <UnifiedDiffModal filePath={filePath} isOpen={true} onClose={() => {}} />
        </ToastProvider>
      </GithubIntegrationProvider>
    </Provider>
  )
  return { ...view, store }
}

beforeEach(() => {
  vi.clearAllMocks()
  selectionSession = 'demo'
  diffPreloader.invalidate('demo')
  diffPreloader.invalidate('demo-2')
  diffPreloader.invalidate('orchestrator')
  currentChangedFiles = [
    createChangedFile({ path: 'src/first.ts', change_type: 'modified', additions: 3, deletions: 1 }),
    createChangedFile({ path: 'src/second.ts', change_type: 'modified', additions: 5, deletions: 2 }),
  ]

  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case TauriCommands.GetChangedFilesFromMain:
        return currentChangedFiles
      case TauriCommands.ComputeUnifiedDiffBackend:
        return {
          ...diffResponse,
          fileInfo: { sizeBytes: 32, path: (args?.filePath as string) ?? 'unknown' },
        }
      case TauriCommands.GetCurrentBranchName:
        return 'feature/demo'
      case TauriCommands.GetBaseBranchName:
        return 'main'
      case TauriCommands.GetCommitComparisonInfo:
        return ['base123', 'head456']
      case TauriCommands.GetDiffViewPreferences:
        return { continuous_scroll: true, compact_diffs: true, sidebar_width: 320, diff_layout: 'unified' }
      case TauriCommands.GetSessionPreferences:
        return { always_show_large_diffs: false }
      case TauriCommands.ListAvailableOpenApps:
        return []
      case TauriCommands.GetDefaultOpenApp:
        return 'code'
      default:
        return null
    }
  })
})

describe('UnifiedDiffView file folding', () => {
  it('collapses all files by default', async () => {
    const { store } = renderModal()

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    const secondHeader = await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })

    expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    expect(secondHeader).toHaveAttribute('aria-expanded', 'false')
    expect(store.get(expandedFilesAtom)).toEqual(new Set())
  })

  it('auto-expands preselected file from filePath prop', async () => {
    const { store } = renderModal('src/second.ts')

    const secondHeader = await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })
    expect(secondHeader).toHaveAttribute('aria-expanded', 'true')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/second.ts']))
  })

  it('keeps all files collapsed when filePath prop is null', async () => {
    renderModal(null)

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    const secondHeader = await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })

    expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    expect(secondHeader).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicking file header toggles file expansion only', async () => {
    const { store } = renderModal()

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    const secondHeader = await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })

    fireEvent.click(firstHeader)

    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
    expect(secondHeader).toHaveAttribute('aria-expanded', 'false')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/first.ts']))
  })

  it('unmounts file diff content while file is collapsed', async () => {
    renderModal()

    await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    expect(screen.queryByText('a')).not.toBeInTheDocument()
    expect(screen.queryByText('b')).not.toBeInTheDocument()
  })

  it('sidebar click expands the selected file', async () => {
    renderModal()

    fireEvent.click(await screen.findByText('second.ts'))

    expect(screen.getByRole('button', { name: 'Toggle src/second.ts diff' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('expand all and collapse all controls update all files', async () => {
    const { store } = renderModal()

    await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })
    const expandAll = await screen.findByRole('button', { name: 'Expand all files' })
    const collapseAll = screen.getByRole('button', { name: 'Collapse all files' })

    fireEvent.click(expandAll)
    expect(screen.getByRole('button', { name: 'Toggle src/first.ts diff' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Toggle src/second.ts diff' })).toHaveAttribute('aria-expanded', 'true')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/first.ts', 'src/second.ts']))

    fireEvent.click(collapseAll)
    expect(screen.getByRole('button', { name: 'Toggle src/first.ts diff' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Toggle src/second.ts diff' })).toHaveAttribute('aria-expanded', 'false')
    expect(store.get(expandedFilesAtom)).toEqual(new Set())
  })

  it('expand all then collapse one file only affects that file', async () => {
    const { store } = renderModal()

    await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })
    const expandAll = await screen.findByRole('button', { name: 'Expand all files' })
    fireEvent.click(expandAll)

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    const secondHeader = await screen.findByRole('button', { name: 'Toggle src/second.ts diff' })
    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
    expect(secondHeader).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(firstHeader)
    expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    expect(secondHeader).toHaveAttribute('aria-expanded', 'true')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/second.ts']))
  })

  it('space toggles focused file expansion', async () => {
    const { store } = renderModal()

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    firstHeader.focus()
    fireEvent.keyDown(firstHeader, { key: ' ' })

    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/first.ts']))
  })

  it('enter expands and keeps expanded on repeat', async () => {
    const { store } = renderModal()

    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    firstHeader.focus()

    fireEvent.keyDown(firstHeader, { key: 'Enter' })
    fireEvent.keyDown(firstHeader, { key: 'Enter' })

    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
    expect(store.get(expandedFilesAtom)).toEqual(new Set(['src/first.ts']))
  })

  it('prunes stale expanded file paths that are not in the current file list', async () => {
    const { store } = renderModal('src/missing.ts')

    await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })

    await waitFor(() => {
      const expandedFiles = store.get(expandedFilesAtom)
      expect(expandedFiles.has('src/missing.ts')).toBe(false)
    })
  })

  it('clears expanded files on session switch', async () => {
    const { store } = renderModal()
    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })

    fireEvent.click(firstHeader)
    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')

    selectionSession = 'demo-2'
    const { rerender } = render(
      <Provider store={store}>
        <GithubIntegrationProvider>
          <ToastProvider>
            <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
          </ToastProvider>
        </GithubIntegrationProvider>
      </Provider>
    )

    void rerender

    await waitFor(() => {
      expect(store.get(expandedFilesAtom)).toEqual(new Set())
    })
  })

  it('clears expanded files when compact mode toggles', async () => {
    const { store } = renderModal()
    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })
    fireEvent.click(firstHeader)
    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')

    const compactToggle = screen.getByRole('button', { name: 'Show full context' })
    fireEvent.click(compactToggle)

    await waitFor(() => {
      expect(store.get(expandedFilesAtom)).toEqual(new Set())
    })
  })

  it('disables expand and collapse all controls when no files are present', async () => {
    currentChangedFiles = []
    renderModal()

    const expandAll = await screen.findByRole('button', { name: 'Expand all files' })
    const collapseAll = screen.getByRole('button', { name: 'Collapse all files' })

    expect(expandAll).toBeDisabled()
    expect(collapseAll).toBeDisabled()
  })

  it('keeps aria-expanded synchronized with header toggle state', async () => {
    renderModal()
    const firstHeader = await screen.findByRole('button', { name: 'Toggle src/first.ts diff' })

    expect(firstHeader).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(firstHeader)
    expect(firstHeader).toHaveAttribute('aria-expanded', 'true')
  })
})
