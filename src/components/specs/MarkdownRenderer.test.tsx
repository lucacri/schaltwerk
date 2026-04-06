import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useOptionalToast: () => null,
}))

vi.mock('../../common/i18n', () => ({
  useTranslation: () => ({ t: { toasts: { failedToOpenLink: '', failedToOpenLinkDesc: '' } } }),
}))

describe('MarkdownRenderer', () => {
  it('applies markdown-github-light class to the container', () => {
    render(<MarkdownRenderer content="# Hello" />)
    const container = screen.getByText('Hello').closest('.markdown-renderer')
    expect(container).toHaveClass('markdown-github-light')
  })

  it('preserves additional className prop', () => {
    render(<MarkdownRenderer content="# Hello" className="custom-class" />)
    const container = screen.getByText('Hello').closest('.markdown-renderer')
    expect(container).toHaveClass('markdown-github-light')
    expect(container).toHaveClass('custom-class')
  })

  it('renders images with default img tag when no forge context', () => {
    render(<MarkdownRenderer content="![alt text](https://example.com/image.png)" />)
    const img = screen.getByAltText('alt text')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/image.png')
  })

  it('proxies GitLab images when forge context is provided', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue('data:image/png;base64,abc123')

    render(
      <MarkdownRenderer
        content="![screenshot](https://gitlab.example.com/group/project/-/uploads/abc123/image.png)"
        forgeContext={{ forgeType: 'gitlab', hostname: 'gitlab.example.com', projectIdentifier: 'group/project' }}
      />
    )

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('forge_proxy_image', {
        imageUrl: 'https://gitlab.example.com/group/project/-/uploads/abc123/image.png',
        forgeType: 'gitlab',
        hostname: 'gitlab.example.com',
      })
    })
  })

  it('does not proxy images for GitHub forge context', () => {
    render(
      <MarkdownRenderer
        content="![alt](https://github.com/image.png)"
        forgeContext={{ forgeType: 'github', hostname: 'github.com', projectIdentifier: 'org/repo' }}
      />
    )
    const img = screen.getByAltText('alt')
    expect(img).toHaveAttribute('src', 'https://github.com/image.png')
  })
})
