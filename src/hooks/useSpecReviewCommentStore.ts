import { useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import type { SpecReviewComment } from '../types/specReview'

interface PersistedRow {
  id: string
  spec_id: string
  line_start: number
  line_end: number
  selected_text: string
  comment: string
  created_at: number
}

export interface SpecReviewCommentStore {
  load: () => Promise<SpecReviewComment[]>
  save: (comments: SpecReviewComment[]) => Promise<void>
  clear: () => Promise<void>
}

function toDomain(row: PersistedRow, specId: string): SpecReviewComment {
  return {
    id: row.id,
    specId,
    lineRange: { start: row.line_start, end: row.line_end },
    selectedText: row.selected_text,
    comment: row.comment,
    timestamp: row.created_at,
  }
}

function toWire(c: SpecReviewComment): PersistedRow {
  return {
    id: c.id,
    spec_id: '',
    line_start: c.lineRange.start,
    line_end: c.lineRange.end,
    selected_text: c.selectedText,
    comment: c.comment,
    created_at: c.timestamp,
  }
}

export function useSpecReviewCommentStore(
  specName: string,
  projectPath: string | null,
): SpecReviewCommentStore {
  const scope = useMemo(() => (projectPath ? { projectPath } : {}), [projectPath])

  const load = useCallback(async () => {
    const rows = await invoke<PersistedRow[]>(
      TauriCommands.SchaltwerkCoreListSpecReviewComments,
      { name: specName, ...scope },
    )
    return rows.map(row => toDomain(row, specName))
  }, [scope, specName])

  const save = useCallback(async (comments: SpecReviewComment[]) => {
    await invoke(TauriCommands.SchaltwerkCoreSaveSpecReviewComments, {
      name: specName,
      comments: comments.map(toWire),
      ...scope,
    })
  }, [scope, specName])

  const clear = useCallback(async () => {
    await invoke(TauriCommands.SchaltwerkCoreClearSpecReviewComments, {
      name: specName,
      ...scope,
    })
  }, [scope, specName])

  return { load, save, clear }
}
