// Phase 7 Wave D.3.b: right-panel surface for task-shaped selections.
//
// Mounted by RightPanelTabs when `selection.kind` is `'task'`,
// `'task-run'`, or `'task-slot'` (per the discriminated union added
// in Wave B.4). Fetches the task with bodies via lucode_task_get,
// then dispatches the active artifact tab to TaskArtifactEditor.
//
// Why a separate component rather than extending the existing
// session-shaped tab dispatch: the existing dispatch reads
// session.info.* fields which task-shaped selections don't have. A
// fresh component keeps the task surface clear of legacy session-
// shape coupling, and the parent's early-return makes the boundary
// explicit.

import { useCallback, useEffect, useState } from 'react'

import { Button } from '../ui'
import { theme } from '../../common/theme'
import { TaskArtifactEditor } from './TaskArtifactEditor'
import { getTask } from '../../services/taskService'
import { logger } from '../../utils/logger'
import type { TaskWithBodies } from '../../types/task'

export interface TaskRightPaneProps {
  taskId: string
  projectPath?: string | null
}

type ArtifactTab = 'spec' | 'plan' | 'summary'

const TAB_ORDER: ReadonlyArray<ArtifactTab> = ['spec', 'plan', 'summary']

const TAB_LABELS: Record<ArtifactTab, string> = {
  spec: 'Spec',
  plan: 'Plan',
  summary: 'Summary',
}

export function TaskRightPane({ taskId, projectPath }: TaskRightPaneProps) {
  const [task, setTask] = useState<TaskWithBodies | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ArtifactTab>('spec')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setTask(null)
    setActiveTab('spec')

    getTask(taskId, projectPath ?? null)
      .then((next) => {
        if (cancelled) return
        setTask(next)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[TaskRightPane] getTask failed', err)
        setError(message)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [taskId, projectPath])

  const handleSaved = useCallback((updated: TaskWithBodies) => {
    // Replace the local task envelope so subsequent tab switches see
    // the freshest body; the TasksRefreshed broadcast will reach the
    // sidebar via the listener.
    setTask(updated)
  }, [])

  if (loading) {
    return (
      <div
        data-testid="task-right-pane-loading"
        className="h-full p-3"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-text-tertiary)',
        }}
      >
        Loading task…
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="task-right-pane-error"
        role="alert"
        className="h-full p-3"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-accent-red-light)',
        }}
      >
        Failed to load task {taskId}: {error}
      </div>
    )
  }

  if (!task) {
    return null
  }

  return (
    <div
      data-testid="task-right-pane"
      data-task-id={task.id}
      className="flex flex-col h-full"
    >
      <div
        role="tablist"
        className="flex items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        {TAB_ORDER.map((kind) => {
          const isActive = activeTab === kind
          return (
            <Button
              key={kind}
              variant={isActive ? 'primary' : 'ghost'}
              data-testid={`task-right-pane-tab-${kind}`}
              role="tab"
              aria-selected={isActive}
              aria-label={`${TAB_LABELS[kind]} tab`}
              onClick={() => setActiveTab(kind)}
            >
              {TAB_LABELS[kind]}
            </Button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0">
        <TaskArtifactEditor
          task={task}
          kind={activeTab}
          projectPath={projectPath ?? null}
          onSaved={handleSaved}
        />
      </div>
    </div>
  )
}
