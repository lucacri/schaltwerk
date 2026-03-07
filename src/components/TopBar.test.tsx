import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'
import { useForgeType } from '../hooks/useForgeType'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn()
  })
}))

vi.mock('../utils/platform', () => ({
  getPlatform: vi.fn(async () => 'mac')
}))

vi.mock('../keyboardShortcuts/helpers', () => ({
  detectPlatformSafe: () => 'mac'
}))

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />
}))

vi.mock('./OpenInSplitButton', () => ({
  OpenInSplitButton: () => <div data-testid="open-in-split" />
}))

vi.mock('./BranchIndicator', () => ({
  BranchIndicator: () => <div data-testid="branch-indicator" />
}))

vi.mock('./github/GithubMenuButton', () => ({
  GithubMenuButton: () => <div data-testid="github-menu" />
}))

vi.mock('./gitlab/GitlabMenuButton', () => ({
  GitlabMenuButton: () => <div data-testid="gitlab-menu" />
}))

vi.mock('./WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('../hooks/useForgeType', () => ({
  useForgeType: vi.fn(() => 'unknown')
}))

const mockUseForgeType = useForgeType as ReturnType<typeof vi.fn>

describe('TopBar', () => {
  beforeEach(() => {
    mockUseForgeType.mockReturnValue('unknown')
  })

  const baseProps = {
    tabs: [{ projectPath: '/tmp/project', projectName: 'Project' }],
    activeTabPath: '/tmp/project',
    onGoHome: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenSettings: vi.fn(),
  }

  it('renders a right panel toggle when handler is provided', () => {
    const onToggleRightPanel = vi.fn()

    render(
      <TopBar
        {...baseProps}
        onToggleRightPanel={onToggleRightPanel}
      />
    )

    const toggle = screen.getByLabelText('Hide right panel')
    fireEvent.click(toggle)
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1)
  })

  it('shows the correct aria label when the right panel is collapsed', () => {
    render(
      <TopBar
        {...baseProps}
        isRightPanelCollapsed={true}
        onToggleRightPanel={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Show right panel')).toBeInTheDocument()
  })

  it('hides GitHub button when forge is gitlab', () => {
    mockUseForgeType.mockReturnValue('gitlab')

    render(<TopBar {...baseProps} />)

    expect(screen.queryByTestId('github-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('gitlab-menu')).toBeInTheDocument()
  })

  it('hides GitLab button when forge is github', () => {
    mockUseForgeType.mockReturnValue('github')

    render(<TopBar {...baseProps} />)

    expect(screen.queryByTestId('gitlab-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('github-menu')).toBeInTheDocument()
  })

  it('shows both buttons when forge is unknown', () => {
    mockUseForgeType.mockReturnValue('unknown')

    render(<TopBar {...baseProps} />)

    expect(screen.getByTestId('github-menu')).toBeInTheDocument()
    expect(screen.getByTestId('gitlab-menu')).toBeInTheDocument()
  })
})
