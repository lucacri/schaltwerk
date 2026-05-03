// Phase 7 Wave B.1: read-side hook that exposes the stage-grouped
// sidebar shape plus per-section collapse state.
//
// Pulls from `tasksAtom` so the listener in Wave A.3 drives the
// sidebar projection automatically. Collapse is component-state for
// now (Wave B.3 wires it through `useSidebarCollapsePersistence`-style
// localStorage persistence once the sidebar uses this hook in anger).
//
// Done and Cancelled sections start collapsed by default — terminal
// tasks are noise unless the user explicitly looks for them. Other
// stages default expanded.

import { useCallback, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'

import { tasksAtom } from '../../../store/atoms/tasks'
import {
  STAGE_SECTION_KEYS,
  buildStageSections,
  type StageSection,
  type StageSectionKey,
} from '../helpers/buildStageSections'

export interface UseSidebarStageSectionsResult {
  sections: StageSection[]
  isCollapsed: (key: StageSectionKey) => boolean
  toggleCollapsed: (key: StageSectionKey) => void
}

const DEFAULT_COLLAPSE: Record<StageSectionKey, boolean> = {
  draft: false,
  ready: false,
  brainstormed: false,
  planned: false,
  implemented: false,
  pushed: false,
  done: true,
  cancelled: true,
}

export function useSidebarStageSections(): UseSidebarStageSectionsResult {
  const tasks = useAtomValue(tasksAtom)

  const sections = useMemo(() => buildStageSections(tasks), [tasks])

  const [collapsed, setCollapsed] = useState<Record<StageSectionKey, boolean>>(
    DEFAULT_COLLAPSE,
  )

  const isCollapsed = useCallback(
    (key: StageSectionKey) => collapsed[key],
    [collapsed],
  )

  const toggleCollapsed = useCallback((key: StageSectionKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return { sections, isCollapsed, toggleCollapsed }
}

// Re-export for ergonomic single-import sites.
export { STAGE_SECTION_KEYS }
export type { StageSection, StageSectionKey }
