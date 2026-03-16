import { useState, useCallback } from 'react'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { NON_TERMINAL_AGENTS, type AgentType } from '../../types/session'
import { generateId } from '../../common/generateId'
import type { AgentVariant } from '../../types/agentVariant'

function createEmptyVariant(): AgentVariant {
    return {
        id: generateId('variant'),
        name: '',
        agentType: 'claude',
        isBuiltIn: false,
    }
}

interface AgentVariantsSettingsProps {
    onNotification?: (message: string, type: 'success' | 'error') => void
}

export function AgentVariantsSettings({ onNotification }: AgentVariantsSettingsProps) {
    const { variants, saveVariants } = useAgentVariants()
    const [editingVariants, setEditingVariants] = useState<AgentVariant[] | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const currentVariants = editingVariants ?? variants
    const hasUnsavedChanges = editingVariants !== null

    const handleAdd = useCallback(() => {
        const newVariant = createEmptyVariant()
        const updated = [...currentVariants, newVariant]
        setEditingVariants(updated)
        setExpandedId(newVariant.id)
    }, [currentVariants])

    const handleRemove = useCallback((id: string) => {
        setEditingVariants(currentVariants.filter(v => v.id !== id))
        if (expandedId === id) setExpandedId(null)
    }, [currentVariants, expandedId])

    const handleUpdate = useCallback((id: string, patch: Partial<AgentVariant>) => {
        setEditingVariants(currentVariants.map(v =>
            v.id === id ? { ...v, ...patch } : v
        ))
    }, [currentVariants])

    const handleEnvVarAdd = useCallback((id: string) => {
        const variant = currentVariants.find(v => v.id === id)
        if (!variant) return
        const tempKey = `NEW_VAR_${Date.now()}`
        const envVars = { ...(variant.envVars ?? {}), [tempKey]: '' }
        handleUpdate(id, { envVars })
    }, [currentVariants, handleUpdate])

    const handleEnvVarRemove = useCallback((id: string, key: string) => {
        const variant = currentVariants.find(v => v.id === id)
        if (!variant?.envVars) return
        const envVars = { ...variant.envVars }
        delete envVars[key]
        handleUpdate(id, { envVars })
    }, [currentVariants, handleUpdate])

    const handleEnvVarChange = useCallback((id: string, oldKey: string, newKey: string, value: string) => {
        const variant = currentVariants.find(v => v.id === id)
        if (!variant?.envVars) return
        const entries = Object.entries(variant.envVars).map(([k, v]) =>
            k === oldKey ? [newKey, value] : [k, v]
        )
        handleUpdate(id, { envVars: Object.fromEntries(entries) })
    }, [currentVariants, handleUpdate])

    const handleCliArgsChange = useCallback((id: string, value: string) => {
        const args = value.split('\n').filter(a => a.trim())
        handleUpdate(id, { cliArgs: args.length > 0 ? args : undefined })
    }, [handleUpdate])

    const handleSave = useCallback(async () => {
        if (!editingVariants) return
        const invalid = editingVariants.find(v => !v.name.trim())
        if (invalid) {
            onNotification?.('Each variant needs a name', 'error')
            return
        }
        const success = await saveVariants(editingVariants)
        if (success) {
            setEditingVariants(null)
            onNotification?.('Agent variants saved', 'success')
        } else {
            onNotification?.('Failed to save agent variants', 'error')
        }
    }, [editingVariants, saveVariants, onNotification])

    const handleDiscard = useCallback(() => {
        setEditingVariants(null)
        setExpandedId(null)
    }, [])

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-text-primary" style={{ fontSize: 'var(--font-heading)' }}>
                    {'Agent Variants'}
                </h3>
                <button
                    onClick={handleAdd}
                    className="settings-btn text-text-primary"
                    style={{ fontSize: 'var(--font-body)' }}
                >
                    {'+ Add Variant'}
                </button>
            </div>

            <p className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                {'Create named configurations with specific model, CLI args, and environment variables. Use variants in the new session modal to quickly apply saved configurations.'}
            </p>

            {currentVariants.length === 0 && (
                <div className="text-text-muted text-center py-8" style={{ fontSize: 'var(--font-body)' }}>
                    {'No variants configured. Click "Add Variant" to create one.'}
                </div>
            )}

            <div className="space-y-2">
                {currentVariants.map(variant => (
                    <div
                        key={variant.id}
                        className="rounded-lg border"
                        style={{
                            backgroundColor: 'var(--color-bg-elevated)',
                            borderColor: 'var(--color-border-subtle)',
                        }}
                    >
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === variant.id ? null : variant.id)}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-text-primary" style={{ fontSize: 'var(--font-body)' }}>
                                    {variant.name || '(unnamed)'}
                                </span>
                                <span className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                                    {variant.agentType}
                                    {variant.model ? ` / ${variant.model}` : ''}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!variant.isBuiltIn && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemove(variant.id) }}
                                        className="settings-btn-danger px-2 py-1"
                                        style={{ fontSize: 'var(--font-caption)' }}
                                    >
                                        {'Delete'}
                                    </button>
                                )}
                                <svg
                                    className={`w-4 h-4 text-text-muted transition-transform ${expandedId === variant.id ? 'rotate-180' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>

                        {expandedId === variant.id && (
                            <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                                <div className="grid grid-cols-2 gap-3 pt-3">
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>
                                            {'Name'}
                                        </label>
                                        <input
                                            type="text"
                                            value={variant.name}
                                            onChange={e => handleUpdate(variant.id, { name: e.target.value })}
                                            placeholder={'e.g. Claude Opus High'}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>
                                            {'Agent Type'}
                                        </label>
                                        <select
                                            value={variant.agentType}
                                            onChange={e => handleUpdate(variant.id, { agentType: e.target.value as AgentType })}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        >
                                            {NON_TERMINAL_AGENTS.map(agent => (
                                                <option key={agent} value={agent}>{agent}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>
                                            {'Model'}
                                        </label>
                                        <input
                                            type="text"
                                            value={variant.model ?? ''}
                                            onChange={e => handleUpdate(variant.id, { model: e.target.value || undefined })}
                                            placeholder={'e.g. opus, o3'}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>
                                            {'Reasoning Effort'}
                                        </label>
                                        <input
                                            type="text"
                                            value={variant.reasoningEffort ?? ''}
                                            onChange={e => handleUpdate(variant.id, { reasoningEffort: e.target.value || undefined })}
                                            placeholder={'e.g. high, medium, low'}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>
                                        {'CLI Arguments (one per line)'}
                                    </label>
                                    <textarea
                                        value={(variant.cliArgs ?? []).join('\n')}
                                        onChange={e => handleCliArgsChange(variant.id, e.target.value)}
                                        placeholder={'--dangerously-skip-permissions\n--model opus'}
                                        rows={3}
                                        className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                        style={{ fontSize: 'var(--font-body)', fontFamily: 'var(--font-family-mono)' }}
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                                            {'Environment Variables'}
                                        </label>
                                        <button
                                            onClick={() => handleEnvVarAdd(variant.id)}
                                            className="settings-btn px-2 py-0.5"
                                            style={{ fontSize: 'var(--font-caption)' }}
                                        >
                                            {'+ Add'}
                                        </button>
                                    </div>
                                    {variant.envVars && Object.entries(variant.envVars).map(([key, value], idx) => (
                                        <div key={idx} className="flex gap-2 mb-1">
                                            <input
                                                type="text"
                                                value={key}
                                                onChange={e => handleEnvVarChange(variant.id, key, e.target.value, value)}
                                                placeholder="KEY"
                                                className="flex-1 bg-bg-tertiary text-text-primary rounded px-2 py-1 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                                style={{ fontSize: 'var(--font-caption)', fontFamily: 'var(--font-family-mono)' }}
                                            />
                                            <input
                                                type="text"
                                                value={value}
                                                onChange={e => handleEnvVarChange(variant.id, key, key, e.target.value)}
                                                placeholder="value"
                                                className="flex-1 bg-bg-tertiary text-text-primary rounded px-2 py-1 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                                style={{ fontSize: 'var(--font-caption)', fontFamily: 'var(--font-family-mono)' }}
                                            />
                                            <button
                                                onClick={() => handleEnvVarRemove(variant.id, key)}
                                                className="settings-btn-danger px-2 py-1"
                                                style={{ fontSize: 'var(--font-caption)' }}
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {hasUnsavedChanges && (
                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={handleDiscard}
                        className="settings-btn text-text-muted"
                        style={{ fontSize: 'var(--font-body)' }}
                    >
                        {'Discard'}
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        className="settings-btn text-text-primary bg-accent-blue/20 border-accent-blue/40"
                        style={{ fontSize: 'var(--font-body)' }}
                    >
                        {'Save'}
                    </button>
                </div>
            )}
        </div>
    )
}
