import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ForgeIssuesTab } from './ForgeIssuesTab'
import { renderWithProviders } from '../../tests/test-utils'
import type { ForgeIssueSummary, ForgeIssueDetails, ForgeSourceConfig } from '../../types/forgeTypes'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const testSource: ForgeSourceConfig = {
  projectIdentifier: 'owner/repo',
  hostname: 'github.com',
  label: 'GitHub',
  forgeType: 'github',
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

describe('ForgeIssuesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders issues from search results', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'First issue' }),
      makeSummary({ id: '2', title: 'Second issue' }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('First issue')).toBeTruthy()
    })
    expect(screen.getByText('Second issue')).toBeTruthy()
  })

  it('shows #id prefix for each issue', async () => {
    const searchIssues = vi.fn().mockResolvedValue([makeSummary({ id: '42' })])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('#42')).toBeTruthy()
    })
  })

  it('shows state badges (Open/Closed)', async () => {
    const searchIssues = vi.fn().mockResolvedValue([
      makeSummary({ id: '1', title: 'Open issue', state: 'OPEN' }),
      makeSummary({ id: '2', title: 'Closed issue', state: 'CLOSED' }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
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
      makeSummary({ id: '1', title: 'Login bug' }),
      makeSummary({ id: '2', title: 'Signup issue' }),
    ])

    renderWithProviders(<ForgeIssuesTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchIssues,
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
})
