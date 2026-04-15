import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { Checkbox, SectionHeader } from '../ui'

export interface AgentPluginConfig {
  claudeLucodeTerminalHooks: boolean
}

interface Props {
  agent: 'claude' | 'codex' | 'opencode' | 'amp' | 'droid'
}

const DEFAULT_CONFIG: AgentPluginConfig = {
  claudeLucodeTerminalHooks: true,
}

export function AgentPluginsPanel({ agent }: Props) {
  const [config, setConfig] = useState<AgentPluginConfig>(DEFAULT_CONFIG)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const current = await invoke<AgentPluginConfig>(
        TauriCommands.GetProjectAgentPluginConfig
      )
      setConfig(current)
    } catch (e) {
      logger.error('Failed to load agent plugin config', e)
      setError(String(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const persist = useCallback(
    async (next: AgentPluginConfig) => {
      setConfig(next)
      setError(null)
      try {
        await invoke(TauriCommands.SetProjectAgentPluginConfig, { config: next })
      } catch (e) {
        logger.error('Failed to save agent plugin config', e)
        setError(String(e))
        await load()
      }
    },
    [load]
  )

  if (agent !== 'claude') {
    return null
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Plugins"
        description="Claude Code plugins Lucode manages for this project. Disable to stop Lucode from enabling them."
        className="border-b-0 pb-0"
      />

      <div
        className="p-3 rounded border"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Lucode terminal hooks
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Lets Lucode badge a session when Claude is waiting on elicitation, permission, or idle prompts.
              Disabling stops Lucode from enabling the <code>lucode-terminal-hooks</code> plugin in this project&apos;s
              <code> .claude/settings.json</code>.
            </div>
          </div>
          <Checkbox
            checked={config.claudeLucodeTerminalHooks}
            disabled={!loaded}
            onChange={(checked) => {
              void persist({ ...config, claudeLucodeTerminalHooks: checked })
            }}
            label="Enable plugin"
          />
        </div>
      </div>

      {error && (
        <div
          className="p-3 rounded text-xs"
          style={{
            backgroundColor: 'var(--color-accent-red-bg)',
            border: '1px solid var(--color-accent-red-border)',
            color: 'var(--color-accent-red-light)',
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
