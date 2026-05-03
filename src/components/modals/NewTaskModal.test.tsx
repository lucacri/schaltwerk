import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { ReactElement } from 'react'

const createTask = vi.fn()

vi.mock('../../services/taskService', () => ({
  createTask: (...args: unknown[]) => createTask(...args),
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { NewTaskModal } from './NewTaskModal'
import type { Task } from '../../types/task'

function renderWithStore(ui: ReactElement) {
  const store = createStore()
  return render(<Provider store={store}>{ui}</Provider>)
}

function makeTask(name: string): Task {
  return {
    id: `id-${name}`,
    name,
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: '',
    source_kind: null,
    source_url: null,
    task_host_session_id: null,
    task_branch: null,
    base_branch: null,
    issue_number: null,
    issue_url: null,
    pr_number: null,
    pr_url: null,
    pr_state: null,
    failure_flag: false,
    epic_id: null,
    attention_required: false,
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    cancelled_at: null,
    task_runs: [],
  }
}

describe('NewTaskModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when isOpen is false', () => {
    renderWithStore(
      <NewTaskModal
        isOpen={false}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByTestId('new-task-modal-form')).toBeNull()
  })

  it('disables submit while the name is empty', () => {
    renderWithStore(<NewTaskModal isOpen onClose={() => {}} />)
    const submit = screen.getByTestId('new-task-modal-submit')
    expect(submit).toBeDisabled()
  })

  it('submits a sanitized name + request body and closes on success', async () => {
    createTask.mockResolvedValue(makeTask('add-search-bar'))
    const onClose = vi.fn()
    const onCreated = vi.fn()
    renderWithStore(
      <NewTaskModal
        isOpen
        onClose={onClose}
        onCreated={onCreated}
        projectPath="/tmp/proj"
      />,
    )

    fireEvent.change(screen.getByTestId('new-task-modal-name'), {
      target: { value: 'Add Search Bar' },
    })
    fireEvent.change(screen.getByTestId('new-task-modal-request'), {
      target: { value: 'Goal: search by branch name.' },
    })
    fireEvent.change(screen.getByTestId('new-task-modal-base-branch'), {
      target: { value: 'main' },
    })

    fireEvent.click(screen.getByTestId('new-task-modal-submit'))

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'add-search-bar',
        requestBody: 'Goal: search by branch name.',
        baseBranch: 'main',
        epicId: null,
      }),
      '/tmp/proj',
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'add-search-bar' }))
  })

  it('renders an epic picker that defaults to "No epic" and submits null when untouched', () => {
    renderWithStore(<NewTaskModal isOpen onClose={() => {}} />)
    const trigger = screen.getByTestId('new-task-modal-epic-trigger')
    expect(trigger).toHaveTextContent('No epic')
  })

  it('surfaces backend errors and keeps the form open', async () => {
    createTask.mockRejectedValue(new Error('backend exploded'))
    const onClose = vi.fn()
    renderWithStore(<NewTaskModal isOpen onClose={onClose} />)

    fireEvent.change(screen.getByTestId('new-task-modal-name'), {
      target: { value: 'oops' },
    })
    fireEvent.click(screen.getByTestId('new-task-modal-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('new-task-modal-error')).toHaveTextContent(
        /backend exploded/,
      ),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('rejects an empty name with a validation error', async () => {
    renderWithStore(<NewTaskModal isOpen onClose={() => {}} />)

    fireEvent.change(screen.getByTestId('new-task-modal-name'), {
      target: { value: '   ' },
    })
    // Force-enable submit by then setting a non-empty value, then back?
    // Easier: directly fire submit on the form to bypass the disabled
    // attribute and exercise the validation branch.
    const form = screen.getByTestId('new-task-modal-form')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(screen.getByTestId('new-task-modal-error')).toHaveTextContent(
        /name is required/i,
      ),
    )
    expect(createTask).not.toHaveBeenCalled()
  })
})
