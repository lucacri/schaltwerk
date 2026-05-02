// Phase 7 Wave C.1: TaskRow shell.
//
// Renders one task row in the stage-grouped sidebar: name, stage badge,
// labeled action buttons. Action handlers are stubs at this stage —
// Wave C.2 wires them through `useTaskRowActions` to the typed
// taskService and adds optimistic + rollback. Inline run history (the
// nested run cards) lands in C.2; multi-candidate slot rendering in
// C.3.
//
// Labeled-affordance discipline (commit 67411e00): every state-required
// button carries visible text + aria-label. The state table in
// `TaskRow.affordances.test.tsx` pins the visibility matrix; a
// behavior change without test update fails CI.
//
// Cancellation invariant (Phase 3 + this wave): a cancelled task shows
// ONLY the Reopen button — never the stage action, never Cancel. A
// terminal-stage task (Done) without a cancellation shows nothing —
// no progressing action, no cancel.

import type { Task, TaskStage } from '../../types/task'
import { theme } from '../../common/theme'
import { TaskRunRow } from './TaskRunRow'
import { useTaskRowActions } from './hooks/useTaskRowActions'
import { logger } from '../../utils/logger'

export interface TaskRowProps {
  task: Task
}

interface StageActionLabel {
  text: string
  ariaLabel: string
}

const STAGE_ACTIONS: Partial<Record<TaskStage, StageActionLabel>> = {
  draft: {
    text: 'Promote to Ready',
    ariaLabel: 'Promote task to Ready',
  },
  ready: {
    text: 'Run Brainstorm',
    ariaLabel: 'Run Brainstorm stage',
  },
  brainstormed: {
    text: 'Run Plan',
    ariaLabel: 'Run Plan stage',
  },
  planned: {
    text: 'Run Implement',
    ariaLabel: 'Run Implement stage',
  },
  implemented: {
    text: 'Open PR',
    ariaLabel: 'Open Pull Request for task',
  },
  // pushed → no progressing action; the user waits for PR merge / Done
  // done → terminal; no progressing action
}

const STAGE_BADGE_LABELS: Record<TaskStage, string> = {
  draft: 'Draft',
  ready: 'Ready',
  brainstormed: 'Brainstormed',
  planned: 'Planned',
  implemented: 'Implemented',
  pushed: 'Pushed',
  done: 'Done',
}

export function TaskRow({ task }: TaskRowProps) {
  const isCancelled = task.cancelled_at !== null
  const isTerminal = task.stage === 'done'
  const stageAction = !isCancelled ? STAGE_ACTIONS[task.stage] : undefined
  const showCancel = !isCancelled && !isTerminal
  const showReopen = isCancelled

  const displayName = task.display_name ?? task.name
  const actions = useTaskRowActions()

  const handleStageAction = () => {
    // Wave C.2 wires the Draft → Ready promotion. Stage runs
    // (Brainstorm/Plan/Implement) need a preset picker which lands in
    // C.3; for now they log so the surface is interactive without
    // dispatching an unconfigured run.
    if (task.stage === 'draft') {
      void actions.promoteToReady(task).catch((err) => {
        logger.warn('[TaskRow] promoteToReady failed', err)
      })
    } else {
      logger.info(
        `[TaskRow] stage-action ${task.stage} on ${task.id} — wiring lands in Wave C.3`,
      )
    }
  }

  const handleCancel = () => {
    void actions.cancelTask(task).catch((err) => {
      logger.warn('[TaskRow] cancelTask failed', err)
    })
  }

  const handleReopen = () => {
    void actions.reopenTask(task, 'draft').catch((err) => {
      logger.warn('[TaskRow] reopenTask failed', err)
    })
  }

  return (
    <article
      data-testid={`task-row-${task.id}`}
      data-task-id={task.id}
      data-task-stage={task.stage}
      data-task-cancelled={isCancelled ? 'true' : 'false'}
      className="flex flex-col gap-1 px-2 py-1.5 rounded-md hover:bg-bg-hover/30"
    >
      <div className="flex items-center gap-2">
      <span
        className="flex-1 truncate"
        style={{
          fontSize: theme.fontSize.body,
          color: 'var(--color-text-primary)',
          lineHeight: theme.lineHeight.normal,
        }}
      >
        {displayName}
      </span>

      <span
        data-testid="task-row-stage-badge"
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
        {STAGE_BADGE_LABELS[task.stage]}
      </span>

      {task.failure_flag && (
        <span
          data-testid="task-row-failure-flag"
          aria-label="Task has a failure flag"
          className="shrink-0 rounded border px-1.5 py-[1px]"
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: 'var(--color-accent-red-light)',
            backgroundColor: 'var(--color-accent-red-bg)',
            borderColor: 'var(--color-accent-red-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          ⚠ Failed
        </span>
      )}

      {stageAction && (
        <button
          type="button"
          data-testid="task-row-stage-action"
          aria-label={stageAction.ariaLabel}
          onClick={handleStageAction}
          className="shrink-0 inline-flex items-center gap-1.5 h-6 rounded border px-2"
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: 'var(--color-accent-blue-light)',
            backgroundColor: 'var(--color-accent-blue-bg)',
            borderColor: 'var(--color-accent-blue-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>{stageAction.text}</span>
        </button>
      )}

      {showCancel && (
        <button
          type="button"
          data-testid="task-row-cancel"
          aria-label="Cancel task"
          onClick={handleCancel}
          className="shrink-0 inline-flex items-center gap-1.5 h-6 rounded border px-2"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red-light)',
            backgroundColor: 'var(--color-accent-red-bg)',
            borderColor: 'var(--color-accent-red-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>Cancel</span>
        </button>
      )}

      {showReopen && (
        <button
          type="button"
          data-testid="task-row-reopen"
          aria-label="Reopen cancelled task"
          onClick={handleReopen}
          className="shrink-0 inline-flex items-center gap-1.5 h-6 rounded border px-2"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-blue-light)',
            backgroundColor: 'var(--color-accent-blue-bg)',
            borderColor: 'var(--color-accent-blue-border)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          <span>Reopen</span>
        </button>
      )}
      </div>

      {task.task_runs.length > 0 && (
        <div
          data-testid="task-row-run-history"
          className="flex flex-col gap-0.5 pl-3 border-l"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {task.task_runs.map((run) => (
            <TaskRunRow
              key={run.id}
              run={run}
              onCancelRun={(runId) => {
                void actions.cancelTaskRun(runId).catch((err) => {
                  logger.warn('[TaskRow] cancelTaskRun failed', err)
                })
              }}
            />
          ))}
        </div>
      )}
    </article>
  )
}
