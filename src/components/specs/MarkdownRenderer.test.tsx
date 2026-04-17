import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useOptionalToast: () => null,
}))

vi.mock('../../common/i18n', () => ({
  useTranslation: () => ({ t: { toasts: { failedToOpenLink: '', failedToOpenLinkDesc: '' } } }),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockReset()
    mermaidMock.render.mockResolvedValue({
      svg: '<svg role="img" aria-label="Mermaid diagram"><text>Diagram</text></svg>',
      diagramType: 'flowchart',
    })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

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

  it('renders mermaid fenced code blocks as diagrams using theme CSS variables', async () => {
    document.documentElement.style.setProperty('--color-bg-elevated', '#101820')
    document.documentElement.style.setProperty('--color-text-primary', '#f8f8f2')
    document.documentElement.style.setProperty('--color-border-subtle', '#3e3e44')
    document.documentElement.style.setProperty('--color-accent-blue', '#66d9ef')

    render(<MarkdownRenderer content={'```mermaid\ngraph TD;\n  A-->B\n```'} />)

    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledWith(
        expect.stringMatching(/^mermaid-/),
        'graph TD;\n  A-->B'
      )
    })

    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: expect.objectContaining({
        primaryColor: '#101820',
        primaryTextColor: '#f8f8f2',
        primaryBorderColor: '#3e3e44',
        lineColor: '#66d9ef',
      }),
    }))
    expect(screen.getByLabelText('Mermaid diagram')).toBeInTheDocument()
    expect(screen.queryByText('graph TD;')).not.toBeInTheDocument()
  })

  it('keeps non-mermaid fenced code blocks as styled code', () => {
    render(<MarkdownRenderer content={'```typescript\nconst value = 1\n```'} />)

    const code = screen.getByText('const value = 1')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('language-typescript')
    expect(mermaidMock.render).not.toHaveBeenCalled()
  })
})
