import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act, screen, fireEvent } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { specOrchestratorTerminalId } from '../../common/terminalIdentity'
import type { EnrichedSession } from '../../types/session'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'

const mockFocusEnd = vi.fn()
const updateSessionSpecContentMock = vi.hoisted(() => vi.fn())
const setSelectionMock = vi.hoisted(() => vi.fn())
const getOrchestratorAgentTypeMock = vi.hoisted(() => vi.fn())
const getSpecClarificationAgentTypeMock = vi.hoisted(() => vi.fn())
const getTerminalStartStateMock = vi.hoisted(() => vi.fn(() => 'started'))
const getTerminalAgentTypeMock = vi.hoisted(() => vi.fn(() => 'claude'))
const loadReviewCommentsMock = vi.hoisted(() => vi.fn())
const saveReviewCommentsMock = vi.hoisted(() => vi.fn())
const clearReviewCommentsMock = vi.hoisted(() => vi.fn())

interface SpecContentMock {
  content: string
  displayName: string | null
  hasData: boolean
}

let specContentMock: SpecContentMock = {
  content: 'Test spec content',
  displayName: 'test-spec',
  hasData: true
}

let sessionsMock: EnrichedSession[] = []

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), UnlistenFn: vi.fn() }))

vi.mock('../../hooks/useProjectFileIndex', () => ({
  useProjectFileIndex: () => ({
    files: [],
    isLoading: false,
    error: null,
    ensureIndex: vi.fn().mockResolvedValue([]),
    refreshIndex: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockReturnValue([]),
  })
}))

vi.mock('../../hooks/useSpecContent', () => ({
  useSpecContent: () => specContentMock
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: sessionsMock,
    updateSessionSpecContent: updateSessionSpecContentMock,
  }),
}))

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    setSelection: setSelectionMock,
  }),
}))

vi.mock('../../hooks/useClaudeSession', () => ({
  useClaudeSession: () => ({
    getOrchestratorAgentType: getOrchestratorAgentTypeMock,
    getSpecClarificationAgentType: getSpecClarificationAgentTypeMock,
  }),
}))

vi.mock('../../common/terminalStartState', () => ({
  getTerminalStartState: getTerminalStartStateMock,
  getTerminalAgentType: getTerminalAgentTypeMock,
}))

vi.mock('../../hooks/useSpecReviewCommentStore', () => ({
  useSpecReviewCommentStore: () => ({
    load: loadReviewCommentsMock,
    save: saveReviewCommentsMock,
    clear: clearReviewCommentsMock,
  }),
}))

vi.mock('../../common/uiEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/uiEvents')>()
  return {
    ...actual,
    emitUiEvent: vi.fn(),
  }
})

vi.mock('./SpecReviewEditor', async () => {
  const React = await import('react')

  return {
    SpecReviewEditor: ({
      specId,
      selection,
      onLineClick,
      onLineMouseEnter,
      onLineMouseUp,
    }: {
      specId: string
      selection: { startLine: number; endLine: number; specId: string } | null
      onLineClick: (lineNum: number, specId: string, event?: React.MouseEvent) => void
      onLineMouseEnter?: (lineNum: number) => void
      onLineMouseUp?: (event: MouseEvent) => void
    }) => {
      const onLineClickRef = React.useRef(onLineClick)
      const onLineMouseEnterRef = React.useRef(onLineMouseEnter)
      const onLineMouseUpRef = React.useRef(onLineMouseUp)

      React.useEffect(() => {
        onLineClickRef.current = onLineClick
        onLineMouseEnterRef.current = onLineMouseEnter
        onLineMouseUpRef.current = onLineMouseUp
      }, [onLineClick, onLineMouseEnter, onLineMouseUp])

      return (
        <div data-testid="spec-review-editor">
          <button onClick={() => onLineClick(2, specId)}>Select line</button>
          <button
            disabled={!selection}
            onClick={() => onLineMouseUp?.(new MouseEvent('mouseup', { clientX: 24, clientY: 48 }))}
          >
            Open comment form
          </button>
          <button
            onClick={() => {
              onLineClickRef.current(2, specId)
              onLineMouseUpRef.current?.(new MouseEvent('mouseup', { clientX: 24, clientY: 48 }))
            }}
          >
            Select line and open comment form
          </button>
          <button
            onClick={() => {
              onLineClickRef.current(2, specId)
              onLineMouseEnterRef.current?.(4)
              onLineMouseUpRef.current?.(new MouseEvent('mouseup', { clientX: 24, clientY: 48 }))
            }}
          >
            Drag select and open comment form
          </button>
          <button
            onClick={() => {
              onLineClickRef.current(2, specId)
              onLineClickRef.current(4, specId, { shiftKey: true } as React.MouseEvent)
              onLineClickRef.current(3, specId)
              onLineMouseEnterRef.current?.(5)
              onLineMouseUpRef.current?.(new MouseEvent('mouseup', { clientX: 24, clientY: 48 }))
            }}
          >
            Drag existing selection and open comment form
          </button>
        </div>
      )
    },
  }
})

