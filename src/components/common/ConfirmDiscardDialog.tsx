import { AnimatedText } from './AnimatedText'
import { useTranslation } from '../../common/i18n'
import { ModalPortal } from '../shared/ModalPortal'
import { Button } from '../ui/Button'

interface ConfirmDiscardDialogProps {
  open: boolean
  filePath: string | null
  onConfirm: () => void
  onCancel: () => void
  isBusy?: boolean
}

export function ConfirmDiscardDialog({ open, filePath, onConfirm, onCancel, isBusy }: ConfirmDiscardDialogProps) {
  const { t } = useTranslation()
  if (!open) return null
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-bg-primary/40" onClick={onCancel} />
        <div className="relative bg-bg-secondary border border-border-default rounded-lg p-4 w-[480px] shadow-xl">
          <div className="text-text-primary font-semibold mb-1">{t.dialogs.discardFile.title}</div>
          <div className="text-text-secondary text-sm mb-3">
            {t.dialogs.discardFile.body}
            <div className="mt-1 text-text-primary font-mono text-xs break-all">{filePath}</div>
            {t.dialogs.discardFile.cannotUndo}
          </div>
          {isBusy ? (
            <div className="py-2 text-text-secondary"><AnimatedText text="deleting" size="md" /></div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="default" size="sm" onClick={onCancel}>{t.dialogs.discardFile.cancel}</Button>
              <Button variant="danger" size="sm" onClick={onConfirm}>{t.dialogs.discardFile.discard}</Button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
