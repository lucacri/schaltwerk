import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { ImageDiffPreview } from './ImageDiffPreview'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const pngOld = {
  dataUrl: 'data:image/png;base64,b2xk',
  sizeBytes: 3,
  mimeType: 'image/png',
}

const pngNew = {
  dataUrl: 'data:image/png;base64,bmV3',
  sizeBytes: 3,
  mimeType: 'image/png',
}

describe('ImageDiffPreview', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('renders before and after images for modified image diffs', async () => {
    invokeMock.mockImplementation((_cmd, args: { side: 'old' | 'new' }) => (
      Promise.resolve(args.side === 'old' ? pngOld : pngNew)
    ))

    render(
      <ImageDiffPreview
        filePath="assets/logo.png"
        changeType="modified"
        sessionName="demo"
        projectPath="/repo"
        fallback={<div>Binary fallback</div>}
      />
    )

    expect(await screen.findByRole('img', { name: 'Before assets/logo.png' })).toHaveAttribute('src', pngOld.dataUrl)
    expect(screen.getByRole('img', { name: 'After assets/logo.png' })).toHaveAttribute('src', pngNew.dataUrl)
    expect(screen.queryByText('Binary fallback')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      filePath: 'assets/logo.png',
      side: 'old',
      sessionName: 'demo',
      projectPath: '/repo',
    }))
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      filePath: 'assets/logo.png',
      side: 'new',
    }))
  })

  it('renders only the current image for added image diffs', async () => {
    invokeMock.mockResolvedValue(pngNew)

    render(
      <ImageDiffPreview
        filePath="assets/new-logo.png"
        changeType="added"
        fallback={<div>Binary fallback</div>}
      />
    )

    expect(await screen.findByRole('img', { name: 'Added assets/new-logo.png' })).toHaveAttribute('src', pngNew.dataUrl)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      filePath: 'assets/new-logo.png',
      side: 'new',
    }))
  })

  it('shows a too-large message without rendering the image when the backend flags it', async () => {
    invokeMock.mockResolvedValue({
      dataUrl: '',
      sizeBytes: 30 * 1024 * 1024,
      mimeType: 'image/png',
      tooLarge: true,
      maxBytes: 25 * 1024 * 1024,
    })

    render(
      <ImageDiffPreview
        filePath="assets/huge.png"
        changeType="added"
        fallback={<div>Binary fallback</div>}
      />
    )

    await waitFor(() => {
      expect(screen.queryByRole('img')).toBeNull()
    })
    expect(screen.getByTestId('image-diff-preview').textContent).toMatch(/too large/i)
  })

  it('collapses renamed images to one preview when both sides are identical', async () => {
    invokeMock.mockResolvedValue(pngNew)

    render(
      <ImageDiffPreview
        filePath="assets/new-logo.png"
        oldFilePath="assets/old-logo.png"
        changeType="renamed"
        fallback={<div>Binary fallback</div>}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(1)
    })
    expect(screen.getByRole('img', { name: 'Image preview assets/new-logo.png' })).toHaveAttribute('src', pngNew.dataUrl)
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      filePath: 'assets/new-logo.png',
      oldFilePath: 'assets/old-logo.png',
      side: 'old',
    }))
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.ReadDiffImage, expect.objectContaining({
      side: 'new',
    }))
  })
})
