import { useMemo } from 'react'
import { Button, Checkbox } from '../../ui'
import {
    MAX_VERSION_COUNT,
    MULTI_AGENT_TYPES,
    MultiAgentAllocationDropdown,
    sumAllocations,
    type MultiAgentAllocations,
} from '../MultiAgentAllocationDropdown'
import type { AdvancedSessionState } from './buildCreatePayload'
import type { FavoriteOption } from './favoriteOptions'
import { displayNameForAgent } from '../../shared/agentDefaults'
import type { AgentType } from '../../../types/session'

interface NewSessionAdvancedPanelProps {
    selection: FavoriteOption
    value: AdvancedSessionState
    onChange: (next: AdvancedSessionState) => void
    onOpenAgentSettings: () => void
    isAgentAvailable?: (agent: AgentType) => boolean
}

function multiAgentSummary(allocations: MultiAgentAllocations, fallback: string): string {
    const parts: string[] = []
    MULTI_AGENT_TYPES.forEach(agent => {
        const count = allocations[agent]
        if (count && count > 0) {
            parts.push(`${count}x ${displayNameForAgent(agent)}`)
        }
    })
    return parts.length > 0 ? parts.join(', ') : fallback
}

export function NewSessionAdvancedPanel({
    selection,
    value,
    onChange,
    onOpenAgentSettings,
    isAgentAvailable = () => true,
}: NewSessionAdvancedPanelProps) {
    const allocations = value.multiAgentAllocations
    const totalCount = useMemo(() => sumAllocations(allocations), [allocations])
    const summaryLabel = useMemo(
        () => multiAgentSummary(allocations, 'Single agent'),
        [allocations]
    )

    if (selection.kind === 'spec') {
        return null
    }

    const isRawAgent = selection.kind === 'agent'
    const isTerminal = isRawAgent && selection.agentType === 'terminal'

    return (
        <section
            data-testid="new-session-advanced-panel"
            className="flex flex-col gap-3 rounded-md p-3"
            style={{
                backgroundColor: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-subtle)',
            }}
        >
            {isRawAgent && !isTerminal && (
                <div data-testid="advanced-autonomy-toggle">
                    <Checkbox
                        checked={value.autonomyEnabled}
                        onChange={(next) => onChange({ ...value, autonomyEnabled: next })}
                        label="Skip permissions (autonomy)"
                    />
                </div>
            )}

            {isRawAgent && (
                <div data-testid="advanced-multi-agent-dropdown">
                    <MultiAgentAllocationDropdown
                        allocations={allocations}
                        selectableAgents={MULTI_AGENT_TYPES}
                        totalCount={totalCount}
                        maxCount={MAX_VERSION_COUNT}
                        summaryLabel={summaryLabel}
                        isAgentAvailable={isAgentAvailable}
                        onToggleAgent={(agent, enabled) => {
                            const next = { ...allocations }
                            if (enabled) {
                                next[agent] = Math.max(1, next[agent] ?? 1)
                            } else {
                                delete next[agent]
                            }
                            onChange({ ...value, multiAgentAllocations: next })
                        }}
                        onChangeCount={(agent, count) => {
                            const next = { ...allocations }
                            if (count <= 0) {
                                delete next[agent]
                            } else {
                                next[agent] = count
                            }
                            onChange({ ...value, multiAgentAllocations: next })
                        }}
                    />
                </div>
            )}

            <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Env vars, CLI args, and model defaults live in agent settings.
                </span>
                <Button
                    size="sm"
                    variant="default"
                    data-testid="advanced-open-agent-settings"
                    onClick={onOpenAgentSettings}
                >
                    Edit agent defaults…
                </Button>
            </div>
        </section>
    )
}

// Ensure the type is exported for tests
export type { NewSessionAdvancedPanelProps }
