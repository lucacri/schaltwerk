import { ConfirmModal } from './ConfirmModal'

export interface TerminateVersionGroupSession {
  id: string
  name: string
  displayName: string
  branch: string
  hasUncommittedChanges: boolean
}

interface TerminateVersionGroupConfirmationProps {
  open: boolean
  baseName: string
  sessions: TerminateVersionGroupSession[]
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function TerminateVersionGroupConfirmation({
  open,
  baseName,
  sessions,
  onConfirm,
  onCancel,
  loading = false,
}: TerminateVersionGroupConfirmationProps) {
  if (!open) {
    return null
  }

  const hasUncommitted = sessions.some(session => session.hasUncommittedChanges)

  return (
    <ConfirmModal
      open={open}
      title={`Terminate running sessions in ${baseName}?`}
      body={(
        <div className="space-y-3">
          <p style={{ color: 'var(--color-text-secondary)' }}>
            This will terminate {sessions.length} running {sessions.length === 1 ? 'session' : 'sessions'} in this version group.
          </p>
          <ul
            className="max-h-56 overflow-y-auto rounded border p-2 space-y-1"
            style={{
              borderColor: 'var(--color-border-subtle)',
              backgroundColor: 'rgba(var(--color-bg-tertiary-rgb), 0.5)',
            }}
          >
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <span className="truncate">
                  {session.displayName}
                  {session.branch ? (
                    <span style={{ color: 'var(--color-text-muted)' }}> ({session.branch})</span>
                  ) : null}
                </span>
                <span
                  className="text-xs flex-shrink-0"
                  style={{
                    color: session.hasUncommittedChanges
                      ? 'var(--color-accent-amber-light)'
                      : 'var(--color-text-muted)'
                  }}
                >
                  {session.hasUncommittedChanges ? 'Uncommitted changes' : 'Clean'}
                </span>
              </li>
            ))}
          </ul>
          {hasUncommitted && (
            <p style={{ color: 'var(--color-accent-amber-light)' }}>
              Warning: some sessions have uncommitted changes.
            </p>
          )}
        </div>
      )}
      confirmText="Terminate All"
      cancelText="Keep Sessions"
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      variant="danger"
    />
  )
}
