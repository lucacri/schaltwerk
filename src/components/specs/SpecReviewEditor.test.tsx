import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpecReviewEditor } from './SpecReviewEditor'

const codeMirrorMock = vi.hoisted(() => vi.fn())
const fakeDispatch = vi.hoisted(() => vi.fn())
const fakePosAtCoords = vi.hoisted(() => vi.fn(({ y }: { y: number }) => (y >= 40 ? 4 : 2)))
const domEventHandlersMock = vi.hoisted(() => vi.fn((handlers: Record<string, unknown>) => handlers))
const stateEffectDefineMock = vi.hoisted(() => vi.fn(() => ({
  of: (value: unknown) => ({ type: 'selected-line-effect', value }),
})))

const fakeView = {
  state: {
    doc: {
      lines: 4,
      lineAt: (pos: number) => ({ number: pos }),
      line: (line: number) => ({ from: line }),
    },
  },
  posAtCoords: fakePosAtCoords,
  dispatch: fakeDispatch,
}

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    codeMirrorMock(props)
    const onCreateEditor = props.onCreateEditor as ((view: typeof fakeView) => void) | undefined
    onCreateEditor?.(fakeView)
    return null
  },
}))

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({ kind: 'markdown' }),
}))

vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: () => ({ kind: 'theme' }),
    lineWrapping: { kind: 'lineWrapping' },
    editable: {
      of: (value: boolean) => ({ kind: 'editable', value }),
    },
    decorations: {
      from: vi.fn(),
    },
    domEventHandlers: domEventHandlersMock,
  },
  Decoration: {
    none: { kind: 'none' },
    line: () => ({
      range: (from: number) => ({ from }),
    }),
  },
  DecorationSet: class DecorationSet {},
  lineNumbers: () => ({ kind: 'lineNumbers' }),
}))

vi.mock('@codemirror/state', () => ({
  StateField: {
    define: vi.fn((config: unknown) => config),
  },
  StateEffect: {
    define: stateEffectDefineMock,
  },
  RangeSet: {
    of: (ranges: unknown[]) => ranges,
  },
}))

function latestCodeMirrorProps(): Record<string, unknown> {
  const lastCall = codeMirrorMock.mock.calls[codeMirrorMock.mock.calls.length - 1]
  if (!lastCall) {
    throw new Error('CodeMirror was not rendered')
  }
  return lastCall[0] as Record<string, unknown>
}

function getMouseHandlers(): {
  mousedown: (event: MouseEvent, view: typeof fakeView) => boolean
  mousemove: (event: MouseEvent, view: typeof fakeView) => boolean
  mouseup: (event: MouseEvent) => boolean
  mouseleave: (event: MouseEvent) => boolean
} {
  const extensions = (latestCodeMirrorProps().extensions as unknown[]) ?? []
  const handlers = extensions.find((extension): extension is Record<string, unknown> => {
    return typeof extension === 'object' && extension !== null && 'mousedown' in extension
  })

  if (!handlers) {
    throw new Error('Mouse handlers extension was not rendered')
  }

  return handlers as {
    mousedown: (event: MouseEvent, view: typeof fakeView) => boolean
    mousemove: (event: MouseEvent, view: typeof fakeView) => boolean
    mouseup: (event: MouseEvent) => boolean
    mouseleave: (event: MouseEvent) => boolean
  }
}

describe('SpecReviewEditor', () => {
  beforeEach(() => {
    codeMirrorMock.mockClear()
    fakeDispatch.mockClear()
    fakePosAtCoords.mockClear()
  })

  it('updates selection highlight dispatches when the selected line range changes', async () => {
    const onLineClick = vi.fn()
    const onLineMouseUp = vi.fn()

    const { rerender } = render(
      <SpecReviewEditor
        content={'Line one\nLine two\nLine three\nLine four'}
        specId="spec-alpha"
        selection={null}
        onLineClick={onLineClick}
        onLineMouseUp={onLineMouseUp}
      />
    )

    await waitFor(() => {
      expect(fakeDispatch).toHaveBeenLastCalledWith({
        effects: { type: 'selected-line-effect', value: null },
      })
    })

    rerender(
      <SpecReviewEditor
        content={'Line one\nLine two\nLine three\nLine four'}
        specId="spec-alpha"
        selection={{ startLine: 2, endLine: 4, specId: 'spec-alpha' }}
        onLineClick={onLineClick}
        onLineMouseUp={onLineMouseUp}
      />
    )

    await waitFor(() => {
      expect(fakeDispatch).toHaveBeenLastCalledWith({
        effects: {
          type: 'selected-line-effect',
          value: { from: 2, to: 4 },
        },
      })
    })

    rerender(
      <SpecReviewEditor
        content={'Line one\nLine two\nLine three\nLine four'}
        specId="spec-alpha"
        selection={null}
        onLineClick={onLineClick}
        onLineMouseUp={onLineMouseUp}
      />
    )

    await waitFor(() => {
      expect(fakeDispatch).toHaveBeenLastCalledWith({
        effects: { type: 'selected-line-effect', value: null },
      })
    })
  })

  it('routes mouse gestures through the current callback refs and spec id', async () => {
    const firstLineClick = vi.fn()
    const firstLineMouseEnter = vi.fn()
    const firstLineMouseUp = vi.fn()

    const { rerender } = render(
      <SpecReviewEditor
        content={'Line one\nLine two\nLine three\nLine four'}
        specId="spec-alpha"
        selection={null}
        onLineClick={firstLineClick}
        onLineMouseEnter={firstLineMouseEnter}
        onLineMouseUp={firstLineMouseUp}
      />
    )

    const currentLineClick = vi.fn()
    const currentLineMouseEnter = vi.fn()
    const currentLineMouseUp = vi.fn()

    rerender(
      <SpecReviewEditor
        content={'Line one\nLine two\nLine three\nLine four'}
        specId="spec-beta"
        selection={{ startLine: 2, endLine: 2, specId: 'spec-beta' }}
        onLineClick={currentLineClick}
        onLineMouseEnter={currentLineMouseEnter}
        onLineMouseUp={currentLineMouseUp}
      />
    )

    const mouseHandlers = getMouseHandlers()

    expect(
      mouseHandlers.mousedown(
        new MouseEvent('mousedown', { clientX: 12, clientY: 20, shiftKey: true }),
        fakeView
      )
    ).toBe(true)
    expect(currentLineClick).toHaveBeenCalledWith(
      2,
      'spec-beta',
      expect.objectContaining({ shiftKey: true })
    )
    expect(firstLineClick).not.toHaveBeenCalled()

    expect(
      mouseHandlers.mousemove(
        new MouseEvent('mousemove', { clientX: 12, clientY: 40 }),
        fakeView
      )
    ).toBe(false)
    expect(currentLineMouseEnter).toHaveBeenCalledWith(4)
    expect(firstLineMouseEnter).not.toHaveBeenCalled()

    expect(
      mouseHandlers.mouseup(new MouseEvent('mouseup', { clientX: 12, clientY: 40 }))
    ).toBe(false)
    expect(currentLineMouseUp).toHaveBeenCalledTimes(1)
    expect(firstLineMouseUp).not.toHaveBeenCalled()
  })
})
