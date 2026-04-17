import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme, type AgentColor } from '../../common/theme'
import { typography } from '../../common/typography'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import type { PrState } from '../../types/session'

export const sessionText = {
  title: {
    ...typography.body,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  badge: {
    ...typography.caption,
    fontWeight: 600,
    lineHeight: theme.lineHeight.compact,
  },
  meta: {
    ...typography.caption,
    color: 'var(--color-text-tertiary)',
  },
  taskDescription: {
    ...typography.caption,
    fontSize: theme.fontSize.sessionTask,
    lineHeight: 1.1,
    color: 'var(--color-text-tertiary)',
    height: 'var(--font-session-task-height)',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word',
  },
  metaEmphasis: {
    ...typography.caption,
    color: 'var(--color-text-secondary)',
  },
  agent: {
    ...typography.body,
    color: 'var(--color-text-secondary)',
  },
  agentMuted: {
    ...typography.caption,
    color: 'var(--color-text-secondary)',
  },
  statsLabel: {
    ...typography.caption,
    color: 'var(--color-text-tertiary)',
  },
  statsNumber: {
    ...typography.caption,
    fontWeight: 600,
  },
  dirtyBadge: {
    ...typography.caption,
    fontWeight: 600,
    lineHeight: theme.lineHeight.compact,
    color: 'var(--color-text-tertiary)',
    backgroundColor: 'var(--color-bg-elevated)',
    borderColor: 'var(--color-border-subtle)',
  },
  diffBadge: {
    ...typography.caption,
    fontWeight: 600,
    lineHeight: theme.lineHeight.compact,
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-bg-hover)',
    borderColor: 'var(--color-border-subtle)',
  },
} as const

export const getAgentColorKey = (agent: string): AgentColor => {
  switch (agent) {
    case 'claude':
      return 'blue'
    case 'opencode':
      return 'green'
    case 'gemini':
      return 'orange'
    case 'droid':
      return 'violet'
    case 'codex':
      return 'red'
    case 'amp':
    case 'kilocode':
    case 'terminal':
      return 'yellow'
    default:
      return 'red'
  }
}

type MetadataBadgeTone = 'issue' | 'pr'

export function openMetadataLink(url: string, sessionId: string, source: string) {
  void invoke(TauriCommands.OpenExternalUrl, { url }).catch((error) => {
    logger.error(`[${source}] Failed to open linked URL for session ${sessionId}`, {
      url,
      error,
    })
  })
}

export function MetadataLinkBadge({
  label,
  url,
  tone,
  title,
  onOpen,
  children,
}: {
  label: string
  url: string
  tone: MetadataBadgeTone
  title: string
  onOpen: (url: string) => void
  children: ReactNode
}) {
  const palette = tone === 'issue'
    ? {
        backgroundColor: 'var(--color-accent-green-bg)',
        color: 'var(--color-accent-green-light)',
        borderColor: 'var(--color-accent-green-border)',
      }
    : {
        backgroundColor: 'var(--color-accent-violet-bg)',
        color: 'var(--color-accent-violet-light)',
        borderColor: 'var(--color-accent-violet-border)',
      }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded border flex-shrink-0 hover:brightness-110 active:opacity-80"
      style={{
        ...sessionText.badge,
        ...palette,
      }}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(url)
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

export function PrStateBadge({ state }: { state?: PrState | null }) {
  if (!state) return null

  const config: Record<PrState, { label: string; color: string; bg: string; border: string }> = {
    open: {
      label: 'open',
      color: 'var(--color-text-secondary)',
      bg: 'var(--color-bg-elevated)',
      border: 'var(--color-border-subtle)',
    },
    succeeding: {
      label: 'ci green',
      color: 'var(--color-accent-green-light)',
      bg: 'var(--color-accent-green-bg)',
      border: 'var(--color-accent-green-border)',
    },
    mred: {
      label: 'merged',
      color: 'var(--color-accent-violet-light)',
      bg: 'var(--color-accent-violet-bg)',
      border: 'var(--color-accent-violet-border)',
    },
  }
  const style = config[state]

  return (
    <span
      data-testid="session-card-pr-state"
      className="inline-flex items-center rounded border px-1.5 py-[1px]"
      style={{
        ...sessionText.badge,
        color: style.color,
        backgroundColor: style.bg,
        borderColor: style.border,
      }}
      title={`PR state: ${style.label}`}
    >
      {style.label}
    </span>
  )
}
