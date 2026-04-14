import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { AgentOrderSettings } from './AgentOrderSettings'
import type { EnabledAgents } from '../../types/session'
import { createAgentRecord } from '../../types/session'
import {
    rawAgentOrderAtom,
    rawAgentOrderLoadedAtom,
} from '../../store/atoms/rawAgentOrder'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))
vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

function renderWithStore(store: ReturnType<typeof createStore>, enabled: EnabledAgents) {
    return render(
        <Provider store={store}>
            <AgentOrderSettings enabledAgents={enabled} />
        </Provider>,
    )
}

function onlyEnabled(types: Array<'claude' | 'codex' | 'gemini' | 'terminal'>): EnabledAgents {
    const map = createAgentRecord<boolean>(() => false)
    types.forEach(t => { map[t] = true })
    return map
}

describe('AgentOrderSettings', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
        store.set(rawAgentOrderAtom, [])
        store.set(rawAgentOrderLoadedAtom, true)
    })

    it('lists only the enabled agents in current order', () => {
        renderWithStore(store, onlyEnabled(['claude', 'codex']))
        const labels = screen.getAllByTestId('agent-order-row').map(el => el.dataset.agent)
        expect(labels).toEqual(['claude', 'codex'])
    })

    it('respects the persisted rawAgentOrder when composing the list', () => {
        store.set(rawAgentOrderAtom, ['codex', 'claude'])
        renderWithStore(store, onlyEnabled(['claude', 'codex', 'gemini']))
        const labels = screen.getAllByTestId('agent-order-row').map(el => el.dataset.agent)
        expect(labels).toEqual(['codex', 'claude', 'gemini'])
    })

    it('ignores disabled agents even when present in saved order', () => {
        store.set(rawAgentOrderAtom, ['gemini', 'claude', 'codex'])
        renderWithStore(store, onlyEnabled(['claude', 'codex']))
        const labels = screen.getAllByTestId('agent-order-row').map(el => el.dataset.agent)
        expect(labels).toEqual(['claude', 'codex'])
    })

    it('moves an agent down and persists the new order', async () => {
        mockInvoke.mockResolvedValue(undefined)
        store.set(rawAgentOrderAtom, ['claude', 'codex', 'gemini'])
        renderWithStore(store, onlyEnabled(['claude', 'codex', 'gemini']))
        const claudeRow = screen.getAllByTestId('agent-order-row').find(el => el.dataset.agent === 'claude')!
        const moveDown = claudeRow.querySelector<HTMLButtonElement>('[data-testid="move-down"]')!

        await act(async () => { moveDown.click() })

        expect(mockInvoke).toHaveBeenCalledWith(
            TauriCommands.SetRawAgentOrder,
            { rawAgentOrder: ['codex', 'claude', 'gemini'] },
        )
    })

    it('moves an agent up and persists the new order', async () => {
        mockInvoke.mockResolvedValue(undefined)
        store.set(rawAgentOrderAtom, ['codex', 'claude', 'gemini'])
        renderWithStore(store, onlyEnabled(['claude', 'codex', 'gemini']))
        const claudeRow = screen.getAllByTestId('agent-order-row').find(el => el.dataset.agent === 'claude')!
        const moveUp = claudeRow.querySelector<HTMLButtonElement>('[data-testid="move-up"]')!

        await act(async () => { moveUp.click() })

        expect(mockInvoke).toHaveBeenCalledWith(
            TauriCommands.SetRawAgentOrder,
            { rawAgentOrder: ['claude', 'codex', 'gemini'] },
        )
    })

    it('disables the move-up button on the first row and move-down on the last', () => {
        renderWithStore(store, onlyEnabled(['claude', 'codex']))
        const rows = screen.getAllByTestId('agent-order-row')
        expect(rows[0].querySelector<HTMLButtonElement>('[data-testid="move-up"]')?.disabled).toBe(true)
        expect(rows[rows.length - 1].querySelector<HTMLButtonElement>('[data-testid="move-down"]')?.disabled).toBe(true)
    })

    it('shows an empty state when no agents are enabled', () => {
        const noneEnabled = createAgentRecord<boolean>(() => false)
        renderWithStore(store, noneEnabled)
        expect(screen.queryAllByTestId('agent-order-row')).toHaveLength(0)
        expect(screen.getByTestId('agent-order-empty')).toBeInTheDocument()
    })
})
