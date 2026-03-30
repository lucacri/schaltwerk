import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { EnrichedSession } from '../types/session'
import { useUpdateSessionFromParent } from './useUpdateSessionFromParent'
import { TauriCommands } from '../common/tauriCommands'

const useSessionsMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('./useSessions', () => ({
  useSessions: () => useSessionsMock(),
}))

vi.mock('../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'session-1',
      display_name: 'Session One',
      branch: 'schaltwerk/session-one',
      worktree_path: '/tmp/session-one',
      base_branch: 'main',
      parent_branch: 'main',
      status: 'active',
      session_state: 'running',
      ready_to_merge: false,
      is_current: false,
      session_type: 'worktree',
      ...overrides,
    },
    terminals: [],
  }
}

describe('useUpdateSessionFromParent', () => {
  const mockInvoke = invoke as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    useSessionsMock.mockReturnValue({
      sessions: [createSession()],
    })
  })

  describe('single session update', () => {
    it('shows warning toast when session is not found in sessions list', async () => {
      useSessionsMock.mockReturnValueOnce({
        sessions: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('missing-session')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Session not found',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('shows warning toast when session is a spec', async () => {
      const specSession = createSession({
        session_state: 'spec',
        status: 'spec',
      })
      useSessionsMock.mockReturnValueOnce({
        sessions: [specSession],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Cannot update spec',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('calls invoke with correct command and session name', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'success',
        parentBranch: 'main',
        message: 'Session updated from main',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'session-1' },
      )
    })

    it('shows success toast on successful update', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'success',
        parentBranch: 'main',
        message: 'Session updated from main',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'success',
          title: 'Session updated',
        }),
      )
    })

    it('shows info toast when already up to date', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'already_up_to_date',
        parentBranch: 'main',
        message: 'Already up to date',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'info',
          title: 'Already up to date',
        }),
      )
    })

    it('shows warning toast when uncommitted changes exist', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'has_uncommitted_changes',
        parentBranch: 'main',
        message: 'Commit or stash changes',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Uncommitted changes',
        }),
      )
    })

    it('shows warning toast with conflict paths when conflicts detected', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'has_conflicts',
        parentBranch: 'main',
        message: 'Merge conflicts',
        conflictingPaths: ['file1.ts', 'file2.ts'],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Merge conflicts',
          description: 'Conflicts in: file1.ts, file2.ts',
        }),
      )
    })

    it('truncates conflict paths when more than 3 files', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'has_conflicts',
        parentBranch: 'main',
        message: 'Merge conflicts',
        conflictingPaths: ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Merge conflicts',
          description: 'Conflicts in: file1.ts, file2.ts, file3.ts...',
        }),
      )
    })

    it('falls back to message when no conflict paths provided', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'has_conflicts',
        parentBranch: 'main',
        message: 'Cannot merge due to conflicts',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Merge conflicts',
          description: 'Cannot merge due to conflicts',
        }),
      )
    })

    it('shows error toast when pull fails', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'pull_failed',
        parentBranch: 'main',
        message: 'Could not fetch origin',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Update failed',
          description: 'Could not fetch origin',
        }),
      )
    })

    it('shows error toast when merge fails', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'merge_failed',
        parentBranch: 'main',
        message: 'Failed to merge branches',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Merge failed',
          description: 'Failed to merge branches',
        }),
      )
    })

    it('shows warning toast for no_session status', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'no_session',
        parentBranch: 'main',
        message: 'Cannot update a spec session',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'No active session',
        }),
      )
    })

    it('shows error toast when invoke throws', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Update failed',
          description: 'Network error',
        }),
      )
    })

    it('handles non-Error thrown values', async () => {
      mockInvoke.mockRejectedValueOnce('String error')

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Update failed',
          description: 'String error',
        }),
      )
    })
  })

  describe('updateAllSessionsFromParent', () => {
    it('shows warning toast when there are no running sessions', async () => {
      const specSession = createSession({
        session_id: 'spec-1',
        session_state: 'spec',
        status: 'spec',
      })
      useSessionsMock.mockReturnValueOnce({
        sessions: [specSession],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'No running sessions',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('updates every non-spec session and skips specs', async () => {
      const running = createSession({ session_id: 'running-1', display_name: 'Running One' })
      const reviewed = createSession({
        session_id: 'reviewed-1',
        display_name: 'Reviewed One',
        session_state: 'reviewed',
        ready_to_merge: true,
      })
      const spec = createSession({ session_id: 'spec-1', session_state: 'spec', status: 'spec' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [running, reviewed, spec],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Updated',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'running-1' },
      )
      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'reviewed-1' },
      )
    })

    it('shows success toast when sessions were updated and some were already current', async () => {
      const session1 = createSession({ session_id: 'session-1' })
      const session2 = createSession({ session_id: 'session-2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke
        .mockResolvedValueOnce({
          status: 'success',
          parentBranch: 'main',
          message: 'Updated',
          conflictingPaths: [],
        })
        .mockResolvedValueOnce({
          status: 'already_up_to_date',
          parentBranch: 'main',
          message: 'Already current',
          conflictingPaths: [],
        })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'success',
          title: 'All sessions updated',
          description: '1 session updated from parent, 1 already up to date',
        }),
      )
    })

    it('shows info toast when all sessions are already up to date', async () => {
      const session1 = createSession({ session_id: 'session-1' })
      const session2 = createSession({ session_id: 'session-2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockResolvedValue({
        status: 'already_up_to_date',
        parentBranch: 'main',
        message: 'Already current',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'info',
          title: 'All sessions up to date',
          description: '2 sessions are already up to date',
        }),
      )
    })

    it('shows warning toast with failed session names when some updates fail', async () => {
      const session1 = createSession({ session_id: 'session-1', display_name: 'Alpha' })
      const session2 = createSession({ session_id: 'session-2', display_name: 'Beta' })
      const session3 = createSession({ session_id: 'session-3', display_name: 'Gamma' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2, session3],
      })
      mockInvoke
        .mockResolvedValueOnce({
          status: 'success',
          parentBranch: 'main',
          message: 'Updated',
          conflictingPaths: [],
        })
        .mockResolvedValueOnce({
          status: 'has_conflicts',
          parentBranch: 'main',
          message: 'Conflicts',
          conflictingPaths: ['file.ts'],
        })
        .mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Some sessions had issues',
          description: '2 failed: Beta, Gamma',
        }),
      )
    })

    it('shows error toast when all session updates fail', async () => {
      const session1 = createSession({ session_id: 'session-1' })
      const session2 = createSession({ session_id: 'session-2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Update failed',
          description: 'All 2 sessions failed to update',
        }),
      )
    })
  })

  describe('isUpdating state', () => {
    it('sets isUpdating to true during a single-session update', async () => {
      let resolvePromise: (value: unknown) => void
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      mockInvoke.mockReturnValue(pendingPromise)

      const { result } = renderHook(() => useUpdateSessionFromParent())

      expect(result.current.isUpdating).toBe(false)

      let updatePromise: Promise<void>
      act(() => {
        updatePromise = result.current.updateSessionFromParent('session-1')
      })

      expect(result.current.isUpdating).toBe(true)

      await act(async () => {
        resolvePromise!({
          status: 'success',
          parentBranch: 'main',
          message: 'Done',
          conflictingPaths: [],
        })
        await updatePromise
      })

      expect(result.current.isUpdating).toBe(false)
    })

    it('sets isUpdating to true during a bulk update', async () => {
      let resolvePromise: (value: unknown) => void
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      mockInvoke.mockReturnValue(pendingPromise)

      const { result } = renderHook(() => useUpdateSessionFromParent())

      expect(result.current.isUpdating).toBe(false)

      let updatePromise: Promise<void>
      act(() => {
        updatePromise = result.current.updateAllSessionsFromParent()
      })

      expect(result.current.isUpdating).toBe(true)

      await act(async () => {
        resolvePromise!({
          status: 'success',
          parentBranch: 'main',
          message: 'Done',
          conflictingPaths: [],
        })
        await updatePromise
      })

      expect(result.current.isUpdating).toBe(false)
    })

    it('resets isUpdating to false even on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(result.current.isUpdating).toBe(false)
    })
  })

  describe('session display name', () => {
    it('uses display_name in toast when available', async () => {
      const sessionWithDisplayName = createSession({
        session_id: 'session-1',
        display_name: 'My Custom Name',
      })
      useSessionsMock.mockReturnValue({
        sessions: [sessionWithDisplayName],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Done',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('My Custom Name'),
        }),
      )
    })
  })
})
