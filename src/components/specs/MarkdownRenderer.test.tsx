import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
