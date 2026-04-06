import { AnimatedText } from './AnimatedText'
import { useTranslation } from '../../common/i18n'
import { Button } from '../ui/Button'

interface ConfirmResetDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  isBusy?: boolean
}

export function ConfirmResetDialog({ open, onConfirm, onCancel, isBusy }: ConfirmResetDialogProps) {
  const { t } = useTranslation()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-primary/40" onClick={onCancel} />
      <div className="relative bg-bg-secondary border border-border-default rounded-lg p-4 w-[460px] shadow-xl">
        <div className="text-text-primary font-semibold mb-1">{t.dialogs.resetSession.title}</div>
        <div className="text-text-secondary text-sm mb-3">
          {t.dialogs.resetSession.body}
        </div>
        {isBusy ? (
          <div className="py-2 text-text-secondary"><AnimatedText text="resetting" size="xs" /></div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="default" size="sm" onClick={onCancel}>{t.dialogs.resetSession.cancel}</Button>
            <Button variant="danger" size="sm" onClick={onConfirm}>{t.dialogs.resetSession.reset}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
