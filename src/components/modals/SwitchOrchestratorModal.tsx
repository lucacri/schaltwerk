import { useState, useEffect, useMemo, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useEnabledAgents } from '../../hooks/useEnabledAgents'
import { AgentType, AGENT_TYPES } from '../../types/session'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'
import { ModalPortal } from '../shared/ModalPortal'

interface Props {
  open: boolean
  onClose: () => void
  onSwitch: (options: { agentType: AgentType }) => void | Promise<void>
  scope?: 'orchestrator' | 'session'
  initialAgentType?: AgentType
  targetSessionId?: string | null
}

const ORCHESTRATOR_ALLOWED_AGENTS: AgentType[] = AGENT_TYPES.filter(
  (agent): agent is AgentType => agent !== 'terminal'
)
const SESSION_ALLOWED_AGENTS = ORCHESTRATOR_ALLOWED_AGENTS
const DEFAULT_AGENT: AgentType = 'claude'

export function SwitchOrchestratorModal({
  open,
  onClose,
  onSwitch,
  scope,
  initialAgentType,
  targetSessionId,
}: Props) {
  const { t } = useTranslation()
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [switching, setSwitching] = useState(false)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const {
    getOrchestratorAgentType,
    getAgentType,
  } = useClaudeSession()
  const { filterAgents, loading: enabledAgentsLoading } = useEnabledAgents()
  const switchRef = useRef<() => void>(() => {})

  const derivedScope: 'orchestrator' | 'session' =
    scope ?? (targetSessionId ? 'session' : 'orchestrator')
  const isOrchestrator = derivedScope === 'orchestrator'
  const allowedAgents = useMemo(
    () => filterAgents(isOrchestrator ? ORCHESTRATOR_ALLOWED_AGENTS : SESSION_ALLOWED_AGENTS),
    [filterAgents, isOrchestrator]
  )
  const selectableAgents = useMemo(
    () => (allowedAgents.length > 0 ? allowedAgents : [DEFAULT_AGENT]),
    [allowedAgents]
  )
  const title = isOrchestrator ? t.switchAgentModal.titleOrchestrator : t.switchAgentModal.titleSession
  const warningBody = isOrchestrator
    ? t.switchAgentModal.warningOrchestrator
    : targetSessionId
      ? t.switchAgentModal.warningSession.replace('session agent', `session agent for ${targetSessionId}`)
      : t.switchAgentModal.warningSession
  const helperText = isOrchestrator
    ? t.switchAgentModal.helperOrchestrator
    : t.switchAgentModal.helperSession

  const handleSwitch = async () => {
    if (switching || enabledAgentsLoading) return

    setSwitching(true)
    try {
      await Promise.resolve(onSwitch({ agentType }))
    } finally {
      setSwitching(false)
    }
  }

  switchRef.current = () => { void handleSwitch() }

  useEffect(() => {
    if (!open) {
      return
    }

    setSwitching(false)

    if (initialAgentType !== undefined) {
      const normalized = AGENT_TYPES.includes(initialAgentType) ? initialAgentType : DEFAULT_AGENT
      const fallbackAgent = selectableAgents[0] ?? DEFAULT_AGENT
      const sanitized = selectableAgents.includes(normalized) ? normalized : fallbackAgent
      setAgentType(sanitized)
      return
    }

    const loadAgentType = isOrchestrator ? getOrchestratorAgentType : getAgentType
    Promise.resolve(loadAgentType())
      .then((type) => {
        const normalized = AGENT_TYPES.includes(type as AgentType)
          ? (type as AgentType)
          : DEFAULT_AGENT
        const fallbackAgent = selectableAgents[0] ?? DEFAULT_AGENT
        const sanitized = selectableAgents.includes(normalized) ? normalized : fallbackAgent
        setAgentType(sanitized)
      })
      .catch((error) => {
        logger.warn('[SwitchOrchestratorModal] Failed to load agent configuration:', error)
      })
  }, [
    open,
    initialAgentType,
    selectableAgents,
    isOrchestrator,
    getAgentType,
    getOrchestratorAgentType,
  ])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModelSelectorOpen) {
        return
      }

      const target = e.target instanceof Element ? e.target : null
      const targetIsModelSelector = target?.closest('[data-model-selector]') !== null

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Enter') {
        if (targetIsModelSelector) {
          return
        }
        e.preventDefault()
        e.stopPropagation()
        switchRef.current()
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
          {title}
        </h2>

        <div className="p-4 space-y-4">
          <div className="p-3 bg-[var(--color-accent-amber-bg)] border border-[var(--color-accent-amber-border)] rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-accent-amber text-lg">⚠️</span>
              <div className="text-sm text-accent-amber">
                <p className="font-medium mb-1">{t.switchAgentModal.warning}</p>
                <p className="opacity-90">{warningBody}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-2">{t.switchAgentModal.selectAgent}</label>
            <ModelSelector
              value={agentType}
              onChange={setAgentType}
              disabled={switching || enabledAgentsLoading}
              onDropdownOpenChange={setIsModelSelectorOpen}
              allowedAgents={selectableAgents}
            />
            <p className="text-xs text-text-tertiary mt-2">{helperText}</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={switching || enabledAgentsLoading}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-bg-hover disabled:bg-bg-elevated disabled:opacity-50 rounded group relative"
            title={t.switchAgentModal.cancelEsc}
          >
            {t.switchAgentModal.cancel}
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          <button
            onClick={() => { void handleSwitch() }}
            disabled={switching || enabledAgentsLoading}
            className="px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed rounded text-text-inverse group relative inline-flex items-center gap-2 bg-accent-blue hover:bg-[var(--color-accent-blue-dark)]"
            title={t.switchAgentModal.switchAgentEnter}
          >
            {switching && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current opacity-60 border-t-transparent"
                aria-hidden="true"
              />
            )}
            <span>{t.switchAgentModal.switchAgent}</span>
            {!switching && (
              <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
            )}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
