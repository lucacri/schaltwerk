import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

type ImageSide = 'old' | 'new'

type ImageChangeType = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown'

interface ImagePreviewResponse {
  dataUrl: string
  sizeBytes: number
  mimeType: string
  tooLarge?: boolean
  maxBytes?: number
}

interface LoadedImagePreview extends ImagePreviewResponse {
  side: ImageSide
}

export interface ImageDiffPreviewProps {
  filePath: string
  oldFilePath?: string | null
  changeType: ImageChangeType
  mode?: 'diff' | 'single'
  sessionName?: string | null
  projectPath?: string | null
  repoPath?: string | null
  commitHash?: string | null
  oldSource?: 'base' | 'head'
  fallback: ReactNode
}

const CHECKERBOARD_BACKGROUND =
  'linear-gradient(45deg, var(--color-bg-elevated) 25%, transparent 25%), linear-gradient(-45deg, var(--color-bg-elevated) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-bg-elevated) 75%), linear-gradient(-45deg, transparent 75%, var(--color-bg-elevated) 75%)'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sidesForChange(changeType: ImageChangeType): ImageSide[] {
  switch (changeType) {
    case 'added':
      return ['new']
    case 'deleted':
      return ['old']
    case 'modified':
    case 'renamed':
    case 'copied':
      return ['old', 'new']
    case 'unknown':
      return ['new', 'old']
  }
}

function imageArgs({
  filePath,
  oldFilePath,
  side,
  sessionName,
  projectPath,
  repoPath,
  commitHash,
  oldSource,
}: Omit<ImageDiffPreviewProps, 'changeType' | 'fallback' | 'mode'> & { side: ImageSide }) {
  const args: Record<string, unknown> = {
    filePath,
    oldFilePath: oldFilePath ?? null,
    side,
  }

  if (sessionName !== undefined) args.sessionName = sessionName
  if (projectPath || repoPath) args.projectPath = projectPath ?? repoPath
  if (commitHash) args.commitHash = commitHash
  if (oldSource) args.oldSource = oldSource

  return args
}

function panelLabel(
  side: ImageSide,
  changeType: ImageChangeType,
  isSingleFileMode: boolean,
  singlePreview: boolean,
  labels: { imageBefore: string; imageAfter: string; imagePreview: string; imageAdded: string; imageDeleted: string },
): string {
  if (isSingleFileMode) return labels.imagePreview
  if (changeType === 'added') return labels.imageAdded
  if (changeType === 'deleted') return labels.imageDeleted
  if (singlePreview) return labels.imagePreview
  return side === 'old' ? labels.imageBefore : labels.imageAfter
}

export function ImageDiffPreview({
  filePath,
  oldFilePath,
  changeType,
  mode = 'diff',
  sessionName,
  projectPath,
  repoPath,
  commitHash,
  oldSource,
  fallback,
}: ImageDiffPreviewProps) {
  const { t } = useTranslation()
  const sides = useMemo(() => mode === 'single' ? ['new' as const] : sidesForChange(changeType), [changeType, mode])
  const [loading, setLoading] = useState(true)
  const [previews, setPreviews] = useState<LoadedImagePreview[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    setPreviews([])

    Promise.all(sides.map(async (side): Promise<LoadedImagePreview | null> => {
      try {
        const response = await invoke<ImagePreviewResponse | null>(TauriCommands.ReadDiffImage, imageArgs({
          filePath,
          oldFilePath,
          side,
          sessionName,
          projectPath,
          repoPath,
          commitHash,
          oldSource,
        }))
        return response ? { ...response, side } : null
      } catch (err) {
        logger.warn('[ImageDiffPreview] Failed to load image preview', {
          filePath,
          oldFilePath,
          side,
          error: err,
        })
        return null
      }
    })).then((results) => {
      if (!active) return
      setPreviews(results.filter((preview): preview is LoadedImagePreview => preview !== null))
      setLoading(false)
    }).catch((err) => {
      if (!active) return
      logger.warn('[ImageDiffPreview] Failed to prepare image preview', { filePath, error: err })
      setPreviews([])
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [commitHash, filePath, oldFilePath, oldSource, projectPath, repoPath, sessionName, sides])

  const displayPreviews = useMemo(() => {
    if (
      (changeType === 'renamed' || changeType === 'copied') &&
      previews.length === 2 &&
      previews[0].dataUrl === previews[1].dataUrl &&
      !previews[0].tooLarge &&
      !previews[1].tooLarge
    ) {
      return [{ ...previews[1], side: 'new' as const }]
    }
    return previews
  }, [changeType, previews])

  if (loading) {
    return (
      <div className="px-4 py-10 text-center" style={{ color: 'var(--color-text-muted)' }}>
        {t.diffViewer.preparingPreview}
      </div>
    )
  }

  if (displayPreviews.length === 0) {
    return <>{fallback}</>
  }

  const singlePreview = displayPreviews.length === 1 && (mode === 'single' || changeType === 'renamed' || changeType === 'copied')

  return (
    <div
      className="grid gap-4 p-4"
      data-testid="image-diff-preview"
      style={{
        gridTemplateColumns: displayPreviews.length > 1 ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr',
        backgroundColor: 'var(--color-bg-primary)',
        fontFamily: theme.fontFamily.sans,
        fontSize: theme.fontSize.body,
      }}
    >
      {displayPreviews.map((preview) => {
        const label = panelLabel(preview.side, changeType, mode === 'single', singlePreview, {
          imageBefore: t.diffViewer.imageBefore,
          imageAfter: t.diffViewer.imageAfter,
          imagePreview: t.diffViewer.imagePreview,
          imageAdded: t.diffViewer.imageAdded,
          imageDeleted: t.diffViewer.imageDeleted,
        })
        return (
          <figure
            key={`${preview.side}:${preview.dataUrl || preview.sizeBytes}`}
            className="min-w-0 rounded overflow-hidden border"
            style={{
              borderColor: 'var(--color-border-subtle)',
              backgroundColor: 'var(--color-bg-secondary)',
            }}
          >
            <figcaption
              className="px-3 py-2 border-b font-medium flex items-center justify-between gap-2"
              style={{
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
                fontSize: theme.fontSize.label,
              }}
            >
              <span>{label}</span>
              {preview.sizeBytes > 0 ? (
                <span style={{ color: 'var(--color-text-muted)' }}>{formatBytes(preview.sizeBytes)}</span>
              ) : null}
            </figcaption>
            <div
              className="p-3 flex items-center justify-center overflow-auto"
              style={{
                backgroundImage: CHECKERBOARD_BACKGROUND,
                backgroundSize: '12px 12px',
                backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
              }}
            >
              {preview.tooLarge ? (
                <div
                  className="text-center px-3 py-4"
                  style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.body }}
                >
                  {t.diffViewer.imageTooLarge
                    .replace('{size}', formatBytes(preview.sizeBytes))
                    .replace('{limit}', formatBytes(preview.maxBytes ?? preview.sizeBytes))}
                </div>
              ) : (
                <img
                  src={preview.dataUrl}
                  alt={`${label} ${filePath}`}
                  className="max-w-full h-auto block"
                  style={{ maxHeight: 520 }}
                />
              )}
            </div>
          </figure>
        )
      })}
    </div>
  )
}
