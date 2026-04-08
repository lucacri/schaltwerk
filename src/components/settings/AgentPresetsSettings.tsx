import { useState, useCallback } from 'react'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { NON_TERMINAL_AGENTS, filterEnabledAgents, type AgentType, type EnabledAgents } from '../../types/session'
import { generateId } from '../../common/generateId'
import type { AgentPreset, AgentPresetSlot } from '../../types/agentPreset'
import { Button, Checkbox, FormGroup, Label, SectionHeader, Select, TextInput } from '../ui'

function createEmptyPreset(defaultAgentType: AgentType): AgentPreset {
    return {
        id: generateId('preset'),
        name: '',
        slots: [{ agentType: defaultAgentType }],
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
    enabledAgents?: EnabledAgents
}

export function AgentPresetsSettings({ onNotification, enabledAgents }: AgentPresetsSettingsProps) {
    const { filterAgents } = useEnabledAgents()
    const { presets, savePresets } = useAgentPresets()
    const { variants } = useAgentVariants()
    const [editingPresets, setEditingPresets] = useState<AgentPreset[] | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const currentPresets = editingPresets ?? presets
    const hasUnsavedChanges = editingPresets !== null
    const visibleAgentTypes = enabledAgents
        ? filterEnabledAgents(NON_TERMINAL_AGENTS, enabledAgents)
        : filterAgents(NON_TERMINAL_AGENTS)
    const visibleVariants = variants.filter(variant => visibleAgentTypes.includes(variant.agentType))
    const defaultAgentType = visibleAgentTypes[0] ?? 'claude'

    const getAgentOptions = useCallback((current: AgentType) => {
        const agentTypes = visibleAgentTypes.includes(current)
            ? visibleAgentTypes
            : [current, ...visibleAgentTypes]
        return agentTypes.map(agent => ({ value: agent, label: agent }))
    }, [visibleAgentTypes])

    const handleAdd = useCallback(() => {
        const newPreset = createEmptyPreset(defaultAgentType)
        const updated = [...currentPresets, newPreset]
        setEditingPresets(updated)
        setExpandedId(newPreset.id)
    }, [currentPresets, defaultAgentType])

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
        handleUpdate(presetId, { slots: [...preset.slots, { agentType: defaultAgentType }] })
    }, [currentPresets, defaultAgentType, handleUpdate])

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
                <SectionHeader
                    title={'Agent Presets'}
                    description={'Define multi-agent launch configurations. Each preset specifies a set of agent slots that will be created together as a version group.'}
                    className="flex-1 border-b-0 pb-0"
                />
                <Button onClick={handleAdd}>
                    {'+ Add Preset'}
                </Button>
            </div>

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
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={(e) => { e.stopPropagation(); handleRemove(preset.id) }}
                                    >
                                        {'Delete'}
                                    </Button>
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
                                <FormGroup label={'Name'} className="pt-3">
                                    <TextInput
                                        value={preset.name}
                                        onChange={e => handleUpdate(preset.id, { name: e.target.value })}
                                        placeholder={'e.g. The Trio'}
                                    />
                                </FormGroup>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <Label>{'Agent Slots'}</Label>
                                        <Button size="sm" onClick={() => handleSlotAdd(preset.id)}>
                                            {'+ Add'}
                                        </Button>
                                    </div>
                                    {preset.slots.map((slot, idx) => (
                                        <div key={idx} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                                            <FormGroup label={`Agent Slot ${idx + 1}`} className="flex-1">
                                                <Select
                                                    value={slot.variantId ? `variant:${slot.variantId}` : slot.agentType}
                                                    onChange={(val) => {
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
                                                    options={[
                                                        ...getAgentOptions(slot.agentType),
                                                        ...visibleVariants.map(v => ({ value: `variant:${v.id}`, label: `${v.name} (${v.agentType})` })),
                                                    ]}
                                                    className="flex-1"
                                                />
                                            </FormGroup>
                                            <div className="md:pb-[1px]">
                                                <Checkbox
                                                    checked={slot.skipPermissions ?? false}
                                                    onChange={checked => handleSlotUpdate(preset.id, idx, { skipPermissions: checked || undefined })}
                                                    label={'Skip'}
                                                />
                                            </div>
                                            <div className="md:pb-[1px]">
                                                <Checkbox
                                                    checked={slot.autonomyEnabled ?? false}
                                                    onChange={checked => handleSlotUpdate(preset.id, idx, { autonomyEnabled: checked || undefined })}
                                                    label={'Full autonomous'}
                                                />
                                            </div>
                                            {preset.slots.length > 1 && (
                                                <div className="md:pb-[1px]">
                                                    <Button size="sm" variant="danger" onClick={() => handleSlotRemove(preset.id, idx)}>
                                                        {'\u00d7'}
                                                    </Button>
                                                </div>
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
