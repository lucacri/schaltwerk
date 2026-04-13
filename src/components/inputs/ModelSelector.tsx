import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { theme } from '../../common/theme'
import { Dropdown } from './Dropdown'
import { AgentType, AGENT_TYPES } from '../../types/session'
import { useTranslation } from '../../common/i18n'
import { typography } from '../../common/typography'

type ModelColor = 'blue' | 'green' | 'orange' | 'red' | 'violet' | 'cyan' | 'yellow' | 'copilot'

const MODEL_METADATA: Record<AgentType, { color: ModelColor }> = {
    claude: { color: 'blue' },
    copilot: { color: 'copilot' },
    opencode: { color: 'green' },
    gemini: { color: 'orange' },
    codex: { color: 'red' },
    droid: { color: 'violet' },
    qwen: { color: 'cyan' },
    amp: { color: 'yellow' },
    kilocode: { color: 'yellow' },
    terminal: { color: 'green' }
}

interface ModelSelectorProps {
    value: AgentType
    onChange: (value: AgentType) => void
    disabled?: boolean
    agentSelectionDisabled?: boolean
    autonomyEnabled?: boolean
    onAutonomyChange?: (value: boolean) => void
    onDropdownOpenChange?: (open: boolean) => void
    showShortcutHint?: boolean
    allowedAgents?: readonly AgentType[]
    variant?: 'grid' | 'compact'
}

interface AgentCardProps {
    title: string
    description: string
    color: string
    selected: boolean
    disabled: boolean
    available: boolean
    loading: boolean
    statusText: string
    onClick: () => void
    tooltip?: string
    shortcutHint?: boolean
}

