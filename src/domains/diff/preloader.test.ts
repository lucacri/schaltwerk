import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { createChangedFile } from '../../tests/test-utils'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../components/diff/loadDiffs', () => ({
  loadFileDiff: vi.fn().mockResolvedValue({
    diffResult: [{ content: 'a', type: 'unchanged', oldLineNumber: 1, newLineNumber: 1 }],
    file: { additions: 0, deletions: 0 },
    fileInfo: { language: 'text', sizeBytes: 100 },
    isBinary: false,
    unsupportedReason: null,
  }),
}))

vi.mock('@pierre/diffs/worker', () => ({
  getOrCreateWorkerPoolSingleton: vi.fn(),
}))

vi.mock('@pierre/diffs', () => ({
  getHighlighterIfLoaded: vi.fn(),
  renderDiffWithHighlighter: vi.fn(),
}))

describe('DiffPreloadManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call highlight APIs during preload', async () => {
    const files = [
      createChangedFile({ path: 'foo.ts', change_type: 'modified' }),
      createChangedFile({ path: 'bar.rs', change_type: 'modified' }),
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) {
        return files
      }
      return undefined
    })

    const { getOrCreateWorkerPoolSingleton } = await import('@pierre/diffs/worker')
    const { getHighlighterIfLoaded, renderDiffWithHighlighter } = await import('@pierre/diffs')

    const { diffPreloader } = await import('./preloader')
    diffPreloader.invalidate('test-session')
    diffPreloader.preload('test-session', false, 'unified')

    await vi.waitFor(() => {
      const cached = diffPreloader.getChangedFiles('test-session')
      expect(cached).not.toBeNull()
      expect(cached).toHaveLength(2)
    }, { timeout: 2000 })

    expect(getOrCreateWorkerPoolSingleton).not.toHaveBeenCalled()
    expect(getHighlighterIfLoaded).not.toHaveBeenCalled()
    expect(renderDiffWithHighlighter).not.toHaveBeenCalled()
  })
})
