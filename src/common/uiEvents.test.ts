import { describe, expect, expectTypeOf, it } from 'vitest'
import { UiEvent, type UiEventPayloads } from './uiEvents'

describe('UiEvent payload typing', () => {
    it('exposes SpecClarificationActivity with a typed payload', () => {
        expect(UiEvent.SpecClarificationActivity).toBe('schaltwerk:spec-clarification-activity')
        expectTypeOf<UiEventPayloads[UiEvent.SpecClarificationActivity]>().toEqualTypeOf<{
            sessionName: string
            terminalId?: string
            source: 'user-submit' | 'agent-started' | 'attention-clear' | 'terminal-output'
        }>()
    })
})
