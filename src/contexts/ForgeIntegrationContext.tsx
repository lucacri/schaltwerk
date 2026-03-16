import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useForgeIntegration, type ForgeIntegrationValue } from '../hooks/useForgeIntegration'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'
import type { ForgeType, ForgeSourceConfig } from '../types/forgeTypes'
import type { GitlabSource } from '../types/gitlabTypes'

export interface ForgeIntegrationContextValue extends ForgeIntegrationValue {
  forgeType: ForgeType
  sources: ForgeSourceConfig[]
  hasRepository: boolean
  hasSources: boolean
}

const ForgeIntegrationContext = createContext<ForgeIntegrationContextValue | undefined>(undefined)

function mapGitlabSourcesToForgeConfigs(sources: GitlabSource[]): ForgeSourceConfig[] {
  return sources.map((s) => ({
    projectIdentifier: s.projectPath,
    hostname: s.hostname,
    label: s.label || s.projectPath,
    forgeType: 'gitlab' as const,
  }))
}

export function ForgeIntegrationProvider({ children }: { children: ReactNode }) {
  const forgeValue = useForgeIntegration()
  const { status } = forgeValue
  const [sources, setSources] = useState<ForgeSourceConfig[]>([])

  const forgeType: ForgeType = status?.forgeType ?? 'unknown'

  useEffect(() => {
    if (!status) {
      setSources([])
      return
    }

    if (status.forgeType === 'github' && status.authenticated) {
      setSources([
        {
          projectIdentifier: '',
          hostname: status.hostname,
          label: 'GitHub',
          forgeType: 'github',
        },
      ])
    } else if (status.forgeType === 'gitlab' && status.authenticated) {
      invoke<GitlabSource[]>(TauriCommands.GitLabGetSources)
        .then((result) => {
          setSources(mapGitlabSourcesToForgeConfigs(result ?? []))
        })
        .catch((error) => {
          logger.error('[ForgeIntegrationContext] Failed to load GitLab sources', error)
          setSources([])
        })
    } else {
      setSources([])
    }
  }, [status])

  const value = useMemo<ForgeIntegrationContextValue>(
    () => ({
      ...forgeValue,
      forgeType,
      sources,
      hasRepository: forgeType !== 'unknown' && sources.length > 0,
      hasSources: sources.length > 0,
    }),
    [forgeValue, forgeType, sources]
  )

  return (
    <ForgeIntegrationContext.Provider value={value}>
      {children}
    </ForgeIntegrationContext.Provider>
  )
}

export function useForgeIntegrationContext(): ForgeIntegrationContextValue {
  const context = useContext(ForgeIntegrationContext)
  if (!context) {
    throw new Error('useForgeIntegrationContext must be used within ForgeIntegrationProvider')
  }
  return context
}

export { ForgeIntegrationContext }
