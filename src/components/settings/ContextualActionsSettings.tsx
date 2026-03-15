import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextualActions } from '../../hooks/useContextualActions'
import { useAgentVariants } from '../../hooks/useAgentVariants'
import { useAgentPresets } from '../../hooks/useAgentPresets'
import { AGENT_TYPES, type AgentType } from '../../types/session'
import type { ContextualAction, ContextualActionContext, ContextualActionMode } from '../../types/contextualAction'
import { MR_TEMPLATE_VARIABLES, ISSUE_TEMPLATE_VARIABLES } from '../../types/contextualAction'

const NON_TERMINAL_AGENTS = AGENT_TYPES.filter(a => a !== 'terminal')

function generateId(): string {
    return `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyAction(): ContextualAction {
    return {
        id: generateId(),
        name: '',
        context: 'both',
        promptTemplate: '',
        mode: 'session',
        isBuiltIn: false,
    }
}

interface ContextualActionsSettingsProps {
    onNotification?: (message: string, type: 'success' | 'error') => void
}

export function ContextualActionsSettings({ onNotification }: ContextualActionsSettingsProps) {
    const { t } = useTranslation()
    const { actions, saveActions, resetToDefaults } = useContextualActions()
    const { variants } = useAgentVariants()
    const { presets } = useAgentPresets()
    const [editingActions, setEditingActions] = useState<ContextualAction[] | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const currentActions = editingActions ?? actions
    const hasUnsavedChanges = editingActions !== null

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
            onNotification?.(t('settings.contextualActions.nameRequired', 'Each action needs a name'), 'error')
            return
        }
        const success = await saveActions(editingActions)
        if (success) {
            setEditingActions(null)
            onNotification?.(t('settings.contextualActions.saved', 'Contextual actions saved'), 'success')
        } else {
            onNotification?.(t('settings.contextualActions.saveFailed', 'Failed to save contextual actions'), 'error')
        }
    }, [editingActions, saveActions, onNotification, t])

    const handleReset = useCallback(async () => {
        const success = await resetToDefaults()
        if (success) {
            setEditingActions(null)
            onNotification?.(t('settings.contextualActions.reset', 'Reset to defaults'), 'success')
        }
    }, [resetToDefaults, onNotification, t])

    const handleDiscard = useCallback(() => {
        setEditingActions(null)
        setExpandedId(null)
    }, [])

    const getTemplateVars = useCallback((context: ContextualActionContext) => {
        const vars: string[] = []
        if (context === 'mr' || context === 'both') vars.push(...MR_TEMPLATE_VARIABLES)
        if (context === 'issue' || context === 'both') vars.push(...ISSUE_TEMPLATE_VARIABLES)
        return [...new Set(vars)]
    }, [])

    const agentSourceOptions = useMemo(() => {
        const options: { value: string; label: string }[] = [
            { value: '', label: t('settings.contextualActions.defaultAgent', 'Default (Claude)') },
        ]
        NON_TERMINAL_AGENTS.forEach(agent => {
            options.push({ value: `agent:${agent}`, label: agent })
        })
        variants.forEach(v => {
            options.push({ value: `variant:${v.id}`, label: `${v.name} (variant)` })
        })
        presets.forEach(p => {
            options.push({ value: `preset:${p.id}`, label: `${p.name} (preset)` })
        })
        return options
    }, [variants, presets, t])

    const getAgentSourceValue = useCallback((action: ContextualAction): string => {
        if (action.presetId) return `preset:${action.presetId}`
        if (action.variantId) return `variant:${action.variantId}`
        if (action.agentType) return `agent:${action.agentType}`
        return ''
    }, [])

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
                <h3 className="text-text-primary" style={{ fontSize: 'var(--font-heading)' }}>
                    {t('settings.contextualActions.title', 'Contextual Actions')}
                </h3>
                <div className="flex gap-2">
                    <button onClick={() => void handleReset()} className="settings-btn text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                        {t('settings.contextualActions.resetDefaults', 'Reset to Defaults')}
                    </button>
                    <button onClick={handleAdd} className="settings-btn text-text-primary" style={{ fontSize: 'var(--font-body)' }}>
                        {t('settings.contextualActions.add', '+ Add Action')}
                    </button>
                </div>
            </div>

            <p className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                {t('settings.contextualActions.description', 'Define actions that appear on MR and Issue detail views. Use {{variable}} syntax in templates to inject context.')}
            </p>

            {currentActions.length === 0 && (
                <div className="text-text-muted text-center py-8" style={{ fontSize: 'var(--font-body)' }}>
                    {t('settings.contextualActions.empty', 'No actions configured.')}
                </div>
            )}

            <div className="space-y-2">
                {currentActions.map(action => (
                    <div
                        key={action.id}
                        className="rounded-lg border"
                        style={{ backgroundColor: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-subtle)' }}
                    >
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer"
                            onClick={() => setExpandedId(expandedId === action.id ? null : action.id)}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-text-primary" style={{ fontSize: 'var(--font-body)' }}>
                                    {action.name || '(unnamed)'}
                                </span>
                                <span className="text-text-muted px-1.5 py-0.5 rounded" style={{ fontSize: 'var(--font-caption)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                                    {action.context}
                                </span>
                                <span className="text-text-muted px-1.5 py-0.5 rounded" style={{ fontSize: 'var(--font-caption)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                                    {action.mode}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {!action.isBuiltIn && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemove(action.id) }}
                                        className="settings-btn-danger px-2 py-1"
                                        style={{ fontSize: 'var(--font-caption)' }}
                                    >
                                        {t('common.delete', 'Delete')}
                                    </button>
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
                            <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                                <div className="grid grid-cols-3 gap-3 pt-3">
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>Name</label>
                                        <input
                                            type="text"
                                            value={action.name}
                                            onChange={e => handleUpdate(action.id, { name: e.target.value })}
                                            placeholder="e.g. Review this MR"
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>Context</label>
                                        <select
                                            value={action.context}
                                            onChange={e => handleUpdate(action.id, { context: e.target.value as ContextualActionContext })}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        >
                                            <option value="mr">MR only</option>
                                            <option value="issue">Issue only</option>
                                            <option value="both">Both</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>Mode</label>
                                        <select
                                            value={action.mode}
                                            onChange={e => handleUpdate(action.id, { mode: e.target.value as ContextualActionMode })}
                                            className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 focus:outline-none focus:border-[var(--color-border-focus)]"
                                            style={{ fontSize: 'var(--font-body)' }}
                                        >
                                            <option value="session">Create Session</option>
                                            <option value="spec">Create Spec</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-text-muted mb-1" style={{ fontSize: 'var(--font-caption)' }}>Agent / Variant / Preset</label>
                                    <select
                                        value={getAgentSourceValue(action)}
                                        onChange={e => handleAgentSourceChange(action.id, e.target.value)}
                                        className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 focus:outline-none focus:border-[var(--color-border-focus)]"
                                        style={{ fontSize: 'var(--font-body)' }}
                                    >
                                        {agentSourceOptions.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>Prompt Template</label>
                                        <span className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
                                            Variables: {getTemplateVars(action.context).map(v => `{{${v}}}`).join(', ')}
                                        </span>
                                    </div>
                                    <textarea
                                        value={action.promptTemplate}
                                        onChange={e => handleUpdate(action.id, { promptTemplate: e.target.value })}
                                        placeholder="Review the merge request:\n\nTitle: {{mr.title}}\nDescription: {{mr.description}}"
                                        rows={6}
                                        className="w-full bg-bg-tertiary text-text-primary rounded px-3 py-2 border border-white/10 placeholder-text-muted focus:outline-none focus:border-[var(--color-border-focus)]"
                                        style={{ fontSize: 'var(--font-body)', fontFamily: 'var(--font-family-mono)' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {hasUnsavedChanges && (
                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={handleDiscard} className="settings-btn text-text-muted" style={{ fontSize: 'var(--font-body)' }}>
                        {t('common.discard', 'Discard')}
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        className="settings-btn text-text-primary bg-accent-blue/20 border-accent-blue/40"
                        style={{ fontSize: 'var(--font-body)' }}
                    >
                        {t('common.save', 'Save')}
                    </button>
                </div>
            )}
        </div>
    )
}
