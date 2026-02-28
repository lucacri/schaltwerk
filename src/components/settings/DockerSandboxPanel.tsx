import { useCallback, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  dockerProjectStateAtom,
  refreshDockerStatusActionAtom,
  setDockerSandboxEnabledActionAtom,
  buildDockerImageActionAtom,
} from '../../store/atoms/docker'
import { logger } from '../../utils/logger'

export function DockerSandboxPanel() {
  const state = useAtomValue(dockerProjectStateAtom)
  const refreshStatus = useSetAtom(refreshDockerStatusActionAtom)
  const setSandboxEnabled = useSetAtom(setDockerSandboxEnabledActionAtom)
  const buildImage = useSetAtom(buildDockerImageActionAtom)

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void setSandboxEnabled(e.target.checked).catch((err: unknown) => {
        logger.error('[Docker] Failed to toggle sandbox', err)
      })
    },
    [setSandboxEnabled]
  )

  const handleBuild = useCallback(() => {
    void buildImage().catch((err: unknown) => {
      logger.error('[Docker] Failed to build image', err)
    })
  }, [buildImage])

  return (
    <div>
      <h3 className="text-body font-medium text-text-primary mb-2">Docker Sandbox</h3>
      <div className="text-body text-text-tertiary mb-4">
        Run agent sessions inside Docker containers for filesystem isolation. Agents can only access
        the mounted project directory.
      </div>

      {!state.available && (
        <div
          className="p-3 border rounded text-xs space-y-1 mb-4"
          style={{
            backgroundColor: 'var(--color-accent-amber-bg)',
            borderColor: 'var(--color-accent-amber-border)',
            color: 'var(--color-text-primary)',
          }}
        >
          <div className="font-medium" style={{ color: 'var(--color-accent-amber-light)' }}>
            Docker not available
          </div>
          <div>
            Install Docker Desktop and ensure the daemon is running to use sandbox mode.
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between bg-bg-tertiary rounded px-3 py-2">
          <div>
            <div className="text-body text-text-primary">Enable sandbox</div>
            <div className="text-caption text-text-tertiary">
              Wrap agent processes in Docker containers
            </div>
          </div>
          <input
            type="checkbox"
            className="accent-blue"
            checked={state.sandboxEnabled}
            onChange={handleToggle}
            disabled={!state.available}
            aria-label="Enable Docker sandbox"
          />
        </div>

        <div className="flex items-center justify-between bg-bg-tertiary rounded px-3 py-2">
          <div>
            <div className="text-body text-text-primary">Sandbox image</div>
            <div className="text-caption text-text-tertiary">
              {state.imageExists ? 'schaltwerk-sandbox:latest — ready' : 'Not built yet'}
            </div>
          </div>
          <button
            className="settings-btn px-3 py-1.5 text-xs font-medium rounded-md"
            onClick={handleBuild}
            disabled={!state.available || state.buildInProgress}
          >
            {state.buildInProgress
              ? 'Building...'
              : state.imageExists
                ? 'Rebuild'
                : 'Build Image'}
          </button>
        </div>

        <div className="p-3 bg-bg-elevated rounded text-caption text-text-muted">
          Credentials can be staged for containers by placing config files in{' '}
          <code className="text-text-secondary">~/.config/schaltwerk/docker-mounts/</code>.
          Subdirectories (<code className="text-text-secondary">claude/</code>,{' '}
          <code className="text-text-secondary">codex/</code>,{' '}
          <code className="text-text-secondary">gemini/</code>) are mounted read-only into the
          container.
        </div>
      </div>
    </div>
  )
}
