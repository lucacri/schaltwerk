import { useState, useEffect, memo, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscChevronLeft, VscCode, VscPreview, VscFileBinary, VscWarning, VscGoToFile } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { MarkdownRenderer } from '../specs/MarkdownRenderer'
import { useSelection } from '../../hooks/useSelection'
import { useHighlightWorker } from '../../hooks/useHighlightWorker'
import { useOpenInEditor } from '../../hooks/useOpenInEditor'
import { useAsyncState } from '../../hooks/useAsyncState'
import { getLanguageFromPath, isMarkdownFile } from '../../utils/fileTypes'
import { useTranslation } from '../../common/i18n'
import { LoadingSkeleton } from '../shared/LoadingSkeleton'
import { useAtomValue } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

interface FileContentViewerProps {
  filePath: string | null
  onBack: () => void
  sessionNameOverride?: string
}

interface FileContentResponse {
  content: string
  is_binary: boolean
  size_bytes: number
  language: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface CodeContentProps {
  content: string
  highlightedLines: string[]
}

const CodeContent = memo(function CodeContent({
  content,
  highlightedLines,
}: CodeContentProps) {
  const lines = content.split('\n')

  return (
    <div
      className="h-full overflow-auto font-mono text-sm hljs"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        fontFamily: theme.fontFamily.mono,
        fontSize: theme.fontSize.code,
      }}
    >
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, index) => {
            const highlighted = highlightedLines[index]
            return (
              <tr key={index} className="hover:bg-slate-800/30">
                <td
                  className="select-none text-right pr-4 pl-4"
                  style={{
                    color: 'var(--color-text-muted)',
                    minWidth: '3em',
                    userSelect: 'none',
                  }}
                >
                  {index + 1}
                </td>
                <td
                  className="pr-4"
                  style={{
                    color: 'var(--color-text-primary)',
                    whiteSpace: 'pre',
                  }}
                  dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
                >
                  {highlighted ? undefined : (line || ' ')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

export function FileContentViewer({
  filePath,
  onBack,
  sessionNameOverride,
}: FileContentViewerProps) {
  const { t } = useTranslation()
  const { selection } = useSelection()
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview')
  const { requestBlockHighlight, readBlockLine } = useHighlightWorker()
  const { openInEditor } = useOpenInEditor({ sessionNameOverride })
  const projectPath = useAtomValue(projectPathAtom)

  const sessionName =
    sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)

  const language = filePath ? getLanguageFromPath(filePath) : null
  const cacheKey = filePath ? `file-viewer::${filePath}` : ''

  const { data: response, loading: isLoading, error: loadError } = useAsyncState(
    (signal) => {
      if (!filePath) return Promise.resolve(null)
      const projectScope = projectPath ? { projectPath } : {}
      return invoke<FileContentResponse>(TauriCommands.ReadProjectFile, {
        sessionName,
        filePath,
        ...projectScope,
      }).then((r) => {
        if (signal.aborted) return null
        return r
      })
    },
    [filePath, projectPath, sessionName],
  )

  const content = useMemo(() => {
    if (!response || response.is_binary) return null
    if (response.content === '' && response.size_bytes > 0) return null
    return response.content
  }, [response])

  const isBinary = response?.is_binary ?? false
  const fileSize = response?.size_bytes ?? 0
  const error = loadError
    ? (typeof loadError.message === 'string' ? loadError.message : 'Failed to load file')
    : (response && !response.is_binary && response.content === '' && response.size_bytes > 0)
      ? `File too large to display (${formatBytes(response.size_bytes)})`
      : null

  useEffect(() => {
    if (filePath && isMarkdownFile(filePath)) {
      setViewMode('preview')
    } else {
      setViewMode('raw')
    }
  }, [filePath])

  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])

  useEffect(() => {
    if (!content || !cacheKey || isMarkdownFile(filePath ?? '')) return

    requestBlockHighlight({
      cacheKey,
      lines: contentLines,
      language,
      autoDetect: !language,
    })
  }, [content, cacheKey, language, filePath, contentLines, requestBlockHighlight])

  // NOTE: Do NOT memoize this - readBlockLine is a stable ref but the underlying
  // cache updates asynchronously. The hook calls forceRender() when highlighting
  // completes, which triggers a re-render. We need to recompute on each render
  // to pick up the updated cache values.
  const highlightedLines = cacheKey
    ? contentLines.map((line, index) => readBlockLine(cacheKey, index, line))
    : contentLines

  if (!filePath) {
    return null
  }

  const fileName = filePath.split('/').pop() || filePath
  const isMarkdown = isMarkdownFile(filePath)

  const renderContent = () => {
    if (isLoading) {
      return <LoadingSkeleton lines={8} className="p-4" />
    }

    if (error) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
            <VscWarning className="mx-auto mb-2 text-4xl" style={{ color: 'var(--color-accent-amber)' }} />
            <div className="text-sm">{error}</div>
          </div>
        </div>
      )
    }

    if (isBinary) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
            <VscFileBinary className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="text-sm">{t.fileContentViewer.binaryFile}</div>
            <div className="text-xs mt-1">{formatBytes(fileSize)}</div>
          </div>
        </div>
      )
    }

    if (content === null) {
      return null
    }

    if (isMarkdown && viewMode === 'preview') {
      return <MarkdownRenderer content={content} />
    }

    return <CodeContent content={content} highlightedLines={highlightedLines} />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}
      >
        <button
          onClick={onBack}
          className="group pl-2 pr-3 py-1 rounded text-xs font-medium flex items-center gap-2 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-text-primary)'
            e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <VscChevronLeft className="w-4 h-4" />
          <span>{t.fileContentViewer.back}</span>
        </button>

        <div className="flex-1 mx-4 truncate text-center">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isMarkdown && content !== null && (
            <>
              <button
                onClick={() => setViewMode('preview')}
                className="p-1.5 rounded transition-colors"
                title={t.fileContentViewer.preview}
                style={{
                  color: viewMode === 'preview' ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
                  backgroundColor: viewMode === 'preview' ? 'var(--color-bg-elevated)' : 'transparent',
                }}
              >
                <VscPreview className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className="p-1.5 rounded transition-colors"
                title={t.fileContentViewer.raw}
                style={{
                  color: viewMode === 'raw' ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
                  backgroundColor: viewMode === 'raw' ? 'var(--color-bg-elevated)' : 'transparent',
                }}
              >
                <VscCode className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={() => { if (filePath) void openInEditor(filePath) }}
            className="p-1.5 rounded transition-colors"
            title={t.fileContentViewer.openInEditor}
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--color-text-primary)'
              e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <VscGoToFile className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{renderContent()}</div>
    </div>
  )
}
