import { describe, it, expect, vi } from 'vitest'
import { runContextualSpecClarify } from './contextualSpecClarify'
import { TauriCommands } from '../common/tauriCommands'
import { UiEvent } from '../common/uiEvents'
import type { ContextualActionCreateSpecDetail } from '../common/uiEvents'

function makeDetail(overrides: Partial<ContextualActionCreateSpecDetail> = {}): ContextualActionCreateSpecDetail {
  return {
    prompt: 'Investigate issue #42',
    name: 'Clarify',
    contextType: 'issue',
    contextNumber: '42',
    contextTitle: 'Fix login bug',
    contextUrl: 'https://github.com/owner/repo/issues/42',
    ...overrides,
  }
}

describe('runContextualSpecClarify', () => {
  it('creates spec, starts orchestrator with backend name, submits prompt, emits SpecCreated', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: 'spec-id-123', name: '42-fix-login-bug' })
      .mockResolvedValueOnce('submitted')
    const startSpecOrchestratorTop = vi.fn(async (_args: { terminalId: string; specName: string }) => {})
    const emitUiEvent = vi.fn()

    await runContextualSpecClarify({
      detail: makeDetail(),
      invoke: invoke as unknown as typeof import('@tauri-apps/api/core').invoke,
      emitUiEvent,
      startSpecOrchestratorTop,
    })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      TauriCommands.SchaltwerkCoreCreateSpecSession,
      expect.objectContaining({
        name: '42-fix-login-bug',
        specContent: 'Investigate issue #42',
        issueNumber: 42,
        issueUrl: 'https://github.com/owner/repo/issues/42',
        prNumber: null,
        prUrl: null,
        userEditedName: false,
      }),
    )

    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.SpecCreated, { name: '42-fix-login-bug' })

    expect(startSpecOrchestratorTop).toHaveBeenCalledWith({
      terminalId: expect.stringContaining('spec-id-123'),
      specName: '42-fix-login-bug',
    })

    expect(invoke).toHaveBeenNthCalledWith(
      2,
      TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
      expect.objectContaining({
        terminalId: expect.stringContaining('spec-id-123'),
        specName: '42-fix-login-bug',
      }),
    )
    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.SpecClarificationActivity, {
      sessionName: '42-fix-login-bug',
      terminalId: expect.stringContaining('spec-id-123'),
      source: 'user-submit',
    })
  })

  it('uses the backend-returned name when it differs from the requested name (collision)', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: 'spec-id-999', name: '42-fix-login-bug-2' })
      .mockResolvedValueOnce('submitted')
    const startSpecOrchestratorTop = vi.fn(async (_args: { terminalId: string; specName: string }) => {})
    const emitUiEvent = vi.fn()

    await runContextualSpecClarify({
      detail: makeDetail(),
      invoke: invoke as unknown as typeof import('@tauri-apps/api/core').invoke,
      emitUiEvent,
      startSpecOrchestratorTop,
    })

    expect(emitUiEvent).toHaveBeenCalledWith(UiEvent.SpecCreated, { name: '42-fix-login-bug-2' })
    expect(startSpecOrchestratorTop).toHaveBeenCalledWith({
      terminalId: expect.stringContaining('spec-id-999'),
      specName: '42-fix-login-bug-2',
    })
    const submitArgs = invoke.mock.calls[1]?.[1] as { specName: string; terminalId: string } | undefined
    expect(submitArgs?.specName).toBe('42-fix-login-bug-2')
    expect(submitArgs?.terminalId).toMatch(/spec-id-999/)
  })

  it('derives terminalId from the backend-assigned spec id, matching SpecEditor rebinding', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: 'derived-stable', name: 'clarify' })
      .mockResolvedValueOnce('submitted')
    const startSpecOrchestratorTop = vi.fn(async (_args: { terminalId: string; specName: string }) => {})
    const emitUiEvent = vi.fn()

    await runContextualSpecClarify({
      detail: makeDetail(),
      invoke: invoke as unknown as typeof import('@tauri-apps/api/core').invoke,
      emitUiEvent,
      startSpecOrchestratorTop,
    })

    const submitCall = invoke.mock.calls[1]?.[1] as { terminalId: string } | undefined
    const startCall = startSpecOrchestratorTop.mock.calls[0]?.[0] as { terminalId: string } | undefined
    expect(submitCall?.terminalId).toBe(startCall?.terminalId)
    expect(startCall?.terminalId).toMatch(/derived-stable/)
  })

  it('does not submit the clarification prompt when orchestrator start fails', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: 'spec-id', name: 'clarify' })
    const startSpecOrchestratorTop = vi.fn(async (_args: { terminalId: string; specName: string }) => {
      throw new Error('pty boom')
    })
    const emitUiEvent = vi.fn()

    await expect(
      runContextualSpecClarify({
        detail: makeDetail(),
        invoke: invoke as unknown as typeof import('@tauri-apps/api/core').invoke,
        emitUiEvent,
        startSpecOrchestratorTop,
      }),
    ).rejects.toThrow('pty boom')

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreCreateSpecSession,
      expect.any(Object),
    )
    expect(invoke).not.toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreSubmitSpecClarificationPrompt,
      expect.any(Object),
    )
  })

  it('falls back to detail.name when issue context is missing', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ id: 'spec-id', name: 'clarify-action' })
      .mockResolvedValueOnce('submitted')
    const startSpecOrchestratorTop = vi.fn(async (_args: { terminalId: string; specName: string }) => {})
    const emitUiEvent = vi.fn()

    await runContextualSpecClarify({
      detail: {
        prompt: 'generic prompt',
        name: 'Clarify Action',
      },
      invoke: invoke as unknown as typeof import('@tauri-apps/api/core').invoke,
      emitUiEvent,
      startSpecOrchestratorTop,
    })

    const createCall = invoke.mock.calls[0]?.[1] as
      | { name: string; issueNumber: number | null; issueUrl: string | null }
      | undefined
    expect(createCall?.name).toBe('clarify-action')
    expect(createCall?.issueNumber).toBeNull()
    expect(createCall?.issueUrl).toBeNull()
  })
})