vi.mock('./MarkdownEditor', async () => {
  const React = await import('react')
  return {
    MarkdownEditor: React.forwardRef((props: { value: string; onChange: (val: string) => void }, ref) => {
      if (ref && typeof ref === 'object' && 'current' in ref) {
        ref.current = { focusEnd: mockFocusEnd }
      }
      return (
        <div>
          <textarea
            data-testid="markdown-editor-input"
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
          />
          <div data-testid="markdown-editor">{props.value}</div>
        </div>
      )
    })
  }
})

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  )
}))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { SpecEditor } from './SpecEditor'
import { TestProviders } from '../../tests/test-utils'

async function pressKey(key: string, opts: KeyboardEventInit = {}) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, ...opts })
    window.dispatchEvent(event)
  })
}

describe('SpecEditor keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    specContentMock = {
      content: 'Test spec content',
      displayName: 'test-spec',
      hasData: true
    }
    sessionsMock = []
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })
    updateSessionSpecContentMock.mockReset()
    setSelectionMock.mockReset()
    setSelectionMock.mockResolvedValue(undefined)
    getOrchestratorAgentTypeMock.mockReset()
    getOrchestratorAgentTypeMock.mockResolvedValue('claude')
    getSpecClarificationAgentTypeMock.mockReset()
    getSpecClarificationAgentTypeMock.mockResolvedValue('claude')
    getTerminalStartStateMock.mockReset()
    getTerminalStartStateMock.mockReturnValue('started')
    getTerminalAgentTypeMock.mockReset()
    getTerminalAgentTypeMock.mockReturnValue('claude')
    loadReviewCommentsMock.mockReset()
    loadReviewCommentsMock.mockResolvedValue([])
    saveReviewCommentsMock.mockReset()
    saveReviewCommentsMock.mockResolvedValue(undefined)
    clearReviewCommentsMock.mockReset()
    clearReviewCommentsMock.mockResolvedValue(undefined)

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSessionAgentContent) {
        return ['Test spec content', null]
      }
      if (cmd === TauriCommands.SchaltwerkCoreUpdateSpecContent) {
        return undefined
      }
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return []
      }
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      if (cmd === TauriCommands.GetProjectMergePreferences) {
        return { auto_cancel_after_merge: false }
      }
      return undefined
    })

    vi.mocked(listen).mockImplementation(async () => {
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current draft stage and no longer renders the old refine button', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="refine-session" />
      </TestProviders>
    )

    await screen.findByText('draft')
    expect(screen.queryByRole('button', { name: 'Refine' })).toBeNull()
  })

  it('hides clarification controls outside the selected spec terminal layout', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="plain-spec-editor" />
      </TestProviders>
    )

    await screen.findByText('draft')
    expect(screen.queryByRole('button', { name: /clarify/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /reset clarification agent/i })).toBeNull()
  })

  it('submits the clarification prompt to the spec terminal when Clarify is clicked', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'clarify-spec',
          stable_id: 'clarify-spec-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="clarify-spec" allowClarificationControls />
      </TestProviders>
    )

    const button = await screen.findByRole('button', { name: /clarify/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
        {
          agentType: 'claude',
          terminalId: specOrchestratorTerminalId('clarify-spec-stable-id'),
          specName: 'clarify-spec',
        }
      )
    })
    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.SpecClarificationActivity, {
      sessionName: 'clarify-spec',
      terminalId: specOrchestratorTerminalId('clarify-spec-stable-id'),
      source: 'user-submit',
    })
  })

  it('flushes pending spec edits before submitting Clarify', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'clarify-save',
          stable_id: 'clarify-save-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="clarify-save" allowClarificationControls />
      </TestProviders>
    )

    fireEvent.click(await screen.findByTitle('Edit markdown'))
    fireEvent.change(screen.getByTestId('markdown-editor-input'), {
      target: { value: 'Updated draft for clarify' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clarify/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
        name: 'clarify-save',
        content: 'Updated draft for clarify',
      })
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
        {
          terminalId: specOrchestratorTerminalId('clarify-save-stable-id'),
          specName: 'clarify-save',
          agentType: 'claude',
        }
      )
    })

    const commandCalls = vi.mocked(invoke).mock.calls.map(([command]) => command)
    const saveCallIndex = commandCalls.indexOf(TauriCommands.SchaltwerkCoreUpdateSpecContent)
    const clarifyCallIndex = commandCalls.indexOf(TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt)

    expect(saveCallIndex).toBeGreaterThanOrEqual(0)
    expect(clarifyCallIndex).toBeGreaterThan(saveCallIndex)
  })

  it('renders separate Clarify and Run actions in the preview toolbar', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'toolbar-actions-spec',
          stable_id: 'toolbar-actions-spec-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="toolbar-actions-spec" allowClarificationControls />
      </TestProviders>
    )

    const clarifyButton = await screen.findByRole('button', { name: 'Clarify' })
    const runButton = screen.getByRole('button', { name: 'Run' })

    expect(clarifyButton).toBeInTheDocument()
    expect(clarifyButton.className).not.toContain('bg-accent-green')
    expect(runButton.className).toContain('bg-accent-green')
  })

  it('starts an Improve Plan round when the button is clicked on a ready spec', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'improve-plan-spec',
          stable_id: 'improve-plan-spec-stable-id',
          spec_stage: 'ready',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="improve-plan-spec" allowClarificationControls />
      </TestProviders>
    )

    const improveButton = await screen.findByRole('button', { name: 'Improve Plan' })
    expect(improveButton).toBeInTheDocument()
    expect(improveButton).not.toBeDisabled()

    fireEvent.click(improveButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartImprovePlanRound, {
        name: 'improve-plan-spec',
      })
    })
  })

  it('hides the Improve Plan button when the spec is still draft', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'draft-plan-spec',
          stable_id: 'draft-plan-spec-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="draft-plan-spec" allowClarificationControls />
      </TestProviders>
    )

    await screen.findByRole('button', { name: 'Clarify' })
    expect(screen.queryByRole('button', { name: 'Improve Plan' })).toBeNull()
  })

  it('disables the Improve Plan button when a round is already active', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'active-plan-spec',
          stable_id: 'active-plan-spec-stable-id',
          spec_stage: 'ready',
          improve_plan_round_id: 'round-abc',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="active-plan-spec" allowClarificationControls />
      </TestProviders>
    )

    const improveButton = await screen.findByRole('button', { name: 'Improve Plan' })
    expect(improveButton).toBeDisabled()
    fireEvent.click(improveButton)
    expect(invoke).not.toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreStartImprovePlanRound,
      expect.anything()
    )
  })

  it('opens the start-from-spec flow when Run is clicked', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'run-button-spec',
          stable_id: 'run-button-spec-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="run-button-spec" allowClarificationControls />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.StartAgentFromSpec, {
        name: 'run-button-spec',
      })
    })
    expect(invoke).not.toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
      expect.anything()
    )
  })

  it('flushes pending spec edits before emitting Run', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'run-save',
          stable_id: 'run-save-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="run-save" allowClarificationControls />
      </TestProviders>
    )

    fireEvent.click(await screen.findByTitle('Edit markdown'))
    fireEvent.change(screen.getByTestId('markdown-editor-input'), {
      target: { value: 'Updated draft before run' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
        name: 'run-save',
        content: 'Updated draft before run',
      })
      expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.StartAgentFromSpec, {
        name: 'run-save',
      })
    })

    const saveCallOrder = vi.mocked(invoke).mock.invocationCallOrder[
      vi.mocked(invoke).mock.calls.findIndex(([command]) => command === TauriCommands.SchaltwerkCoreUpdateSpecContent)
    ]
    const emitCallOrder = vi.mocked(emitUiEvent).mock.invocationCallOrder[
      vi.mocked(emitUiEvent).mock.calls.findIndex(([event]) => event === UiEvent.StartAgentFromSpec)
    ]

    expect(emitCallOrder).toBeGreaterThan(saveCallOrder)
  })

  it('keeps Clarify disabled until the spec clarification agent reports ready', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'clarify-gated',
          stable_id: 'clarify-gated-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]
    getTerminalStartStateMock.mockReturnValue('starting')

    render(
      <TestProviders>
        <SpecEditor sessionName="clarify-gated" allowClarificationControls />
      </TestProviders>
    )

    const button = await screen.findByRole('button', { name: /clarify/i })
    expect(button).toBeDisabled()

    act(() => {
      window.dispatchEvent(new CustomEvent(String(UiEvent.AgentLifecycle), {
        detail: {
          terminalId: specOrchestratorTerminalId('clarify-gated-stable-id'),
          sessionName: 'clarify-gated',
          agentType: 'claude',
          state: 'ready',
        },
      }))
    })

    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })

  it('runs the start-from-spec shortcut without invoking clarification', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'run-shortcut-spec',
          stable_id: 'run-shortcut-spec-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]
    getTerminalStartStateMock.mockReturnValue('starting')

    render(
      <TestProviders>
        <SpecEditor sessionName="run-shortcut-spec" allowClarificationControls />
      </TestProviders>
    )

    await pressKey('Enter', { metaKey: true })

    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.StartAgentFromSpec, {
      name: 'run-shortcut-spec',
    })
    expect(invoke).not.toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
      expect.anything()
    )
  })

  it('does not run the Clarify shortcut until the spec clarification agent is ready', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'clarify-shortcut',
          stable_id: 'clarify-shortcut-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]
    getTerminalStartStateMock.mockReturnValue('starting')

    render(
      <TestProviders>
        <SpecEditor sessionName="clarify-shortcut" allowClarificationControls />
      </TestProviders>
    )

    await pressKey('R', { metaKey: true, shiftKey: true })
    expect(invoke).not.toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
      expect.anything()
    )

    act(() => {
      window.dispatchEvent(new CustomEvent(String(UiEvent.AgentLifecycle), {
        detail: {
          terminalId: specOrchestratorTerminalId('clarify-shortcut-stable-id'),
          sessionName: 'clarify-shortcut',
          agentType: 'claude',
          state: 'ready',
        },
      }))
    })

    await pressKey('R', { metaKey: true, shiftKey: true })

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
        {
          terminalId: specOrchestratorTerminalId('clarify-shortcut-stable-id'),
          specName: 'clarify-shortcut',
          agentType: 'claude',
        }
      )
    })
  })

  it('resets the clarification agent from the editor toolbar', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'clarify-reset',
          stable_id: 'clarify-reset-stable-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="clarify-reset" allowClarificationControls />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /reset clarification agent/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreResetSpecOrchestrator,
        {
          terminalId: specOrchestratorTerminalId('clarify-reset-stable-id'),
          specName: 'clarify-reset',
          agentType: 'claude',
        }
      )
    })

    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.TerminalReset, {
      kind: 'session',
      sessionId: 'clarify-reset',
    })

    expect(screen.getByRole('button', { name: /clarify/i })).not.toBeDisabled()
    expect(getSpecClarificationAgentTypeMock).toHaveBeenCalled()
  })

  it('moves a draft spec to ready from the editor', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="draft-spec" />
      </TestProviders>
    )

    const button = await screen.findByRole('button', { name: /move to ready/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSpecStage, {
        name: 'draft-spec',
        stage: 'ready',
      })
    })
  })

  it('moves a ready spec back to draft from the editor', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'ready-spec',
          spec_stage: 'ready',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="ready-spec" />
      </TestProviders>
    )

    const button = await screen.findByRole('button', { name: /move to draft/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSpecStage, {
        name: 'ready-spec',
        stage: 'draft',
      })
    })
  })

  it('switches from preview to edit mode and focuses editor when Cmd+T is pressed', async () => {
    const { container } = render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" />
      </TestProviders>
    )

    await waitFor(() => {
      expect(container.querySelector('[title="Edit markdown"]')).toBeTruthy()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await waitFor(() => {
      expect(container.querySelector('[title="Preview markdown"]')).toBeTruthy()
    }, { timeout: 1000 })

    await waitFor(() => {
      expect(mockFocusEnd).toHaveBeenCalled()
    }, { timeout: 1000 })
  })

  it('focuses editor directly when Cmd+T is pressed in edit mode', async () => {
    const { container } = render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" />
      </TestProviders>
    )

    await waitFor(() => {
      expect(container.querySelector('[title="Edit markdown"]')).toBeTruthy()
    })

    const editButton = container.querySelector('[title="Edit markdown"]') as HTMLElement
    act(() => {
      editButton.click()
    })

    await waitFor(() => {
      expect(container.querySelector('[title="Preview markdown"]')).toBeTruthy()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await waitFor(() => {
      expect(mockFocusEnd).toHaveBeenCalled()
    })
  })

  it('does not focus when disableFocusShortcut is true', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="test-spec" disableFocusShortcut={true} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalled()
    })

    mockFocusEnd.mockClear()

    await pressKey('t', { metaKey: true })

    await waitFor(() => {
      expect(mockFocusEnd).not.toHaveBeenCalled()
    })
  })

  it('routes spec review comments to the spec clarification terminal and keeps the spec selected', async () => {
    const sessionName = 'review-spec'
    const stableId = 'spec-stable-123'

    specContentMock = {
      content: 'Line one\nLine two\nLine three',
      displayName: 'Review Spec',
      hasData: true,
    }

    sessionsMock = [
      {
        info: {
          session_id: sessionName,
          stable_id: stableId,
          spec_stage: 'draft',
          original_agent_type: 'droid',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName={sessionName} />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select line' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open comment form' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open comment form' }))

    const commentInput = await screen.findByPlaceholderText('Write your comment...')
    fireEvent.change(commentInput, { target: { value: 'Please tighten the goal statement.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    fireEvent.click(await screen.findByRole('button', { name: /finish review/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.PasteAndSubmitTerminal,
        expect.objectContaining({
          id: specOrchestratorTerminalId(stableId),
          useBracketedPaste: false,
          needsDelayedSubmit: true,
        })
      )
    })
    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.SpecClarificationActivity, {
      sessionName,
      terminalId: specOrchestratorTerminalId(stableId),
      source: 'user-submit',
    })

    await waitFor(() => {
      expect(setSelectionMock).toHaveBeenCalledWith(
        { kind: 'session', payload: sessionName, sessionState: 'spec' },
        false,
        true,
      )
    })

    expect(getOrchestratorAgentTypeMock).not.toHaveBeenCalled()
  })

  it('opens the comment form when selection and mouseup happen in the same interaction', async () => {
    specContentMock = {
      content: 'Line one\nLine two\nLine three',
      displayName: 'Review Spec',
      hasData: true,
    }

    render(
      <TestProviders>
        <SpecEditor sessionName="review-single-line" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Select line and open comment form' }))

    expect(await screen.findByPlaceholderText('Write your comment...')).toBeInTheDocument()
    expect(screen.getByText('Line 2')).toBeInTheDocument()
  })

  it('opens the comment form after dragging across multiple lines in one interaction', async () => {
    specContentMock = {
      content: 'Line one\nLine two\nLine three\nLine four',
      displayName: 'Review Spec',
      hasData: true,
    }

    render(
      <TestProviders>
        <SpecEditor sessionName="review-range" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Drag select and open comment form' }))

    expect(await screen.findByPlaceholderText('Write your comment...')).toBeInTheDocument()
    expect(screen.getByText('Lines 2-4')).toBeInTheDocument()
  })

  it('keeps extending an existing selection when dragging starts inside the selected range', async () => {
    specContentMock = {
      content: 'Line one\nLine two\nLine three\nLine four\nLine five',
      displayName: 'Review Spec',
      hasData: true,
    }

    render(
      <TestProviders>
        <SpecEditor sessionName="review-existing-selection" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Drag existing selection and open comment form' }))

    expect(await screen.findByPlaceholderText('Write your comment...')).toBeInTheDocument()
    expect(screen.getByText('Lines 2-5')).toBeInTheDocument()
  })
})

describe('SpecEditor implementation plan preview', () => {
  beforeEach(() => {
    specContentMock = {
      content: 'Spec body',
      displayName: 'Plan Spec',
      hasData: true,
    }
    sessionsMock = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the implementation plan block in preview mode when the field is populated', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'plan-present',
          stable_id: 'plan-present-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
          spec_implementation_plan: '1. Step one.\n2. Step two.',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="plan-present" />
      </TestProviders>
    )

    await screen.findByText('draft')
    const previewButton = screen.queryByTitle('Preview markdown')
    if (previewButton) {
      fireEvent.click(previewButton)
    }

    const planBlock = await screen.findByTestId('spec-implementation-plan')
    expect(planBlock).toBeInTheDocument()
    expect(planBlock).toHaveTextContent('Step one')
    expect(planBlock).toHaveTextContent('Implementation Plan')
  })

  it('does not render the plan block when the field is empty', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'plan-missing',
          stable_id: 'plan-missing-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
          spec_implementation_plan: '   ',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="plan-missing" />
      </TestProviders>
    )

    await screen.findByText('draft')
    const previewButton = screen.queryByTitle('Preview markdown')
    if (previewButton) {
      fireEvent.click(previewButton)
    }

    expect(screen.queryByTestId('spec-implementation-plan')).toBeNull()
  })
})

