import { describe, expect, it } from 'vitest'
import { parseCancelBlocker } from './cancelBlocker'

describe('parseCancelBlocker', () => {
  it('parses UncommittedChanges envelope from object error', () => {
    const err = {
      type: 'CancelBlocked',
      data: { blocker: { type: 'UncommittedChanges', data: { files: ['a.ts', 'b.ts'] } } },
    }
    expect(parseCancelBlocker(err)).toEqual({
      type: 'UncommittedChanges',
      data: { files: ['a.ts', 'b.ts'] },
    })
  })

  it('parses OrphanedWorktree envelope', () => {
    const err = {
      type: 'CancelBlocked',
      data: { blocker: { type: 'OrphanedWorktree', data: { expected_path: '/tmp/x' } } },
    }
    expect(parseCancelBlocker(err)).toEqual({
      type: 'OrphanedWorktree',
      data: { expected_path: '/tmp/x' },
    })
  })

  it('parses WorktreeLocked envelope', () => {
    const err = {
      type: 'CancelBlocked',
      data: { blocker: { type: 'WorktreeLocked', data: { reason: 'manual' } } },
    }
    expect(parseCancelBlocker(err)).toEqual({
      type: 'WorktreeLocked',
      data: { reason: 'manual' },
    })
  })

  it('parses GitError envelope', () => {
    const err = {
      type: 'CancelBlocked',
      data: { blocker: { type: 'GitError', data: { operation: 'remove', message: 'boom' } } },
    }
    expect(parseCancelBlocker(err)).toEqual({
      type: 'GitError',
      data: { operation: 'remove', message: 'boom' },
    })
  })

  it('parses stringified JSON error (Tauri may serialize errors to strings over IPC)', () => {
    const err = JSON.stringify({
      type: 'CancelBlocked',
      data: { blocker: { type: 'WorktreeLocked', data: { reason: 'manual' } } },
    })
    expect(parseCancelBlocker(err)).toEqual({
      type: 'WorktreeLocked',
      data: { reason: 'manual' },
    })
  })

  it('parses Error with stringified JSON message', () => {
    const err = new Error(JSON.stringify({
      type: 'CancelBlocked',
      data: { blocker: { type: 'GitError', data: { operation: 'prune', message: 'x' } } },
    }))
    expect(parseCancelBlocker(err)).toEqual({
      type: 'GitError',
      data: { operation: 'prune', message: 'x' },
    })
  })

  it('returns null for unrelated errors', () => {
    expect(parseCancelBlocker(new Error('boom'))).toBeNull()
    expect(parseCancelBlocker({ type: 'DatabaseError', data: { message: 'x' } })).toBeNull()
    expect(parseCancelBlocker(null)).toBeNull()
    expect(parseCancelBlocker(undefined)).toBeNull()
    expect(parseCancelBlocker('not-json')).toBeNull()
  })

  it('returns null for CancelBlocked with unknown blocker variant', () => {
    const err = {
      type: 'CancelBlocked',
      data: { blocker: { type: 'Unknown', data: {} } },
    }
    expect(parseCancelBlocker(err)).toBeNull()
  })
})
