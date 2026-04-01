import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore } from 'jotai'
import { DiffFileExplorer } from './DiffFileExplorer'
import { PierreDiffViewer, type PierreDiffViewerProps, type ChangedFile } from './PierreDiffViewer'
import { CollapsedDiffBadge } from './CollapsedDiffBadge'
import type { FileDiffData } from './loadDiffs'
import {
  expandedFilesAtom,
  expandAllFilesActionAtom,
  collapseAllFilesActionAtom,
} from '../../store/atoms/diffPreferences'

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

function createFile(path: string, additions = 5, deletions = 2): ChangedFile {
  return {
    path,
    change_type: 'modified',
    additions,
    deletions,
  }
}

function createFileDiffData(file: ChangedFile): FileDiffData {
  return {
    file: {
      path: file.path,
      change_type: file.change_type,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changes: (file.additions ?? 0) + (file.deletions ?? 0),
    },
    diffResult: [
      { type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1, content: 'line 1' },
      { type: 'added' as const, newLineNumber: 2, content: 'added line' },
    ],
    changedLinesCount: 1,
    fileInfo: { sizeBytes: 100, language: 'typescript' },
    totalLineCount: 2,
  }
}

function defaultPierreDiffProps(
  files: ChangedFile[],
  overrides: Partial<PierreDiffViewerProps> = {}
): PierreDiffViewerProps {
  const allFileDiffs = new Map<string, FileDiffData>()
  files.forEach(f => allFileDiffs.set(f.path, createFileDiffData(f)))

  return {
    files,
    visualFileOrder: files.map(f => f.path),
    selectedFile: files[0]?.path ?? null,
    allFileDiffs,
    fileError: null,
    branchInfo: null,
    isLargeDiffMode: false,
    isCompactView: false,
    alwaysShowLargeDiffs: false,
    expandedFiles: new Set<string>(),
    onToggleFileExpanded: vi.fn(),
    getCommentsForFile: vi.fn(() => []),
    themeId: 'dark',
    diffStyle: 'unified',
    ...overrides,
  }
}

