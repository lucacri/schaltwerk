// Phase 7 Wave C.3: derive the slot presentation list for a single
// TaskRun from the existing session list.
//
// Reads `allSessionsAtom` (the canonical session list) and filters to
// sessions whose `task_run_id` matches the given run. Each session's
// `slot_key` becomes the slot label; status is derived from
// `exit_code` and `first_idle_at` per the same rules
// `compute_run_status` uses on the backend (per-slot version):
//
// - exit_code != 0 (and unset) → 'failed'
// - first_idle_at is set      → 'idle'
// - otherwise                 → 'running'
//
// `selectedSessionId` (typically `task_run.selected_session_id`) flips
// the corresponding slot's `isWinner` flag so the UI can highlight it.

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'

import { allSessionsAtom } from '../../../store/atoms/sessions'
import type {
  TaskRunSlotPresentation,
  TaskRunSlotStatus,
} from '../TaskRunSlots'

export function useTaskRunSlots(
  runId: string | null,
  selectedSessionId: string | null,
): TaskRunSlotPresentation[] {
  const sessions = useAtomValue(allSessionsAtom)

  return useMemo(() => {
    if (!runId) return []
    const bound = sessions.filter((s) => s.info.task_run_id === runId)
    return bound.map((s) => ({
      sessionId: s.info.session_id,
      slotKey: s.info.slot_key ?? '?',
      status: classifySlotStatus(s.info.exit_code, s.info.first_idle_at),
      isWinner: s.info.session_id === selectedSessionId,
      label: s.info.display_name ?? s.info.session_id,
    }))
  }, [runId, selectedSessionId, sessions])
}

function classifySlotStatus(
  exitCode: number | null | undefined,
  firstIdleAt: string | null | undefined,
): TaskRunSlotStatus {
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return 'failed'
  }
  if (firstIdleAt) {
    return 'idle'
  }
  return 'running'
}
