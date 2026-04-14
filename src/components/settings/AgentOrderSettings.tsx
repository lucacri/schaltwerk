import { useCallback, useMemo } from 'react'
import { useRawAgentOrder } from '../../hooks/useRawAgentOrder'
import { useTranslation } from '../../common/i18n/useTranslation'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES, type AgentType, type EnabledAgents } from '../../types/session'
import { SectionHeader } from '../ui'

interface AgentOrderSettingsProps {
    enabledAgents: EnabledAgents
    onNotification?: (message: string, type: 'success' | 'error') => void
}

function composeDisplayOrder(rawAgentOrder: string[], enabledAgents: EnabledAgents): AgentType[] {
    const knownAgents = new Set<AgentType>(AGENT_TYPES)
    const seen = new Set<AgentType>()
    const ordered: AgentType[] = []

    for (const entry of rawAgentOrder) {
        if (!knownAgents.has(entry as AgentType)) continue
        const agent = entry as AgentType
        if (seen.has(agent)) continue
        if (!enabledAgents[agent]) continue
        seen.add(agent)
        ordered.push(agent)
    }

    for (const agent of AGENT_TYPES) {
        if (seen.has(agent)) continue
        if (!enabledAgents[agent]) continue
        ordered.push(agent)
    }

    return ordered
}

export function AgentOrderSettings({ enabledAgents, onNotification }: AgentOrderSettingsProps) {
    const { t } = useTranslation()
    const { rawAgentOrder, saveRawAgentOrder } = useRawAgentOrder()

    const displayOrder = useMemo(
        () => composeDisplayOrder(rawAgentOrder, enabledAgents),
        [rawAgentOrder, enabledAgents],
    )

    const persist = useCallback(async (next: AgentType[]) => {
        const success = await saveRawAgentOrder(next)
        if (!success) {
            onNotification?.('Failed to save raw agent order', 'error')
        }
    }, [saveRawAgentOrder, onNotification])

    const swap = useCallback((index: number, delta: number) => {
        const target = index + delta
        if (target < 0 || target >= displayOrder.length) return
        const next = [...displayOrder]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        void persist(next)
    }, [displayOrder, persist])

    return (
        <div className="space-y-4">
            <SectionHeader
                title={t.settings.agentConfiguration.rawAgentOrder}
                description={t.settings.agentConfiguration.rawAgentOrderDesc}
                className="border-b-0 pb-0"
            />
            {displayOrder.length === 0 ? (
                <p
                    data-testid="agent-order-empty"
                    className="text-body text-text-secondary"
                >
                    {t.settings.agentConfiguration.rawAgentOrderEmpty}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {displayOrder.map((agent, index) => (
                        <li
                            key={agent}
                            data-testid="agent-order-row"
                            data-agent={agent}
                            className="flex items-center justify-between rounded border border-border-default bg-bg-elevated px-3 py-2"
                        >
                            <span className="text-body text-text-primary">
                                <span className="mr-2 inline-block min-w-6 text-text-tertiary">{index + 1}.</span>
                                {displayNameForAgent(agent)}
                                {index < 9 && (
                                    <span className="ml-2 text-caption text-text-tertiary">⌘{index + 1}</span>
                                )}
                            </span>
                            <span className="flex gap-1">
                                <button
                                    type="button"
                                    data-testid="move-up"
                                    aria-label={t.settings.agentConfiguration.moveUp}
                                    title={t.settings.agentConfiguration.moveUp}
                                    className="rounded border border-border-default px-2 py-1 text-caption text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                                    disabled={index === 0}
                                    onClick={() => swap(index, -1)}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    data-testid="move-down"
                                    aria-label={t.settings.agentConfiguration.moveDown}
                                    title={t.settings.agentConfiguration.moveDown}
                                    className="rounded border border-border-default px-2 py-1 text-caption text-text-secondary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                                    disabled={index === displayOrder.length - 1}
                                    onClick={() => swap(index, 1)}
                                >
                                    ↓
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
