import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData } from './loadDiffs'
import { PierreDiffViewer, type ChangedFile, type PierreDiffViewerProps } from './PierreDiffViewer'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@pierre/diffs/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@pierre/diffs/react')
  return {
    ...actual,
    FileDiff: vi.fn(() => <div data-testid="pierre-file-diff" />),
  }
})

vi.mock('../../utils/fileIcons', () => ({
  getFileIcon: () => <span data-testid="file-icon" />,
}))

vi.mock('../../common/uiEvents', () => ({
  listenUiEvent: () => () => {},
  UiEvent: { FontSizeChanged: 'font-size-changed' },
}))

vi.mock('../../adapters/pierreThemeAdapter', () => ({
  getPierreThemes: () => ({}),
  getThemeType: () => 'dark',
  getPierreUnsafeCSS: () => '',
}))

vi.mock('../../hooks/usePierreKeyboardNav', () => ({
  usePierreKeyboardNav: () => ({ focusedLine: null, isKeyboardActive: false }),
}))

function binaryDiff(file: ChangedFile): FileDiffData {
  return {
    file: {
      path: file.path,
      change_type: file.change_type,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changes: 0,
      is_binary: true,
      previous_path: file.previous_path,
    },
    diffResult: [],
    changedLinesCount: 0,
    fileInfo: { sizeBytes: 12, language: undefined },
    isBinary: true,
    unsupportedReason: 'Binary file type',
    totalLineCount: 0,
  }
}

function propsFor(file: ChangedFile): PierreDiffViewerProps {
  return {
    files: [file],
    visualFileOrder: [file.path],
    selectedFile: file.path,
    allFileDiffs: new Map([[file.path, binaryDiff(file)]]),
    fileError: null,
    branchInfo: null,
    isLargeDiffMode: false,
    isCompactView: false,
    alwaysShowLargeDiffs: false,
    expandedFiles: new Set([file.path]),
    onToggleFileExpanded: vi.fn(),
    getCommentsForFile: vi.fn(() => []),
    themeId: 'dark',
    diffStyle: 'unified',
  }
}

describe('PierreDiffViewer image previews', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('renders before and after image previews for modified image binaries', async () => {
    invokeMock.mockImplementation((_cmd, args: { side: 'old' | 'new' }) => Promise.resolve({
      dataUrl: args.side === 'old' ? 'data:image/png;base64,b2xk' : 'data:image/png;base64,bmV3',
      sizeBytes: 3,
      mimeType: 'image/png',
    }))

    const file: ChangedFile = { path: 'assets/logo.png', change_type: 'modified', additions: 0, deletions: 0 }
    render(
      <PierreDiffViewer
        {...propsFor(file)}
        imagePreviewContext={{ sessionName: 'demo', projectPath: '/repo' }}
      />
    )

    expect(await screen.findByRole('img', { name: 'Before assets/logo.png' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'After assets/logo.png' })).toBeInTheDocument()
    expect(screen.queryByText('Binary file')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      sessionName: 'demo',
      projectPath: '/repo',
      side: 'old',
    }))
  })

  it('keeps the binary placeholder for non-image binaries', () => {
    const file: ChangedFile = { path: 'archive.zip', change_type: 'modified', additions: 0, deletions: 0 }
    render(<PierreDiffViewer {...propsFor(file)} />)

    expect(screen.getByText('Binary file')).toBeInTheDocument()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
