import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'
import { useForgeIntegrationContext } from '../contexts/ForgeIntegrationContext'
import type { ForgeIntegrationContextValue } from '../contexts/ForgeIntegrationContext'

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

vi.mock('../contexts/ForgeIntegrationContext', () => ({
  useForgeIntegrationContext: vi.fn(() => ({
    forgeType: 'unknown',
    sources: [],
    hasRepository: false,
    hasSources: false,
    status: null,
  }))
}))

const mockUseForgeIntegrationContext = useForgeIntegrationContext as ReturnType<typeof vi.fn>

function mockForgeType(forgeType: string) {
  mockUseForgeIntegrationContext.mockReturnValue({
    forgeType,
    sources: [],
    hasRepository: forgeType !== 'unknown',
    hasSources: forgeType !== 'unknown',
    status: null,
  } as unknown as ForgeIntegrationContextValue)
}

describe('TopBar', () => {
  beforeEach(() => {
    mockForgeType('unknown')
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
    mockForgeType('gitlab')

    render(<TopBar {...baseProps} />)

    expect(screen.queryByTestId('github-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('gitlab-menu')).toBeInTheDocument()
  })

  it('hides GitLab button when forge is github', () => {
    mockForgeType('github')

    render(<TopBar {...baseProps} />)

    expect(screen.queryByTestId('gitlab-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('github-menu')).toBeInTheDocument()
  })

  it('shows both buttons when forge is unknown', () => {
    mockForgeType('unknown')

    render(<TopBar {...baseProps} />)

    expect(screen.getByTestId('github-menu')).toBeInTheDocument()
    expect(screen.getByTestId('gitlab-menu')).toBeInTheDocument()
  })
})
