import { useId, useMemo, useRef, useState } from 'react'
import { AgentType } from '../../types/session'
import { AgentEnvVar, displayNameForAgent } from './agentDefaults'
import { useTranslation } from '../../common/i18n'
import { Button, FormGroup, Label, SectionHeader, TextInput, Textarea } from '../ui'

interface Props {
    agentType: AgentType
    cliArgs: string
    onCliArgsChange: (value: string) => void
    envVars: AgentEnvVar[]
    onEnvVarChange: (index: number, field: 'key' | 'value', value: string) => void
    onAddEnvVar: () => void
    onRemoveEnvVar: (index: number) => void
    loading?: boolean
}

export function AgentDefaultsSection({
    agentType,
    cliArgs,
    onCliArgsChange,
    envVars,
    onEnvVarChange,
    onAddEnvVar,
    onRemoveEnvVar,
    loading = false,
}: Props) {
    const { t } = useTranslation()
    const agentDisplayName = displayNameForAgent(agentType)
    const [envEditorOpen, setEnvEditorOpen] = useState(false)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    const cliArgsRef = useRef<HTMLTextAreaElement | null>(null)
    const cliArgsFieldId = useId()

    const summaryText = useMemo(() => {
        if (loading) {
            return t.agentDefaults.loadingDefaults
        }

        if (envVars.length === 0) {
            return t.agentDefaults.noEnvVarsYet
        }

        const summaryItems = envVars
            .slice(0, 3)
            .map(item => (item.key.trim() ? item.key.trim() : 'Unnamed'))
        const remaining = envVars.length - summaryItems.length

        return remaining > 0
            ? `${summaryItems.join(', ')} and ${remaining} more`
            : summaryItems.join(', ')
    }, [envVars, loading, t.agentDefaults.loadingDefaults, t.agentDefaults.noEnvVarsYet])

    const handleToggleEditor = () => {
        if (loading) {
            return
        }

        setEnvEditorOpen(prev => !prev)
    }

    const handleToggleAdvanced = () => {
        setAdvancedOpen(prev => {
            const next = !prev
            if (!next) {
                setEnvEditorOpen(false)
            } else {
                requestAnimationFrame(() => {
                    if (!loading) {
                        cliArgsRef.current?.focus({ preventScroll: true })
                    }
                })
            }
            return next
        })
    }

    const handleAddVariable = () => {
        if (loading) {
            return
        }

        if (!advancedOpen) {
            setAdvancedOpen(true)
        }

        if (!envEditorOpen) {
            setEnvEditorOpen(true)
        }

        onAddEnvVar()
    }

    return (
        <div className="space-y-3" data-testid="agent-defaults-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeader
                    title={t.agentDefaults.title}
                    description={
                        agentType === 'terminal'
                            ? t.agentDefaults.descriptionEnvOnly.replace('{agent}', agentDisplayName)
                            : t.agentDefaults.descriptionWithArgs.replace('{agent}', agentDisplayName)
                    }
                    className="min-w-0 flex-1 border-b-0 pb-0"
                />
                <Button
                    size="sm"
                    onClick={handleToggleAdvanced}
                    data-testid="advanced-agent-settings-toggle"
                    aria-expanded={advancedOpen}
                >
                    {advancedOpen ? t.agentDefaults.hideAdvanced : t.agentDefaults.showAdvanced}
                </Button>
            </div>

            {advancedOpen && (
                <div className="space-y-3">
                    {agentType !== 'terminal' && (
                        <FormGroup
                            label={t.agentDefaults.defaultCustomArgs}
                            htmlFor={cliArgsFieldId}
                            help={t.agentDefaults.argsHint.replace('{agent}', agentDisplayName)}
                        >
                            <Textarea
                                id={cliArgsFieldId}
                                ref={cliArgsRef}
                                data-testid="agent-cli-args-input"
                                value={cliArgs}
                                onChange={event => onCliArgsChange(event.target.value)}
                                placeholder={t.agentDefaults.argsPlaceholder}
                                rows={2}
                                disabled={loading}
                                monospace
                            />
                        </FormGroup>
                    )}
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <Label>{t.agentDefaults.envVars}</Label>
                                <p className="mt-1 text-caption text-text-muted" data-testid="env-summary">
                                    {summaryText}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    onClick={handleToggleEditor}
                                    disabled={loading}
                                    data-testid="toggle-env-vars"
                                    aria-expanded={envEditorOpen}
                                >
                                    {envEditorOpen ? t.agentDefaults.hideEditor : t.agentDefaults.editVariables}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleAddVariable}
                                    disabled={loading}
                                    data-testid="add-env-var"
                                >
                                    {t.agentDefaults.addVariable}
                                </Button>
                            </div>
                        </div>
                        {envEditorOpen && (
                            <div className="mt-3 rounded border border-border-subtle bg-bg-elevated">
                                <div
                                    className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-border-subtle"
                                    data-testid="env-vars-scroll"
                                >
                                    {loading ? (
                                        <div className="p-3 text-caption text-text-muted">{t.agentDefaults.loadingDefaults}</div>
                                    ) : envVars.length === 0 ? (
                                        <div className="p-3 text-caption text-text-muted">
                                            {t.agentDefaults.noEnvVarsConfigured}
                                        </div>
                                    ) : (
                                        envVars.map((item, index) => (
                                            <div
                                                className="grid grid-cols-12 gap-2 p-2"
                                                key={`env-var-${agentType}-${index}`}
                                                data-testid={`env-var-row-${index}`}
                                            >
                                                <TextInput
                                                    data-testid={`env-var-key-${index}`}
                                                    aria-label={`Environment variable key ${index + 1}`}
                                                    value={item.key}
                                                    onChange={event => onEnvVarChange(index, 'key', event.target.value)}
                                                    placeholder={t.agentDefaults.keyPlaceholder}
                                                    className="col-span-4"
                                                    disabled={loading}
                                                />
                                                <TextInput
                                                    data-testid={`env-var-value-${index}`}
                                                    aria-label={`Environment variable value ${index + 1}`}
                                                    value={item.value}
                                                    onChange={event => onEnvVarChange(index, 'value', event.target.value)}
                                                    placeholder={t.agentDefaults.valuePlaceholder}
                                                    className="col-span-7"
                                                    disabled={loading}
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    data-testid={`env-var-remove-${index}`}
                                                    onClick={() => onRemoveEnvVar(index)}
                                                    className="col-span-1 w-full !px-0"
                                                    disabled={loading}
                                                    title={t.agentDefaults.remove}
                                                >
                                                    {t.agentDefaults.remove}
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                        <p className="mt-1 text-caption text-text-muted">
                            {agentType === 'terminal'
                                ? t.agentDefaults.envVarsShellHint.replace('{agent}', agentDisplayName)
                                : t.agentDefaults.envVarsProcessHint.replace('{agent}', agentDisplayName)
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
