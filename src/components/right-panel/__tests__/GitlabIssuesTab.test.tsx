import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabIssuesTab } from '../GitlabIssuesTab'
import { describe, it, expect, beforeEach, type Mock } from 'vitest'
import type { GitlabIssueSummary } from '../../../types/gitlabTypes'

const mockInvoke = invoke as Mock

const backendSource = {
  id: '1',
  label: 'Backend',
  projectPath: 'group/backend',
  hostname: 'gitlab.com',
  issuesEnabled: true,
  mrsEnabled: false,
  pipelinesEnabled: false,
}

const frontendSource = {
  id: '2',
  label: 'Frontend',
  projectPath: 'group/frontend',
  hostname: 'gitlab.com',
  issuesEnabled: true,
  mrsEnabled: false,
  pipelinesEnabled: false,
}

const backendIssues: GitlabIssueSummary[] = [
  {
    iid: 1,
    title: 'Fix API timeout',
    state: 'opened',
    updatedAt: '2026-03-10T12:00:00Z',
    author: 'alice',
    labels: ['bug'],
    url: 'https://gitlab.com/group/backend/-/issues/1',
    sourceLabel: 'Backend',
  },
]

const frontendIssues: GitlabIssueSummary[] = [
  {
    iid: 2,
    title: 'Update button styles',
    state: 'opened',
    updatedAt: '2026-03-09T12:00:00Z',
    author: 'bob',
    labels: ['ui'],
    url: 'https://gitlab.com/group/frontend/-/issues/2',
    sourceLabel: 'Frontend',
  },
]

describe('GitlabIssuesTab', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('renders issues from both sources', async () => {
    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.sourceProject === 'group/backend') return backendIssues
      if (args?.sourceProject === 'group/frontend') return frontendIssues
      return []
    })

    renderWithProviders(<GitlabIssuesTab />, {
      gitlabOverrides: {
        sources: [backendSource, frontendSource],
        hasSources: true,
        status: { installed: true, authenticated: true },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix API timeout')).toBeInTheDocument()
    })
    expect(screen.getByText('Update button styles')).toBeInTheDocument()
  })

  it('search input retains focus after typing', async () => {
    mockInvoke.mockImplementation(async () => [])

    renderWithProviders(<GitlabIssuesTab />, {
      gitlabOverrides: {
        sources: [backendSource],
        hasSources: true,
        status: { installed: true, authenticated: true },
      },
    })

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText(/search/i)

    await act(async () => {
      input.focus()
    })
    expect(document.activeElement).toBe(input)

    await act(async () => {
      fireEvent.change(input, { target: { value: 'timeout' } })
    })
    expect(input).toHaveValue('timeout')
    expect(document.activeElement).toBe(input)
  })

  it('does not unmount when search triggers state updates', async () => {
    let callCount = 0
    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      callCount++
      if (args?.sourceProject === 'group/backend') return backendIssues
      return []
    })

    renderWithProviders(<GitlabIssuesTab />, {
      gitlabOverrides: {
        sources: [backendSource],
        hasSources: true,
        status: { installed: true, authenticated: true },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Fix API timeout')).toBeInTheDocument()
    })

    const initialCallCount = callCount
    const input = screen.getByPlaceholderText(/search/i)

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } })
    })

    await waitFor(() => {
      expect(callCount).toBeGreaterThan(initialCallCount)
    })

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('shows error details modal when Details button is clicked', async () => {
    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.sourceProject === 'group/backend') return backendIssues
      if (args?.sourceProject === 'group/frontend') return Promise.reject('403 Forbidden')
      return []
    })

    renderWithProviders(<GitlabIssuesTab />, {
      gitlabOverrides: {
        sources: [backendSource, frontendSource],
        hasSources: true,
        status: { installed: true, authenticated: true },
      },
    })

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch issues/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Details'))

    await waitFor(() => {
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
    })
  })
})
