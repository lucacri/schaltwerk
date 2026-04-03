import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { agentPresetsListAtom, agentPresetsLoadingAtom, agentPresetsErrorAtom, loadAgentPresetsAtom, saveAgentPresetsAtom } from './agentPresets'
import { TauriCommands } from '../../common/tauriCommands'
import type { AgentPreset } from '../../types/agentPreset'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

describe('agentPresets atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
    })

    it('starts with empty list', () => {
        expect(store.get(agentPresetsListAtom)).toEqual([])
        expect(store.get(agentPresetsLoadingAtom)).toBe(false)
        expect(store.get(agentPresetsErrorAtom)).toBeNull()
    })

    it('loads presets from backend', async () => {
        const presets: AgentPreset[] = [
            {
                id: 'p1', name: 'The Duo', isBuiltIn: false,
                slots: [
                    { agentType: 'claude', skipPermissions: true, autonomyEnabled: true },
                    { agentType: 'codex', autonomyEnabled: false },
                ],
            }
        ]
        mockInvoke.mockResolvedValueOnce(presets)

        await store.set(loadAgentPresetsAtom)

        expect(store.get(agentPresetsListAtom)).toEqual(presets)
        expect(store.get(agentPresetsLoadingAtom)).toBe(false)
    })

    it('saves presets to backend', async () => {
        const presets: AgentPreset[] = [
            { id: 'p1', name: 'Solo', isBuiltIn: false, slots: [{ agentType: 'claude', autonomyEnabled: true }] }
        ]
        mockInvoke.mockResolvedValueOnce(undefined)

        const result = await store.set(saveAgentPresetsAtom, presets)

        expect(result).toBe(true)
        expect(store.get(agentPresetsListAtom)).toEqual(presets)
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentPresets, { presets })
    })

    it('handles load errors', async () => {
        mockInvoke.mockRejectedValueOnce(new Error('fail'))

        await store.set(loadAgentPresetsAtom)

        expect(store.get(agentPresetsListAtom)).toEqual([])
        expect(store.get(agentPresetsErrorAtom)).toBe('fail')
    })
})
