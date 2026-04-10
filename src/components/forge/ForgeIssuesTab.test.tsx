import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, render } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ForgeIssuesTab } from './ForgeIssuesTab'
import { renderWithProviders } from '../../tests/test-utils'
import type { ForgeIssueSummary, ForgeIssueDetails, ForgeSourceConfig } from '../../types/forgeTypes'
import { ForgeIntegrationContext, type ForgeIntegrationContextValue } from '../../contexts/ForgeIntegrationContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const testSource: ForgeSourceConfig = {
  projectIdentifier: 'owner/repo',
  hostname: 'github.com',
  label: 'GitHub',
  forgeType: 'github',
}

const secondSource: ForgeSourceConfig = {
  projectIdentifier: 'group/project-b',
  hostname: 'gitlab.example.com',
  label: 'Project B',
  forgeType: 'gitlab',
}

function makeSummary(overrides: Partial<ForgeIssueSummary> = {}): ForgeIssueSummary {
  return {
    id: '42',
    title: 'Fix login bug',
    state: 'OPEN',
    updatedAt: '2026-03-10T10:00:00Z',
    author: 'alice',
    labels: [{ name: 'bug', color: 'ff0000' }],
    url: 'https://github.com/owner/repo/issues/42',
    ...overrides,
  }
}

function makeDetails(overrides: Partial<ForgeIssueDetails> = {}): ForgeIssueDetails {
  return {
    summary: makeSummary(),
    body: 'The login form crashes on submit.',
    comments: [{ author: 'alice', createdAt: '2026-03-10T10:00:00Z', body: 'I can reproduce this.' }],
    ...overrides,
  }
}

function renderWithForgeStore(
  forgeOverrides: Partial<ForgeIntegrationContextValue>,
  store = createStore()
) {
  const value: ForgeIntegrationContextValue = {
    status: null,
    loading: false,
    forgeType: 'unknown',
    sources: [],
    hasRepository: false,
    hasSources: false,
    refreshStatus: async () => {},
    searchIssues: async () => [],
    getIssueDetails: async () => {
      throw new Error('getIssueDetails not configured')
    },
    searchPrs: async () => [],
    getPrDetails: async () => {
      throw new Error('getPrDetails not configured')
    },
    createSessionPr: async () => {
      throw new Error('createSessionPr not configured')
    },
    getReviewComments: async () => [],
    approvePr: async () => {
      throw new Error('approvePr not configured')
    },
    mergePr: async () => {
      throw new Error('mergePr not configured')
    },
    commentOnPr: async () => {
      throw new Error('commentOnPr not configured')
    },
    getPipelineStatus: async () => null,
    getPipelineJobs: async () => [],
    ...forgeOverrides,
  }

  return {
    store,
    ...render(
      <Provider store={store}>
        <ForgeIntegrationContext.Provider value={value}>
          <ForgeIssuesTab />
        </ForgeIntegrationContext.Provider>
      </Provider>
    ),
  }
}

