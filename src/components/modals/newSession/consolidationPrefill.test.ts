import { describe, it, expect } from 'vitest'
import { applyConsolidationDefaultFavorite } from './consolidationPrefill'

describe('applyConsolidationDefaultFavorite', () => {
    it('returns presetId when preset default is stored', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: null, presetId: 'pr-1' }),
        ).toEqual({ presetId: 'pr-1' })
    })

    it('returns agentType when raw-agent default is stored', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: 'codex', presetId: null }),
        ).toEqual({ agentType: 'codex' })
    })

    it('prefers preset over agent when both are set', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: 'codex', presetId: 'pr-1' }),
        ).toEqual({ presetId: 'pr-1' })
    })

    it('returns empty object when neither is set', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: null, presetId: null }),
        ).toEqual({})
    })

    it('ignores empty strings', () => {
        expect(
            applyConsolidationDefaultFavorite({ agentType: '', presetId: '' }),
        ).toEqual({})
    })

    it('drops a preset that is not in the available list and falls back to agent', () => {
        expect(
            applyConsolidationDefaultFavorite(
                { agentType: 'claude', presetId: 'dead-id' },
                { availablePresetIds: ['other'] },
            ),
        ).toEqual({ agentType: 'claude' })
    })

    it('drops a preset that is not available and returns empty when no agent fallback', () => {
        expect(
            applyConsolidationDefaultFavorite(
                { agentType: null, presetId: 'dead-id' },
                { availablePresetIds: ['other'] },
            ),
        ).toEqual({})
    })

    it('keeps preset when availablePresetIds lists it', () => {
        expect(
            applyConsolidationDefaultFavorite(
                { agentType: null, presetId: 'live-id' },
                { availablePresetIds: ['live-id'] },
            ),
        ).toEqual({ presetId: 'live-id' })
    })
})
