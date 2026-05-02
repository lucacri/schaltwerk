// Phase 7 Wave B.1: pure projection from task list to the stage-grouped
// sidebar shape. Replaces the lifecycle (specs/running) section split
// from `splitVersionGroupsBySection` with a stage-keyed split.
//
// Cancellation is orthogonal to stage in v2 (Phase 3 collapsed
// `TaskStage::Cancelled` to `task.cancelled_at`). A task with a
// non-null `cancelled_at` therefore lives in the **Cancelled** section
// regardless of what `task.stage` reads — that pin lives in
// `buildStageSections.test.ts` and guards against the v1 bug class
// where a cancelled+ready task appeared in BOTH sections.

import { STAGE_ORDER, type Task, type TaskStage } from '../../../types/task'

/**
 * A sidebar section key. Either one of the seven `TaskStage` values, or
 * the synthetic `'cancelled'` key for tasks with `cancelled_at !== null`.
 */
export type StageSectionKey = TaskStage | 'cancelled'

/**
 * Canonical render order: stages in `STAGE_ORDER`, then Cancelled last.
 * Pinned by `buildStageSections.test.ts` so a future stage addition
 * that forgets to update the array fails the build.
 */
export const STAGE_SECTION_KEYS: readonly StageSectionKey[] = [
  ...STAGE_ORDER,
  'cancelled',
] as const

export interface StageSection {
  key: StageSectionKey
  tasks: Task[]
}

/**
 * Project a task list into the 8-section stage-grouped shape.
 *
 * Always returns all 8 sections (even empty ones) so the sidebar can
 * render stable headers.
 *
 * Tasks within a section are sorted by `name` for stable visual order.
 * That mirrors v1's sidebar behavior; the `name` field is sanitized
 * by `sanitizeName` at creation time so this is also a deterministic
 * lexicographic sort across locales.
 */
export function buildStageSections(tasks: readonly Task[]): StageSection[] {
  const sections: Record<StageSectionKey, Task[]> = {
    draft: [],
    ready: [],
    brainstormed: [],
    planned: [],
    implemented: [],
    pushed: [],
    done: [],
    cancelled: [],
  }

  for (const task of tasks) {
    const key: StageSectionKey = task.cancelled_at !== null ? 'cancelled' : task.stage
    sections[key].push(task)
  }

  for (const list of Object.values(sections)) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }

  return STAGE_SECTION_KEYS.map((key) => ({ key, tasks: sections[key] }))
}
