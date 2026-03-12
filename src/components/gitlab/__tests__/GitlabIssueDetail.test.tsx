import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabIssueDetail } from '../GitlabIssueDetail'
import type { GitlabIssueDetails } from '../../../types/gitlabTypes'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const mockDetails: GitlabIssueDetails = {
  iid: 42,
  title: 'Test issue',
  url: 'https://gitlab.example.com/group/project/-/issues/42',
  description: 'A test description',
  labels: [],
  state: 'opened',
  notes: [],
  sourceLabel: 'my-project',
}

describe('GitlabIssueDetail', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('opens URL via Tauri command when clicking Open in GitLab', () => {
    renderWithProviders(
      <GitlabIssueDetail details={mockDetails} onBack={vi.fn()} />
    )

    const openButton = screen.getByText('Open in GitLab')
    fireEvent.click(openButton)

    expect(invokeMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://gitlab.example.com/group/project/-/issues/42',
    })
  })
})
