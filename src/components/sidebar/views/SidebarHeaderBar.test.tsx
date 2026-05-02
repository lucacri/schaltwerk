import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { SidebarHeaderBar } from './SidebarHeaderBar'

describe('SidebarHeaderBar — view-mode toggle (Phase 7 kanban disable)', () => {
  it('renders the toggle as disabled with the "returns in v2.1" tooltip', () => {
    render(
      <SidebarHeaderBar
        isCollapsed={false}
        sidebarViewMode="list"
        setSidebarViewMode={() => {}}
        leftSidebarShortcut=""
      />,
    )
    const toggle = screen.getByTestId('sidebar-view-mode-toggle')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(toggle.getAttribute('title')).toMatch(/v2\.1/)
    expect(toggle.textContent).toMatch(/Board v2\.1/i)
  })

  it('forces list mode when clicked while persisted value is stale "board"', () => {
    const setSidebarViewMode = vi.fn()
    render(
      <SidebarHeaderBar
        isCollapsed={false}
        sidebarViewMode="board"
        setSidebarViewMode={setSidebarViewMode}
        leftSidebarShortcut=""
      />,
    )
    fireEvent.click(screen.getByTestId('sidebar-view-mode-toggle'))
    expect(setSidebarViewMode).toHaveBeenCalledWith('list')
  })

  it('does not flip the persisted value when clicked while already on list', () => {
    const setSidebarViewMode = vi.fn()
    render(
      <SidebarHeaderBar
        isCollapsed={false}
        sidebarViewMode="list"
        setSidebarViewMode={setSidebarViewMode}
        leftSidebarShortcut=""
      />,
    )
    fireEvent.click(screen.getByTestId('sidebar-view-mode-toggle'))
    expect(setSidebarViewMode).not.toHaveBeenCalled()
  })

  it('hides the toggle when the sidebar is collapsed', () => {
    render(
      <SidebarHeaderBar
        isCollapsed
        sidebarViewMode="list"
        setSidebarViewMode={() => {}}
        leftSidebarShortcut=""
      />,
    )
    expect(screen.queryByTestId('sidebar-view-mode-toggle')).toBeNull()
  })
})
