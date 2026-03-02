import { AgentBinaryStatus } from '../../hooks/useAgentBinarySnapshot'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES } from '../../types/session'
import { useTranslation } from '../../common/i18n'
import type { Translations } from '../../common/i18n/types'
import { theme } from '../../common/theme'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  loading: boolean
  statusByAgent: Record<string, AgentBinaryStatus>
  onRefresh: () => void
}

function StatusList({ items, t }: { items: Record<string, { status: 'present' | 'missing'; preferredPath: string | null }>; t: Translations }) {
  return (
    <div className="space-y-2">
      {AGENT_TYPES.map(agent => {
        const status = items[agent]?.status ?? 'missing'
        const preferred = items[agent]?.preferredPath ?? null
        const color = status === 'present'
          ? 'var(--color-accent-green)'
          : 'var(--color-text-secondary)'
        return (
          <div
            key={agent}
            className="flex items-start justify-between border rounded px-3 py-2"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div>
              <div style={{ color: 'var(--color-text-primary)', fontSize: theme.fontSize.body }}>
                {displayNameForAgent(agent)}
              </div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.caption }}>
                {preferred ?? t.agentCliMissing.noPathDetected}
              </div>
            </div>
            <div className="font-semibold" style={{ color, fontSize: theme.fontSize.label }}>
              {status === 'present' ? t.agentCliMissing.found : t.agentCliMissing.missing}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AgentCliMissingModal({ open, onClose, onOpenSettings, loading, statusByAgent, onRefresh }: Props) {
  const { t } = useTranslation()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative z-10 w-[640px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-100" style={{ fontSize: theme.fontSize.heading }}>{t.agentCliMissing.title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label={t.agentCliMissing.close}
          >
            ×
          </button>
        </div>
        <p className="text-slate-300" style={{ fontSize: theme.fontSize.body }}>
          {t.agentCliMissing.description}
        </p>
        <StatusList items={statusByAgent} t={t} />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded border"
            style={{
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
              backgroundColor: 'var(--color-bg-elevated)',
              fontSize: theme.fontSize.button,
            }}
            disabled={loading}
          >
            {loading ? t.agentCliMissing.scanning : t.agentCliMissing.rerunDetection}
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 rounded text-white"
            style={{ backgroundColor: 'var(--color-accent-blue-dark)', fontSize: theme.fontSize.button }}
          >
            {t.agentCliMissing.openSettings}
          </button>
        </div>
      </div>
    </div>
  )
}
