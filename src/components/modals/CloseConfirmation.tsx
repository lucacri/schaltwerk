import { ConfirmModal } from './ConfirmModal'
import { useTranslation } from '../../common/i18n/useTranslation'

interface CloseConfirmationProps {
  open: boolean
  runningCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function CloseConfirmation({ open, runningCount, onConfirm, onCancel }: CloseConfirmationProps) {
  const { t } = useTranslation()

  if (!open) return null

  const body = (
    <p className="text-zinc-300">
      {t.dialogs.closeApp.bodyRunning.replace('{count}', String(runningCount))}
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={t.dialogs.closeApp.title}
      body={body}
      confirmText={t.dialogs.closeApp.confirm}
      cancelText={t.dialogs.closeApp.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      variant="warning"
    />
  )
}
