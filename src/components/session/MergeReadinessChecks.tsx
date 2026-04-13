import { VscCheck, VscClose } from 'react-icons/vsc'
import { useTranslation } from '../../common/i18n'
import type { SessionReadyToMergeCheck } from '../../types/session'

interface MergeReadinessChecksProps {
  checks?: SessionReadyToMergeCheck[]
}

export function MergeReadinessChecks({ checks }: MergeReadinessChecksProps) {
  const { t } = useTranslation()

  if (!checks || checks.length === 0) return null

  const readinessLabelByKey: Record<SessionReadyToMergeCheck['key'], string> = {
    worktree_exists: t.sessionActions.checkWorktreeExists,
    no_uncommitted_changes: t.sessionActions.checkNoUncommittedChanges,
    no_conflicts: t.sessionActions.checkNoConflicts,
    has_committed_changes: t.sessionActions.checkHasCommittedChanges,
    rebased_onto_parent: t.sessionActions.checkRebasedOntoParent,
  }

  return (
    <div className="flex flex-col gap-1" aria-label={t.sessionActions.mergeChecks}>
      <span
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {t.sessionActions.mergeChecks}
      </span>
      <div className="flex flex-col gap-1">
        {checks.map((check) => (
          <div
            key={check.key}
            className="inline-flex items-center gap-1.5 text-xs"
            style={{ color: check.passed ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border"
              style={{
                borderColor: check.passed ? 'var(--color-accent-green-border)' : 'var(--color-accent-red-border)',
                backgroundColor: check.passed ? 'var(--color-accent-green-bg)' : 'var(--color-accent-red-bg)',
                color: check.passed ? 'var(--color-accent-green-light)' : 'var(--color-accent-red-light)',
              }}
            >
              {check.passed ? <VscCheck /> : <VscClose />}
            </span>
            <span>{readinessLabelByKey[check.key]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
