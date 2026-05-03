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
