import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'
import { AgentType, AGENT_TYPES } from '../../types/session'
import { useTranslation } from '../../common/i18n'
import { ModalPortal } from '../shared/ModalPortal'
import { Button } from '../ui/Button'

interface Props {
    open: boolean
    onClose: () => void
    onSelect: (options: { agentType: AgentType }) => void | Promise<void>
    initialAgentType?: AgentType
}

const ALLOWED_AGENTS: AgentType[] = AGENT_TYPES.filter(
    (agent): agent is AgentType => agent !== 'terminal'
)
const DEFAULT_AGENT: AgentType = 'claude'

export function CustomAgentModal({
    open,
    onClose,
    onSelect,
    initialAgentType,
}: Props) {
    const { t } = useTranslation()
    const { filterAgents, loading: enabledAgentsLoading } = useEnabledAgents()
    const [agentType, setAgentType] = useState<AgentType>(DEFAULT_AGENT)
    const [isSelecting, setIsSelecting] = useState(false)
    const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
    const selectRef = useRef<() => void>(() => {})
    const allowedAgents = filterAgents(ALLOWED_AGENTS)
    const selectableAgents = allowedAgents.length > 0 ? allowedAgents : [DEFAULT_AGENT]

    const handleSelect = async () => {
        if (isSelecting || enabledAgentsLoading) return

        setIsSelecting(true)
        try {
            await Promise.resolve(onSelect({ agentType }))
            onClose()
        } finally {
            setIsSelecting(false)
        }
    }

    selectRef.current = () => { void handleSelect() }

    useEffect(() => {
        if (!open) return

        setIsSelecting(false)

        if (initialAgentType !== undefined) {
            const normalized = AGENT_TYPES.includes(initialAgentType) ? initialAgentType : DEFAULT_AGENT
            const fallbackAgent = selectableAgents[0] ?? DEFAULT_AGENT
            const sanitized = selectableAgents.includes(normalized) ? normalized : fallbackAgent
            setAgentType(sanitized)
        } else {
            setAgentType(selectableAgents[0] ?? DEFAULT_AGENT)
        }
    }, [open, initialAgentType, selectableAgents])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isModelSelectorOpen) {
                return
            }

            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
            } else if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                selectRef.current()
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [open, onClose, isModelSelectorOpen])

    if (!open) return null

    return (
        <ModalPortal>
            <div className="fixed inset-0 bg-bg-primary/60 z-50 flex items-center justify-center">
                <div className="w-[480px] max-w-[95vw] bg-bg-secondary border border-border-default rounded-xl shadow-xl">
                <h2 className="px-4 py-3 border-b border-border-subtle text-text-secondary font-medium">
                    {t.customAgentModal.title}
                </h2>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-text-secondary mb-2">{t.customAgentModal.selectAgent}</label>
                        <ModelSelector
                            value={agentType}
                            onChange={setAgentType}
                            disabled={isSelecting || enabledAgentsLoading}
                            onDropdownOpenChange={setIsModelSelectorOpen}
                            allowedAgents={selectableAgents}
                        />
                        <p className="text-xs text-text-tertiary mt-2">
                            {t.customAgentModal.helperText}
                        </p>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
                    <Button
                        onClick={onClose}
                        disabled={isSelecting || enabledAgentsLoading}
                        title={t.customAgentModal.cancelEsc}
                    >
                        {t.customAgentModal.cancel}
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </Button>
                    <Button
                        onClick={() => { void handleSelect() }}
                        disabled={isSelecting || enabledAgentsLoading}
                        loading={isSelecting}
                        variant="primary"
                        title={t.customAgentModal.addTabEnter}
                    >
                        <span>{t.customAgentModal.addTab}</span>
                        {!isSelecting && (
                            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
                        )}
                    </Button>
                </div>
                </div>
            </div>
        </ModalPortal>
    )
}
