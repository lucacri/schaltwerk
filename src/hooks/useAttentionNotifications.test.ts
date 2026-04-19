import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '../test/flushPromises'
import {
  computeMutedSourceSessionIds,
  isSessionActivelyRunning,
  shouldCountSessionForAttention,
  useAttentionNotifications,
} from './useAttentionNotifications'
import type { EnrichedSession } from '../types/session'
import type { AttentionNotificationMode } from './useSettings'

const hookMocks = vi.hoisted(() => ({
  invoke: vi.fn<() => Promise<unknown>>(),
  isForeground: false,
  requestDockBounce: vi.fn<() => Promise<void>>(),
  sendAttentionSystemNotification: vi.fn<() => Promise<void>>(),
  getCurrentWindowLabel: vi.fn<() => Promise<string>>(),
  reportAttentionSnapshot: vi.fn<() => Promise<{ totalCount: number; badgeLabel: string | null }>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: hookMocks.invoke,
}))

vi.mock('./useWindowVisibility', () => ({
  useWindowVisibility: () => ({ isForeground: hookMocks.isForeground }),
}))

vi.mock('../utils/attentionBridge', () => ({
  requestDockBounce: hookMocks.requestDockBounce,
  sendAttentionSystemNotification: hookMocks.sendAttentionSystemNotification,
  getCurrentWindowLabel: hookMocks.getCurrentWindowLabel,
  reportAttentionSnapshot: hookMocks.reportAttentionSnapshot,
}))

const createSession = (
  overrides: Partial<EnrichedSession['info']> = {}
): EnrichedSession => ({
  info: {
    session_id: overrides.session_id ?? 'session-id',
    display_name: overrides.display_name,
    branch: overrides.branch ?? 'feature',
    worktree_path: overrides.worktree_path ?? '/tmp/session-id',
    base_branch: overrides.base_branch ?? 'main',
    status: overrides.status ?? 'active',
    is_current: overrides.is_current ?? false,
    session_type: overrides.session_type ?? 'worktree',
    session_state: overrides.session_state ?? 'running',
    ready_to_merge: overrides.ready_to_merge ?? false,
    attention_required: overrides.attention_required ?? false,
    attention_kind: overrides.attention_kind,
    version_group_id: overrides.version_group_id,
    is_consolidation: overrides.is_consolidation,
    consolidation_role: overrides.consolidation_role,
  },
  status: undefined,
  terminals: [],
})

const renderAttentionHook = (
  mode: AttentionNotificationMode,
  session: EnrichedSession
) => {
  hookMocks.invoke.mockResolvedValue({
    attention_notification_mode: mode,
    remember_idle_baseline: false,
  })

  return renderHook(
    ({ sessions }) => useAttentionNotifications({
      sessions,
      projectPath: '/repo',
    }),
    {
      initialProps: {
        sessions: [session],
      },
    }
  )
}

const renderAttentionHookWithMissingPreferences = (session: EnrichedSession) => {
  hookMocks.invoke.mockResolvedValue({})

  return renderHook(
    ({ sessions }) => useAttentionNotifications({
      sessions,
      projectPath: '/repo',
    }),
    {
      initialProps: {
        sessions: [session],
      },
    }
  )
}

const triggerAttentionTransition = async (
  mode: AttentionNotificationMode,
  expected: {
    dock: boolean
    system: boolean
  }
) => {
  const initialSession = createSession({
    session_id: 'session-1',
    attention_required: false,
  })
  const attentionSession = createSession({
    session_id: 'session-1',
    display_name: 'fix-notifications',
    attention_required: true,
    branch: 'fix-notifications',
  })
  const rendered = renderAttentionHook(mode, initialSession)
  await flushPromises()
  hookMocks.requestDockBounce.mockClear()
  hookMocks.sendAttentionSystemNotification.mockClear()

  await act(async () => {
    rendered.rerender({ sessions: [attentionSession] })
  })
  await flushPromises()

  if (expected.dock) {
    expect(hookMocks.requestDockBounce).toHaveBeenCalledTimes(1)
  } else {
    expect(hookMocks.requestDockBounce).not.toHaveBeenCalled()
  }

  if (expected.system) {
    expect(hookMocks.sendAttentionSystemNotification).toHaveBeenCalledWith('fix-notifications')
  } else {
    expect(hookMocks.sendAttentionSystemNotification).not.toHaveBeenCalled()
  }
}

