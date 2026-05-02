// Phase 7 Wave B.3: render the stage-grouped task list above the
// existing session list. Self-contained so Sidebar.tsx stays under the
// 500-line cap — Sidebar mounts this as a single JSX element while the
// hook + 8 stage section renders live here.
//
// Empty across-the-board state (no tasks at all): show a single empty
// placeholder rather than rendering 8 empty headers. This is a
// projection over `tasksAtom`; the listener in Wave A.3 keeps it
// fresh.

import { useSidebarStageSections } from '../hooks/useSidebarStageSections'
import { SidebarStageSection } from './SidebarStageSection'
import { theme } from '../../../common/theme'

export function SidebarStageSectionsView() {
  const { sections, isCollapsed, toggleCollapsed } = useSidebarStageSections()
  const totalTasks = sections.reduce((sum, s) => sum + s.tasks.length, 0)

  if (totalTasks === 0) {
    return (
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
    )
  }

  return (
    <div data-testid="sidebar-stage-sections">
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