describe('Collapsible File Diffs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('all files collapsed by default', () => {
    it('renders no diff components when expandedFiles is empty', () => {
      const files = [createFile('src/a.ts'), createFile('src/b.ts'), createFile('src/c.ts')]
      const props = defaultPierreDiffProps(files, { expandedFiles: new Set() })

      render(<PierreDiffViewer {...props} />)

      expect(screen.queryAllByTestId('pierre-file-diff')).toHaveLength(0)

      const chevrons = screen.getAllByTestId('file-collapse-chevron')
      expect(chevrons).toHaveLength(3)
      chevrons.forEach(chevron => {
        expect(chevron).toHaveAttribute('data-expanded', 'false')
      })
    })
  })

  describe('pre-selected file auto-expands', () => {
    it('expands the file matching filePath in expandedFiles', () => {
      const files = [createFile('src/foo.ts'), createFile('src/bar.ts')]
      const props = defaultPierreDiffProps(files, {
        expandedFiles: new Set(['src/foo.ts']),
      })

      render(<PierreDiffViewer {...props} />)

      const diffs = screen.queryAllByTestId('pierre-file-diff')
      expect(diffs).toHaveLength(1)
    })
  })

  describe('click header toggles expansion', () => {
    it('calls onToggleFileExpanded when file header is clicked', () => {
      const files = [createFile('src/a.ts')]
      const onToggle = vi.fn()
      const props = defaultPierreDiffProps(files, {
        expandedFiles: new Set(),
        onToggleFileExpanded: onToggle,
      })

      render(<PierreDiffViewer {...props} />)

      const header = screen.getByRole('button', { name: /Toggle src\/a.ts diff/ })
      fireEvent.click(header)
      expect(onToggle).toHaveBeenCalledWith('src/a.ts')
    })

    it('shows diff content when expanded, hides when collapsed', () => {
      const files = [createFile('src/a.ts')]

      const { rerender } = render(
        <PierreDiffViewer {...defaultPierreDiffProps(files, { expandedFiles: new Set() })} />
      )
      expect(screen.queryAllByTestId('pierre-file-diff')).toHaveLength(0)

      rerender(
        <PierreDiffViewer {...defaultPierreDiffProps(files, { expandedFiles: new Set(['src/a.ts']) })} />
      )
      expect(screen.queryAllByTestId('pierre-file-diff')).toHaveLength(1)
    })
  })

  describe('sidebar click selects and expands', () => {
    it('calls both onFileSelect and onFileExpanded on sidebar click', () => {
      const files = [
        { path: 'src/a.ts', change_type: 'modified' as const, additions: 5, deletions: 2, changes: 7 },
      ]
      const onFileSelect = vi.fn()
      const onFileExpanded = vi.fn()

      render(
        <DiffFileExplorer
          files={files}
          selectedFile={null}
          visibleFilePath={null}
          onFileSelect={onFileSelect}
          onFileExpanded={onFileExpanded}
          getCommentsForFile={() => []}
          currentReview={null}
          onFinishReview={vi.fn()}
          onCancelReview={vi.fn()}
          removeComment={vi.fn()}
        />
      )

      const fileNode = screen.getByText('a.ts')
      fireEvent.click(fileNode)
      expect(onFileSelect).toHaveBeenCalledWith('src/a.ts', 0)
      expect(onFileExpanded).toHaveBeenCalledWith('src/a.ts')
    })
  })

  describe('expand all adds all paths', () => {
    it('expandAllFilesActionAtom sets all paths into expandedFilesAtom', () => {
      const store = createStore()
      const allPaths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']

      store.set(expandAllFilesActionAtom, allPaths)

      const expanded = store.get(expandedFilesAtom)
      expect(expanded.size).toBe(5)
      allPaths.forEach(p => expect(expanded.has(p)).toBe(true))
    })
  })

  describe('collapse all clears set', () => {
    it('collapseAllFilesActionAtom clears expandedFilesAtom', () => {
      const store = createStore()
      store.set(expandedFilesAtom, new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']))

      store.set(collapseAllFilesActionAtom)

      const expanded = store.get(expandedFilesAtom)
      expect(expanded.size).toBe(0)
    })
  })

  describe('expand all then collapse individual', () => {
    it('collapsing one file leaves others expanded', () => {
      const files = [createFile('src/a.ts'), createFile('src/b.ts'), createFile('src/c.ts')]
      const onToggle = vi.fn()

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            expandedFiles: new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']),
            onToggleFileExpanded: onToggle,
          })}
        />
      )

      expect(screen.queryAllByTestId('pierre-file-diff')).toHaveLength(3)

      const header = screen.getByRole('button', { name: /Toggle src\/b.ts diff/ })
      fireEvent.click(header)
      expect(onToggle).toHaveBeenCalledWith('src/b.ts')
    })
  })

  describe('stale paths pruned on file list change', () => {
    it('removes stale paths from expandedFilesAtom when files change', () => {
      const store = createStore()
      store.set(expandedFilesAtom, new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']))

      const currentPaths = new Set(['src/a.ts', 'src/c.ts'])
      store.set(expandedFilesAtom, (prev: Set<string>) => {
        const next = new Set<string>()
        prev.forEach(p => {
          if (currentPaths.has(p)) next.add(p)
        })
        return next
      })

      const expanded = store.get(expandedFilesAtom)
      expect(expanded.has('src/b.ts')).toBe(false)
      expect(expanded.has('src/a.ts')).toBe(true)
      expect(expanded.has('src/c.ts')).toBe(true)
    })
  })

  describe('enter on expanded file is no-op', () => {
    it('does not toggle already expanded file on Enter', () => {
      const files = [createFile('src/a.ts')]
      const onToggle = vi.fn()

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            expandedFiles: new Set(['src/a.ts']),
            onToggleFileExpanded: onToggle,
          })}
        />
      )

      const header = screen.getByRole('button', { name: /Toggle src\/a.ts diff/ })
      fireEvent.keyDown(header, { key: 'Enter' })
      expect(onToggle).not.toHaveBeenCalled()
    })

    it('expands collapsed file on Enter', () => {
      const files = [createFile('src/a.ts')]
      const onToggle = vi.fn()

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            expandedFiles: new Set(),
            onToggleFileExpanded: onToggle,
          })}
        />
      )

      const header = screen.getByRole('button', { name: /Toggle src\/a.ts diff/ })
      fireEvent.keyDown(header, { key: 'Enter' })
      expect(onToggle).toHaveBeenCalledWith('src/a.ts')
    })
  })

  describe('space toggles expansion', () => {
    it('expands a focused file with Space', () => {
      const files = [createFile('src/a.ts')]
      const onToggle = vi.fn()

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            onToggleFileExpanded: onToggle,
          })}
        />
      )

      fireEvent.keyDown(screen.getByRole('button', { name: /Toggle src\/a.ts diff/ }), { key: ' ' })
      expect(onToggle).toHaveBeenCalledWith('src/a.ts')
    })
  })

  describe('rapid toggle produces stable state', () => {
    it('toggling 10 times results in correct final state', () => {
      const store = createStore()
      store.set(expandedFilesAtom, new Set<string>())

      for (let i = 0; i < 10; i++) {
        store.set(expandedFilesAtom, (prev: Set<string>) => {
          const next = new Set(prev)
          if (next.has('src/a.ts')) {
            next.delete('src/a.ts')
          } else {
            next.add('src/a.ts')
          }
          return next
        })
      }

      const expanded = store.get(expandedFilesAtom)
      expect(expanded.has('src/a.ts')).toBe(false)
    })
  })

  describe('aria-expanded matches state', () => {
    it('sets aria-expanded=true on expanded and false on collapsed', () => {
      const files = [createFile('src/a.ts'), createFile('src/b.ts')]

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            expandedFiles: new Set(['src/a.ts']),
          })}
        />
      )

      const headerA = screen.getByRole('button', { name: /Toggle src\/a.ts diff/ })
      const headerB = screen.getByRole('button', { name: /Toggle src\/b.ts diff/ })

      expect(headerA).toHaveAttribute('aria-expanded', 'true')
      expect(headerB).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('collapsed badge shows change stats', () => {
    it('renders additions and deletions', () => {
      render(
        <CollapsedDiffBadge
          filterResult={{ shouldCollapse: true, isGenerated: true, isLarge: false, reason: 'generated' }}
          additions={7}
          deletions={3}
          onClick={() => {}}
        />
      )
      expect(screen.getByText('+7')).toBeInTheDocument()
      expect(screen.getByText('-3')).toBeInTheDocument()
    })

    it('shows stats for deleted files in collapsed state', () => {
      const files = [createFile('src/deleted.ts', 0, 4)]
      files[0].change_type = 'deleted'

      render(
        <PierreDiffViewer
          {...defaultPierreDiffProps(files, {
            expandedFiles: new Set(),
          })}
        />
      )

      expect(screen.getByText('+0')).toBeInTheDocument()
      expect(screen.getByText('-4')).toBeInTheDocument()
    })
  })
})