function AgentCard({
    title,
    description,
    color,
    selected,
    disabled,
    available,
    loading,
    statusText,
    onClick,
    tooltip,
    shortcutHint = false
}: AgentCardProps) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            title={tooltip}
            onClick={onClick}
            className="relative flex min-h-[96px] min-w-0 overflow-hidden rounded-lg text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
            style={{
                backgroundColor: 'var(--color-bg-primary)',
                border: `2px solid ${selected ? 'var(--color-accent-blue)' : 'var(--color-border-default)'}`,
                color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                opacity: disabled ? 0.55 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
            }}
        >
            <span
                aria-hidden="true"
                className="shrink-0"
                style={{
                    width: 6,
                    backgroundColor: color,
                }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                <span className="flex items-start justify-between gap-2">
                    <span
                        className="truncate"
                        style={{
                            ...typography.body,
                            color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                            fontWeight: 600,
                        }}
                    >
                        {title}
                    </span>
                    {shortcutHint && selected && (
                        <span
                            aria-hidden="true"
                            className="shrink-0"
                            style={{ color: 'var(--color-text-muted)', ...typography.caption }}
                        >
                            ⌘↑ · ⌘↓
                        </span>
                    )}
                </span>
                <span
                    className="truncate"
                    style={{
                        ...typography.caption,
                        color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                    }}
                >
                    {description}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                    {loading ? (
                        <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
                            style={{ color: 'var(--color-text-muted)' }}
                        />
                    ) : !available ? (
                        <svg className="h-4 w-4 shrink-0" style={{ color: 'var(--color-status-warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    ) : (
                        <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                        />
                    )}
                    <span
                        className="truncate"
                        style={{
                            ...typography.caption,
                            color: !loading && !available ? 'var(--color-status-warning)' : 'var(--color-text-secondary)',
                        }}
                    >
                        {statusText}
                    </span>
                </span>
            </span>
        </button>
    )
}

export function ModelSelector({
    value,
    onChange,
    disabled = false,
    agentSelectionDisabled = false,
    autonomyEnabled,
    onAutonomyChange,
    onDropdownOpenChange,
    showShortcutHint = false,
    allowedAgents,
    variant = 'grid'
}: ModelSelectorProps) {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const { isAvailable, getRecommendedPath, getInstallationMethod, loading } = useAgentAvailability()

    const allowedList = useMemo(
        () => (allowedAgents && allowedAgents.length > 0 ? allowedAgents : AGENT_TYPES),
        [allowedAgents]
    )

    const getAccentColor = useCallback((color: ModelColor) => {
        if (color === 'blue') return 'var(--color-accent-blue)'
        if (color === 'green') return 'var(--color-accent-green)'
        if (color === 'orange') return 'var(--color-accent-amber)'
        if (color === 'red') return 'var(--color-accent-red)'
        if (color === 'violet') return 'var(--color-accent-violet)'
        if (color === 'cyan') return 'var(--color-accent-cyan)'
        if (color === 'yellow') return 'var(--color-accent-yellow)'
        if (color === 'copilot') return 'var(--color-accent-copilot)'
        return 'var(--color-accent-blue)'
    }, [])

    const models = useMemo(
        () => allowedList.map(modelValue => ({
            value: modelValue,
            label: t.modelSelector.agents[modelValue].label,
            description: t.modelSelector.agents[modelValue].description,
            color: getAccentColor(MODEL_METADATA[modelValue].color)
        })),
        [allowedList, getAccentColor, t.modelSelector.agents]
    )

    const selectedModel = models.find(m => m.value === value) || models[0]
    const canConfigureAutonomy = selectedModel.value !== 'terminal' && typeof autonomyEnabled === 'boolean' && typeof onAutonomyChange === 'function'
    const selectorDisabled = disabled || agentSelectionDisabled

    const handleSelect = useCallback((modelValue: AgentType) => {
        if (selectorDisabled) return
        onChange(modelValue)
        setIsOpen(false)
    }, [onChange, selectorDisabled])

    const getAgentLabel = useCallback((modelValue: AgentType) => (
        t.modelSelector.agents[modelValue].label
    ), [t.modelSelector.agents])

    const getStatusText = useCallback((modelValue: AgentType) => {
        if (loading) return t.modelSelector.checkingAvailability
        return isAvailable(modelValue) ? t.modelSelector.availableLabel : t.modelSelector.notInstalledLabel
    }, [loading, isAvailable, t.modelSelector.availableLabel, t.modelSelector.checkingAvailability, t.modelSelector.notInstalledLabel])

    const getTooltipText = useCallback((modelValue: AgentType) => {
        const label = getAgentLabel(modelValue)
        if (loading) return t.modelSelector.checkingAvailability
        if (!isAvailable(modelValue)) return t.modelSelector.notInstalled.replace('{agent}', label)
        const path = getRecommendedPath(modelValue)
        const method = getInstallationMethod(modelValue)
        if (path && method) return t.modelSelector.availableAt.replace('{agent}', label).replace('{path}', path).replace('{method}', method)
        return t.modelSelector.available.replace('{agent}', label)
    }, [loading, isAvailable, getRecommendedPath, getInstallationMethod, getAgentLabel, t])

    const selectedAvailable = isAvailable(selectedModel.value)
    const dropdownDisabled = selectorDisabled
    const selectedUnavailable = !loading && !selectedAvailable

    const handleToggleAutonomy = useCallback(() => {
        if (!canConfigureAutonomy || disabled || !onAutonomyChange) return
        onAutonomyChange(!autonomyEnabled)
    }, [autonomyEnabled, canConfigureAutonomy, disabled, onAutonomyChange])

    const items = models.map(model => {
        const available = isAvailable(model.value)
        return {
            key: model.value,
            label: (
                <span className="flex items-center gap-2 text-sm">
                    {loading ? (
                        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : (
                        <span className={`h-2 w-2 rounded-full ${!available && !loading ? 'opacity-50' : ''}`}
                              style={{
                                  backgroundColor: model.color
                              }} />
                    )}
                    <span className="flex items-center gap-1">
                        {model.label}
                        {!loading && !available && (
                            <svg className="h-3 w-3" style={{ color: 'var(--color-status-warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        )}
                    </span>
                </span>
            ),
            title: getTooltipText(model.value)
        }
    })

    const dropdownOpen = isOpen && !dropdownDisabled && variant === 'compact'

    useEffect(() => {
        if ((dropdownDisabled || variant !== 'compact') && isOpen) {
            setIsOpen(false)
        }
    }, [dropdownDisabled, isOpen, variant])

    useEffect(() => {
        if (onDropdownOpenChange) {
            onDropdownOpenChange(dropdownOpen)
        }
    }, [dropdownOpen, onDropdownOpenChange])

    const renderAutonomyToggle = () => {
        if (!canConfigureAutonomy) return null

        return (
            <div className="space-y-2">
                <button
                    type="button"
                    onClick={handleToggleAutonomy}
                    disabled={disabled}
                    aria-pressed={!!autonomyEnabled}
                    className="w-full rounded border px-3 py-1.5 text-xs transition-colors"
                    style={{
                        backgroundColor: autonomyEnabled ? 'var(--color-accent-green)' : 'var(--color-bg-elevated)',
                        borderColor: autonomyEnabled ? 'var(--color-accent-green)' : 'var(--color-border-default)',
                        color: disabled ? 'var(--color-text-muted)' : (autonomyEnabled ? 'var(--color-accent-green-text)' : 'var(--color-text-secondary)')
                    }}
                    title={t.sessionConfig.fullAutonomousTitle}
                >
                    {t.sessionConfig.fullAutonomous}
                </button>
            </div>
        )
    }

    if (variant === 'grid') {
        return (
            <div className="space-y-3" data-model-selector>
                <div className="max-h-[380px] overflow-y-auto pr-1 -mr-1 custom-scrollbar">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {models.map(model => (
                            <AgentCard
                                key={model.value}
                                title={model.label}
                                description={model.description}
                                color={model.color}
                                selected={model.value === selectedModel.value}
                                disabled={selectorDisabled}
                                available={isAvailable(model.value)}
                                loading={loading}
                                statusText={getStatusText(model.value)}
                                onClick={() => handleSelect(model.value)}
                                tooltip={getTooltipText(model.value)}
                                shortcutHint={showShortcutHint}
                            />
                        ))}
                    </div>
                </div>
                {renderAutonomyToggle()}
            </div>
        )
    }

    return (
        <div className="space-y-2" data-model-selector>
            <Dropdown
                open={dropdownOpen}
                onOpenChange={setIsOpen}
                items={items}
                selectedKey={selectedModel.value}
                align="stretch"
                onSelect={(key) => {
                    handleSelect(key as AgentType)
                }}
            >
                {({ open, toggle }) => (
                    <button
                        type="button"
                        onClick={() => !dropdownDisabled && toggle()}
                        disabled={dropdownDisabled}
                        className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                            dropdownDisabled
                                ? 'cursor-not-allowed'
                                : 'cursor-pointer'
                        } ${
                            dropdownDisabled && !loading
                                ? 'opacity-50'
                                : selectedAvailable || loading
                                ? 'hover:opacity-80'
                                : ''
                        }`}
                        style={{
                            backgroundColor: 'var(--color-bg-elevated)',
                            borderColor: 'var(--color-border-default)',
                            color: dropdownDisabled && !loading ? 'var(--color-text-muted)' : 'var(--color-text-primary)'
                        }}
                        title={getTooltipText(selectedModel.value)}
                        aria-label={selectedModel.label}
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{selectedModel.label}</span>
                            {selectedUnavailable && (
                                <span
                                    className="inline-flex shrink-0 items-center gap-1"
                                    style={{ color: 'var(--color-status-warning)', fontSize: theme.fontSize.caption }}
                                >
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                    </svg>
                                    {t.modelSelector.notInstalledLabel}
                                </span>
                            )}
                            {showShortcutHint && (
                                <span
                                    aria-hidden="true"
                                    className="shrink-0"
                                    style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
                                >
                                    ⌘↑ · ⌘↓
                                </span>
                            )}
                        </span>
                        <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="currentColor" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}
            </Dropdown>
            {renderAutonomyToggle()}
        </div>
    )
}
