// Phase 7 Wave B.3: render the stage-grouped task list above the
// existing session list. Self-contained so Sidebar.tsx stays under the
// 500-line cap — Sidebar mounts this as a single JSX element while the
// hook + 8 stage section renders live here.
//
// Wave D.1.b: when standalone non-task running sessions exist (cutover-
// day stragglers), surface a "Capture all running sessions as tasks"
// button so the user can promote them in bulk instead of right-
// clicking each one.

import { useCallback, useState } from 'react'
import { useAtomValue } from 'jotai'

import { useSidebarStageSections } from '../hooks/useSidebarStageSections'
import { SidebarStageSection } from './SidebarStageSection'
import { theme } from '../../../common/theme'
import { allSessionsAtom } from '../../../store/atoms/sessions'
import { projectPathAtom } from '../../../store/atoms/project'
import { captureSessionAsTask } from '../../../services/taskService'
import { logger } from '../../../utils/logger'
import type { EnrichedSession } from '../../../types/session'

function isStandaloneCaptureCandidate(session: EnrichedSession): boolean {
  // Live, non-task-bound, non-spec, non-cancelled. Cancelled sessions
  // have already been filtered out of `allSessionsAtom` by the time
  // they appear in the sidebar's running list, so we just guard on
  // the eligibility predicate the right-click menu uses.
  if (session.info.task_id) return false
  if (session.info.session_state === 'spec') return false
  return true
}

export function SidebarStageSectionsView() {
  const { sections, isCollapsed, toggleCollapsed } = useSidebarStageSections()
  const allSessions = useAtomValue(allSessionsAtom)
  const projectPath = useAtomValue(projectPathAtom)
  const [bulkCapturing, setBulkCapturing] = useState(false)

  const totalTasks = sections.reduce((sum, s) => sum + s.tasks.length, 0)
  const standaloneCandidates = allSessions.filter(isStandaloneCaptureCandidate)

  const handleBulkCapture = useCallback(async () => {
    if (bulkCapturing || standaloneCandidates.length === 0) return
    setBulkCapturing(true)
    let captured = 0
    let failed = 0
    for (const session of standaloneCandidates) {
      try {
        await captureSessionAsTask(session.info.session_id, projectPath ?? null)
        captured++
      } catch (err) {
        failed++
        logger.warn(
          `[SidebarStageSectionsView] capture failed for ${session.info.session_id}`,
          err,
        )
      }
    }
    logger.info(
      `[SidebarStageSectionsView] bulk capture complete: ${captured} captured, ${failed} failed`,
    )
    setBulkCapturing(false)
  }, [bulkCapturing, projectPath, standaloneCandidates])

  const bulkCapturePill =
    standaloneCandidates.length > 0 ? (
      <button
        type="button"
        data-testid="sidebar-bulk-capture-button"
        aria-label={`Capture all ${standaloneCandidates.length} running sessions as draft tasks`}
        onClick={() => void handleBulkCapture()}
        disabled={bulkCapturing}
        className="mx-3 mb-2 inline-flex items-center justify-between gap-2 rounded border px-2 py-1.5"
        style={{
          fontSize: theme.fontSize.caption,
          color: 'var(--color-accent-blue-light)',
          backgroundColor: 'var(--color-accent-blue-bg)',
          borderColor: 'var(--color-accent-blue-border)',
          lineHeight: theme.lineHeight.compact,
        }}
      >
        <span>
          {bulkCapturing
            ? `Capturing ${standaloneCandidates.length} session${standaloneCandidates.length === 1 ? '' : 's'}…`
            : `Capture ${standaloneCandidates.length} running session${standaloneCandidates.length === 1 ? '' : 's'} as task${standaloneCandidates.length === 1 ? '' : 's'}`}
        </span>
      </button>
    ) : null

  if (totalTasks === 0) {
    return (
      <div data-testid="sidebar-stage-sections-empty-container">
        {bulkCapturePill}
        <div
          data-testid="sidebar-stage-sections-empty"
          className="px-3 py-2"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-tertiary)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          No tasks. Create one with + New Task
        </div>
      </div>
    )
  }

  return (
    <div data-testid="sidebar-stage-sections">
      {bulkCapturePill}
      {sections.map((section) => (
        <SidebarStageSection
          key={section.key}
          sectionKey={section.key}
          tasks={section.tasks}
          collapsed={isCollapsed(section.key)}
          onToggleCollapsed={() => toggleCollapsed(section.key)}
        />
      ))}
    </div>
  )
}
