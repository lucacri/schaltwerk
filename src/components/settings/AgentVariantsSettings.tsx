import { useState, useCallback } from 'react'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { NON_TERMINAL_AGENTS, type AgentType } from '../../types/session'
import { generateId } from '../../common/generateId'
import type { AgentVariant } from '../../types/agentVariant'
import { Button, FormGroup, Label, SectionHeader, Select, TextInput, Textarea } from '../ui'

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
                <SectionHeader
                    title={'Agent Variants'}
                    description={'Create named configurations with specific model, CLI args, and environment variables. Use variants in the new session modal to quickly apply saved configurations.'}
                    className="flex-1 border-b-0 pb-0"
                />
                <Button onClick={handleAdd}>
                    {'+ Add Variant'}
                </Button>
            </div>

            {currentVariants.length === 0 && (
                <div className="text-text-muted text-center py-8 text-body">
                    {'No variants configured. Click "Add Variant" to create one.'}
                </div>
            )}

            <div className="space-y-2">
                {currentVariants.map(variant => (
                    <div
                        key={variant.id}
                        className="rounded-lg border bg-bg-elevated border-border-subtle"
                    >
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === variant.id ? null : variant.id)}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-body text-text-primary">
                                    {variant.name || '(unnamed)'}
                                </span>
                                <span className="text-caption text-text-muted">
                                    {variant.agentType}
                                    {variant.model ? ` / ${variant.model}` : ''}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!variant.isBuiltIn && (
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={(e) => { e.stopPropagation(); handleRemove(variant.id) }}
                                    >
                                        {'Delete'}
                                    </Button>
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
                            <div className="px-4 pb-4 space-y-3 border-t border-border-subtle">
                                <div className="grid grid-cols-2 gap-3 pt-3">
                                    <FormGroup label={'Name'}>
                                        <TextInput
                                            value={variant.name}
                                            onChange={e => handleUpdate(variant.id, { name: e.target.value })}
                                            placeholder={'e.g. Claude Opus High'}
                                        />
                                    </FormGroup>
                                    <FormGroup label={'Agent Type'}>
                                        <Select
                                            value={variant.agentType}
                                            onChange={value => handleUpdate(variant.id, { agentType: value as AgentType })}
                                            options={NON_TERMINAL_AGENTS.map(agent => ({ value: agent, label: agent }))}
                                        />
                                    </FormGroup>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <FormGroup label={'Model'}>
                                        <TextInput
                                            value={variant.model ?? ''}
                                            onChange={e => handleUpdate(variant.id, { model: e.target.value || undefined })}
                                            placeholder={'e.g. opus, o3'}
                                        />
                                    </FormGroup>
                                    <FormGroup label={'Reasoning Effort'}>
                                        <TextInput
                                            value={variant.reasoningEffort ?? ''}
                                            onChange={e => handleUpdate(variant.id, { reasoningEffort: e.target.value || undefined })}
                                            placeholder={'e.g. high, medium, low'}
                                        />
                                    </FormGroup>
                                </div>

                                <FormGroup label={'CLI Arguments (one per line)'}>
                                    <Textarea
                                        value={(variant.cliArgs ?? []).join('\n')}
                                        onChange={e => handleCliArgsChange(variant.id, e.target.value)}
                                        placeholder={'--dangerously-skip-permissions\n--model opus'}
                                        rows={3}
                                        monospace
                                    />
                                </FormGroup>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <Label>{'Environment Variables'}</Label>
                                        <Button size="sm" onClick={() => handleEnvVarAdd(variant.id)}>
                                            {'+ Add'}
                                        </Button>
                                    </div>
                                    {variant.envVars && Object.entries(variant.envVars).map(([key, value], idx) => (
                                        <div key={idx} className="flex gap-2 mb-1">
                                            <TextInput
                                                aria-label="Environment variable key"
                                                value={key}
                                                onChange={e => handleEnvVarChange(variant.id, key, e.target.value, value)}
                                                placeholder="KEY"
                                                className="flex-1"
                                            />
                                            <TextInput
                                                aria-label="Environment variable value"
                                                value={value}
                                                onChange={e => handleEnvVarChange(variant.id, key, key, e.target.value)}
                                                placeholder="value"
                                                className="flex-1"
                                            />
                                            <Button size="sm" variant="danger" onClick={() => handleEnvVarRemove(variant.id, key)}>
                                                &times;
                                            </Button>
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
                    <Button variant="ghost" onClick={handleDiscard}>
                        {'Discard'}
                    </Button>
                    <Button variant="primary" onClick={() => void handleSave()}>
                        {'Save'}
                    </Button>
                </div>
            )}
        </div>
    )
}
