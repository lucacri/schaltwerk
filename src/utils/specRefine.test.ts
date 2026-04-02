import { describe, it, expect, vi, afterEach } from 'vitest'
import * as specRefine from './specRefine'
import { logger } from './logger'
import * as uiEvents from '../common/uiEvents'

describe('runSpecRefineWithOrchestrator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('awaits orchestrator selection before emitting refine events', async () => {
    const selectOrchestrator = vi.fn().mockResolvedValue(undefined)
    const emitUiEventSpy = vi.spyOn(uiEvents, 'emitUiEvent').mockImplementation(() => {})

    await specRefine.runSpecRefineWithOrchestrator({
      sessionId: 'foo',
      displayName: 'Foo',
      selectOrchestrator,
      logContext: '[test]',
    })

    expect(selectOrchestrator).toHaveBeenCalledTimes(1)
    const refineCall = emitUiEventSpy.mock.calls.find(([event]) => event === uiEvents.UiEvent.RefineSpecInNewTab)
    expect(refineCall).toBeDefined()
    expect(refineCall?.[1]).toEqual({ sessionName: 'foo', displayName: 'Foo' })
  })

  it('logs a warning but still emits when orchestrator selection fails', async () => {
    const error = new Error('boom')
    const selectOrchestrator = vi.fn().mockRejectedValue(error)
    const emitUiEventSpy = vi.spyOn(uiEvents, 'emitUiEvent').mockImplementation(() => {})
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await specRefine.runSpecRefineWithOrchestrator({
      sessionId: 'foo',
      displayName: undefined,
      selectOrchestrator,
      logContext: '[test]',
    })

    expect(selectOrchestrator).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[test] Failed to switch to orchestrator for refine', error)
    const refineCall = emitUiEventSpy.mock.calls.find(([event]) => event === uiEvents.UiEvent.RefineSpecInNewTab)
    expect(refineCall?.[1]).toEqual({ sessionName: 'foo', displayName: undefined })
  })
})
