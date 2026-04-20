import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { useTranslation } from '../../common/i18n/useTranslation'
import type { CancelBlocker } from '../../common/events'

interface CancelConfirmationProps {
  open: boolean
  displayName: string
  branch: string
  hasUncommittedChanges: boolean
  onConfirm: (force: boolean) => void
  onForceRemove?: () => void
  onCancel: () => void
  loading?: boolean
  cancelBlocker?: CancelBlocker | null
}

export function CancelConfirmation({
  open,
  displayName,
  branch,
  hasUncommittedChanges,
  onConfirm,
  onForceRemove,
  onCancel,
  loading = false,
  cancelBlocker = null,
}: CancelConfirmationProps) {
  const { t } = useTranslation()
  const handleConfirm = useCallback(() => {
    if (cancelBlocker) {
      onForceRemove?.()
      return
    }
    onConfirm(false)
  }, [cancelBlocker, onConfirm, onForceRemove])

  if (!open) return null

  const title = cancelBlocker
    ? t.dialogs.cancelSession.blockedTitle.replace('{name}', displayName)
    : t.dialogs.cancelSession.title
    .replace('{name}', displayName)
    .replace('{branch}', branch)

  const body = cancelBlocker
    ? <CancelBlockerBody blocker={cancelBlocker} />
    : (
      <p className="text-text-secondary">
        {t.dialogs.cancelSession.body}
        {hasUncommittedChanges ? (
          <span className="block mt-2 text-accent-amber font-medium">
            {t.dialogs.cancelSession.warningUncommitted}
          </span>
        ) : (
          <span className="block mt-2 text-text-muted">
            {t.dialogs.cancelSession.allCommitted}
          </span>
        )}
      </p>
    )

  return (
    <ConfirmModal
      open={open}
      title={<span>{title}</span>}
      body={body}
      confirmText={cancelBlocker ? t.dialogs.cancelSession.forceRemove : t.dialogs.cancelSession.cancelSession}
      cancelText={t.dialogs.cancelSession.keepSession}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant={cancelBlocker ? 'danger' : 'warning'}
    />
  )
}

function CancelBlockerBody({ blocker }: { blocker: CancelBlocker }) {
  const { t } = useTranslation()
  const copy = t.dialogs.cancelSession

  if (blocker.type === 'UncommittedChanges') {
    return (
      <div className="space-y-3 text-text-secondary">
        <p>{copy.blockedBody}</p>
        <p className="font-medium text-text-primary">{copy.blockedUncommitted}</p>
        <div>
          <p className="mb-2 text-text-muted">{copy.affectedFiles}</p>
          <ul className="max-h-40 overflow-auto rounded border border-border-subtle bg-bg-elevated p-2">
            {blocker.data.files.map(file => (
              <li
                key={file}
                className="break-all text-text-primary"
                style={{ fontSize: 'var(--font-code)', fontFamily: 'var(--font-family-mono)' }}
              >
                {file}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  if (blocker.type === 'OrphanedWorktree') {
    return (
      <BlockerDetail
        body={copy.blockedBody}
        reason={copy.blockedOrphaned}
        label={copy.expectedPath}
        value={blocker.data.expected_path}
      />
    )
  }

  if (blocker.type === 'WorktreeLocked') {
    return (
      <BlockerDetail
        body={copy.blockedBody}
        reason={copy.blockedLocked}
        label={copy.lockReason}
        value={blocker.data.reason}
      />
    )
  }

  return (
    <BlockerDetail
      body={copy.blockedBody}
      reason={copy.blockedGitError}
      label={copy.gitOperation}
      value={`${blocker.data.operation}: ${blocker.data.message}`}
    />
  )
}

function BlockerDetail({
  body,
  reason,
  label,
  value,
}: {
  body: string
  reason: string
  label: string
  value: string
}) {
  return (
    <div className="space-y-3 text-text-secondary">
      <p>{body}</p>
      <p className="font-medium text-text-primary">{reason}</p>
      <div>
        <p className="mb-2 text-text-muted">{label}</p>
        <p
          className="break-all rounded border border-border-subtle bg-bg-elevated p-2 text-text-primary"
          style={{ fontSize: 'var(--font-code)', fontFamily: 'var(--font-family-mono)' }}
        >
          {value}
        </p>
      </div>
    </div>
  )
}
