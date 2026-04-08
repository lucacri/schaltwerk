import { useState, useCallback, useMemo } from 'react'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'
import { useContextualActions } from '../../hooks/useContextualActions'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { NON_TERMINAL_AGENTS, filterEnabledAgents, type AgentType, type EnabledAgents } from '../../types/session'
import { generateId } from '../../common/generateId'
import type { ContextualAction, ContextualActionContext, ContextualActionMode } from '../../types/contextualAction'
import { PR_TEMPLATE_VARIABLES, ISSUE_TEMPLATE_VARIABLES } from '../../types/contextualAction'
import { Button, Label, SectionHeader, Select, TextInput, Textarea } from '../ui'

function createEmptyAction(): ContextualAction {
    return {
        id: generateId('action'),
        name: '',
        context: 'both',
        promptTemplate: '',
        mode: 'session',
        isBuiltIn: false,
    }
}

interface ContextualActionsSettingsProps {
    onNotification?: (message: string, type: 'success' | 'error') => void
    enabledAgents?: EnabledAgents
}

export function ContextualActionsSettings({ onNotification, enabledAgents }: ContextualActionsSettingsProps) {
    const { filterAgents } = useEnabledAgents()
    const { actions, saveActions, resetToDefaults } = useContextualActions()
    const { variants } = useAgentVariants()
    const { presets } = useAgentPresets()
    const [editingActions, setEditingActions] = useState<ContextualAction[] | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const currentActions = editingActions ?? actions
    const hasUnsavedChanges = editingActions !== null
    const visibleAgentTypes = enabledAgents
        ? filterEnabledAgents(NON_TERMINAL_AGENTS, enabledAgents)
        : filterAgents(NON_TERMINAL_AGENTS)
    const visibleVariants = variants.filter(variant => visibleAgentTypes.includes(variant.agentType))
    const visiblePresets = presets.filter(preset => preset.slots.every(slot => visibleAgentTypes.includes(slot.agentType)))

    const handleAdd = useCallback(() => {
        const newAction = createEmptyAction()
        const updated = [...currentActions, newAction]
        setEditingActions(updated)
        setExpandedId(newAction.id)
    }, [currentActions])

    const handleRemove = useCallback((id: string) => {
        setEditingActions(currentActions.filter(a => a.id !== id))
        if (expandedId === id) setExpandedId(null)
    }, [currentActions, expandedId])

    const handleUpdate = useCallback((id: string, patch: Partial<ContextualAction>) => {
        setEditingActions(currentActions.map(a =>
            a.id === id ? { ...a, ...patch } : a
        ))
    }, [currentActions])

    const handleSave = useCallback(async () => {
        if (!editingActions) return
        const invalid = editingActions.find(a => !a.name.trim())
        if (invalid) {
            onNotification?.('Each action needs a name', 'error')
            return
        }
        const success = await saveActions(editingActions)
        if (success) {
            setEditingActions(null)
            onNotification?.('Contextual actions saved', 'success')
        } else {
            onNotification?.('Failed to save contextual actions', 'error')
        }
    }, [editingActions, saveActions, onNotification])

    const handleReset = useCallback(async () => {
        const success = await resetToDefaults()
        if (success) {
            setEditingActions(null)
            onNotification?.('Reset to defaults', 'success')
        } else {
            onNotification?.('Failed to reset contextual actions', 'error')
        }
    }, [resetToDefaults, onNotification])

    const handleDiscard = useCallback(() => {
        setEditingActions(null)
        setExpandedId(null)
    }, [])

    const getTemplateVars = useCallback((context: ContextualActionContext) => {
        const vars: string[] = []
        if (context === 'pr' || context === 'both') vars.push(...PR_TEMPLATE_VARIABLES)
        if (context === 'issue' || context === 'both') vars.push(...ISSUE_TEMPLATE_VARIABLES)
        return [...new Set(vars)]
    }, [])

    const agentSourceOptions = useMemo(() => {
        const options: { value: string; label: string }[] = [
            { value: '', label: 'Default (Claude)' },
        ]
        visibleAgentTypes.forEach(agent => {
            options.push({ value: `agent:${agent}`, label: agent })
        })
        visibleVariants.forEach(v => {
            options.push({ value: `variant:${v.id}`, label: `${v.name} (variant)` })
        })
        visiblePresets.forEach(p => {
            options.push({ value: `preset:${p.id}`, label: `${p.name} (preset)` })
        })
        return options
    }, [visibleAgentTypes, visiblePresets, visibleVariants])

    const getAgentSourceValue = useCallback((action: ContextualAction): string => {
        if (action.presetId) return `preset:${action.presetId}`
        if (action.variantId) return `variant:${action.variantId}`
        if (action.agentType) return `agent:${action.agentType}`
        return ''
    }, [])

    const getAgentSourceOptions = useCallback((action: ContextualAction) => {
        const currentValue = getAgentSourceValue(action)
        if (!currentValue || agentSourceOptions.some(option => option.value === currentValue)) {
            return agentSourceOptions
        }

        const currentLabel = action.agentType
            ? action.agentType
            : action.variantId
                ? `${action.variantId} (variant)`
                : action.presetId
                    ? `${action.presetId} (preset)`
                    : currentValue

        return [
            { value: currentValue, label: currentLabel },
            ...agentSourceOptions,
        ]
    }, [agentSourceOptions, getAgentSourceValue])

    const handleAgentSourceChange = useCallback((id: string, value: string) => {
        if (value.startsWith('preset:')) {
            handleUpdate(id, { presetId: value.slice(7), variantId: undefined, agentType: undefined })
        } else if (value.startsWith('variant:')) {
            handleUpdate(id, { variantId: value.slice(8), presetId: undefined, agentType: undefined })
        } else if (value.startsWith('agent:')) {
            handleUpdate(id, { agentType: value.slice(6) as AgentType, variantId: undefined, presetId: undefined })
        } else {
            handleUpdate(id, { agentType: undefined, variantId: undefined, presetId: undefined })
        }
    }, [handleUpdate])

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <SectionHeader title="Contextual Actions" />
                <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => void handleReset()}>
                        {'Reset to Defaults'}
                    </Button>
                    <Button size="sm" onClick={handleAdd}>
                        {'+ Add Action'}
                    </Button>
                </div>
            </div>

            <p className="text-caption text-text-tertiary">
                {'Define actions that appear on PR/MR and issue detail views. Use {{variable}} syntax in templates to inject context.'}
            </p>

            {currentActions.length === 0 && (
                <div className="text-text-muted text-center py-8 text-body">
                    {'No actions configured.'}
                </div>
            )}

            <div className="space-y-2">
                {currentActions.map(action => (
                    <div
                        key={action.id}
                        className="rounded-lg border bg-bg-elevated border-border-subtle"
                    >
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === action.id ? null : action.id)}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-body text-text-primary">
                                    {action.name || '(unnamed)'}
                                </span>
                                <span className="text-caption text-text-muted px-1.5 py-0.5 rounded bg-bg-tertiary">
                                    {action.context}
                                </span>
                                <span className="text-caption text-text-muted px-1.5 py-0.5 rounded bg-bg-tertiary">
                                    {action.mode}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!action.isBuiltIn && (
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={(e) => { e.stopPropagation(); handleRemove(action.id) }}
                                    >
                                        {'Delete'}
                                    </Button>
                                )}
                                <svg
                                    className={`w-4 h-4 text-text-muted transition-transform ${expandedId === action.id ? 'rotate-180' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>

                        {expandedId === action.id && (
                            <div className="px-4 pb-4 space-y-3 border-t border-border-subtle">
                                <div className="pt-3">
                                    <div>
                                        <Label className="block mb-1">Name</Label>
                                        <TextInput
                                            aria-label="Name"
                                            value={action.name}
                                            onChange={e => handleUpdate(action.id, { name: e.target.value })}
                                            placeholder="e.g. Review this PR"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mt-3">
                                        <div>
                                            <Label className="block mb-1">Context</Label>
                                            <Select
                                                value={action.context}
                                                onChange={value => handleUpdate(action.id, { context: value as ContextualActionContext })}
                                                options={[
                                                    { value: 'pr', label: 'PR/MR' },
                                                    { value: 'issue', label: 'Issue' },
                                                    { value: 'both', label: 'Both' },
                                                ]}
                                            />
                                        </div>
                                        <div>
                                            <Label className="block mb-1">Mode</Label>
                                            <Select
                                                value={action.mode}
                                                onChange={value => handleUpdate(action.id, { mode: value as ContextualActionMode })}
                                                options={[
                                                    { value: 'session', label: 'Create Session' },
                                                    { value: 'spec', label: 'Create Spec' },
                                                ]}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <Label className="block mb-1">Agent / Variant / Preset</Label>
                                            <Select
                                                aria-label="Agent Source"
                                                value={getAgentSourceValue(action)}
                                                onChange={value => handleAgentSourceChange(action.id, value)}
                                                options={getAgentSourceOptions(action)}
                                            />
                                </div>

                                <div>
                                    <Label className="block mb-1">Prompt Template</Label>
                                    <div className="flex flex-wrap gap-1 mb-2">
                                        {getTemplateVars(action.context).map(v => (
                                            <span
                                                key={v}
                                                className="text-caption text-text-muted px-1.5 py-0.5 rounded border border-border-subtle bg-bg-tertiary font-mono"
                                            >
                                                {`{{${v}}}`}
                                            </span>
                                        ))}
                                    </div>
                                    <Textarea
                                        aria-label="Prompt Template"
                                        value={action.promptTemplate}
                                        onChange={e => handleUpdate(action.id, { promptTemplate: e.target.value })}
                                        placeholder="Review the pull/merge request:\n\nTitle: {{pr.title}}\nDescription: {{pr.description}}"
                                        rows={8}
                                        monospace
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {hasUnsavedChanges && (
                <div
                    className="flex justify-end gap-3 pt-3 mt-2 border-t border-border-subtle"
                >
                    <Button variant="ghost" onClick={handleDiscard}>
                        {'Discard'}
                    </Button>
                    <Button variant="primary" onClick={() => void handleSave()}>
                        {'Save Changes'}
                    </Button>
                </div>
            )}
        </div>
    )
}
