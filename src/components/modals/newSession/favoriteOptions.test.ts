import { describe, expect, it } from 'vitest'
import {
    SPEC_FAVORITE_ID,
    buildFavoriteOptions,
    favoriteAccentColor,
} from './favoriteOptions'
import type { AgentPreset } from '../../../types/agentPreset'
import { AGENT_TYPES, type AgentType, type EnabledAgents, createAgentRecord } from '../../../types/session'

function allEnabled(): EnabledAgents {
    return createAgentRecord<boolean>(() => true)
}

function onlyEnabled(types: AgentType[]): EnabledAgents {
    const map = createAgentRecord<boolean>(() => false)
    types.forEach(t => { map[t] = true })
    return map
}

const alwaysAvailable = () => true

describe('buildFavoriteOptions', () => {
    it('always puts the spec-only card first with the spec sentinel id and title', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: allEnabled(),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })

        expect(result[0]).toMatchObject({
            kind: 'spec',
            id: SPEC_FAVORITE_ID,
            title: 'Spec only',
            summary: 'Prompt-only setup',
            disabled: false,
        })
        expect(result[0].accentColor).toBe('var(--color-border-strong)')
    })

    it('appends enabled raw-agent cards in AGENT_TYPES order after presets', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex', 'terminal']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })

        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual([
            '__agent__claude',
            '__agent__codex',
            '__agent__terminal',
        ])

        const order = AGENT_TYPES.filter(a => ['claude', 'codex', 'terminal'].includes(a))
        expect(agentIds).toEqual(order.map(a => `__agent__${a}`))
    })

    it('hides raw-agent cards that are disabled in enabledAgents', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual(['__agent__claude'])
    })

    it('hides raw-agent cards whose binary is unavailable even when enabled', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex']),
            isAvailable: (agent) => agent !== 'codex',
            presetOrder: [],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual(['__agent__claude'])
    })

    it('orders presets according to presetOrder, then unordered presets alphabetically', () => {
        const presets: AgentPreset[] = [
            { id: 'p-alpha', name: 'Alpha Sweep', slots: [{ agentType: 'claude' }], isBuiltIn: false },
            { id: 'p-bravo', name: 'Bravo Review', slots: [{ agentType: 'claude' }], isBuiltIn: false },
            { id: 'p-zeta', name: 'Zeta Runner', slots: [{ agentType: 'claude' }], isBuiltIn: false },
        ]
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: allEnabled(),
            isAvailable: alwaysAvailable,
            presetOrder: ['p-bravo'],
        })
        const presetIds = result.filter(o => o.kind === 'preset').map(o => o.id)
        expect(presetIds).toEqual(['p-bravo', 'p-alpha', 'p-zeta'])
    })

    it('hides presets whose slots include an agent that is disabled in user settings', () => {
        const presets: AgentPreset[] = [
            { id: 'p-mixed', name: 'Mixed', slots: [{ agentType: 'claude' }, { agentType: 'codex' }], isBuiltIn: false },
            { id: 'p-claude', name: 'Claude only', slots: [{ agentType: 'claude' }], isBuiltIn: false },
        ]
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: onlyEnabled(['claude']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })
        const presetIds = result.filter(o => o.kind === 'preset').map(o => o.id)
        expect(presetIds).toEqual(['p-claude'])
    })

    it('marks presets disabled but still visible when an included agent is enabled-but-unavailable', () => {
        const presets: AgentPreset[] = [
            { id: 'p-codex', name: 'Codex Triage', slots: [{ agentType: 'codex' }], isBuiltIn: false },
        ]
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: onlyEnabled(['codex']),
            isAvailable: (agent) => agent !== 'codex',
            presetOrder: [],
        })
        const preset = result.find(o => o.kind === 'preset')
        expect(preset).toBeDefined()
        expect(preset?.disabled).toBe(true)
    })

    it('summarises a preset with the slot count', () => {
        const presets: AgentPreset[] = [
            { id: 'p1', name: 'Dual', slots: [{ agentType: 'claude' }, { agentType: 'codex' }], isBuiltIn: false },
            { id: 'p2', name: 'Single', slots: [{ agentType: 'claude' }], isBuiltIn: false },
        ]
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: allEnabled(),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })
        const dual = result.find(o => o.id === 'p1')
        const single = result.find(o => o.id === 'p2')
        expect(dual?.summary).toBe('2 agents')
        expect(single?.summary).toBe('1 agent')
    })

    it('assigns command shortcuts ⌘1..⌘9 to the first nine options only', () => {
        const presets: AgentPreset[] = Array.from({ length: 12 }, (_, i) => ({
            id: `p-${i}`,
            name: `Preset ${String.fromCharCode(65 + i)}`,
            slots: [{ agentType: 'claude' }],
            isBuiltIn: false,
        }))
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: onlyEnabled(['claude']),
            isAvailable: alwaysAvailable,
            presetOrder: presets.map(p => p.id),
        })

        expect(result[0].shortcut).toBe('⌘1')
        expect(result[8].shortcut).toBe('⌘9')
        expect(result[9].shortcut).toBeUndefined()
        expect(result[result.length - 1].shortcut).toBeUndefined()
    })

    it('uses favoriteAccentColor to colour raw-agent cards', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'gemini']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })
        const claude = result.find(o => o.id === '__agent__claude')
        const gemini = result.find(o => o.id === '__agent__gemini')
        expect(claude?.accentColor).toBe(favoriteAccentColor('claude'))
        expect(gemini?.accentColor).toBe(favoriteAccentColor('gemini'))
    })

    it('orders raw agents per rawAgentOrder, appending unspecified ones in AGENT_TYPES order', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex', 'gemini', 'copilot']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
            rawAgentOrder: ['codex', 'gemini'],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual([
            '__agent__codex',
            '__agent__gemini',
            '__agent__claude',
            '__agent__copilot',
        ])
    })

    it('falls back to AGENT_TYPES order when rawAgentOrder is empty', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['gemini', 'claude']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
            rawAgentOrder: [],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual(['__agent__claude', '__agent__gemini'])
    })

    it('filters disabled agents out of the saved rawAgentOrder', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
            rawAgentOrder: ['gemini', 'codex', 'claude'],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual(['__agent__codex', '__agent__claude'])
    })

    it('ignores unknown or duplicate entries in rawAgentOrder', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
            rawAgentOrder: ['not-an-agent', 'codex', 'codex', 'claude'],
        })
        const agentIds = result.filter(o => o.kind === 'agent').map(o => o.id)
        expect(agentIds).toEqual(['__agent__codex', '__agent__claude'])
    })

    it('shifts ⌘1..⌘9 shortcuts to reflect user raw-agent ordering', () => {
        const result = buildFavoriteOptions({
            presets: [],
            enabledAgents: onlyEnabled(['claude', 'codex', 'gemini']),
            isAvailable: alwaysAvailable,
            presetOrder: [],
            rawAgentOrder: ['gemini', 'codex', 'claude'],
        })
        const firstAgent = result.find(o => o.kind === 'agent')
        expect(firstAgent?.id).toBe('__agent__gemini')
        expect(firstAgent?.shortcut).toBe('⌘2')
    })

    it('uses the primary slot agent colour for presets', () => {
        const presets: AgentPreset[] = [
            { id: 'p1', name: 'Mixed', slots: [{ agentType: 'gemini' }, { agentType: 'claude' }], isBuiltIn: false },
        ]
        const result = buildFavoriteOptions({
            presets,
            enabledAgents: allEnabled(),
            isAvailable: alwaysAvailable,
            presetOrder: [],
        })
        const preset = result.find(o => o.id === 'p1')
        expect(preset?.accentColor).toBe(favoriteAccentColor('gemini'))
    })
})
