import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { NewSessionAdvancedPanel } from './NewSessionAdvancedPanel'
import { createEmptyAdvancedState } from './buildCreatePayload'
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
    slots: [{ agentType: 'claude' }, { agentType: 'codex' }],
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

function renderPanel(overrides: Partial<React.ComponentProps<typeof NewSessionAdvancedPanel>> = {}) {
    const store = createStore()
    const props: React.ComponentProps<typeof NewSessionAdvancedPanel> = {
        selection: rawClaude,
        value: createEmptyAdvancedState(),
        onChange: vi.fn(),
        onOpenAgentSettings: vi.fn(),
        ...overrides,
    }
    render(
        <Provider store={store}>
            <NewSessionAdvancedPanel {...props} />
        </Provider>
    )
    return props
}

describe('NewSessionAdvancedPanel', () => {
    it('renders nothing for a spec selection', () => {
        const { container } = render(
            <Provider store={createStore()}>
                <NewSessionAdvancedPanel
                    selection={spec}
                    value={createEmptyAdvancedState()}
                    onChange={vi.fn()}
                    onOpenAgentSettings={vi.fn()}
                />
            </Provider>
        )
        expect(container.firstChild).toBeNull()
    })

    it('shows autonomy toggle and multi-agent controls for non-terminal raw agents', () => {
        renderPanel({ selection: rawClaude })
        expect(screen.getByTestId('advanced-autonomy-toggle')).toBeTruthy()
        expect(screen.getByTestId('advanced-multi-agent-dropdown')).toBeTruthy()
        expect(screen.getByTestId('advanced-open-agent-settings')).toBeTruthy()
    })

    it('hides the autonomy toggle for the terminal agent', () => {
        renderPanel({ selection: rawTerminal })
        expect(screen.queryByTestId('advanced-autonomy-toggle')).toBeNull()
    })

    it('hides multi-agent controls for preset selections', () => {
        renderPanel({ selection: presetOption })
        expect(screen.queryByTestId('advanced-multi-agent-dropdown')).toBeNull()
    })

    it('emits onChange when toggling autonomy', () => {
        const onChange = vi.fn()
        renderPanel({ selection: rawClaude, onChange })
        const toggle = screen.getByTestId('advanced-autonomy-toggle')
        const input = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement
        fireEvent.click(input)
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autonomyEnabled: true }))
    })

    it('invokes onOpenAgentSettings when the defaults button is clicked', () => {
        const onOpenAgentSettings = vi.fn()
        renderPanel({ selection: rawClaude, onOpenAgentSettings })
        fireEvent.click(screen.getByTestId('advanced-open-agent-settings'))
        expect(onOpenAgentSettings).toHaveBeenCalledTimes(1)
    })
})
