import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  open: boolean
  script: string
  isApplying?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SetupScriptApprovalModal({
  open,
  script,
  isApplying = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  return (
    <ConfirmModal
      open={open}
      title={t.setupScriptModal.title}
      confirmText={isApplying ? t.setupScriptModal.confirmSaving : t.setupScriptModal.confirmApply}
      cancelText={t.setupScriptModal.reject}
      confirmDisabled={isApplying}
      loading={isApplying}
      onConfirm={onConfirm}
      onCancel={onCancel}
      body={
        <div className="space-y-3 text-slate-200">
          <p className="text-body text-slate-300">
            {t.setupScriptModal.description}
          </p>
          <div
            className="rounded border border-slate-700 overflow-auto"
            style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
          >
            <pre
              data-testid="setup-script-preview"
              className="p-3 font-mono whitespace-pre-wrap"
              style={{ color: 'var(--color-text-primary)', fontSize: theme.fontSize.code }}
            >
              {script || t.setupScriptModal.emptyScript}
            </pre>
          </div>
        </div>
      }
    />
  )
}
