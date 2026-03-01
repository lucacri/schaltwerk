import { useCallback, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  dockerProjectStateAtom,
  refreshDockerStatusActionAtom,
  setDockerSandboxEnabledActionAtom,
  buildDockerImageActionAtom,
  rebuildDockerImageActionAtom,
} from '../../store/atoms/docker'
import { useTranslation } from '../../common/i18n/useTranslation'
import { logger } from '../../utils/logger'

export function DockerSandboxPanel() {
  const { t } = useTranslation()
  const state = useAtomValue(dockerProjectStateAtom)
  const refreshStatus = useSetAtom(refreshDockerStatusActionAtom)
  const setSandboxEnabled = useSetAtom(setDockerSandboxEnabledActionAtom)
  const buildImage = useSetAtom(buildDockerImageActionAtom)
  const rebuildImage = useSetAtom(rebuildDockerImageActionAtom)

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
    const action = state.imageExists ? rebuildImage() : buildImage()
    void action.catch((err: unknown) => {
      logger.error('[Docker] Failed to build image', err)
    })
  }, [buildImage, rebuildImage, state.imageExists])

  return (
    <div>
      <h3 className="text-body font-medium text-text-primary mb-2">
        {t.settings.docker.title}
      </h3>
      <div className="text-body text-text-tertiary mb-4">{t.settings.docker.description}</div>

      {!state.available && (
        <div
          className="p-3 border rounded text-caption space-y-1 mb-4"
          style={{
            backgroundColor: 'var(--color-accent-amber-bg)',
            borderColor: 'var(--color-accent-amber-border)',
            color: 'var(--color-text-primary)',
          }}
        >
          <div className="font-medium" style={{ color: 'var(--color-accent-amber-light)' }}>
            {t.settings.docker.notAvailable}
          </div>
          <div>{t.settings.docker.notAvailableDesc}</div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between bg-bg-tertiary rounded px-3 py-2">
          <div>
            <div className="text-body text-text-primary">{t.settings.docker.enableSandbox}</div>
            <div className="text-caption text-text-tertiary">
              {t.settings.docker.enableSandboxDesc}
            </div>
          </div>
          <input
            type="checkbox"
            className="accent-blue"
            checked={state.sandboxEnabled}
            onChange={handleToggle}
            disabled={!state.available}
            aria-label={t.settings.docker.enableSandbox}
          />
        </div>

        <div className="flex items-center justify-between bg-bg-tertiary rounded px-3 py-2">
          <div>
            <div className="text-body text-text-primary">{t.settings.docker.sandboxImage}</div>
            <div className="text-caption text-text-tertiary">
              {state.imageExists ? t.settings.docker.imageReady : t.settings.docker.imageNotBuilt}
            </div>
          </div>
          <button
            className="settings-btn px-3 py-1.5 text-button font-medium rounded-md"
            onClick={handleBuild}
            disabled={!state.available || state.buildInProgress}
          >
            {state.buildInProgress
              ? t.settings.docker.building
              : state.imageExists
                ? t.settings.docker.rebuild
                : t.settings.docker.buildImage}
          </button>
        </div>

        <div className="p-3 bg-bg-elevated rounded text-caption text-text-muted">
          {t.settings.docker.credentialsHint}
        </div>
      </div>
    </div>
  )
}