describe('ForgeIssuesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders issues from search results', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'First issue', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Second issue', assignees: ['octocat'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeTruthy()
    })
    expect(screen.getByText('Second issue')).toBeTruthy()
  })

  it('shows #id prefix for each issue', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary({ id: '42', assignees: ['octocat'] })])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('#42')).toBeTruthy()
    })
  })

  it('shows state badges (Open/Closed)', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Open issue', state: 'OPEN', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Closed issue', state: 'CLOSED', assignees: ['octocat'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Open issue')).toBeTruthy()
    })

    const openBadges = screen.getAllByText('Open')
    const closedBadges = screen.getAllByText('Closed')
    expect(openBadges.length).toBeGreaterThanOrEqual(1)
    expect(closedBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('search input filters immediately', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Login bug', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Signup issue', assignees: ['octocat'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Login bug')).toBeTruthy()
    })

    const input = screen.getByPlaceholderText('Search issues...')
    fireEvent.change(input, { target: { value: 'Login' } })

    await waitFor(() => {
      expect(screen.getByText('Login bug')).toBeTruthy()
      expect(screen.queryByText('Signup issue')).toBeNull()
    })
  })

  it('shows empty state when no results', async () => {
    const searchIssues = vi.fn().mockResolvedValue([])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeTruthy()
    })
    expect(screen.getByText('Try adjusting your search')).toBeTruthy()
  })

  it('defaults to showing only issues assigned to the current user', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Assigned to me', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Assigned elsewhere', assignees: ['someone-else'] }),
      makeSummary({ id: '3', title: 'Unassigned', assignees: [] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Assigned to me')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'My Issues' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All Issues' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Assigned elsewhere')).toBeNull()
    expect(screen.queryByText('Unassigned')).toBeNull()
  })

  it('can switch to showing all issues', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Assigned to me', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Assigned elsewhere', assignees: ['someone-else'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Assigned to me')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'All Issues' }))

    await waitFor(() => {
      expect(screen.getByText('Assigned elsewhere')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'My Issues' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'All Issues' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles back to my issues after viewing all', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Assigned to me', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Assigned elsewhere', assignees: ['someone-else'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Assigned to me')).toBeTruthy()
    })
    expect(screen.queryByText('Assigned elsewhere')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All Issues' }))

    await waitFor(() => {
      expect(screen.getByText('Assigned elsewhere')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'My Issues' }))

    await waitFor(() => {
      expect(screen.queryByText('Assigned elsewhere')).toBeNull()
    })
    expect(screen.getByText('Assigned to me')).toBeTruthy()
  })

  it('shows empty state when filter yields no results', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Other issue', assignees: ['alice'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeTruthy()
    })
  })

  it('hides the filter toggle and shows all issues when no current user is available', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Assigned elsewhere', assignees: ['someone-else'] }),
      makeSummary({ id: '2', title: 'Unassigned', assignees: [] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        status: { forgeType: 'github', installed: true, authenticated: false },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Assigned elsewhere')).toBeTruthy()
    })

    expect(screen.getByText('Unassigned')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'My Issues' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'All Issues' })).toBeNull()
  })

  it('preserves the selected filter across remounts in the same app session', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Assigned to me', assignees: ['octocat'] }),
      makeSummary({ id: '2', title: 'Assigned elsewhere', assignees: ['someone-else'] }),
    ])
    const store = createStore()

    const firstRender = renderWithForgeStore({
      hasSources: true,
      sources: [testSource],
      searchIssues,
      status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
    }, store)

    await waitFor(() => {
      expect(screen.getByText('Assigned to me')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'All Issues' }))

    await waitFor(() => {
      expect(screen.getByText('Assigned elsewhere')).toBeTruthy()
    })

    firstRender.unmount()

    renderWithForgeStore({
      hasSources: true,
      sources: [testSource],
      searchIssues,
      status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
    }, store)

    await waitFor(() => {
      expect(screen.getByText('Assigned elsewhere')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'All Issues' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'My Issues' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows error banner', async () => {
    const searchIssues = vi.fn().mockRejectedValue(new Error('Network error'))

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch from GitHub')).toBeTruthy()
    })
  })

  it('shows info icon in error banner that opens error detail modal', async () => {
    const searchIssues = vi.fn().mockRejectedValue(new Error('Network error'))

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch from GitHub')).toBeTruthy()
    })

    const infoButton = screen.getByRole('button', { name: /error details/i })
    expect(infoButton).toBeTruthy()

    fireEvent.click(infoButton)

    await waitFor(() => {
      expect(screen.getByText('Error Details')).toBeTruthy()
    })
  })

  it('clicking issue fetches and shows detail view', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
    const getIssueDetails = vi.fn().mockResolvedValue(makeDetails())

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        getIssueDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Fix login bug'))

    await waitFor(() => {
      expect(screen.getByText('The login form crashes on submit.')).toBeTruthy()
    })
  })

  it('fetches details from the matching source in multi-source mode', async () => {
    const searchIssues = vi.fn().mockImplementation((source: ForgeSourceConfig) => {
      if (source.label === 'GitHub') {
        return Promise.resolve([])
      }
      if (source.label === 'Project B') {
        return Promise.resolve([makeSummary({ id: '1541', title: 'Self-hosted issue' })])
      }
      return Promise.resolve([])
    })
    const getIssueDetails = vi.fn().mockResolvedValue(
      makeDetails({
        summary: makeSummary({ id: '1541', title: 'Self-hosted issue' }),
      })
    )

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource, secondSource],
        searchIssues,
        getIssueDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Self-hosted issue')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Self-hosted issue'))

    await waitFor(() => {
      expect(getIssueDetails).toHaveBeenCalledWith(secondSource, '1541')
    })
  })

  it('shows error state when detail fetch returns null', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
    const getIssueDetails = vi.fn().mockResolvedValue(null)

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        getIssueDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Fix login bug'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })
  })

  it('can retry after detail fetch failure', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
    const getIssueDetails = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeDetails())

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        getIssueDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Fix login bug'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByText('The login form crashes on submit.')).toBeTruthy()
    })
  })

  it('excludes sources with issuesEnabled=false from search', async () => {
    const disabledSource: ForgeSourceConfig = {
      projectIdentifier: 'group/no-issues',
      hostname: 'gitlab.example.com',
      label: 'No Issues',
      forgeType: 'gitlab',
      issuesEnabled: false,
    }
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'First issue' }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource, disabledSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeTruthy()
    })

    const calledLabels = searchIssues.mock.calls.map((c) => (c as [ForgeSourceConfig])[0].label)
    expect(calledLabels).not.toContain('No Issues')
    expect(calledLabels).toContain('GitHub')
  })

  it('includes sources with issuesEnabled=true or undefined', async () => {
    const enabledSource: ForgeSourceConfig = {
      projectIdentifier: 'group/has-issues',
      hostname: 'gitlab.example.com',
      label: 'Has Issues',
      forgeType: 'gitlab',
      issuesEnabled: true,
    }
    const searchIssues = vi.fn().mockResolvedValue([])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource, enabledSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(searchIssues).toHaveBeenCalledTimes(2)
    })

    const calledLabels = searchIssues.mock.calls.map((c) => (c as [ForgeSourceConfig])[0].label)
    expect(calledLabels).toContain('GitHub')
    expect(calledLabels).toContain('Has Issues')
  })

  it('can go back to list after detail fetch failure', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary()])
    const getIssueDetails = vi.fn().mockResolvedValue(null)

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
        getIssueDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Fix login bug'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Back to list'))

    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeTruthy()
      expect(screen.queryByText('Failed to load details')).toBeNull()
    })
  })

  it('renders author in issue row', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '10', title: 'Test issue', author: 'alice' }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        searchIssues,
        sources: [testSource],
      },
    })

    await waitFor(() => {
      expect(screen.getByText(/by @alice/)).toBeTruthy()
    })
  })

  it('renders assignees in issue row', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '11', title: 'Assigned issue', assignees: ['bob', 'carol'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        searchIssues,
        sources: [testSource],
      },
    })

    await waitFor(() => {
      expect(screen.getByText('@bob')).toBeTruthy()
      expect(screen.getByText('@carol')).toBeTruthy()
    })
  })

  it('highlights current user assignee with accent color', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '13', title: 'My issue', assignees: ['bob', 'octocat', 'carol'] }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        searchIssues,
        sources: [testSource],
        status: { forgeType: 'github', installed: true, authenticated: true, userLogin: 'octocat' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('@octocat')).toBeTruthy()
    })

    const highlighted = screen.getByText('@octocat')
    expect(highlighted.style.color).toBe('var(--color-accent-blue)')
    expect(highlighted.style.fontWeight).toBe('600')

    const bob = screen.getByText('@bob')
    expect(bob.style.color).not.toBe('var(--color-accent-blue)')
  })

  it('hides author segment when author is missing', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '12', title: 'No author', author: undefined }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        searchIssues,
        sources: [testSource],
      },
    })

    await waitFor(() => {
      expect(screen.getByText('No author')).toBeTruthy()
    })
    expect(screen.queryByText(/by @/)).toBeNull()
  })

  it('refresh button re-triggers search', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary()])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(searchIssues).toHaveBeenCalledTimes(1)
    })

    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(searchIssues).toHaveBeenCalledTimes(2)
    })
  })
})
