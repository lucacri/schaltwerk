import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ReactNode, createElement } from 'react'

import { useTaskRunSlots } from './useTaskRunSlots'
import { allSessionsAtom } from '../../../store/atoms/sessions'
import type { EnrichedSession } from '../../../types/session'

function makeSession(overrides: {
  id: string
  taskRunId?: string | null
  slotKey?: string | null
  firstIdleAt?: string | null
  exitCode?: number | null
  isWinner?: boolean
}): EnrichedSession {
  return {
    info: {
      session_id: overrides.id,
      branch: `lucode/${overrides.id}`,
      worktree_path: `/tmp/wt-${overrides.id}`,
      base_branch: 'main',
      status: 'active',
      is_current: false,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
      task_run_id: overrides.taskRunId ?? null,
      slot_key: overrides.slotKey ?? null,
      first_idle_at: overrides.firstIdleAt ?? null,
      exit_code: overrides.exitCode ?? null,
    },
    terminals: [],
  }
}

function withStore(store: ReturnType<typeof createStore>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store, children })
}

describe('useTaskRunSlots', () => {
  it('returns empty list when no session is bound to the run', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'orphan-1' }),
      makeSession({ id: 'other-task', taskRunId: 'run-other', slotKey: 'A' }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', null),
      { wrapper: withStore(store) },
    )
    expect(result.current).toEqual([])
  })

  it('filters sessions to those bound to the given runId', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a', taskRunId: 'run-target', slotKey: 'A' }),
      makeSession({ id: 'b', taskRunId: 'run-target', slotKey: 'B' }),
      makeSession({ id: 'c', taskRunId: 'run-other', slotKey: 'A' }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', null),
      { wrapper: withStore(store) },
    )
    expect(result.current.map((s) => s.sessionId)).toEqual(['a', 'b'])
    expect(result.current.map((s) => s.slotKey)).toEqual(['A', 'B'])
  })

  it('classifies status: failed when exit_code is non-zero', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({
        id: 'a',
        taskRunId: 'run-target',
        slotKey: 'A',
        exitCode: 1,
      }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', null),
      { wrapper: withStore(store) },
    )
    expect(result.current[0].status).toBe('failed')
  })

  it('classifies status: idle when first_idle_at is set and exit is clean', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({
        id: 'a',
        taskRunId: 'run-target',
        slotKey: 'A',
        firstIdleAt: '2026-05-02T01:00:00Z',
      }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', null),
      { wrapper: withStore(store) },
    )
    expect(result.current[0].status).toBe('idle')
  })

  it('classifies status: running when neither idle nor failed', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a', taskRunId: 'run-target', slotKey: 'A' }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', null),
      { wrapper: withStore(store) },
    )
    expect(result.current[0].status).toBe('running')
  })

  it('marks the slot as winner when its sessionId matches selectedSessionId', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a', taskRunId: 'run-target', slotKey: 'A' }),
      makeSession({ id: 'b', taskRunId: 'run-target', slotKey: 'B' }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots('run-target', 'b'),
      { wrapper: withStore(store) },
    )
    expect(result.current.find((s) => s.sessionId === 'b')?.isWinner).toBe(true)
    expect(result.current.find((s) => s.sessionId === 'a')?.isWinner).toBe(false)
  })

  it('returns empty when runId is null', () => {
    const store = createStore()
    store.set(allSessionsAtom, [
      makeSession({ id: 'a', taskRunId: 'run-target', slotKey: 'A' }),
    ])
    const { result } = renderHook(
      () => useTaskRunSlots(null, null),
      { wrapper: withStore(store) },
    )
    expect(result.current).toEqual([])
  })
})
