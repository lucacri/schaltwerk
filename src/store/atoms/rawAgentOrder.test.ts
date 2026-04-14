import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import {
    rawAgentOrderAtom,
    rawAgentOrderLoadingAtom,
    rawAgentOrderErrorAtom,
    loadRawAgentOrderAtom,
    saveRawAgentOrderAtom,
} from './rawAgentOrder'
import { TauriCommands } from '../../common/tauriCommands'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

describe('rawAgentOrder atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
    })

    it('starts with an empty raw agent order', () => {
        expect(store.get(rawAgentOrderAtom)).toEqual([])
        expect(store.get(rawAgentOrderLoadingAtom)).toBe(false)
        expect(store.get(rawAgentOrderErrorAtom)).toBeNull()
    })

    it('loads raw agent order from backend', async () => {
        mockInvoke.mockResolvedValueOnce(['codex', 'claude', 'gemini'])

        await store.set(loadRawAgentOrderAtom)

        expect(store.get(rawAgentOrderAtom)).toEqual(['codex', 'claude', 'gemini'])
        expect(store.get(rawAgentOrderLoadingAtom)).toBe(false)
        expect(store.get(rawAgentOrderErrorAtom)).toBeNull()
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetRawAgentOrder)
    })

    it('saves raw agent order to backend', async () => {
        const rawAgentOrder = ['codex', 'claude']
        mockInvoke.mockResolvedValueOnce(undefined)

        const result = await store.set(saveRawAgentOrderAtom, rawAgentOrder)

        expect(result).toBe(true)
        expect(store.get(rawAgentOrderAtom)).toEqual(rawAgentOrder)
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetRawAgentOrder, { rawAgentOrder })
    })

    it('records load failures', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('raw agent order load failed'))

        await store.set(loadRawAgentOrderAtom)

        expect(store.get(rawAgentOrderAtom)).toEqual([])
        expect(store.get(rawAgentOrderErrorAtom)).toBe('raw agent order load failed')
    })
})
