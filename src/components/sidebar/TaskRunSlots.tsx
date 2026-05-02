// Phase 7 Wave C.3: render the multi-candidate slot list for a single
// TaskRun. Generalizes the labeled-affordance + nudge-banner pattern
// from SessionVersionGroup (commit 67411e00) to every multi-candidate
// stage run, not just consolidation.
//
// The component is presentational — slot data and run status come in
// as props, so the state-table test (TaskRunSlots.affordances.test.tsx)
// can drive every state without standing up the atom graph. The
// data-flow integration (deriving slots from sessions for a given
// runId via useTaskRunSlots) is wired separately in
// `hooks/useTaskRunSlots.ts`.
//
// Critical state pin: merge-failed-mid-confirm. Commit f759cef0
// shipped the merge-before-confirm-selection ordering so a merge
// conflict no longer corrupts the run. This component surfaces the
// failure as a banner with the reason, while keeping the
// confirm-winner affordance available so the user can retry once the
// conflict is resolved.

import { theme } from '../../common/theme'

export type TaskRunSlotStatus = 'running' | 'idle' | 'failed' | 'cancelled'

export interface TaskRunSlotPresentation {
  sessionId: string
  slotKey: string
  status: TaskRunSlotStatus
  isWinner: boolean
  /** Optional human-readable label (display_name or name). */
  label?: string
}

export interface TaskRunSlotsProps {
  runId: string
  runStatus: 'running' | 'awaiting_selection' | 'completed' | 'failed' | 'cancelled'
  slots: TaskRunSlotPresentation[]
  judgeFiled: boolean
  /** Non-null when a merge attempt during confirm_stage failed. */
  mergeFailureReason: string | null
  onConfirmWinner?: (sessionId: string) => void
  onTriggerJudge?: (runId: string) => void
}

