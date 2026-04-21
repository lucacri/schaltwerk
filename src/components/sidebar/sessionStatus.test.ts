import { describe, expect, it } from 'vitest'
import { SessionState, type SessionInfo } from '../../types/session'
import { getSidebarSessionStatus } from './sessionStatus'

const baseInfo: SessionInfo = {
  session_id: 's1',
  display_name: 's1',
  branch: 's1',
  worktree_path: '/tmp/s1',
  base_branch: 'main',
  status: 'active',
  is_current: false,
  session_type: 'worktree',
  session_state: SessionState.Running,
  ready_to_merge: false,
  is_blocked: false,
  original_agent_type: 'claude',
}

function statusFor(overrides: Partial<SessionInfo>, isRunning = false) {
  return getSidebarSessionStatus(
    {
      ...baseInfo,
      ...overrides,
    },
    overrides.is_blocked ?? false,
    isRunning,
  )
}

describe('getSidebarSessionStatus', () => {
  it('returns ready for ready specs that are not running and do not need attention', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'ready',
      clarification_started: true,
      attention_required: false,
    })

    expect(status.primaryStatus).toBe('ready')
    expect(status.isWaitingForInput).toBe(false)
    expect(status.isIdle).toBe(false)
  })

  it('returns waiting for ready specs with waiting attention when they are not running', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'ready',
      clarification_started: true,
      attention_required: true,
      attention_kind: 'waiting_for_input',
    })

    expect(status.primaryStatus).toBe('waiting')
    expect(status.isWaitingForInput).toBe(true)
  })

  it('returns ready for ready specs with idle attention when they are not running', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'ready',
      clarification_started: true,
      attention_required: true,
      attention_kind: 'idle',
    })

    expect(status.primaryStatus).toBe('ready')
    expect(status.isIdle).toBe(false)
  })

  it('lets live running override stale waiting attention for ready specs', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'ready',
      clarification_started: true,
      attention_required: true,
      attention_kind: 'waiting_for_input',
    }, true)

    expect(status.primaryStatus).toBe('running')
    expect(status.isWaitingForInput).toBe(false)
  })

  it('keeps draft specs running while the clarification agent is active', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'draft',
      clarification_started: true,
      attention_required: false,
    }, true)

    expect(status.primaryStatus).toBe('running')
  })

  it('lets live running override stale waiting attention for running sessions', () => {
    const status = statusFor({
      attention_required: true,
      attention_kind: 'waiting_for_input',
      session_state: SessionState.Running,
      status: 'active',
    }, true)

    expect(status.primaryStatus).toBe('running')
    expect(status.isWaitingForInput).toBe(false)
  })

  it('lets live running override stale idle attention for running sessions', () => {
    const status = statusFor({
      attention_required: true,
      attention_kind: 'idle',
      session_state: SessionState.Running,
      status: 'active',
    }, true)

    expect(status.primaryStatus).toBe('running')
    expect(status.isIdle).toBe(false)
  })

  it('treats blocked ready specs as blocked regardless of spec_stage', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'ready',
      clarification_started: true,
      attention_required: false,
      is_blocked: true,
    })

    expect(status.primaryStatus).toBe('blocked')
  })

  it('returns not_started for a draft spec that has not started clarification', () => {
    const status = statusFor({
      session_state: SessionState.Spec,
      status: 'spec',
      worktree_path: '',
      spec_stage: 'draft',
      clarification_started: false,
      attention_required: false,
    })

    expect(status.primaryStatus).toBe('not_started')
  })
})
