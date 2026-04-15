import { render } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MarkdownEditor, MARKDOWN_PASTE_CHARACTER_LIMIT, handleMarkdownPaste } from './MarkdownEditor'
import type { ProjectFileIndexApi } from '../../hooks/useProjectFileIndex'

const codeMirrorMock = vi.fn((props: unknown) => props)
const pushToastMock = vi.fn()

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: unknown) => {
    codeMirrorMock(props)
    return null
  },
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useOptionalToast: () => ({
    pushToast: pushToastMock,
  }),
}))

function captureExtensions(extraProps: Partial<ComponentProps<typeof MarkdownEditor>> = {}): Extension[] {
  codeMirrorMock.mockClear()
  const { unmount } = render(
    <MarkdownEditor
      value=""
      onChange={() => {}}
      {...extraProps}
    />
  )
  unmount()
  const lastCall = codeMirrorMock.mock.calls[codeMirrorMock.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('CodeMirror was not rendered')
  }
  const [props] = lastCall as [Record<string, unknown>]
  return (props.extensions as Extension[]) ?? []
}

function resolveContentAttributes(extensions: Extension[]): Record<string, string> {
  const state = EditorState.create({ extensions })
  const entries = state.facet(EditorView.contentAttributes)
  const merged: Record<string, string> = {}
  for (const entry of entries) {
    if (typeof entry === 'function') continue
    Object.assign(merged, entry)
  }
  return merged
}

function resolveEditorAttributes(extensions: Extension[]): Record<string, string> {
  const state = EditorState.create({ extensions })
  const entries = state.facet(EditorView.editorAttributes)
  const merged: Record<string, string> = {}
  for (const entry of entries) {
    if (typeof entry === 'function') continue
    Object.assign(merged, entry)
  }
  return merged
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    codeMirrorMock.mockClear()
    pushToastMock.mockClear()
  })

  it('includes base extensions when no file reference provider is supplied', () => {
    const extensions = captureExtensions()
    expect(Array.isArray(extensions)).toBe(true)
    expect(extensions.length).toBeGreaterThan(0)
  })

  it('adds file reference autocomplete extension when provider is supplied', () => {
    const baseExtensions = captureExtensions()

    const provider: ProjectFileIndexApi = {
      files: [],
      isLoading: false,
      error: null,
      ensureIndex: vi.fn().mockResolvedValue([]),
      refreshIndex: vi.fn().mockResolvedValue([]),
      getSnapshot: vi.fn().mockReturnValue([]),
    }

    const withProviderExtensions = captureExtensions({ fileReferenceProvider: provider })

    expect(withProviderExtensions.length).toBe(baseExtensions.length + 1)

    const lastExtension = withProviderExtensions[withProviderExtensions.length - 1]
    expect(Array.isArray(lastExtension)).toBe(true)
    expect((lastExtension as Extension[]).length).toBe(2)
  })

  it('blocks oversized paste operations and reports through toast', () => {
    const largePayload = 'a'.repeat(MARKDOWN_PASTE_CHARACTER_LIMIT + 1)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    Object.defineProperty(event, 'preventDefault', { value: preventDefault, configurable: true })
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation, configurable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: vi.fn(() => largePayload),
      },
    })
    const handled = handleMarkdownPaste(event, { pushToast: pushToastMock })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'warning',
    }))
  })

  describe('accessibility', () => {
    it('sets role=textbox and aria-multiline=true by default', () => {
      const attrs = resolveContentAttributes(captureExtensions())
      expect(attrs.role).toBe('textbox')
      expect(attrs['aria-multiline']).toBe('true')
    })

    it('marks the focused content node as a standard text input surface for macOS voice tools', () => {
      const attrs = resolveContentAttributes(captureExtensions())
      expect(attrs.tabindex).toBe('0')
      expect(attrs.inputmode).toBe('text')
      expect(attrs.spellcheck).toBe('false')
      expect(attrs.autocorrect).toBe('off')
      expect(attrs.autocapitalize).toBe('off')
      expect(attrs['data-lucode-text-input-surface']).toBe('markdown-editor')
    })

    it('labels the editor root consistently with the focused content node', () => {
      const attrs = resolveEditorAttributes(captureExtensions({ ariaLabel: 'Prompt and context' }))
      expect(attrs['aria-label']).toBe('Prompt and context')
      expect(attrs['data-lucode-text-input-root']).toBe('markdown-editor')
    })

    it('falls back to placeholder as aria-label when no ariaLabel is provided', () => {
      const attrs = resolveContentAttributes(captureExtensions({ placeholder: 'Describe the task…' }))
      expect(attrs['aria-label']).toBe('Describe the task…')
    })

    it('uses ariaLabel prop when provided', () => {
      const attrs = resolveContentAttributes(captureExtensions({ ariaLabel: 'Prompt and context' }))
      expect(attrs['aria-label']).toBe('Prompt and context')
    })

    it('prefers ariaLabelledBy over ariaLabel and omits aria-label', () => {
      const attrs = resolveContentAttributes(captureExtensions({
        ariaLabel: 'ignored',
        ariaLabelledBy: 'prompt-label-id',
      }))
      expect(attrs['aria-labelledby']).toBe('prompt-label-id')
      expect(attrs['aria-label']).toBeUndefined()
    })

    it('sets aria-readonly=true when readOnly is enabled', () => {
      const attrs = resolveContentAttributes(captureExtensions({ readOnly: true }))
      expect(attrs['aria-readonly']).toBe('true')
    })

    it('omits aria-readonly when editable', () => {
      const attrs = resolveContentAttributes(captureExtensions())
      expect(attrs['aria-readonly']).toBeUndefined()
    })
  })

  it('allows paste operations within the configured limit', () => {
    const allowedPayload = 'b'.repeat(MARKDOWN_PASTE_CHARACTER_LIMIT)

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    Object.defineProperty(event, 'preventDefault', { value: preventDefault, configurable: true })
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation, configurable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: vi.fn(() => allowedPayload),
      },
    })
    const handled = handleMarkdownPaste(event, { pushToast: pushToastMock })

    expect(handled).toBe(false)
    expect(pushToastMock).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })
})