export function TaskRunSlots({
  runId,
  runStatus,
  slots,
  judgeFiled,
  mergeFailureReason,
  onConfirmWinner,
  onTriggerJudge,
}: TaskRunSlotsProps) {
  if (slots.length === 0) {
    return null
  }

  const isAwaitingSelection = runStatus === 'awaiting_selection'
  const allIdle = slots.every((s) => s.status === 'idle')
  const anyFailed = slots.some((s) => s.status === 'failed')
  const winner = slots.find((s) => s.isWinner) ?? null

  const showNudgeBanner =
    isAwaitingSelection && allIdle && !judgeFiled && mergeFailureReason === null
  const showConfirmWinner = isAwaitingSelection && !anyFailed
  const showMergeFailedBanner = mergeFailureReason !== null

  return (
    <div
      data-testid={`task-run-slots-${runId}`}
      className="flex flex-col gap-1.5 px-2 py-1.5"
    >
      {showMergeFailedBanner && (
        <div
          data-testid="task-run-slots-merge-failed-banner"
          role="alert"
          className="rounded border px-2 py-1.5"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red-light)',
            backgroundColor: 'var(--color-accent-red-bg)',
            borderColor: 'var(--color-accent-red-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          Merge failed during confirm — winner not persisted. {mergeFailureReason}
        </div>
      )}

      {showNudgeBanner && (
        <div
          data-testid="task-run-slots-nudge-banner"
          role="status"
          className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-amber-light)',
            backgroundColor: 'var(--color-accent-amber-bg)',
            borderColor: 'var(--color-accent-amber-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>All candidates idle. Pick a winner or run the synthesis judge.</span>
          {onTriggerJudge && (
            <button
              type="button"
              data-testid="task-run-slots-trigger-judge"
              aria-label={`Run synthesis judge for run ${runId}`}
              onClick={() => onTriggerJudge(runId)}
              className="shrink-0 inline-flex items-center gap-1 h-6 rounded border px-2"
              style={{
                fontSize: theme.fontSize.caption,
                fontWeight: 600,
                color: 'var(--color-accent-amber-light)',
                backgroundColor: 'var(--color-accent-amber-bg)',
                borderColor: 'var(--color-accent-amber-border)',
                lineHeight: theme.lineHeight.compact,
              }}
            >
              Run judge
            </button>
          )}
        </div>
      )}

      <ul
        data-testid="task-run-slots-list"
        className="flex flex-col gap-0.5"
      >
        {slots.map((s) => (
          <li
            key={s.sessionId}
            data-testid={`task-run-slot-${s.sessionId}`}
            data-slot-status={s.status}
            data-slot-winner={s.isWinner ? 'true' : 'false'}
            className="flex items-center gap-2 px-2 py-1 rounded"
            style={{
              fontSize: theme.fontSize.caption,
              color: 'var(--color-text-primary)',
              backgroundColor: s.isWinner ? 'var(--color-accent-green-bg)' : undefined,
              borderColor: s.isWinner
                ? 'var(--color-accent-green-border)'
                : undefined,
              borderWidth: s.isWinner ? 1 : 0,
              borderStyle: 'solid',
              lineHeight: theme.lineHeight.compact,
            }}
          >
            <span
              className="shrink-0 rounded border px-1.5 py-[1px]"
              style={{
                fontSize: theme.fontSize.caption,
                fontWeight: 600,
                color: 'var(--color-text-tertiary)',
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-subtle)',
                lineHeight: theme.lineHeight.compact,
              }}
            >
              {s.slotKey}
            </span>
            <span className="flex-1 truncate">{s.label ?? s.sessionId}</span>
            <span
              data-testid={`task-run-slot-${s.sessionId}-status`}
              className="shrink-0 rounded border px-1.5 py-[1px]"
              style={{
                fontSize: theme.fontSize.caption,
                color: slotStatusColor(s.status),
                backgroundColor: slotStatusBg(s.status),
                borderColor: slotStatusBorder(s.status),
                lineHeight: theme.lineHeight.compact,
              }}
            >
              {SLOT_STATUS_LABEL[s.status]}
            </span>
          </li>
        ))}
      </ul>

      {showConfirmWinner && (
        <button
          type="button"
          data-testid="task-run-slots-confirm-winner"
          aria-label={
            winner
              ? `Confirm winner ${winner.slotKey}`
              : `Confirm winner for run ${runId}`
          }
          onClick={() => {
            const target = winner ?? slots[0]
            if (target && onConfirmWinner) {
              onConfirmWinner(target.sessionId)
            }
          }}
          className="self-end inline-flex items-center gap-1.5 h-6 rounded border px-2"
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: 'var(--color-accent-green-light)',
            backgroundColor: 'var(--color-accent-green-bg)',
            borderColor: 'var(--color-accent-green-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>Confirm winner</span>
        </button>
      )}
    </div>
  )
}

const SLOT_STATUS_LABEL: Record<TaskRunSlotStatus, string> = {
  running: 'Running',
  idle: 'Idle',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function slotStatusColor(status: TaskRunSlotStatus): string {
  switch (status) {
    case 'running':
      return 'var(--color-accent-blue-light)'
    case 'idle':
      return 'var(--color-accent-amber-light)'
    case 'failed':
      return 'var(--color-accent-red-light)'
    case 'cancelled':
      return 'var(--color-text-tertiary)'
  }
}

function slotStatusBg(status: TaskRunSlotStatus): string {
  switch (status) {
    case 'running':
      return 'var(--color-accent-blue-bg)'
    case 'idle':
      return 'var(--color-accent-amber-bg)'
    case 'failed':
      return 'var(--color-accent-red-bg)'
    case 'cancelled':
      return 'var(--color-bg-tertiary)'
  }
}

function slotStatusBorder(status: TaskRunSlotStatus): string {
  switch (status) {
    case 'running':
      return 'var(--color-accent-blue-border)'
    case 'idle':
      return 'var(--color-accent-amber-border)'
    case 'failed':
      return 'var(--color-accent-red-border)'
    case 'cancelled':
      return 'var(--color-border-subtle)'
  }
}
