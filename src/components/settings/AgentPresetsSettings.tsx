import { useState, useCallback } from 'react'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { NON_TERMINAL_AGENTS, type AgentType } from '../../types/session'
import { generateId } from '../../common/generateId'
import type { AgentPreset, AgentPresetSlot } from '../../types/agentPreset'

function createEmptyPreset(): AgentPreset {
    return {
        id: generateId('preset'),
        name: '',
        slots: [{ agentType: 'claude' }],
        isBuiltIn: false,
    }
}

function slotSummary(slots: AgentPresetSlot[]): string {
    const counts = new Map<string, number>()
    for (const slot of slots) {
        const key = slot.agentType
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
        .map(([agent, count]) => `${count}x ${agent}`)
        .join(', ')
}

interface AgentPresetsSettingsProps {
    onNotification?: (message: string, type: 'success' | 'error') => void
}

export function AgentPresetsSettings({ onNotification }: AgentPresetsSettingsProps) {
    const { presets, savePresets } = useAgentPresets()
    const { variants } = useAgentVariants()
    const [editingPresets, setEditingPresets] = useState<AgentPreset[] | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const currentPresets = editingPresets ?? presets
    const hasUnsavedChanges = editingPresets !== null

    const handleAdd = useCallback(() => {
        const newPreset = createEmptyPreset()
        const updated = [...currentPresets, newPreset]
        setEditingPresets(updated)
        setExpandedId(newPreset.id)
    }, [currentPresets])

    const handleRemove = useCallback((id: string) => {
        setEditingPresets(currentPresets.filter(p => p.id !== id))
        if (expandedId === id) setExpandedId(null)
    }, [currentPresets, expandedId])

    const handleUpdate = useCallback((id: string, patch: Partial<AgentPreset>) => {
        setEditingPresets(currentPresets.map(p =>
            p.id === id ? { ...p, ...patch } : p
        ))
    }, [currentPresets])

    const handleSlotUpdate = useCallback((presetId: string, slotIndex: number, patch: Partial<AgentPresetSlot>) => {
        const preset = currentPresets.find(p => p.id === presetId)
        if (!preset) return
        const slots = preset.slots.map((s, i) => i === slotIndex ? { ...s, ...patch } : s)
        handleUpdate(presetId, { slots })
    }, [currentPresets, handleUpdate])

    const handleSlotAdd = useCallback((presetId: string) => {
        const preset = currentPresets.find(p => p.id === presetId)
        if (!preset) return
        handleUpdate(presetId, { slots: [...preset.slots, { agentType: 'claude' }] })
    }, [currentPresets, handleUpdate])

    const handleSlotRemove = useCallback((presetId: string, slotIndex: number) => {
        const preset = currentPresets.find(p => p.id === presetId)
        if (!preset || preset.slots.length <= 1) return
        handleUpdate(presetId, { slots: preset.slots.filter((_, i) => i !== slotIndex) })
    }, [currentPresets, handleUpdate])

    const handleSave = useCallback(async () => {
        if (!editingPresets) return
        const invalid = editingPresets.find(p => !p.name.trim())
        if (invalid) {
            onNotification?.('Each preset needs a name', 'error')
            return
        }
        const success = await savePresets(editingPresets)
        if (success) {
            setEditingPresets(null)
            onNotification?.('Agent presets saved', 'success')
        } else {
            onNotification?.('Failed to save agent presets', 'error')
        }
    }, [editingPresets, savePresets, onNotification])

    const handleDiscard = useCallback(() => {
        setEditingPresets(null)
        setExpandedId(null)
    }, [])

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-body font-medium text-text-primary">
                    {'Agent Presets'}
                </h3>
                <button onClick={handleAdd} className="settings-btn text-body px-3 py-1.5 rounded-lg">
                    {'+ Add Preset'}
                </button>
            </div>

            <p className="text-caption text-text-tertiary">
                {'Define multi-agent launch configurations. Each preset specifies a set of agent slots that will be created together as a version group.'}
            </p>

            {currentPresets.length === 0 && (
                <div className="text-text-muted text-center py-8 text-body">
                    {'No presets configured. Click "Add Preset" to create one.'}
                </div>
            )}

            <div className="space-y-2">
                {currentPresets.map(preset => (
                    <div
                        key={preset.id}
                        className="rounded-lg border bg-bg-elevated border-border-subtle"
                    >
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-body text-text-primary">
                                    {preset.name || '(unnamed)'}
                                </span>
                                <span className="text-caption text-text-muted">
                                    {slotSummary(preset.slots)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!preset.isBuiltIn && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemove(preset.id) }}
                                        className="settings-btn-danger text-caption px-2 py-1 rounded"
                                    >
                                        {'Delete'}
                                    </button>
                                )}
                                <svg
                                    className={`w-4 h-4 text-text-muted transition-transform ${expandedId === preset.id ? 'rotate-180' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>

                        {expandedId === preset.id && (
                            <div className="px-4 pb-4 space-y-3 border-t border-border-subtle">
                                <div className="pt-3">
                                    <label className="block text-caption text-text-secondary mb-1">
                                        {'Name'}
                                    </label>
                                    <input
                                        type="text"
                                        value={preset.name}
                                        onChange={e => handleUpdate(preset.id, { name: e.target.value })}
                                        placeholder={'e.g. The Trio'}
                                        className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-border-subtle placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)] text-body"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-caption text-text-secondary">
                                            {'Agent Slots'}
                                        </label>
                                        <button
                                            onClick={() => handleSlotAdd(preset.id)}
                                            className="settings-btn text-caption px-2 py-0.5 rounded"
                                        >
                                            {'+ Add'}
                                        </button>
                                    </div>
                                    {preset.slots.map((slot, idx) => (
                                        <div key={idx} className="flex items-center gap-2 mb-2">
                                            <select
                                                value={slot.variantId ? `variant:${slot.variantId}` : slot.agentType}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    if (val.startsWith('variant:')) {
                                                        const variantId = val.slice(8)
                                                        const variant = variants.find(v => v.id === variantId)
                                                        if (variant) {
                                                            handleSlotUpdate(preset.id, idx, {
                                                                agentType: variant.agentType,
                                                                variantId: variant.id,
                                                            })
                                                        }
                                                    } else {
                                                        handleSlotUpdate(preset.id, idx, {
                                                            agentType: val as AgentType,
                                                            variantId: undefined,
                                                        })
                                                    }
                                                }}
                                                className="flex-1 bg-bg-tertiary text-text-primary rounded px-2 py-1.5 border border-border-subtle focus:outline-none focus:border-[var(--color-border-focus)] text-caption settings-select"
                                            >
                                                <optgroup label="Agents">
                                                    {NON_TERMINAL_AGENTS.map(agent => (
                                                        <option key={agent} value={agent}>{agent}</option>
                                                    ))}
                                                </optgroup>
                                                {variants.length > 0 && (
                                                    <optgroup label="Variants">
                                                        {variants.map(v => (
                                                            <option key={v.id} value={`variant:${v.id}`}>
                                                                {v.name} ({v.agentType})
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                            <label className="flex items-center gap-1 text-caption text-text-muted">
                                                <input
                                                    type="checkbox"
                                                    checked={slot.skipPermissions ?? false}
                                                    onChange={e => handleSlotUpdate(preset.id, idx, { skipPermissions: e.target.checked || undefined })}
                                                    className="rounded"
                                                />
                                                Skip
                                            </label>
                                            {preset.slots.length > 1 && (
                                                <button
                                                    onClick={() => handleSlotRemove(preset.id, idx)}
                                                    className="settings-btn-danger text-caption px-2 py-1 rounded"
                                                >
                                                    &times;
                                                </button>
                                            )}
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
                    <button onClick={handleDiscard} className="settings-btn text-body text-text-muted px-3 py-1.5 rounded-lg">
                        {'Discard'}
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        className="settings-btn-primary text-body px-4 py-1.5 rounded-lg"
                    >
                        {'Save'}
                    </button>
                </div>
            )}
        </div>
    )
}
