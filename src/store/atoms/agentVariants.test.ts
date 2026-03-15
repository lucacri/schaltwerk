import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { agentVariantsListAtom, agentVariantsLoadingAtom, agentVariantsErrorAtom, loadAgentVariantsAtom, saveAgentVariantsAtom } from './agentVariants'
import { TauriCommands } from '../../common/tauriCommands'
import type { AgentVariant } from '../../types/agentVariant'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

describe('agentVariants atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
    })

    it('starts with empty list', () => {
        expect(store.get(agentVariantsListAtom)).toEqual([])
        expect(store.get(agentVariantsLoadingAtom)).toBe(false)
        expect(store.get(agentVariantsErrorAtom)).toBeNull()
    })

    it('loads variants from backend', async () => {
        const variants: AgentVariant[] = [
            { id: 'v1', name: 'Claude Opus', agentType: 'claude', model: 'opus', isBuiltIn: false }
        ]
        mockInvoke.mockResolvedValueOnce(variants)

        await store.set(loadAgentVariantsAtom)

        expect(store.get(agentVariantsListAtom)).toEqual(variants)
        expect(store.get(agentVariantsLoadingAtom)).toBe(false)
        expect(store.get(agentVariantsErrorAtom)).toBeNull()
    })

    it('handles load errors', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('Network error'))

        await store.set(loadAgentVariantsAtom)

        expect(store.get(agentVariantsListAtom)).toEqual([])
        expect(store.get(agentVariantsErrorAtom)).toBe('Network error')
    })

    it('saves variants to backend', async () => {
        const variants: AgentVariant[] = [
            { id: 'v1', name: 'Claude Opus', agentType: 'claude', model: 'opus', isBuiltIn: false }
        ]
        mockInvoke.mockResolvedValueOnce(undefined)

        const result = await store.set(saveAgentVariantsAtom, variants)

        expect(result).toBe(true)
        expect(store.get(agentVariantsListAtom)).toEqual(variants)
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentVariants, { variants })
    })

    it('handles save errors', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('Save failed'))

        const result = await store.set(saveAgentVariantsAtom, [])

        expect(result).toBe(false)
        expect(store.get(agentVariantsErrorAtom)).toBe('Save failed')
    })
})
