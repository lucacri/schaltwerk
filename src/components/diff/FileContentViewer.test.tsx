import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { TestProviders } from '../../tests/test-utils'
import { FileContentViewer } from './FileContentViewer'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({ selection: { kind: 'none' } }),
}))

vi.mock('../../hooks/useHighlightWorker', () => ({
  useHighlightWorker: () => ({
    requestBlockHighlight: vi.fn(),
    readBlockLine: (_cacheKey: string, _index: number, line: string) => line,
  }),
}))

vi.mock('../../hooks/useOpenInEditor', () => ({
  useOpenInEditor: () => ({ openInEditor: vi.fn() }),
}))

describe('FileContentViewer image previews', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation((cmd) => {
      if (cmd === TauriCommands.ReadProjectFile) {
        return Promise.resolve({
          content: '',
          is_binary: true,
          size_bytes: 3,
          language: null,
        })
      }
      if (cmd === TauriCommands.ReadDiffImage) {
        return Promise.resolve({
          dataUrl: 'data:image/png;base64,bmV3',
          sizeBytes: 3,
          mimeType: 'image/png',
        })
      }
      return Promise.resolve(undefined)
    })
  })

  it('renders an image preview for supported binary image files', async () => {
    render(
      <TestProviders>
        <FileContentViewer filePath="assets/logo.png" onBack={vi.fn()} />
      </TestProviders>
    )

    expect(await screen.findByRole('img', { name: 'Image preview assets/logo.png' })).toHaveAttribute('src', 'data:image/png;base64,bmV3')
    expect(screen.queryByText('Binary file')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      filePath: 'assets/logo.png',
      side: 'new',
      projectPath: '/test/project',
    }))
  })
})
