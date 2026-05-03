// Phase 7 Wave D.1: "+ New Task" creation modal.
//
// Replaces the old "Start Agent" / "Create Spec" dual-button flow in
// the home section. A fresh task starts at Draft stage; the user's
// `request_body` is the first artifact (Phase 4 Wave F: artifact bodies
// are derived from `task_artifacts` so the request body lives there
// once any further edit lands).
//
// Per Phase 7 plan §6 #6: orchestrator stays a non-task surface; this
// modal does NOT create orchestrator sessions. Spec creation is
// implicit: a Draft task IS the spec-equivalent surface in v2.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { ResizableModal } from '../shared/ResizableModal'
import { Button, FormGroup, TextInput } from '../ui'
import { Dropdown } from '../inputs/Dropdown'
import { theme } from '../../common/theme'
import { sanitizeName } from '../../utils/sanitizeName'
import { createTask } from '../../services/taskService'
import { logger } from '../../utils/logger'
import { epicsAtom } from '../../store/atoms/epics'
import type { Task } from '../../types/task'

export interface NewTaskModalProps {
  isOpen: boolean
  onClose: () => void
  /** Project path passed through to lucode_task_create. */
  projectPath?: string | null
  /** Called with the newly-created task on success. The default refresh
   *  flow (TasksRefreshed listener) will replace it momentarily. */
  onCreated?: (task: Task) => void
}

interface FormState {
  name: string
  displayName: string
  requestBody: string
  baseBranch: string
  epicId: string | null
}

const INITIAL: FormState = {
  name: '',
  displayName: '',
  requestBody: '',
  baseBranch: '',
  epicId: null,
}

const NO_EPIC_KEY = '__none__'

export function NewTaskModal({
  isOpen,
  onClose,
  projectPath,
  onCreated,
}: NewTaskModalProps) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [epicMenuOpen, setEpicMenuOpen] = useState(false)
  const epics = useAtomValue(epicsAtom)

  const epicOptions = useMemo(
    () => [
      { key: NO_EPIC_KEY, label: 'No epic' },
      ...epics.map((epic) => ({ key: epic.id, label: epic.name })),
    ],
    [epics],
  )

  const selectedEpicLabel = useMemo(() => {
    if (!form.epicId) return 'No epic'
    return epics.find((epic) => epic.id === form.epicId)?.name ?? 'No epic'
  }, [epics, form.epicId])

  useEffect(() => {
    if (isOpen) {
      setForm(INITIAL)
      setError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      const trimmedName = form.name.trim()
      if (!trimmedName) {
        setError('Task name is required')
        return
      }
      const sanitized = sanitizeName(trimmedName)
      if (!sanitized) {
        setError('Task name must contain valid characters')
        return
      }

      setError(null)
      setSubmitting(true)
      try {
        const created = await createTask(
          {
            name: sanitized,
            displayName: form.displayName.trim() || null,
            requestBody: form.requestBody,
            baseBranch: form.baseBranch.trim() || null,
            epicId: form.epicId,
          },
          projectPath ?? null,
        )
        onCreated?.(created)
        onClose()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[NewTaskModal] createTask failed', err)
        setError(message)
      } finally {
        setSubmitting(false)
      }
    },
    [form, onClose, onCreated, projectPath],
  )

  return (
    <ResizableModal
      isOpen={isOpen}
      onClose={onClose}
      title="New task"
      storageKey="new-task-modal"
      defaultWidth={640}
      defaultHeight={520}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && (
            <span
              data-testid="new-task-modal-error"
              role="alert"
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-accent-red-light)',
                marginRight: 'auto',
              }}
            >
              {error}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            data-testid="new-task-modal-submit"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || form.name.trim().length === 0}
          >
            {submitting ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      }
    >
      <form
        data-testid="new-task-modal-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <FormGroup label="Name" required>
          <TextInput
            data-testid="new-task-modal-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="add-search-bar"
            autoFocus
            disabled={submitting}
          />
        </FormGroup>

        <FormGroup label="Display name">
          <TextInput
            data-testid="new-task-modal-display-name"
            value={form.displayName}
            onChange={(event) => update('displayName', event.target.value)}
            placeholder="Add search bar"
            disabled={submitting}
          />
        </FormGroup>

        <FormGroup label="Base branch">
          <TextInput
            data-testid="new-task-modal-base-branch"
            value={form.baseBranch}
            onChange={(event) => update('baseBranch', event.target.value)}
            placeholder="main"
            disabled={submitting}
          />
        </FormGroup>

        <FormGroup label="Epic" help="Optional grouping for related tasks.">
          <Dropdown
            open={epicMenuOpen}
            onOpenChange={setEpicMenuOpen}
            items={epicOptions}
            onSelect={(key) => {
              update('epicId', key === NO_EPIC_KEY ? null : key)
              setEpicMenuOpen(false)
            }}
            menuTestId="new-task-modal-epic-menu"
          >
            {({ toggle }) => (
              <Button
                data-testid="new-task-modal-epic-trigger"
                variant="default"
                onClick={toggle}
                disabled={submitting}
              >
                {selectedEpicLabel}
              </Button>
            )}
          </Dropdown>
        </FormGroup>

        <FormGroup label="Request" help="Markdown describing what the task should do.">
          <textarea
            data-testid="new-task-modal-request"
            value={form.requestBody}
            onChange={(event) => update('requestBody', event.target.value)}
            placeholder="## Goal&#10;…"
            disabled={submitting}
            rows={8}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border-subtle)',
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-family-mono)',
              fontSize: theme.fontSize.body,
              lineHeight: theme.lineHeight.body,
              resize: 'vertical',
              minHeight: 160,
            }}
          />
        </FormGroup>
      </form>
    </ResizableModal>
  )
}
