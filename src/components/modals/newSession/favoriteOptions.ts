import type { AgentPreset } from '../../../types/agentPreset'
import { AGENT_TYPES, type AgentType, type EnabledAgents } from '../../../types/session'

export const SPEC_FAVORITE_ID = '__schaltwerk_spec__'
const AGENT_FAVORITE_PREFIX = '__agent__'
const MAX_SHORTCUT_INDEX = 9

export function agentFavoriteId(agent: AgentType): string {
    return `${AGENT_FAVORITE_PREFIX}${agent}`
}

export function favoriteAccentColor(agentType: AgentType | null): string {
    switch (agentType) {
        case 'claude':
            return 'var(--color-accent-blue)'
        case 'codex':
            return 'var(--color-accent-violet)'
        case 'gemini':
            return 'var(--color-accent-amber)'
        case 'copilot':
            return 'var(--color-accent-copilot)'
        case 'droid':
            return 'var(--color-accent-green)'
        case 'qwen':
            return 'var(--color-accent-purple)'
        case 'amp':
            return 'var(--color-accent-magenta)'
        case 'kilocode':
            return 'var(--color-accent-red)'
        case 'terminal':
            return 'var(--color-border-strong)'
        case 'opencode':
            return 'var(--color-accent-cyan)'
        default:
            return 'var(--color-border-strong)'
    }
}

export function agentDisplayName(agent: AgentType): string {
    switch (agent) {
        case 'claude':
            return 'Claude'
        case 'codex':
            return 'Codex'
        case 'gemini':
            return 'Gemini'
        case 'copilot':
            return 'Copilot'
        case 'droid':
            return 'Factory Droid'
        case 'qwen':
            return 'Qwen'
        case 'amp':
            return 'Amp'
        case 'kilocode':
            return 'Kilo Code'
        case 'terminal':
            return 'Terminal'
        case 'opencode':
            return 'OpenCode'
    }
}

export interface SpecFavoriteOption {
    kind: 'spec'
    id: typeof SPEC_FAVORITE_ID
    title: string
    summary: string
    accentColor: string
    disabled: false
    shortcut?: string
}

export interface PresetFavoriteOption {
    kind: 'preset'
    id: string
    title: string
    summary: string
    accentColor: string
    disabled: boolean
    shortcut?: string
    preset: AgentPreset
}

export interface AgentFavoriteOption {
    kind: 'agent'
    id: string
    title: string
    summary: string
    accentColor: string
    disabled: boolean
    shortcut?: string
    agentType: AgentType
}

export type FavoriteOption = SpecFavoriteOption | PresetFavoriteOption | AgentFavoriteOption

export interface BuildFavoriteOptionsInput {
    presets: AgentPreset[]
    enabledAgents: EnabledAgents
    isAvailable: (agent: AgentType) => boolean
    presetOrder: string[]
    rawAgentOrder?: string[]
}

function summarisePreset(preset: AgentPreset): string {
    const count = preset.slots.length
    return `${count} agent${count === 1 ? '' : 's'}`
}

function orderPresets(presets: AgentPreset[], presetOrder: string[]): AgentPreset[] {
    const presetMap = new Map(presets.map(preset => [preset.id, preset]))
    const ordered = presetOrder
        .map(id => presetMap.get(id))
        .filter((preset): preset is AgentPreset => preset !== undefined)
    const remaining = presets
        .filter(preset => !presetOrder.includes(preset.id))
        .sort((a, b) => a.name.localeCompare(b.name))
    return [...ordered, ...remaining]
}

function orderRawAgents(rawAgentOrder: readonly string[]): AgentType[] {
    const known = new Set<AgentType>(AGENT_TYPES)
    const seen = new Set<AgentType>()
    const ordered: AgentType[] = []
    for (const entry of rawAgentOrder) {
        if (!known.has(entry as AgentType)) continue
        const agent = entry as AgentType
        if (seen.has(agent)) continue
        seen.add(agent)
        ordered.push(agent)
    }
    for (const agent of AGENT_TYPES) {
        if (seen.has(agent)) continue
        ordered.push(agent)
    }
    return ordered
}

function shortcutFor(index: number): string | undefined {
    if (index >= MAX_SHORTCUT_INDEX) return undefined
    return `⌘${index + 1}`
}

export function buildFavoriteOptions({
    presets,
    enabledAgents,
    isAvailable,
    presetOrder,
    rawAgentOrder = [],
}: BuildFavoriteOptionsInput): FavoriteOption[] {
    const specOption: SpecFavoriteOption = {
        kind: 'spec',
        id: SPEC_FAVORITE_ID,
        title: 'Spec only',
        summary: 'Prompt-only setup',
        accentColor: favoriteAccentColor(null),
        disabled: false,
    }

    const presetOptions: PresetFavoriteOption[] = []
    for (const preset of orderPresets(presets, presetOrder)) {
        const slotAgents = preset.slots.map(slot => slot.agentType)
        const allEnabled = slotAgents.every(agent => enabledAgents[agent])
        if (!allEnabled) continue
        const disabled = slotAgents.some(agent => !isAvailable(agent))
        const primaryAgent = slotAgents[0] ?? null
        presetOptions.push({
            kind: 'preset',
            id: preset.id,
            title: preset.name,
            summary: summarisePreset(preset),
            accentColor: favoriteAccentColor(primaryAgent),
            disabled,
            preset,
        })
    }

    const agentOptions: AgentFavoriteOption[] = []
    for (const agent of orderRawAgents(rawAgentOrder)) {
        if (!enabledAgents[agent]) continue
        if (!isAvailable(agent)) continue
        agentOptions.push({
            kind: 'agent',
            id: agentFavoriteId(agent),
            title: agentDisplayName(agent),
            summary: 'Raw agent',
            accentColor: favoriteAccentColor(agent),
            disabled: false,
            agentType: agent,
        })
    }

    const combined: FavoriteOption[] = [specOption, ...presetOptions, ...agentOptions]
    return combined.map((option, index) => ({ ...option, shortcut: shortcutFor(index) }))
}
