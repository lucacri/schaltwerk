import { useEffect } from 'react'
import { VscClose } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import type { SourceError } from '../../hooks/useGitlabIssueSearch'

interface GitlabErrorDetailsModalProps {
  errors: SourceError[]
  onClose: () => void
}

export function GitlabErrorDetailsModal({ errors, onClose }: GitlabErrorDetailsModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: theme.layers.modalOverlay, backgroundColor: 'var(--color-overlay-backdrop)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-3 rounded-lg shadow-xl"
        style={{
          zIndex: theme.layers.modalContent,
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          maxWidth: 520,
          width: '90%',
          maxHeight: '70vh',
          padding: 16,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span style={{ fontSize: theme.fontSize.bodyLarge, color: 'var(--color-text-primary)', fontWeight: 600 }}>
            Error Details
          </span>
          <button type="button" onClick={onClose} aria-label="close" style={{ color: 'var(--color-text-muted)' }}>
            <VscClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '55vh' }}>
          {errors.map((err) => (
            <div
              key={err.source}
              className="flex flex-col gap-1 rounded"
              style={{
                padding: '8px 10px',
                backgroundColor: 'var(--color-accent-red-bg)',
                border: '1px solid var(--color-accent-red-border)',
              }}
            >
              <span style={{ fontSize: theme.fontSize.body, fontWeight: 600, color: 'var(--color-accent-red)' }}>
                {err.source}
              </span>
              <pre
                style={{
                  fontSize: theme.fontSize.caption,
                  fontFamily: theme.fontFamily.mono,
                  color: 'var(--color-text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}
              >
                {err.message}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
