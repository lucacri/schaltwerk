// Phase 7 Wave C.2: render one TaskRun inside a task's inline run
// history. Status badge uses `derived_status`; per the wire contract
// (Wave A.1.a) handlers always populate this field, so a `null` means
// regression — the badge labels it 'unknown' loudly so the bug
// surfaces visually instead of silently coalescing to "running".
//
// Cancel-run is a labeled affordance gated on
// `derived_status === 'awaiting_selection'` — runs that are still
// running cannot be cancelled cleanly without orphaning live agent
// processes; runs that are terminal (completed/failed/cancelled) have
// nothing to cancel. This is the same gating the v1 TaskRow used.

import { theme } from '../../common/theme'
import type { TaskRun, TaskRunStatus } from '../../types/task'

export interface TaskRunRowProps {
  run: TaskRun
  onCancelRun?: (runId: string) => void
}

const STAGE_BADGE: Record<TaskRun['stage'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  brainstormed: 'Brainstormed',
  planned: 'Planned',
  implemented: 'Implemented',
  pushed: 'Pushed',
  done: 'Done',
}

interface StatusVisual {
  label: string
  color: string
  background: string
  border: string
}

const STATUS_VISUALS: Record<TaskRunStatus, StatusVisual> = {
  running: {
    label: 'Running',
    color: 'var(--color-accent-blue-light)',
    background: 'var(--color-accent-blue-bg)',
    border: 'var(--color-accent-blue-border)',
  },
  awaiting_selection: {
    label: 'Awaiting selection',
    color: 'var(--color-accent-amber-light)',
    background: 'var(--color-accent-amber-bg)',
    border: 'var(--color-accent-amber-border)',
  },
  completed: {
    label: 'Completed',
    color: 'var(--color-accent-green-light)',
    background: 'var(--color-accent-green-bg)',
    border: 'var(--color-accent-green-border)',
  },
  failed: {
    label: 'Failed',
    color: 'var(--color-accent-red-light)',
    background: 'var(--color-accent-red-bg)',
    border: 'var(--color-accent-red-border)',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'var(--color-text-tertiary)',
    background: 'var(--color-bg-tertiary)',
    border: 'var(--color-border-subtle)',
  },
}

const UNKNOWN_VISUAL: StatusVisual = {
  label: 'Unknown',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-bg-tertiary)',
  border: 'var(--color-border-subtle)',
}

export function TaskRunRow({ run, onCancelRun }: TaskRunRowProps) {
  const status = run.derived_status
  const visual = status ? STATUS_VISUALS[status] : UNKNOWN_VISUAL
  const showCancel = status === 'awaiting_selection'

  return (
    <div
      data-testid={`task-run-row-${run.id}`}
      data-run-id={run.id}
      className="flex items-center gap-2 px-2 py-1 rounded-md"
    >
      <span
        data-testid="task-run-row-stage-badge"
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
        {STAGE_BADGE[run.stage]}
      </span>

      <span
        data-testid="task-run-row-status-badge"
        data-status={status ?? 'unknown'}
        className="shrink-0 rounded border px-1.5 py-[1px]"
        style={{
          fontSize: theme.fontSize.caption,
          fontWeight: 600,
          color: visual.color,
          backgroundColor: visual.background,
          borderColor: visual.border,
          lineHeight: theme.lineHeight.compact,
        }}
      >
        {visual.label}
      </span>

      <span
        className="flex-1 truncate"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-text-tertiary)',
          lineHeight: theme.lineHeight.compact,
        }}
      >
        Run {run.id.slice(0, 6)}
      </span>

      {showCancel && (
        <button
          type="button"
          data-testid="task-run-row-cancel-run"
          aria-label={`Cancel run ${run.id}`}
          onClick={() => onCancelRun?.(run.id)}
          className="shrink-0 inline-flex items-center gap-1.5 h-6 rounded border px-2"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red-light)',
            backgroundColor: 'var(--color-accent-red-bg)',
            borderColor: 'var(--color-accent-red-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>Cancel run</span>
        </button>
      )}
    </div>
  )
}
