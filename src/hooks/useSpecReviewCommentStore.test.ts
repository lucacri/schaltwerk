import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { TauriCommands } from '../common/tauriCommands'
import type { SpecReviewComment } from '../types/specReview'
import { useSpecReviewCommentStore } from './useSpecReviewCommentStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'

describe('useSpecReviewCommentStore', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('load converts persisted rows into SpecReviewComment shape', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        id: 'c1',
        spec_id: 'internal-id',
        line_start: 2,
        line_end: 4,
        selected_text: 'body text',
        comment: 'fix this',
        created_at: 99,
      },
    ])

    const { result } = renderHook(() => useSpecReviewCommentStore('spec-a', '/repo'))
    const rows = await result.current.load()

    expect(invoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreListSpecReviewComments,
      { name: 'spec-a', projectPath: '/repo' },
    )
    expect(rows).toEqual<SpecReviewComment[]>([
      {
        id: 'c1',
        specId: 'spec-a',
        lineRange: { start: 2, end: 4 },
        selectedText: 'body text',
        comment: 'fix this',
        timestamp: 99,
      },
    ])
  })

  it('save serialises comments into the persisted wire shape', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useSpecReviewCommentStore('spec-a', null))

    await act(async () => {
      await result.current.save([
        {
          id: 'c1',
          specId: 'spec-a',
          lineRange: { start: 1, end: 1 },
          selectedText: 'snippet',
          comment: 'nit',
          timestamp: 5,
        },
      ])
    })

    expect(invoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreSaveSpecReviewComments,
      {
        name: 'spec-a',
        comments: [
          {
            id: 'c1',
            spec_id: '',
            line_start: 1,
            line_end: 1,
            selected_text: 'snippet',
            comment: 'nit',
            created_at: 5,
          },
        ],
      },
    )
  })

  it('clear calls the clear command with projectPath', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useSpecReviewCommentStore('spec-a', '/repo'))

    await act(async () => {
      await result.current.clear()
    })

    expect(invoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreClearSpecReviewComments,
      { name: 'spec-a', projectPath: '/repo' },
    )
  })

  it('omits projectPath when null', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    const { result } = renderHook(() => useSpecReviewCommentStore('spec-a', null))
    await result.current.load()

    expect(invoke).toHaveBeenCalledWith(
      TauriCommands.SchaltwerkCoreListSpecReviewComments,
      { name: 'spec-a' },
    )
  })
})
