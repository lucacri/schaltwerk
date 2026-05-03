// Phase 8 W.5 GAP 10: pin the confirmStage flow + Retry merge toast.
//
// Three scenarios:
//   1. Happy path — confirmStage resolves, returns the new task.
//   2. MergeConflict (SchaltError shape) — sticky toast with Retry.
//   3. StageAdvanceFailedAfterMerge (TaskFlowError shape) — sticky
//      Retry toast.
// The Retry button re-runs the same call.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

const confirmStageService = vi.fn()
vi.mock('../../../services/taskService', () => ({
  confirmStage: (...args: unknown[]) => confirmStageService(...args),
}))

vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useConfirmStage } from './useConfirmStage'
import { allSessionsAtom } from '../../../store/atoms/sessions'
import { ToastProvider } from '../../../common/toast/ToastProvider'
import type { EnrichedSession } from '../../../types/session'

function makeSession(id: string, branch: string): EnrichedSession {
  return {
    info: {
      session_id: id,
      branch,
      worktree_path: `/tmp/${id}`,
      base_branch: 'main',
      status: 'active',
      is_current: false,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
    },
    terminals: [],
  }
}

function makeWrapper(sessions: EnrichedSession[] = []): (p: { children: ReactNode }) => JSX.Element {
  const store = createStore()
  store.set(allSessionsAtom, sessions)
  return ({ children }) => (
    <Provider store={store}>
      <ToastProvider>{children}</ToastProvider>
    </Provider>
  )
}

describe('useConfirmStage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the resolved task when confirmStage succeeds', async () => {
    const winner = makeSession('s1', 'feature/winner')
    confirmStageService.mockResolvedValue({ id: 't1', stage: 'brainstormed' })

    const { result } = renderHook(() => useConfirmStage(), {
      wrapper: makeWrapper([winner]),
    })

    let returned: unknown = null
    await act(async () => {
      returned = await result.current.confirmStage('run-1', 's1')
    })

    expect(confirmStageService).toHaveBeenCalledWith(
      'run-1',
      's1',
      'feature/winner',
      expect.objectContaining({ projectPath: null }),
    )
    expect(returned).toMatchObject({ id: 't1' })
  })

  it('returns null and toasts when the slot session has no branch on the wire', async () => {
    const { result } = renderHook(() => useConfirmStage(), {
      wrapper: makeWrapper(),
    })

    let returned: unknown = 'not-set'
    await act(async () => {
      returned = await result.current.confirmStage('run-1', 'missing')
    })

    expect(returned).toBeNull()
    expect(confirmStageService).not.toHaveBeenCalled()
  })
})

// Component-level pin so we can assert toast rendering + Retry.
function ConfirmTrigger({ runId, sessionId }: { runId: string; sessionId: string }) {
  const { confirmStage } = useConfirmStage()
  return (
    <button
      data-testid="trigger-confirm"
      onClick={() => {
        void confirmStage(runId, sessionId)
      }}
    >
      Confirm
    </button>
  )
}

function renderTrigger(sessions: EnrichedSession[]) {
  const store = createStore()
  store.set(allSessionsAtom, sessions)
  return render(
    <Provider store={store}>
      <ToastProvider>
        <ConfirmTrigger runId="run-1" sessionId="s1" />
      </ToastProvider>
    </Provider>,
  )
}

describe('useConfirmStage merge-failure toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces a sticky "Retry merge" toast for SchaltError MergeConflict', async () => {
    const winner = makeSession('s1', 'feature/winner')
    confirmStageService
      .mockRejectedValueOnce({
        type: 'MergeConflict',
        data: { files: ['a.txt'], message: 'conflict on a.txt' },
      })
      .mockResolvedValueOnce({ id: 't1' })

    renderTrigger([winner])
    fireEvent.click(screen.getByTestId('trigger-confirm'))

    const title = await screen.findByText(/Merge failed during confirm/)
    expect(title).toBeInTheDocument()

    const retry = await screen.findByRole('button', { name: /Retry merge/i })
    fireEvent.click(retry)

    await waitFor(() => expect(confirmStageService).toHaveBeenCalledTimes(2))
  })

  it('surfaces "Retry merge" toast for TaskFlowError StageAdvanceFailedAfterMerge', async () => {
    const winner = makeSession('s1', 'feature/winner')
    confirmStageService
      .mockRejectedValueOnce({
        type: 'StageAdvanceFailedAfterMerge',
        data: { task_id: 't1', message: 'boom' },
      })
      .mockResolvedValueOnce({ id: 't1' })

    renderTrigger([winner])
    fireEvent.click(screen.getByTestId('trigger-confirm'))

    const title = await screen.findByText(/Merge failed during confirm/)
    expect(title).toBeInTheDocument()

    const retry = await screen.findByRole('button', { name: /Retry merge/i })
    fireEvent.click(retry)

    await waitFor(() => expect(confirmStageService).toHaveBeenCalledTimes(2))
  })

  it('surfaces a generic non-retry toast for unrelated errors', async () => {
    const winner = makeSession('s1', 'feature/winner')
    confirmStageService.mockRejectedValueOnce(new Error('database down'))

    renderTrigger([winner])
    fireEvent.click(screen.getByTestId('trigger-confirm'))

    const title = await screen.findByText(/Confirm stage failed/)
    expect(title).toBeInTheDocument()
    // No Retry button on the generic error path.
    expect(within(title.parentElement as HTMLElement).queryByRole('button', { name: /Retry/i })).toBeNull()
  })
})