describe('useAttentionNotifications delivery modes', () => {
  beforeEach(() => {
    hookMocks.invoke.mockReset()
    hookMocks.isForeground = false
    hookMocks.requestDockBounce.mockReset()
    hookMocks.requestDockBounce.mockResolvedValue(undefined)
    hookMocks.sendAttentionSystemNotification.mockReset()
    hookMocks.sendAttentionSystemNotification.mockResolvedValue(undefined)
    hookMocks.getCurrentWindowLabel.mockReset()
    hookMocks.getCurrentWindowLabel.mockResolvedValue('main')
    hookMocks.reportAttentionSnapshot.mockReset()
    hookMocks.reportAttentionSnapshot.mockResolvedValue({ totalCount: 0, badgeLabel: null })
  })

  it('uses only dock attention in dock mode', async () => {
    await triggerAttentionTransition('dock', { dock: true, system: false })
  })

  it('uses only system notification in system mode', async () => {
    await triggerAttentionTransition('system', { dock: false, system: true })
  })

  it('uses dock and system notification in both mode', async () => {
    await triggerAttentionTransition('both', { dock: true, system: true })
  })

  it('uses both notification channels when preferences are missing', async () => {
    const initialSession = createSession({
      session_id: 'session-1',
      attention_required: false,
    })
    const attentionSession = createSession({
      session_id: 'session-1',
      display_name: 'fix-notifications',
      attention_required: true,
    })
    const rendered = renderAttentionHookWithMissingPreferences(initialSession)
    await flushPromises()
    hookMocks.requestDockBounce.mockClear()
    hookMocks.sendAttentionSystemNotification.mockClear()

    await act(async () => {
      rendered.rerender({ sessions: [attentionSession] })
    })
    await flushPromises()

    expect(hookMocks.requestDockBounce).toHaveBeenCalledTimes(1)
    expect(hookMocks.sendAttentionSystemNotification).toHaveBeenCalledWith('fix-notifications')
  })

  it('does not notify in off mode', async () => {
    await triggerAttentionTransition('off', { dock: false, system: false })
  })
})

describe('shouldCountSessionForAttention', () => {
  it('excludes ready sessions even when they require attention', () => {
    const session = createSession({
      attention_required: true,
      ready_to_merge: true,
    })

    expect(shouldCountSessionForAttention(session)).toBe(false)
  })

  it('includes running sessions that require attention', () => {
    const session = createSession({
      attention_required: true,
      ready_to_merge: false,
    })

    expect(shouldCountSessionForAttention(session)).toBe(true)
  })

  it('ignores sessions without attention requirements', () => {
    const session = createSession({
      attention_required: false,
      ready_to_merge: false,
    })

    expect(shouldCountSessionForAttention(session)).toBe(false)
  })

  it('includes running sessions when ready_to_merge is false', () => {
    const session = createSession({
      attention_required: true,
      ready_to_merge: false,
      session_state: 'running',
    })

    expect(shouldCountSessionForAttention(session)).toBe(true)
  })
})

describe('isSessionActivelyRunning', () => {
  it('returns true for running sessions without attention required', () => {
    const session = createSession({
      session_state: 'running',
      attention_required: false,
      ready_to_merge: false,
    })

    expect(isSessionActivelyRunning(session)).toBe(true)
  })

  it('returns false for running sessions that are idle (attention_required)', () => {
    const session = createSession({
      session_state: 'running',
      attention_required: true,
      ready_to_merge: false,
    })

    expect(isSessionActivelyRunning(session)).toBe(false)
  })

  it('returns true for running sessions without attention or ready state', () => {
    const session = createSession({
      session_state: 'running',
      attention_required: false,
      ready_to_merge: false,
    })

    expect(isSessionActivelyRunning(session)).toBe(true)
  })

  it('returns false for ready sessions via ready_to_merge', () => {
    const session = createSession({
      session_state: 'running',
      attention_required: false,
      ready_to_merge: true,
    })

    expect(isSessionActivelyRunning(session)).toBe(false)
  })

  it('returns false for spec sessions', () => {
    const session = createSession({
      session_state: 'spec',
      attention_required: false,
      ready_to_merge: false,
    })

    expect(isSessionActivelyRunning(session)).toBe(false)
  })

  it('returns false for processing sessions', () => {
    const session = createSession({
      session_state: 'processing',
      attention_required: false,
      ready_to_merge: false,
    })

    expect(isSessionActivelyRunning(session)).toBe(false)
  })
})

