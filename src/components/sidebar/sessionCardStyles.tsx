import type { ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme, type AgentColor } from '../../common/theme'
import { typography } from '../../common/typography'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

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
