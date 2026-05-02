import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { SidebarStageSection } from './SidebarStageSection'
import type { Task } from '../../../types/task'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'one',
    display_name: null,
    repository_path: '/tmp/repo',
    repository_name: 'repo',
    variant: 'regular',
    stage: 'draft',
    request_body: '',
    source_kind: null,
    source_url: null,
    task_host_session_id: null,
    task_branch: null,
    base_branch: null,
    issue_number: null,
    issue_url: null,
    pr_number: null,
    pr_url: null,
    pr_state: null,
    failure_flag: false,
    epic_id: null,
    attention_required: false,
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    cancelled_at: null,
    task_runs: [],
    ...overrides,
  }
}

describe('SidebarStageSection', () => {
  it('renders the stage label as a section header with task count', () => {
    render(
      <SidebarStageSection
        sectionKey="ready"
        tasks={[
          makeTask({ id: 'a', stage: 'ready' }),
          makeTask({ id: 'b', stage: 'ready' }),
        ]}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    // Scope the header label to the toggle button (each TaskRow also
    // renders a stage badge with the same text).
    const header = screen.getByRole('button', { name: /Collapse Ready section/i })
    expect(header).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-section-count')).toHaveTextContent('2')
  })

  it('renders one row per task when expanded', () => {
    render(
      <SidebarStageSection
        sectionKey="planned"
        tasks={[
          makeTask({ id: 'alpha', name: 'alpha', stage: 'planned' }),
          makeTask({ id: 'beta', name: 'beta', stage: 'planned' }),
          makeTask({ id: 'gamma', name: 'gamma', stage: 'planned' }),
        ]}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.getAllByTestId('task-row-stage-badge')).toHaveLength(3)
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()
  })

  it('hides task rows when collapsed', () => {
    render(
      <SidebarStageSection
        sectionKey="draft"
        tasks={[makeTask({ id: 'hidden', stage: 'draft' })]}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.queryByTestId('task-row-stage-badge')).toBeNull()
  })

  it('renders an empty-state placeholder when no tasks are present', () => {
    render(
      <SidebarStageSection
        sectionKey="brainstormed"
        tasks={[]}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.getByTestId('sidebar-stage-empty')).toBeInTheDocument()
  })

  it('does not render the empty-state placeholder when collapsed', () => {
    render(
      <SidebarStageSection
        sectionKey="brainstormed"
        tasks={[]}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.queryByTestId('sidebar-stage-empty')).toBeNull()
  })

  it('invokes onToggleCollapsed when the header is clicked', () => {
    const onToggle = vi.fn()
    render(
      <SidebarStageSection
        sectionKey="ready"
        tasks={[]}
        collapsed={false}
        onToggleCollapsed={onToggle}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('renders a special "Cancelled" header for cancelled tasks', () => {
    render(
      <SidebarStageSection
        sectionKey="cancelled"
        tasks={[makeTask({ id: 'killed', cancelled_at: '2026-05-02T00:00:00Z' })]}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Cancelled section/i }),
    ).toBeInTheDocument()
  })
})
