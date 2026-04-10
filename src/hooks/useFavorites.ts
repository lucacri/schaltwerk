import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'
import { favoriteOrderAtom, favoriteOrderErrorAtom, favoriteOrderLoadedAtom, favoriteOrderLoadingAtom, loadFavoriteOrderAtom, saveFavoriteOrderAtom } from '../store/atoms/favoriteOrder'
import { useAgentAvailability } from './useAgentAvailability'
import { useAgentPresets } from './useAgentPresets'
import { useAgentVariants } from './useAgentVariants'
import type { AgentPreset } from '../types/agentPreset'
import type { AgentType } from '../types/session'
import type { AgentVariant } from '../types/agentVariant'

export interface FavoriteItem {
    id: string
    kind: 'variant' | 'preset'
    name: string
    summary: string
    disabled: boolean
    agentType: AgentType | null
    agentTypes: AgentType[]
    variant?: AgentVariant
    preset?: AgentPreset
}

interface UseFavoritesResult {
    favorites: FavoriteItem[]
    favoriteOrder: string[]
    favoriteOrderLoaded: boolean
    loading: boolean
    error: string | null
    saveFavoriteOrder: (favoriteOrder: string[]) => Promise<boolean>
    reloadFavoriteOrder: () => Promise<void>
}

function formatModelName(model?: string): string {
    if (!model) {
        return ''
    }
    return model.replace(/^gpt-/i, 'GPT-')
}

function summarizeVariant(variant: AgentVariant): string {
    const model = formatModelName(variant.model)
    const reasoning = variant.reasoningEffort?.trim() ?? ''
    if (model && reasoning) {
        return `${model} · ${reasoning}`
    }
    if (model) {
        return model
    }
    if (reasoning) {
        return reasoning
    }
    return variant.agentType
}

function summarizePreset(preset: AgentPreset): string {
    return `${preset.slots.length} agent${preset.slots.length === 1 ? '' : 's'}`
}

function sortFavorites(items: FavoriteItem[], favoriteOrder: string[]): FavoriteItem[] {
    const itemMap = new Map(items.map(item => [item.id, item]))
    const orderedItems = favoriteOrder
        .map(id => itemMap.get(id))
        .filter((item): item is FavoriteItem => Boolean(item))

    const remainingItems = items
        .filter(item => !favoriteOrder.includes(item.id))
        .sort((left, right) => left.name.localeCompare(right.name))

    return [...orderedItems, ...remainingItems]
}

export function useFavorites(): UseFavoritesResult {
    const { variants, loading: variantsLoading, error: variantsError } = useAgentVariants()
    const { presets, loading: presetsLoading, error: presetsError } = useAgentPresets()
    const { isAvailable } = useAgentAvailability()
    const favoriteOrder = useAtomValue(favoriteOrderAtom)
    const favoriteOrderLoaded = useAtomValue(favoriteOrderLoadedAtom)
    const favoriteOrderLoading = useAtomValue(favoriteOrderLoadingAtom)
    const favoriteOrderError = useAtomValue(favoriteOrderErrorAtom)
    const loadFavoriteOrder = useSetAtom(loadFavoriteOrderAtom)
    const saveFavoriteOrderAtomValue = useSetAtom(saveFavoriteOrderAtom)

    useEffect(() => {
        if (favoriteOrderLoaded || favoriteOrderLoading || favoriteOrderError) {
            return
        }
        void loadFavoriteOrder()
    }, [favoriteOrderError, favoriteOrderLoaded, favoriteOrderLoading, loadFavoriteOrder])

    const favorites = useMemo(() => {
        const variantFavorites: FavoriteItem[] = variants.map(variant => ({
            id: variant.id,
            kind: 'variant',
            name: variant.name,
            summary: summarizeVariant(variant),
            disabled: !isAvailable(variant.agentType),
            agentType: variant.agentType,
            agentTypes: [variant.agentType],
            variant,
        }))

        const presetFavorites: FavoriteItem[] = presets.map(preset => {
            const presetAgentTypes = preset.slots.map(slot => slot.agentType)
            return {
                id: preset.id,
                kind: 'preset' as const,
                name: preset.name,
                summary: summarizePreset(preset),
                disabled: presetAgentTypes.some(agentType => !isAvailable(agentType)),
                agentType: presetAgentTypes[0] ?? null,
                agentTypes: presetAgentTypes,
                preset,
            }
        })

        return sortFavorites([...variantFavorites, ...presetFavorites], favoriteOrder)
    }, [favoriteOrder, isAvailable, presets, variants])

    const saveFavoriteOrder = useCallback((nextFavoriteOrder: string[]) => {
        return saveFavoriteOrderAtomValue(nextFavoriteOrder)
    }, [saveFavoriteOrderAtomValue])

    const reloadFavoriteOrder = useCallback(() => {
        return loadFavoriteOrder()
    }, [loadFavoriteOrder])

    return {
        favorites,
        favoriteOrder,
        favoriteOrderLoaded,
        loading: variantsLoading || presetsLoading || favoriteOrderLoading,
        error: variantsError ?? presetsError ?? favoriteOrderError,
        saveFavoriteOrder,
        reloadFavoriteOrder,
    }
}