describe('computeMutedSourceSessionIds', () => {
  it('returns source session IDs of version groups that contain a judge session', () => {
    const sessions: EnrichedSession[] = [
      createSession({ session_id: 'feature-A_v1', version_group_id: 'group-A' }),
      createSession({ session_id: 'feature-A_v2', version_group_id: 'group-A' }),
      createSession({
        session_id: 'feature-A-judge',
        version_group_id: 'group-A',
        is_consolidation: true,
        consolidation_role: 'judge',
      }),
      createSession({ session_id: 'feature-B_v1', version_group_id: 'group-B' }),
    ]

    expect(computeMutedSourceSessionIds(sessions)).toEqual(
      new Set(['feature-A_v1', 'feature-A_v2'])
    )
  })

  it('returns empty set when no judge session exists', () => {
    const sessions: EnrichedSession[] = [
      createSession({ session_id: 'feature-A_v1', version_group_id: 'group-A' }),
      createSession({
        session_id: 'feature-A-merge',
        version_group_id: 'group-A',
        is_consolidation: true,
        consolidation_role: 'candidate',
      }),
    ]

    expect(computeMutedSourceSessionIds(sessions)).toEqual(new Set())
  })

  it('does not mute sessions outside the judge group', () => {
    const sessions: EnrichedSession[] = [
      createSession({ session_id: 'feature-A_v1', version_group_id: 'group-A' }),
      createSession({
        session_id: 'feature-A-judge',
        version_group_id: 'group-A',
        is_consolidation: true,
        consolidation_role: 'judge',
      }),
      createSession({ session_id: 'feature-B_v1', version_group_id: 'group-B' }),
    ]

    expect(computeMutedSourceSessionIds(sessions)).toEqual(new Set(['feature-A_v1']))
  })

  it('ignores sessions without a version_group_id', () => {
    const sessions: EnrichedSession[] = [
      createSession({ session_id: 'solo' }),
      createSession({
        session_id: 'feature-A-judge',
        version_group_id: 'group-A',
        is_consolidation: true,
        consolidation_role: 'judge',
      }),
    ]

    expect(computeMutedSourceSessionIds(sessions)).toEqual(new Set())
  })
})

describe('useAttentionNotifications with consolidation judge', () => {
  beforeEach(() => {
    hookMocks.invoke.mockReset()
    hookMocks.invoke.mockResolvedValue({
      attention_notification_mode: 'both',
      remember_idle_baseline: false,
    })
    hookMocks.isForeground = false
    hookMocks.requestDockBounce.mockReset()
    hookMocks.requestDockBounce.mockResolvedValue(undefined)
    hookMocks.sendAttentionSystemNotification.mockReset()
    hookMocks.sendAttentionSystemNotification.mockResolvedValue(undefined)
    hookMocks.getCurrentWindowLabel.mockReset()
    hookMocks.getCurrentWindowLabel.mockResolvedValue('main')
    hookMocks.reportAttentionSnapshot.mockReset()
    hookMocks.reportAttentionSnapshot.mockResolvedValue({ totalCount: 0, badgeLabel: null })
  })

  it('does not bounce the dock or notify when an idle source has a sibling judge session', async () => {
    const judge = createSession({
      session_id: 'feature-A-judge',
      version_group_id: 'group-A',
      is_consolidation: true,
      consolidation_role: 'judge',
    })
    const initialSource = createSession({
      session_id: 'feature-A_v1',
      version_group_id: 'group-A',
      attention_required: false,
    })
    const idleSource = createSession({
      session_id: 'feature-A_v1',
      display_name: 'feature-A_v1',
      version_group_id: 'group-A',
      attention_required: true,
      attention_kind: 'idle',
    })

    const rendered = renderHook(
      ({ sessions }) => useAttentionNotifications({
        sessions,
        projectPath: '/repo',
      }),
      {
        initialProps: { sessions: [judge, initialSource] },
      }
    )
    await flushPromises()
    hookMocks.requestDockBounce.mockClear()
    hookMocks.sendAttentionSystemNotification.mockClear()

    await act(async () => {
      rendered.rerender({ sessions: [judge, idleSource] })
    })
    await flushPromises()

    expect(hookMocks.requestDockBounce).not.toHaveBeenCalled()
    expect(hookMocks.sendAttentionSystemNotification).not.toHaveBeenCalled()
  })
})
