import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { PropsWithChildren } from 'react'
import { favoriteOrderAtom } from '../store/atoms/favoriteOrder'
import { useFavorites } from './useFavorites'

const mockUseAgentVariants = vi.fn()
const mockUseAgentPresets = vi.fn()
const mockUseAgentAvailability = vi.fn()

vi.mock('./useAgentVariants', () => ({
    useAgentVariants: () => mockUseAgentVariants(),
}))

vi.mock('./useAgentPresets', () => ({
    useAgentPresets: () => mockUseAgentPresets(),
}))

vi.mock('./useAgentAvailability', () => ({
    useAgentAvailability: (...args: unknown[]) => mockUseAgentAvailability(...args),
}))

function createWrapper(initialFavoriteOrder: string[] = []) {
    const store = createStore()
    store.set(favoriteOrderAtom, initialFavoriteOrder)

    return function Wrapper({ children }: PropsWithChildren) {
        return <Provider store={store}>{children}</Provider>
    }
}

describe('useFavorites', () => {
    beforeEach(() => {
        vi.clearAllMocks()

        mockUseAgentVariants.mockReturnValue({
            variants: [
                { id: 'variant-zed', name: 'Zed Claude', agentType: 'claude', model: 'sonnet', isBuiltIn: false },
                { id: 'variant-alpha', name: 'Alpha Codex', agentType: 'codex', model: 'gpt-5.4', reasoningEffort: 'high', isBuiltIn: false },
            ],
            loading: false,
            error: null,
            saveVariants: vi.fn(),
            reloadVariants: vi.fn(),
        })

        mockUseAgentPresets.mockReturnValue({
            presets: [
                { id: 'preset-review', name: 'Review Squad', slots: [{ agentType: 'claude' }, { agentType: 'codex', skipPermissions: true }], isBuiltIn: false },
                { id: 'preset-triage', name: 'Triage', slots: [{ agentType: 'gemini' }], isBuiltIn: false },
            ],
            loading: false,
            error: null,
            savePresets: vi.fn(),
            reloadPresets: vi.fn(),
        })

        mockUseAgentAvailability.mockReturnValue({
            isAvailable: (agent: string) => agent !== 'gemini',
        })
    })

    it('orders explicit favorites first and appends the rest alphabetically', async () => {
        const { result } = renderHook(() => useFavorites(), {
            wrapper: createWrapper(['preset-review', 'variant-alpha']),
        })

        await waitFor(() => {
            expect(result.current.favorites.map(favorite => favorite.id)).toEqual([
                'preset-review',
                'variant-alpha',
                'preset-triage',
                'variant-zed',
            ])
        })
    })

    it('marks unavailable presets as disabled when any required agent is missing', async () => {
        const { result } = renderHook(() => useFavorites(), {
            wrapper: createWrapper(['preset-triage']),
        })

        await waitFor(() => {
            const preset = result.current.favorites.find(favorite => favorite.id === 'preset-triage')
            expect(preset?.disabled).toBe(true)
        })
    })

    it('builds compact summaries for presets and variants', async () => {
        const { result } = renderHook(() => useFavorites(), {
            wrapper: createWrapper(['variant-alpha', 'preset-review']),
        })

        await waitFor(() => {
            const variant = result.current.favorites.find(favorite => favorite.id === 'variant-alpha')
            const preset = result.current.favorites.find(favorite => favorite.id === 'preset-review')

            expect(variant?.summary).toBe('GPT-5.4 · high')
            expect(preset?.summary).toBe('2 agents · skip')
        })
    })
})
