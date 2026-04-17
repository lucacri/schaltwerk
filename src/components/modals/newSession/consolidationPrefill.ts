import type { ConsolidationDefaultFavorite } from '../../../hooks/useClaudeSession'

export interface ConsolidationPrefillExtras {
    presetId?: string
    agentType?: string
}

export interface ApplyOptions {
    availablePresetIds?: readonly string[]
}

export function applyConsolidationDefaultFavorite(
    value: ConsolidationDefaultFavorite,
    options: ApplyOptions = {},
): ConsolidationPrefillExtras {
    if (value.presetId && value.presetId.length > 0) {
        if (!options.availablePresetIds || options.availablePresetIds.includes(value.presetId)) {
            return { presetId: value.presetId }
        }
    }
    if (value.agentType && value.agentType.length > 0) {
        return { agentType: value.agentType }
    }
    return {}
}
