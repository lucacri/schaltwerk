import { describe, expect, it } from 'vitest'
import { BuildCreatePayloadError, buildCreatePayload, createEmptyAdvancedState } from './buildCreatePayload'
import type { AgentFavoriteOption, PresetFavoriteOption, SpecFavoriteOption } from './favoriteOptions'
import type { AgentPreset } from '../../../types/agentPreset'

const spec: SpecFavoriteOption = {
    kind: 'spec',
    id: '__schaltwerk_spec__',
    title: 'Spec only',
    summary: 'Prompt-only setup',
    accentColor: 'var(--color-border-strong)',
    disabled: false,
}

const rawClaude: AgentFavoriteOption = {
    kind: 'agent',
    id: '__agent__claude',
    title: 'Claude',
    summary: 'Raw agent',
    accentColor: 'var(--color-accent-blue)',
    disabled: false,
    agentType: 'claude',
}

const rawTerminal: AgentFavoriteOption = {
    kind: 'agent',
    id: '__agent__terminal',
    title: 'Terminal',
    summary: 'Raw agent',
    accentColor: 'var(--color-border-strong)',
    disabled: false,
    agentType: 'terminal',
}

const dualPreset: AgentPreset = {
    id: 'p-1',
    name: 'Pair',
    slots: [
        { agentType: 'claude', autonomyEnabled: true },
        { agentType: 'codex' },
    ],
    isBuiltIn: false,
}

const presetOption: PresetFavoriteOption = {
    kind: 'preset',
    id: 'p-1',
    title: 'Pair',
    summary: '2 agents',
    accentColor: 'var(--color-accent-blue)',
    disabled: false,
    preset: dualPreset,
}

describe('buildCreatePayload', () => {
    it('returns a spec payload when the spec card is selected', () => {
        const payload = buildCreatePayload({
            selection: spec,
            name: 'my_spec',
            prompt: '# Hello\n\nBody',
            userEditedName: true,
            baseBranch: 'main',
            advanced: createEmptyAdvancedState(),
        })

        expect(payload).toEqual({
            name: 'my_spec',
            isSpec: true,
            draftContent: '# Hello\n\nBody',
            userEditedName: true,
            baseBranch: '',
        })
    })

    it('throws EMPTY_SPEC when the spec prompt is whitespace', () => {
        expect(() => buildCreatePayload({
            selection: spec,
            name: 'my_spec',
            prompt: '   \n',
            userEditedName: false,
            baseBranch: 'main',
            advanced: createEmptyAdvancedState(),
        })).toThrowError(expect.objectContaining({ code: 'EMPTY_SPEC' }))
    })

    it('throws INVALID_NAME for whitespace-only names regardless of selection', () => {
        try {
            buildCreatePayload({
                selection: rawClaude,
                name: '   ',
                prompt: 'hi',
                userEditedName: true,
                baseBranch: 'main',
                advanced: createEmptyAdvancedState(),
            })
            throw new Error('expected throw')
        } catch (err) {
            expect(err).toBeInstanceOf(BuildCreatePayloadError)
            expect((err as BuildCreatePayloadError).code).toBe('INVALID_NAME')
        }
    })

    it('returns a raw-agent payload with versionCount and resolved baseBranch', () => {
        const payload = buildCreatePayload({
            selection: rawClaude,
            name: 'brave_spark',
            prompt: 'Ship the thing',
            userEditedName: false,
            baseBranch: 'main',
            advanced: createEmptyAdvancedState(),
            versionCount: 3,
        })

        expect(payload).toMatchObject({
            name: 'brave_spark',
            prompt: 'Ship the thing',
            agentType: 'claude',
            versionCount: 3,
            baseBranch: 'main',
            userEditedName: false,
            autonomyEnabled: false,
        })
        expect(payload.isSpec).toBeUndefined()
        expect(payload.agentSlots).toBeUndefined()
        expect(payload.agentTypes).toBeUndefined()
    })

    it('forces autonomyEnabled to false for the terminal agent even if advanced says otherwise', () => {
        const advanced = createEmptyAdvancedState()
        advanced.autonomyEnabled = true
        const payload = buildCreatePayload({
            selection: rawTerminal,
            name: 'brave_spark',
            prompt: '',
            userEditedName: false,
            baseBranch: 'main',
            advanced,
            versionCount: 1,
        })
        expect(payload.agentType).toBe('terminal')
        expect(payload.autonomyEnabled).toBe(false)
    })

    it('maps preset selections to agentSlots and primary agentType', () => {
        const payload = buildCreatePayload({
            selection: presetOption,
            name: 'brave_spark',
            prompt: 'Do work',
            userEditedName: false,
            baseBranch: 'main',
            advanced: createEmptyAdvancedState(),
        })
        expect(payload.agentType).toBe('claude')
        expect(payload.agentSlots).toEqual([
            { agentType: 'claude', autonomyEnabled: true },
            { agentType: 'codex', autonomyEnabled: undefined },
        ])
        expect(payload.versionCount).toBe(2)
        expect(payload.agentTypes).toBeUndefined()
    })

    it('ignores versionCount overrides on preset selections', () => {
        const payload = buildCreatePayload({
            selection: presetOption,
            name: 'brave_spark',
            prompt: 'Do work',
            userEditedName: false,
            baseBranch: 'main',
            advanced: createEmptyAdvancedState(),
            versionCount: 5,
        })
        expect(payload.versionCount).toBe(2)
    })

    it('surfaces multiAgent allocations as agentTypes when the advanced panel configures them', () => {
        const advanced = createEmptyAdvancedState()
        advanced.multiAgentAllocations = { claude: 2, codex: 1 }
        const payload = buildCreatePayload({
            selection: rawClaude,
            name: 'brave_spark',
            prompt: 'Do work',
            userEditedName: true,
            baseBranch: 'main',
            advanced,
            versionCount: 1,
        })
        expect(payload.agentTypes).toEqual(['claude', 'claude', 'codex'])
        expect(payload.versionCount).toBe(3)
    })

    it('respects advanced.autonomyEnabled on non-terminal raw agents', () => {
        const advanced = createEmptyAdvancedState()
        advanced.autonomyEnabled = true
        const payload = buildCreatePayload({
            selection: rawClaude,
            name: 'brave_spark',
            prompt: 'Do work',
            userEditedName: true,
            baseBranch: 'main',
            advanced,
            versionCount: 1,
        })
        expect(payload.autonomyEnabled).toBe(true)
    })
})
