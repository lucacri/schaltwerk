import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { theme } from '../common/theme'
import { logger } from '../utils/logger'

interface DevelopmentInfo {
  isDevelopment?: boolean
  branch?: string | null
  devMode?: boolean
}

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  marginLeft: theme.spacing.sm,
  marginRight: theme.spacing.sm,
  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  backgroundColor: 'var(--color-accent-red-bg)',
  border: '1px solid var(--color-accent-red-border)',
  borderRadius: theme.borderRadius.lg,
  color: 'var(--color-accent-red-light)',
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.caption,
  fontWeight: 600,
  letterSpacing: '0.04em',
  lineHeight: theme.lineHeight.compact,
  whiteSpace: 'nowrap',
}

export function DevModeIndicator() {
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    invoke<DevelopmentInfo>(TauriCommands.GetDevelopmentInfo)
      .then(info => {
        if (!cancelled) {
          setDevMode(Boolean(info?.devMode))
        }
      })
      .catch(error => {
        logger.error('[DevModeIndicator] Failed to get development info:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!devMode) {
    return null
  }

  return (
    <div
      data-testid="dev-mode-indicator"
      data-no-drag
      role="status"
      aria-label="Running in dev mode"
      title="Running in dev mode"
      style={containerStyle}
    >
      RUNNING IN DEV MODE
    </div>
  )
}
