import { useCallback, useEffect, useRef, useState } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscEye, VscEdit } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { MarkdownEditor, type MarkdownEditorRef } from './MarkdownEditor'
import { useSpecContentCache } from '../../hooks/useSpecContentCache'
import { MarkdownRenderer } from './MarkdownRenderer'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n'
import { useOptionalToast } from '../../common/toast/ToastProvider'
import { writeClipboard } from '../../utils/clipboard'

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
  sessionState?: 'spec' | 'processing' | 'running' | 'reviewed'
}

export function SpecContentView({ sessionName, editable = true, debounceMs = 1000, sessionState }: Props) {
  const { t } = useTranslation()
  const toast = useOptionalToast()
  const { content, loading, error, updateContent } = useSpecContentCache(sessionName, sessionState)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  type TimeoutHandle = ReturnType<typeof setTimeout> | number
  const saveTimerRef = useRef<TimeoutHandle | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        if (!editable) return
        try {
          setSaving(true)
          await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, { name: sessionName, content })
        } catch (e) {
          logger.error('[DraftContentView] Failed to save spec:', e)
        } finally {
          setSaving(false)
        }
      })()
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  const handleCopyRaw = useCallback(async () => {
    if (!content) {
      toast?.pushToast({ tone: 'warning', title: t.toasts.nothingToCopy, description: t.toasts.nothingToCopyDesc })
      return
    }

    try {
      const success = await writeClipboard(content)
      if (!success) {
        toast?.pushToast({ tone: 'error', title: t.toasts.clipboardBlocked, description: t.toasts.clipboardBlockedDesc })
        return
      }
      toast?.pushToast({ tone: 'success', title: t.toasts.copiedToClipboard, description: t.specContentView.copyRawSuccess })
    } catch (error) {
      logger.error('[SpecContentView] Failed to copy raw spec', { sessionName, error })
      toast?.pushToast({ tone: 'error', title: t.toasts.copyFailed, description: t.toasts.copyFailedDesc })
    }
  }, [content, sessionName, t, toast])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        if (markdownEditorRef.current) {
          markdownEditorRef.current.focus()
          logger.info('[SpecContentView] Focused spec content via Cmd+T')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown) // Use bubble phase to not interfere with cmd+e
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])


  if (loading && content === '') {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" />
      </div>
    )
  }

  if (editable) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {saving ? t.specContentView.saving : error ? <span style={{ color: 'var(--color-accent-red)' }}>{error}</span> : viewMode === 'edit' ? t.specContentView.editingSpec : t.specContentView.previewMode}
            </div>
            {viewMode === 'edit' && (
              <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-elevated)', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }} title={`${t.specContentView.focusSpecContent} (⌘T)`}>⌘T</span>
            )}
          </div>
          <button
            onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
            style={{ fontSize: theme.fontSize.caption, padding: '0.25rem 0.5rem', borderRadius: '0.25rem', backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' }}
            className="hover:bg-slate-600 flex items-center gap-1"
            title={viewMode === 'edit' ? t.specContentView.previewMarkdown : t.specContentView.editMarkdown}
          >
            {viewMode === 'edit' ? <VscEye /> : <VscEdit />}
            {viewMode === 'edit' ? t.specContentView.preview : t.specContentView.edit}
          </button>
        </div>
        {viewMode === 'edit' ? (
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={updateContent}
            placeholder={t.specContentView.enterAgentDescription}
            className="flex-1"
          />
        ) : (
          <div className="flex-1 overflow-hidden">
            <MarkdownRenderer content={content} className="h-full" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>{t.specContentView.spec}</div>
        </div>
        <button
          type="button"
          onClick={() => { void handleCopyRaw() }}
          style={{ fontSize: theme.fontSize.caption, padding: '0.25rem 0.5rem', borderRadius: '0.25rem', backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' }}
          className="flex items-center gap-1 transition-opacity hover:opacity-90"
          title={t.specContentView.copyRawTitle}
        >
          <VscCopy />
          {t.specContentView.copyRaw}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <MarkdownRenderer content={content} className="h-full" />
      </div>
    </div>
  )
}
