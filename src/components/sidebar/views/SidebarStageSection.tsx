// Phase 7 Wave B.2: render one stage section.
//
// Pairs the canonical `SidebarSectionHeader` (which lives at
// `src/components/sidebar/SidebarSectionHeader.tsx` and is shared with
// the legacy lifecycle sections) with a list of placeholder task rows.
// The actual `TaskRow` lands in Wave C.1; until then this view renders
// the bare minimum so Wave B.3 can wire it into Sidebar.tsx and the
// projection plumbing surfaces in user-visible UI.
//
// Empty state shows a small placeholder ("No tasks") rather than
// silently rendering nothing — without it, an empty stage section
// looks like a layout glitch.

import { theme } from '../../../common/theme'
import type { Task } from '../../../types/task'
import type { StageSectionKey } from '../helpers/buildStageSections'
import { SidebarSectionHeader } from '../SidebarSectionHeader'

export interface SidebarStageSectionProps {
  sectionKey: StageSectionKey
  tasks: readonly Task[]
  collapsed: boolean
  onToggleCollapsed: () => void
}

const SECTION_LABELS: Record<StageSectionKey, string> = {
  draft: 'Draft',
  ready: 'Ready',
  brainstormed: 'Brainstormed',
  planned: 'Planned',
  implemented: 'Implemented',
  pushed: 'Pushed',
  done: 'Done',
  cancelled: 'Cancelled',
}

export function SidebarStageSection({
  sectionKey,
  tasks,
  collapsed,
  onToggleCollapsed,
}: SidebarStageSectionProps) {
  const label = SECTION_LABELS[sectionKey]
  const toggleLabel = collapsed
    ? `Expand ${label} section`
    : `Collapse ${label} section`

  return (
    <section data-testid={`sidebar-stage-section-${sectionKey}`}>
      <SidebarSectionHeader
        title={label}
        count={tasks.length}
        collapsed={collapsed}
        toggleLabel={toggleLabel}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && tasks.length > 0 && (
        <ul
          data-testid={`sidebar-stage-list-${sectionKey}`}
          className="flex flex-col gap-0.5 px-1 py-1"
        >
          {tasks.map((task) => (
            <li
              key={task.id}
              data-testid="sidebar-stage-task-row-placeholder"
              data-task-id={task.id}
              className="px-2 py-1 rounded hover:bg-bg-hover/30"
              style={{
                fontSize: theme.fontSize.body,
                color: 'var(--color-text-primary)',
                lineHeight: theme.lineHeight.normal,
              }}
            >
              {task.display_name ?? task.name}
            </li>
          ))}
        </ul>
      )}

      {!collapsed && tasks.length === 0 && (
        <div
          data-testid="sidebar-stage-empty"
          className="px-3 py-2"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-tertiary)',
            lineHeight: theme.lineHeight.compact,
          }}
        >
          No tasks
        </div>
      )}
    </section>
  )
}
