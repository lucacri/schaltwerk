import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { contextualActionsListAtom, contextualActionsLoadingAtom, loadContextualActionsAtom, saveContextualActionsAtom, resetContextualActionsAtom } from './contextualActions'
import { TauriCommands } from '../../common/tauriCommands'
import type { ContextualAction } from '../../types/contextualAction'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args)
}))

vi.mock('../../utils/logger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

describe('contextualActions atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.clearAllMocks()
        store = createStore()
    })

    it('starts empty', () => {
        expect(store.get(contextualActionsListAtom)).toEqual([])
    })

    it('loads actions from backend', async () => {
        const actions: ContextualAction[] = [
            { id: 'a1', name: 'Review MR', context: 'mr', promptTemplate: '{{mr.title}}', mode: 'session', isBuiltIn: true }
        ]
        mockInvoke.mockResolvedValueOnce(actions)

        await store.set(loadContextualActionsAtom)

        expect(store.get(contextualActionsListAtom)).toEqual(actions)
        expect(store.get(contextualActionsLoadingAtom)).toBe(false)
    })

    it('saves actions', async () => {
        const actions: ContextualAction[] = [
            { id: 'a1', name: 'Test', context: 'both', promptTemplate: 'test', mode: 'spec', isBuiltIn: false }
        ]
        mockInvoke.mockResolvedValueOnce(undefined)

        const result = await store.set(saveContextualActionsAtom, actions)

        expect(result).toBe(true)
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetContextualActions, { actions })
    })

    it('resets to defaults', async () => {
        const defaults: ContextualAction[] = [
            { id: 'builtin-1', name: 'Default', context: 'mr', promptTemplate: 'x', mode: 'session', isBuiltIn: true }
        ]
        mockInvoke.mockResolvedValueOnce(defaults)

        const result = await store.set(resetContextualActionsAtom)

        expect(result).toBe(true)
        expect(store.get(contextualActionsListAtom)).toEqual(defaults)
    })
})
