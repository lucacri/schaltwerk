import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ForgePrsTab } from './ForgePrsTab'
import { renderWithProviders } from '../../tests/test-utils'
import type { ForgePrSummary, ForgePrDetails, ForgeSourceConfig } from '../../types/forgeTypes'

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

function makePrSummary(overrides: Partial<ForgePrSummary> = {}): ForgePrSummary {
  return {
    id: '99',
    title: 'Add feature X',
    state: 'OPEN',
    author: 'alice',
    labels: [{ name: 'enhancement' }],
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    url: 'https://github.com/owner/repo/pull/99',
    ...overrides,
  }
}

function makePrDetails(overrides: Partial<ForgePrDetails> = {}): ForgePrDetails {
  return {
    summary: makePrSummary(),
    body: 'This PR adds feature X.',
    reviews: [],
    reviewComments: [],
    providerData: { type: 'None' },
    ...overrides,
  }
}

describe('ForgePrsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders PRs from search results', async () => {
    const searchPrs = vi.fn().mockResolvedValue([
      makePrSummary({ id: '1', title: 'First PR' }),
      makePrSummary({ id: '2', title: 'Second PR' }),
    ])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('First PR')).toBeTruthy()
    })
    expect(screen.getByText('Second PR')).toBeTruthy()
  })

  it('shows #id prefix', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary({ id: '99' })])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('#99')).toBeTruthy()
    })
  })

  it('shows state badges (Open/Closed/Merged)', async () => {
    const searchPrs = vi.fn().mockResolvedValue([
      makePrSummary({ id: '1', title: 'Open PR', state: 'OPEN' }),
      makePrSummary({ id: '2', title: 'Closed PR', state: 'CLOSED' }),
      makePrSummary({ id: '3', title: 'Merged PR', state: 'MERGED' }),
    ])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Open PR')).toBeTruthy()
    })

    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Merged').length).toBeGreaterThanOrEqual(1)
  })

  it('shows branch names', async () => {
    const searchPrs = vi.fn().mockResolvedValue([
      makePrSummary({ id: '1', sourceBranch: 'feature/login' }),
    ])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('feature/login')).toBeTruthy()
    })
  })

  it('search input retains focus after typing', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary()])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
    })

    const input = screen.getByPlaceholderText('Search pull requests...')
    input.focus()
    fireEvent.change(input, { target: { value: 'test' } })
    expect(document.activeElement).toBe(input)
  })

  it('shows empty state', async () => {
    const searchPrs = vi.fn().mockResolvedValue([])

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('No pull requests found')).toBeTruthy()
    })
    expect(screen.getByText('Try adjusting your search')).toBeTruthy()
  })

  it('shows error banner with info icon that opens error detail modal', async () => {
    const searchPrs = vi.fn().mockRejectedValue(new Error('Network error'))

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
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

  it('clicking PR fetches and shows detail view', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary()])
    const getPrDetails = vi.fn().mockResolvedValue(makePrDetails())

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
        getPrDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Add feature X'))

    await waitFor(() => {
      expect(screen.getByText('This PR adds feature X.')).toBeTruthy()
    })
  })

  it('fetches PR details from the matching source in multi-source mode', async () => {
    const searchPrs = vi.fn().mockImplementation((source: ForgeSourceConfig) => {
      if (source.label === 'GitHub') {
        return Promise.resolve([])
      }
      if (source.label === 'Project B') {
        return Promise.resolve([makePrSummary({ id: '1541', title: 'Self-hosted PR' })])
      }
      return Promise.resolve([])
    })
    const getPrDetails = vi.fn().mockResolvedValue(
      makePrDetails({
        summary: makePrSummary({ id: '1541', title: 'Self-hosted PR' }),
      })
    )

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource, secondSource],
        searchPrs,
        getPrDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Self-hosted PR')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Self-hosted PR'))

    await waitFor(() => {
      expect(getPrDetails).toHaveBeenCalledWith(secondSource, '1541')
    })
  })

  it('shows error state when detail fetch returns null', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary()])
    const getPrDetails = vi.fn().mockResolvedValue(null)

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
        getPrDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Add feature X'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })
  })

  it('can retry after PR detail fetch failure', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary()])
    const getPrDetails = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePrDetails())

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
        getPrDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Add feature X'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByText('This PR adds feature X.')).toBeTruthy()
    })
  })

  it('can go back to list after PR detail fetch failure', async () => {
    const searchPrs = vi.fn().mockResolvedValue([makePrSummary()])
    const getPrDetails = vi.fn().mockResolvedValue(null)

    renderWithProviders(<ForgePrsTab />, {
      forgeOverrides: {
        hasSources: true,
        sources: [testSource],
        searchPrs,
        getPrDetails,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Add feature X'))

    await waitFor(() => {
      expect(screen.getByText('Failed to load details')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Back to list'))

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy()
      expect(screen.queryByText('Failed to load details')).toBeNull()
    })
  })
})
