// Phase 7 Wave D.3: read/write editor for a task artifact (spec / plan).
//
// Reads `task.current_*_body` (Wave A.1.a wire fields). Saves through
// `taskService.updateTaskContent` (returns body-less `Task` per the
// Phase 7 wire-shape split — list/refresh shapes don't carry bodies).
// After save, refetch via `getTask(id)` (the body-bearing endpoint)
// and propagate the full `TaskWithBodies` upstream so the parent's
// `task` state stays consistent. Per `feedback_stamp_after_side_effect`
// the refetch must run AFTER the update succeeds; on update failure
// the parent's task envelope is untouched.
//
// `summary` kind is read-only: summary artifacts are produced by the
// agent at end-of-stage, not user-edited. The textarea renders with
// readOnly and the save button is omitted.

import { useCallback, useEffect, useState } from 'react'

import { theme } from '../../common/theme'
import { Button } from '../ui'
import { getTask, updateTaskContent } from '../../services/taskService'
import { logger } from '../../utils/logger'
import type { TaskArtifactKind, TaskWithBodies } from '../../types/task'

export interface TaskArtifactEditorProps {
  task: TaskWithBodies
  kind: TaskArtifactKind & ('spec' | 'plan' | 'summary')
  projectPath?: string | null
  /** Callback invoked with the backend response after a successful save. */
  onSaved?: (task: TaskWithBodies) => void
}

const KIND_FIELD: Record<'spec' | 'plan' | 'summary', keyof TaskWithBodies> = {
  spec: 'current_spec_body',
  plan: 'current_plan_body',
  summary: 'current_summary_body',
}

const KIND_LABEL: Record<'spec' | 'plan' | 'summary', string> = {
  spec: 'Spec',
  plan: 'Plan',
  summary: 'Summary',
}

export function TaskArtifactEditor({
  task,
  kind,
  projectPath,
  onSaved,
}: TaskArtifactEditorProps) {
  const initial = (task[KIND_FIELD[kind]] as string | null) ?? ''
  const [body, setBody] = useState<string>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Reset the local buffer when the task changes (selection swap or
    // backend refresh of a different task).
    setBody(initial)
    setError(null)
    setSubmitting(false)
    // Intentionally not depending on `body` so user edits aren't
    // clobbered mid-typing by a TasksRefreshed broadcast for the same
    // task. The TasksRefreshed listener replaces the entire task list,
    // which would otherwise reset `body` to the latest `initial` on
    // every keystroke that triggered a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, kind])

  const isReadOnly = kind === 'summary'

  const handleSave = useCallback(async () => {
    setError(null)
    setSubmitting(true)
    try {
      // updateTaskContent returns a body-less Task (per the wire-shape
      // split); we discard that return value and refetch via getTask
      // which IS the body-bearing endpoint. The refetch lands AFTER
      // the save side-effect succeeds — on save failure the parent's
      // task state is untouched. Per feedback_stamp_after_side_effect.
      await updateTaskContent(task.id, kind, body, {
        projectPath: projectPath ?? null,
      })
      const refreshed = await getTask(task.id, projectPath ?? null)
      onSaved?.(refreshed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('[TaskArtifactEditor] updateTaskContent failed', err)
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [body, kind, onSaved, projectPath, task.id])

  return (
    <div
      data-testid={`task-artifact-editor-${kind}`}
      className="flex flex-col gap-2 h-full p-3"
    >
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: theme.fontSize.heading,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {KIND_LABEL[kind]}
        </span>
        {!isReadOnly && (
          <Button
            data-testid="task-artifact-editor-save"
            variant="primary"
            onClick={() => void handleSave()}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {error && (
        <div
          data-testid="task-artifact-editor-error"
          role="alert"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red-light)',
          }}
        >
          {error}
        </div>
      )}

      {body.length === 0 && !isReadOnly && (
        <div
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-tertiary)',
          }}
        >
          {KIND_LABEL[kind]} is empty. Edit and save to seed the artifact.
        </div>
      )}

      <textarea
        data-testid="task-artifact-editor-textarea"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        readOnly={isReadOnly}
        spellCheck={false}
        style={{
          flex: 1,
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-input)',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-family-mono)',
          fontSize: theme.fontSize.body,
          lineHeight: theme.lineHeight.body,
          resize: 'none',
        }}
      />
    </div>
  )
}