describe('SpecEditor review comment persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    specContentMock = {
      content: 'Line one\nLine two\nLine three',
      displayName: 'Review Spec',
      hasData: true,
    }
    sessionsMock = []
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    loadReviewCommentsMock.mockReset(); loadReviewCommentsMock.mockResolvedValue([])
    saveReviewCommentsMock.mockReset(); saveReviewCommentsMock.mockResolvedValue(undefined)
    clearReviewCommentsMock.mockReset(); clearReviewCommentsMock.mockResolvedValue(undefined)
    updateSessionSpecContentMock.mockReset()
    setSelectionMock.mockReset()
    setSelectionMock.mockResolvedValue(undefined)
    getOrchestratorAgentTypeMock.mockReset()
    getOrchestratorAgentTypeMock.mockResolvedValue('claude')

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSessionAgentContent) {
        return ['Line one\nLine two\nLine three', null]
      }
      return undefined
    })
    vi.mocked(listen).mockImplementation(async () => () => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const storedComment = (id: string, ts: number) => ({
    id,
    specId: 'review-spec',
    lineRange: { start: 1, end: 1 },
    selectedText: 'Line one',
    comment: `note-${id}`,
    timestamp: ts,
  })

  it('enters review mode with empty state when nothing is stored', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))

    await waitFor(() => {
      expect(loadReviewCommentsMock).toHaveBeenCalled()
    })
    expect(screen.queryByText('Continue your pending review?')).toBeNull()
    expect(screen.queryByRole('button', { name: /finish review/i })).toBeNull()
  })

  it('shows the resume prompt when stored comments exist and Continue hydrates them', async () => {
    loadReviewCommentsMock.mockResolvedValue([storedComment('c1', 1), storedComment('c2', 2)])

    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))

    const continueButton = await screen.findByRole('button', { name: 'Continue' })
    expect(screen.getByText('Continue your pending review?')).toBeInTheDocument()

    fireEvent.click(continueButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /finish review \(2\)/i })).toBeInTheDocument()
    })
    expect(clearReviewCommentsMock).not.toHaveBeenCalled()
  })

  it('Clear discards storage and opens review mode empty', async () => {
    loadReviewCommentsMock.mockResolvedValue([storedComment('c1', 1)])

    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))

    const clearButton = await screen.findByRole('button', { name: 'Clear & start fresh' })
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(clearReviewCommentsMock).toHaveBeenCalled()
    })
    expect(screen.queryByText('Continue your pending review?')).toBeNull()
    expect(screen.queryByRole('button', { name: /finish review/i })).toBeNull()
  })

  it('persists the comment list when a comment is submitted', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    await waitFor(() => expect(loadReviewCommentsMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Select line and open comment form' }))
    fireEvent.change(await screen.findByPlaceholderText('Write your comment...'), {
      target: { value: 'Please tighten.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(saveReviewCommentsMock).toHaveBeenCalled()
    })
    const latestCall = saveReviewCommentsMock.mock.calls.at(-1)
    expect(latestCall).toBeDefined()
    expect(Array.isArray(latestCall?.[0])).toBe(true)
    expect(latestCall?.[0]).toHaveLength(1)
    expect(latestCall?.[0][0].comment).toBe('Please tighten.')
  })

  it('does not clear storage on Finish Review', async () => {
    sessionsMock = [
      {
        info: {
          session_id: 'review-spec',
          stable_id: 'review-spec-id',
          spec_stage: 'draft',
          branch: 'main',
          worktree_path: '',
          base_branch: 'main',
          status: 'spec',
          is_current: false,
          session_type: 'worktree',
          session_state: 'spec',
        },
        terminals: [],
      },
    ]

    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    await waitFor(() => expect(loadReviewCommentsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Select line and open comment form' }))
    fireEvent.change(await screen.findByPlaceholderText('Write your comment...'), {
      target: { value: 'Fix X' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(saveReviewCommentsMock).toHaveBeenCalled())

    fireEvent.click(await screen.findByRole('button', { name: /finish review/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.PasteAndSubmitTerminal,
        expect.any(Object),
      )
    })
    expect(clearReviewCommentsMock).not.toHaveBeenCalled()
  })

  it('does not clear storage when pressing Cancel Review', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    await waitFor(() => expect(loadReviewCommentsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Select line and open comment form' }))
    fireEvent.change(await screen.findByPlaceholderText('Write your comment...'), {
      target: { value: 'Fix X' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(saveReviewCommentsMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Review' }))

    expect(clearReviewCommentsMock).not.toHaveBeenCalled()
  })

  it('does not clear storage when pressing Escape to exit review', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    await waitFor(() => expect(loadReviewCommentsMock).toHaveBeenCalled())

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(clearReviewCommentsMock).not.toHaveBeenCalled()
  })

  it('does not clear storage when pressing Exit Review toolbar button', async () => {
    render(
      <TestProviders>
        <SpecEditor sessionName="review-spec" />
      </TestProviders>
    )

    fireEvent.click(await screen.findByRole('button', { name: /comment/i }))
    await waitFor(() => expect(loadReviewCommentsMock).toHaveBeenCalled())

    fireEvent.click(screen.getByTitle('Exit review mode'))

    expect(clearReviewCommentsMock).not.toHaveBeenCalled()
  })
})
