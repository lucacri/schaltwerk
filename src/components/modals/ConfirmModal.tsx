import { useEffect, useCallback, useRef } from 'react'
import { useTranslation } from '../../common/i18n'
import { Button } from '../ui/Button'
import { ModalPortal } from '../shared/ModalPortal'

interface ConfirmModalProps {
  open: boolean
  title: React.ReactNode
  body?: React.ReactNode
  confirmText: React.ReactNode
  cancelText?: string
  confirmTitle?: string
  cancelTitle?: string
  onConfirm: () => void
  onCancel: () => void
  confirmDisabled?: boolean
  loading?: boolean
  variant?: 'default' | 'danger' | 'warning' | 'success'
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmText,
  cancelText = 'Cancel',
  confirmTitle,
  cancelTitle,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  loading = false,
  variant = 'default',
}: ConfirmModalProps) {
  const { t } = useTranslation()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = useCallback(() => {
    if (loading || confirmDisabled) return
    onConfirm()
  }, [loading, confirmDisabled, onConfirm])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement
        const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

        if (!isInputField) {
          e.preventDefault()
          e.stopPropagation()
          handleConfirm()
        }
      }
    }

    // Use capture phase to handle events before other listeners
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel, handleConfirm])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      confirmButtonRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  const confirmVariants: Record<NonNullable<ConfirmModalProps['variant']>, 'primary' | 'danger' | 'warning' | 'success'> = {
    default: 'primary',
    danger: 'danger',
    warning: 'warning',
    success: 'success',
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-bg-primary/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
        <div
          className="bg-bg-secondary border border-border-default rounded-lg p-6 max-w-md w-full mx-4"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold mb-4 text-text-primary">{title}</h2>
          {body && <div className="mb-6">{body}</div>}
          <div className="flex gap-3 justify-end">
            <Button
              onClick={onCancel}
              className="group"
              title={cancelTitle || t.confirmModal.cancelDefault}
            >
              {cancelText}
              <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">{t.confirmModal.escKey}</span>
            </Button>
            <Button
              ref={confirmButtonRef}
              onClick={handleConfirm}
              disabled={loading || confirmDisabled}
              className="group"
              variant={confirmVariants[variant]}
              title={confirmTitle || t.confirmModal.confirmDefault}
            >
              <span>{confirmText}</span>
              <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">{t.confirmModal.enterKey}</span>
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
